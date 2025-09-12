const USER_AGENT = "krs-mcp/1.0";

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
  // Prefer path params; keep query fallback if needed by future changes.
  return `${KRS_API_BASE}/${type}/${krs}?rejestr=${rejestr}&format=json`;
}

export async function makeKRSRequest<T>(url: string): Promise<T | null> {
  const headers = { Accept: "application/json" };
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    console.error("KRS request error:", err);
    return null;
  }
}