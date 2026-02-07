import { buildExtractUrl } from "./api";

type UnknownRecord = Record<string, unknown>;

const RUN_INTEGRATION = process.env.KRS_INTEGRATION_TESTS === "1";
const DEFAULT_KRS = "0000109411"; // GUS (stable public entity)
const DEFAULT_REJESTR = "P";

const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

if (RUN_INTEGRATION) {
  jest.setTimeout(20_000);
}

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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout")), 10_000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "krs-mcp/1.0" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

describeIntegration("KRS public API integration", () => {
  const krs = process.env.KRS_TEST_KRS ?? DEFAULT_KRS;
  const rejestr = (process.env.KRS_TEST_REJESTR ?? DEFAULT_REJESTR).toUpperCase();

  it("returns a valid current extract for a known KRS number", async () => {
    const url = buildExtractUrl({ type: "OdpisAktualny", rejestr, krs });
    const data = await fetchJson(url);

    expect(asRecord(data)).toBeTruthy();
    expect(findKrsNumber(data)).toBe(krs);
    expect(findName(data)).toBeTruthy();

    const rodzaj = findRodzaj(data);
    if (rodzaj) {
      expect(normalizeAscii(rodzaj)).toContain("aktual");
    }
  });

  it("returns a valid full extract for a known KRS number", async () => {
    const url = buildExtractUrl({ type: "OdpisPelny", rejestr, krs });
    const data = await fetchJson(url);

    expect(asRecord(data)).toBeTruthy();
    expect(findKrsNumber(data)).toBe(krs);
    expect(findName(data)).toBeTruthy();

    const rodzaj = findRodzaj(data);
    if (rodzaj) {
      expect(normalizeAscii(rodzaj)).toContain("pelny");
    }
  });
});
