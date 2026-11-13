const USER_AGENT = "krs-mcp/1.0";

const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [30_000, 60_000];

// Known public base for KRS Open API (REST returning JSON odpisy).
// If MS changes routing/domains, adjust this single constant.
const KRS_API_BASE = "https://api-krs.ms.gov.pl/api/krs";

export type ExtractType = "OdpisAktualny" | "OdpisPelny";

/**
 * Wynik zapytania do API KRS. `not_found` oznacza odpowiedź 404 (podmiotu nie ma w danym rejestrze)
 * albo 204 (podmiot wykreślony – istnieje tylko odpis pełny).
 */
export type KrsFetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "not_found" }
  | { status: "error"; error: string };

/**
 * Build URL for KRS odpis (OdpisAktualny/OdpisPelny) with rejestr as a query param:
 *   `${KRS_API_BASE}/{typ_odpisu}/{krs}?rejestr={P|S}&format=json`
 */
export function buildExtractUrl(opts: { type: ExtractType; rejestr: string; krs: string }): string {
  const { type, rejestr, krs } = opts;
  return `${KRS_API_BASE}/${type}/${krs}?rejestr=${rejestr}&format=json`;
}

export function buildExtractUrlPath(opts: { type: ExtractType; rejestr: string; krs: string }): string {
  const { type, rejestr, krs } = opts;
  return `${KRS_API_BASE}/${type}/${rejestr}/${krs}?format=json`;
}

