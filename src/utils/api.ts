const USER_AGENT = "krs-mcp/1.0";

const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [30_000, 60_000];

// Known public base for KRS Open API (REST returning JSON odpisy).
// If MS changes routing/domains, adjust this single constant.
const KRS_API_BASE = "https://api-krs.ms.gov.pl/api/krs";

type ExtractType = "OdpisAktualny" | "OdpisPelny";

/**
 * Build URL for KRS odpis (OdpisAktualny/OdpisPelny).
 * Historically documented as REST with typ odpisu + KRS + rejestr (P/S), JSON in response.
 * Example effective form (subject to MS routing): 
 *   `${KRS_API_BASE}/{typ_odpisu}/{rejestr}/{krs}`
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
  // Prefer path params; keep query fallback if needed by future changes.
  return [buildExtractUrlPath(opts), buildExtractUrl(opts)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeKRSRequestSingle<T>(url: string, logFailure: boolean): Promise<T | null> {
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout")), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === maxAttempts - 1) {
        if (logFailure) {
          console.error("KRS request error:", err);
        }
        return null;
      }

      console.error("KRS request error (will retry):", err);
      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await sleep(delay);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
}

export async function makeKRSRequest<T>(urlOrUrls: string | string[]): Promise<T | null> {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];

  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    const logFailure = index === urls.length - 1;
    const result = await makeKRSRequestSingle<T>(url, logFailure);
    if (result) return result;
  }

  return null;
}
