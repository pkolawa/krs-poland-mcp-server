import { buildExtractUrls } from "./api.js";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_KRS = "0000109411"; // GUS (stable public entity)
const DEFAULT_REJESTR = "P";

jest.setTimeout(20_000);

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function findKrsNumber(data: unknown): string | undefined {
  const root = asRecord(data);
  if (!root) return undefined;

  const dzial1 = asRecord(root.dzial1);
  const danePodstawowe = asRecord(dzial1?.danePodstawowe);
  const podstawoweDane = asRecord(root.podstawoweDane);
  const odpis = asRecord(root.odpis);

  return (
    asString(root.numerKRS) ??
    asString(danePodstawowe?.numerKRS) ??
    asString(podstawoweDane?.numerKRS) ??
    asString(asRecord(odpis?.naglowekP)?.numerKRS) ??
    asString(asRecord(odpis?.naglowekS)?.numerKRS) ??
    asString(asRecord(odpis?.naglowek)?.numerKRS)
  );
}

function findName(data: unknown): string | undefined {
  const root = asRecord(data);
  if (!root) return undefined;

  const odpis = asRecord(root.odpis);
  const dane = asRecord(odpis?.dane);
  const dzial1 = asRecord(dane?.dzial1);
  const danePodmiotu = asRecord(dzial1?.danePodmiotu);
  const nazwa = danePodmiotu?.nazwa;
  const dzial1Root = asRecord(root.dzial1);
  const danePodstawowe = asRecord(dzial1Root?.danePodstawowe);
  const podstawoweDane = asRecord(root.podstawoweDane);

  if (Array.isArray(nazwa)) {
    const first = asRecord(nazwa[0]);
    const nameFromArray = asString(first?.nazwa);
    if (nameFromArray) return nameFromArray;
  }

  return (
    asString(danePodstawowe?.nazwa) ??
    asString(podstawoweDane?.nazwa) ??
    asString(root.nazwa)
  );
}

function findRodzaj(data: unknown): string | undefined {
  const root = asRecord(data);
  if (!root) return undefined;
  return asString(asRecord(root.odpis)?.rodzaj) ?? asString(root.rodzaj);
}

function normalizeAscii(value: string): string {
  return value
    .replace(/[Ąą]/g, "a")
    .replace(/[Ćć]/g, "c")
    .replace(/[Ęę]/g, "e")
    .replace(/[Łł]/g, "l")
    .replace(/[Ńń]/g, "n")
    .replace(/[Óó]/g, "o")
    .replace(/[Śś]/g, "s")
    .replace(/[ŻżŹź]/g, "z")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function withNoCache(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("nocache", Date.now().toString());
  return parsed.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOnce(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout")), 10_000);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "krs-mcp/1.0",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    const body = text.replace(/^\uFEFF/, "").trim();

    if (!res.ok) {
      const snippet = body.slice(0, 200);
      throw new Error(`HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`);
    }
    if (!body) {
      throw new Error("Empty response body");
    }

    try {
      return JSON.parse(body) as unknown;
    } catch (err) {
      const snippet = body.slice(0, 200);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSON: ${message}${snippet ? `: ${snippet}` : ""}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Empty response body") ||
    message.includes("Invalid JSON") ||
    message.includes("HTTP 429") ||
    message.includes("HTTP 500") ||
    message.includes("HTTP 502") ||
    message.includes("HTTP 503") ||
    message.includes("HTTP 504")
  );
}

async function fetchJson(urlOrUrls: string | string[]): Promise<unknown> {
  const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  let lastError: unknown = null;

  for (const url of urls) {
    const retryDelays = [1000, 2000, 4000, 8000];
    const maxAttempts = retryDelays.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const attemptUrl = withNoCache(url);
        return await fetchJsonOnce(attemptUrl);
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts || !shouldRetry(err)) {
          break;
        }
        await sleep(retryDelays[attempt - 1] ?? 1000);
      }
    }
  }

  throw lastError ?? new Error("Unreachable");
}

describe("KRS public API integration", () => {
  const krs = process.env.KRS_TEST_KRS ?? DEFAULT_KRS;
  const rejestr = (process.env.KRS_TEST_REJESTR ?? DEFAULT_REJESTR).toUpperCase();

  it("returns a valid full extract for a known KRS number", async () => {
    const urls = buildExtractUrls({ type: "OdpisPelny", rejestr, krs });
    const data = await fetchJson(urls);

    expect(asRecord(data)).toBeTruthy();
    expect(findKrsNumber(data)).toBe(krs);
    expect(findName(data)).toBeTruthy();

    const rodzaj = findRodzaj(data);
    if (rodzaj) {
      expect(normalizeAscii(rodzaj)).toContain("pelny");
    }
  });
});