export function buildExtractUrls(opts: { type: ExtractType; rejestr: string; krs: string }): string[] {
  // The query-param form is the one the API serves; the path form currently answers 404
  // even for existing entities, so it is only a fallback in case MS changes routing.
  return [buildExtractUrl(opts), buildExtractUrlPath(opts)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 4xx means the request itself is wrong or the entity does not exist – retrying will not help.
// 408 (timeout) and 429 (rate limit) are the exceptions worth another attempt.
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export interface FetchKrsOptions {
  /** Pauses before successive retries; defaults to 30 s and 60 s. An empty list disables retries. */
  retryDelaysMs?: readonly number[];
}

async function fetchKrsSingle<T>(
  url: string,
  logFailure: boolean,
  retryDelaysMs: readonly number[]
): Promise<KrsFetchResult<T>> {
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  const maxAttempts = retryDelaysMs.length + 1;
  let lastError = "unknown error";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout")), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      // 204 is what OdpisAktualny answers for an entity struck off the register: it exists, but has no current extract.
      if (res.status === 404 || res.status === 204) {
        return { status: "not_found" };
      }
      if (res.ok) {
        return { status: "ok", data: (await res.json()) as T };
      }
      if (!isRetryableStatus(res.status)) {
        if (logFailure) console.error("KRS request error:", `HTTP ${res.status}`);
        return { status: "error", error: `HTTP ${res.status}` };
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts - 1) {
        if (logFailure) {
          console.error("KRS request error:", err);
        }
        break;
      }

      console.error("KRS request error (will retry):", err);
      await sleep(retryDelaysMs[attempt]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { status: "error", error: lastError };
}

async function fetchKrsUncached<T>(urls: string[], retryDelaysMs: readonly number[]): Promise<KrsFetchResult<T>> {
  let firstError: KrsFetchResult<T> | null = null;

  for (let index = 0; index < urls.length; index++) {
    const logFailure = index === urls.length - 1;
    const result = await fetchKrsSingle<T>(urls[index], logFailure, retryDelaysMs);
    if (result.status === "ok") return result;
    if (result.status === "error" && !firstError) firstError = result;
  }

  return firstError ?? { status: "not_found" };
}

// ---------------------------------------------------------------------------
// Cache – the same extract is often needed several times in one conversation (status, profile,
// history, watchlist details), and a full extract of a large company is ~350 kB.
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_TTL_SECONDS = 600;
/** Full extracts take a few MB in memory each, so the cache keeps only the most recently used ones. */
const CACHE_MAX_ENTRIES = 50;

interface CacheEntry {
  expiresAt: number;
  result: Promise<KrsFetchResult<unknown>>;
}

const cache = new Map<string, CacheEntry>();

/** `KRS_CACHE_TTL_SECONDS` overrides the 10-minute lifetime; 0 turns the cache off. */
function cacheTtlMs(): number {
  const raw = process.env.KRS_CACHE_TTL_SECONDS?.trim();
  const seconds = raw ? Number(raw) : DEFAULT_CACHE_TTL_SECONDS;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export function clearKrsCache(): void {
  cache.clear();
}

/**
 * Remembers `ok` and `not_found` results; errors are forgotten so the next call asks the API again.
 * Concurrent calls for the same key share one request.
 */
function cached<T>(key: string, load: () => Promise<KrsFetchResult<T>>): Promise<KrsFetchResult<T>> {
  const ttl = cacheTtlMs();
  if (ttl === 0) return load();

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    // Re-insert to keep the Map ordered from least to most recently used.
    cache.delete(key);
    cache.set(key, hit);
    return hit.result as Promise<KrsFetchResult<T>>;
  }

  const result = load();
  const entry: CacheEntry = { expiresAt: now + ttl, result };
  cache.set(key, entry);
  const forget = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };
  result.then((value) => value.status === "error" && forget(), forget);

  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return result;
}

/**
 * Tries each URL in order and returns the first successful response.
 * When none succeeds, reports `error` if any URL failed for a reason other than 404,
 * and `not_found` only when every URL answered 404. Results are cached (see `cached`).
 */
export function fetchKrs<T>(urlOrUrls: string | string[], options: FetchKrsOptions = {}): Promise<KrsFetchResult<T>> {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  return cached(urls.join(" "), () => fetchKrsUncached<T>(urls, retryDelaysMs));
}

export function fetchKrsExtract<T>(opts: { type: ExtractType; rejestr: string; krs: string }): Promise<KrsFetchResult<T>> {
  return fetchKrs<T>(buildExtractUrls(opts));
}

export type KrsRegisterFetchResult<T, R extends string = string> =
  | { status: "ok"; rejestr: R; data: T }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Fetches the extract from the first register (in the given order) that has the entity.
 * Reports `error` when no register returned it and at least one failed, because then a missing
 * entity cannot be told apart from an API outage; `not_found` only when every register said so.
 */
export async function fetchKrsExtractFromRegisters<T, R extends string>(
  type: ExtractType,
  krs: string,
  registers: readonly R[]
): Promise<KrsRegisterFetchResult<T, R>> {
  let apiFailed = false;
  for (const rejestr of registers) {
    const result = await fetchKrsExtract<T>({ type, rejestr, krs });
    if (result.status === "ok") return { status: "ok", rejestr, data: result.data };
    if (result.status === "error") apiFailed = true;
  }
  return apiFailed ? { status: "error" } : { status: "not_found" };
}

export async function makeKRSRequest<T>(urlOrUrls: string | string[]): Promise<T | null> {
  const result = await fetchKrs<T>(urlOrUrls);
  return result.status === "ok" ? result.data : null;
}

// ---------------------------------------------------------------------------
// Biuletyn – daily list of entities with an entry in the register
// ---------------------------------------------------------------------------

/**
 * One bulletin call per day of a range adds up, so a failing day gives up after a few seconds
 * instead of the 90 s used for single extracts – the caller reports it as a day not fetched.
 */
const BULLETIN_RETRY_DELAYS_MS = [2_000, 5_000];

/** `${KRS_API_BASE}/Biuletyn/{YYYY-MM-DD}` */
export function buildBulletinUrl(date: string): string {
  return `${KRS_API_BASE}/Biuletyn/${date}`;
}

/** The bulletin lists KRS numbers without leading zeros ("116" → "0000000116"); anything else yields null. */
export function normalizeKrsNumber(value: unknown): string | null {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,10}$/.test(text.trim())) return null;
  return text.trim().padStart(10, "0");
}

/**
 * KRS numbers of entities that had an entry in the register on the given day (YYYY-MM-DD),
 * normalized to 10 digits and without the duplicates the API returns (one item per change).
 * A 404/204 is reported as an error, not as an empty day, so a moved endpoint cannot pass for "no changes".
 */
export async function fetchBulletin(
  date: string
): Promise<Exclude<KrsFetchResult<string[]>, { status: "not_found" }>> {
  const result = await fetchKrs<unknown>(buildBulletinUrl(date), { retryDelaysMs: BULLETIN_RETRY_DELAYS_MS });
  if (result.status === "error") return result;
  if (result.status === "not_found") return { status: "error", error: "brak biuletynu (HTTP 404/204)" };
  if (!Array.isArray(result.data)) return { status: "error", error: "nieoczekiwany format odpowiedzi biuletynu" };

  const numbers = new Set<string>();
  for (const item of result.data) {
    const krs = normalizeKrsNumber(item);
    if (krs) numbers.add(krs);
  }
  return { status: "ok", data: [...numbers] };
}
