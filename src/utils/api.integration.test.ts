import { buildExtractUrls, fetchBulletin } from "./api.js";
import { checkKrsStatusTool } from "../tools/checkStatus.js";
import { checkWatchlist, todayInPoland } from "../tools/watchlist.js";
import { getKrsEntryHistoryTool, EntryHistoryArgs } from "../tools/entryHistory.js";

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

describe("Check_KRS_Status against the public API", () => {
  async function status(krs: string): Promise<string> {
    const result = await checkKrsStatusTool.handler({ krs });
    return result.content[0].text;
  }

  function report(output: string): UnknownRecord {
    return JSON.parse(output.slice(output.indexOf("{"))) as UnknownRecord;
  }

  it("finds an active entity without being told the register", async () => {
    const output = await status("0000019193"); // PKP S.A.

    expect(report(output)).toMatchObject({ krs: "0000019193", rejestr: "P" });
    expect(["BRAK_SYGNALOW", "OSTRZEZENIA", "KRYTYCZNE"]).toContain(report(output).ocena);
    expect(normalizeAscii(String(report(output).nazwa))).toContain("polskie koleje panstwowe");
  }, 60_000);

  it("recognizes an entity struck off the register", async () => {
    const output = await status("0000005433"); // spółka jawna wykreślona 16.10.2026

    expect(report(output)).toMatchObject({ krs: "0000005433", ocena: "WYKRESLONY" });
  }, 60_000);

  it("reports a number that does not exist as not found", async () => {
    const output = await status("0999999999");

    expect(output).toBe("Nie znaleziono podmiotu o numerze KRS 0999999999 w rejestrze P ani S.");
  }, 60_000);
});

describe("KRS bulletin (Biuletyn) against the public API", () => {
  /** Weekdays before today (Polish calendar), newest first – a public holiday can leave one empty. */
  function recentWeekdays(count: number): string[] {
    const days: string[] = [];
    const day = new Date(`${todayInPoland(new Date())}T00:00:00Z`);
    while (days.length < count) {
      day.setUTCDate(day.getUTCDate() - 1);
      const weekday = day.getUTCDay();
      if (weekday !== 0 && weekday !== 6) days.push(day.toISOString().slice(0, 10));
    }
    return days;
  }

  let sample: { day: string; numbers: string[] } | undefined;

  async function recentBulletin(): Promise<{ day: string; numbers: string[] }> {
    if (sample) return sample;
    for (const day of recentWeekdays(5)) {
      const result = await fetchBulletin(day);
      if (result.status !== "ok") throw new Error(`Biuletyn ${day}: ${result.error}`);
      if (result.data.length > 0) {
        sample = { day, numbers: result.data };
        return sample;
      }
    }
    throw new Error("Biuletyn KRS był pusty przez ostatnie 5 dni roboczych");
  }

  it("returns a non-empty list of unique 10-digit numbers for a recent working day", async () => {
    const { numbers } = await recentBulletin();

    expect(numbers.length).toBeGreaterThan(0);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.every((krs) => /^\d{10}$/.test(krs))).toBe(true);
  }, 60_000);

  it("Check_KRS_Watchlist points out the watched entities listed in that day's bulletin", async () => {
    const { day, numbers } = await recentBulletin();
    const changed = numbers.slice(0, 2);
    const unknown = "0999999999";

    const result = await checkWatchlist({ krs: [...changed, unknown], data: day });
    const text = result.content[0].text;
    const report = JSON.parse(text.slice(text.indexOf("{"))) as {
      zmiany: Array<{ krs: string; dni: string[]; ostatniWpis?: { numer: number | null }; blad?: string }>;
      bezZmian: string[];
    };

    expect(text.split("\n")[0]).toBe(`Obserwowane podmioty w KRS – ${day}: wpisy u 2 z 3 podmiotów.`);
    expect(report.zmiany.map((hit) => hit.krs)).toEqual(changed);
    expect(report.bezZmian).toEqual([unknown]);
    for (const hit of report.zmiany) {
      expect(hit.dni).toEqual([day]);
      expect(hit.blad).toBeUndefined();
      expect(typeof hit.ostatniWpis?.numer).toBe("number");
    }
  }, 120_000);
});

describe("Get_KRS_Entry_History against the public API", () => {
  const PKP = "0000019193";

  async function history(args: EntryHistoryArgs): Promise<string> {
    const result = await getKrsEntryHistoryTool.handler(args);
    return result.content[0].text;
  }

  function json(output: string): UnknownRecord {
    return JSON.parse(output.slice(output.indexOf("{"))) as UnknownRecord;
  }

  it("lists PKP entries newest first in a few thousand characters instead of the whole extract", async () => {
    const output = await history({ krs: PKP, limit: 10 });
    const list = json(output);
    const numbers = (list.wpisy as Array<{ numerWpisu: number }>).map((entry) => entry.numerWpisu);

    expect(list).toMatchObject({ krs: PKP, rejestr: "P", pierwszyWpis: { numerWpisu: 1, dataWpisu: "11.06.2001" } });
    expect(list.liczbaWpisow as number).toBeGreaterThanOrEqual(216);
    expect(numbers).toHaveLength(10);
    expect(numbers[0]).toBe((list.ostatniWpis as { numerWpisu: number }).numerWpisu);
    expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
    expect(output.length).toBeLessThan(10_000);
  }, 60_000);

  it("shows what a single PKP entry changed in the management board", async () => {
    const output = await history({ krs: PKP, rejestr: "P", numerWpisu: 189 });
    const changes = json(output).zmiany as Array<{ pole: string; zmieniono?: unknown[] }>;

    expect(output.split("\n")[0]).toBe("Wpis nr 189 z 08.01.2025 – ZMIANA DANYCH W REJESTRZE");
    expect(changes.find((change) => change.pole === "dzial2.reprezentacja.sklad")?.zmieniono).toEqual([
      expect.objectContaining({
        przed: { funkcjaWOrganie: "CZŁONEK ZARZĄDU" },
        po: { funkcjaWOrganie: "WICEPREZES ZARZĄDU" },
      }),
    ]);
  }, 60_000);

  it("reads the history of an entity struck off the register", async () => {
    const output = await history({ krs: "0000005433", limit: 1 }); // spółka jawna wykreślona 16.10.2026

    expect(json(output).wpisy).toEqual([
      expect.objectContaining({ dataWpisu: "16.10.2026", opis: "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO" }),
    ]);
  }, 60_000);
});
