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

async function fetchKrsSingle<T>(url: string, logFailure: boolean): Promise<KrsFetchResult<T>> {
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
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
      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await sleep(delay);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { status: "error", error: lastError };
}

/**
 * Tries each URL in order and returns the first successful response.
 * When none succeeds, reports `error` if any URL failed for a reason other than 404,
 * and `not_found` only when every URL answered 404.
 */
export async function fetchKrs<T>(urlOrUrls: string | string[]): Promise<KrsFetchResult<T>> {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  let firstError: KrsFetchResult<T> | null = null;

  for (let index = 0; index < urls.length; index++) {
    const logFailure = index === urls.length - 1;
    const result = await fetchKrsSingle<T>(urls[index], logFailure);
    if (result.status === "ok") return result;
    if (result.status === "error" && !firstError) firstError = result;
  }

  return firstError ?? { status: "not_found" };
}

export function fetchKrsExtract<T>(opts: { type: ExtractType; rejestr: string; krs: string }): Promise<KrsFetchResult<T>> {
  return fetchKrs<T>(buildExtractUrls(opts));
}

export async function makeKRSRequest<T>(urlOrUrls: string | string[]): Promise<T | null> {
  const result = await fetchKrs<T>(urlOrUrls);
  return result.status === "ok" ? result.data : null;
}
