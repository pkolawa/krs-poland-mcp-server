import { checkWatchlist, resolveDateRange, todayInPoland, WatchlistArgs } from "./watchlist.js";
import { KrsExtract } from "../types/krs.js";

const ACTIVE_KRS = "0000012345";
const DELETED_KRS = "0000005433";
const QUIET_KRS = "0000000001";
const NOW = new Date("2026-11-13T10:00:00Z");

const ACTIVE: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: {
      numerKRS: ACTIVE_KRS,
      numerOstatniegoWpisu: 213,
      dataOstatniegoWpisu: "12.11.2026",
      sygnaturaAktSprawyDotyczacejOstatniegoWpisu: "KA.VIII NS-REJ.KRS/37384/26/13",
      oznaczenieSaduDokonujacegoOstatniegoWpisu: "SĄD REJONOWY KATOWICE-WSCHÓD W KATOWICACH",
    },
    dane: {
      dzial1: { danePodmiotu: { nazwa: "SPÓŁKA AKTYWNA", formaPrawna: "STOWARZYSZENIE" } },
      dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD", sklad: [{ funkcjaWOrganie: "PREZES" }] } },
    },
  },
};

const DELETED: KrsExtract = {
  odpis: {
    rodzaj: "Pełny",
    naglowekP: {
      numerKRS: DELETED_KRS,
      wpis: [
        { numerWpisu: 1, opis: "WPIS DO REJESTRU", dataWpisu: "02.04.2001" },
        {
          numerWpisu: 41,
          opis: "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO",
          dataWpisu: "16.10.2026",
          sygnaturaAktSprawyDotyczacejWpisu: "PO.VIII NS-REJ.KRS/32007/26/990",
          oznaczenieSaduDokonujacegoWpisu: "SĄD REJONOWY POZNAŃ",
          dataUprawomocnienia: "29.10.2026",
        },
      ],
    },
    dane: { dzial1: { danePodmiotu: { nazwa: [{ nazwa: "SPÓŁKA USUNIĘTA", nrWpisuWprow: "1", nrWpisuWykr: "41" }] } } },
  },
};

type Route = { status: number; body?: unknown };

/**
 * Bulletin routes by date ("2026-11-12"), extract routes by "<OdpisAktualny|OdpisPelny>/<krs>/<P|S>".
 * Anything not listed answers 404.
 */
function mockApi(bulletins: Record<string, Route>, extracts: Record<string, Route> = {}) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const segments = url.pathname.split("/");
    let route: Route | undefined;
    if (url.pathname.includes("/Biuletyn/")) {
      route = bulletins[segments.at(-1) ?? ""];
    } else {
      const type = url.pathname.includes("OdpisPelny") ? "OdpisPelny" : "OdpisAktualny";
      const rejestr = url.searchParams.get("rejestr") ?? segments.at(-2);
      route = extracts[`${type}/${segments.at(-1)}/${rejestr}`];
    }
    const { status, body } = route ?? { status: 404 };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
}

function bulletinCalls(fetchSpy: jest.SpyInstance): string[] {
  return fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/Biuletyn/"));
}

async function run(args: WatchlistArgs) {
  const result = await checkWatchlist(args, NOW);
  const text = result.content[0].text;
  const brace = text.indexOf("{");
  return {
    result,
    headline: text.split("\n")[0],
    report: brace >= 0 ? JSON.parse(text.slice(brace)) : undefined,
    text,
  };
}

describe("Check_KRS_Watchlist handler", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("matches watched numbers against a normalized, deduplicated bulletin and adds the last entry", async () => {
    // The API lists numbers without leading zeros and once per change.
    const fetchSpy = mockApi(
      { "2026-11-12": { status: 200, body: ["116", "12345", "12345", "12345"] } },
      { [`OdpisAktualny/${ACTIVE_KRS}/P`]: { status: 200, body: ACTIVE } }
    );

    const { headline, report, result } = await run({ krs: [ACTIVE_KRS, QUIET_KRS], data: "2026-11-12" });

    expect(result).not.toHaveProperty("isError");
    expect(headline).toBe("Obserwowane podmioty w KRS – 2026-11-12: wpisy u 1 z 2 podmiotów.");
    expect(report.zakres).toEqual({ od: "2026-11-12", do: "2026-11-12", liczbaDni: 1 });
    expect(report.zmiany).toEqual([
      {
        krs: ACTIVE_KRS,
        nazwa: "SPÓŁKA AKTYWNA",
        rejestr: "P",
        dni: ["2026-11-12"],
        ostatniWpis: {
          numer: 213,
          data: "12.11.2026",
          sygnatura: "KA.VIII NS-REJ.KRS/37384/26/13",
          sad: "SĄD REJONOWY KATOWICE-WSCHÓD W KATOWICACH",
          wZakresie: true,
        },
        ocena: "BRAK_SYGNALOW",
        podsumowanie: "Brak sygnałów ostrzegawczych w KRS.",
      },
    ]);
    expect(report.bezZmian).toEqual([QUIET_KRS]);
    expect(report.niepobraneDni).toEqual([]);
    expect(bulletinCalls(fetchSpy)).toEqual(["https://api-krs.ms.gov.pl/api/krs/Biuletyn/2026-11-12"]);
  });

  it("fetches every day of a range once and lists the days each entity appeared", async () => {
    const fetchSpy = mockApi({
      "2026-11-09": { status: 200, body: ["12345"] },
      "2026-11-10": { status: 200, body: [] },
      "2026-11-11": { status: 200, body: ["5433"] },
      "2026-11-12": { status: 200, body: ["12345", "5433"] },
    });

    const { headline, report } = await run({
      krs: [ACTIVE_KRS, DELETED_KRS, QUIET_KRS],
      odDaty: "2026-11-09",
      doDaty: "2026-11-12",
      szczegoly: false,
    });

    expect(headline).toBe("Obserwowane podmioty w KRS – 2026-11-09 – 2026-11-12 (4 dni): wpisy u 2 z 3 podmiotów.");
    expect(report.zmiany).toEqual([
      { krs: ACTIVE_KRS, dni: ["2026-11-09", "2026-11-12"] },
      { krs: DELETED_KRS, dni: ["2026-11-11", "2026-11-12"] },
    ]);
    expect(report.bezZmian).toEqual([QUIET_KRS]);
    expect(bulletinCalls(fetchSpy).sort()).toEqual(
      ["09", "10", "11", "12"].map((day) => `https://api-krs.ms.gov.pl/api/krs/Biuletyn/2026-11-${day}`)
    );
    // szczegoly: false – no extracts are fetched.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("describes a deleted entity from its full extract and flags an entry dated outside the range", async () => {
    mockApi(
      { "2026-11-12": { status: 200, body: ["5433"] } },
      {
        [`OdpisAktualny/${DELETED_KRS}/P`]: { status: 204 },
        [`OdpisPelny/${DELETED_KRS}/P`]: { status: 200, body: DELETED },
      }
    );

    const { report } = await run({ krs: [DELETED_KRS], data: "2026-11-12" });

    expect(report.zmiany[0]).toMatchObject({
      krs: DELETED_KRS,
      nazwa: "SPÓŁKA USUNIĘTA",
      ocena: "WYKRESLONY",
      ostatniWpis: {
        numer: 41,
        opis: "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO",
        data: "16.10.2026",
        dataUprawomocnienia: "29.10.2026",
        wZakresie: false,
      },
    });
    expect(report.uwagi.some((note: string) => note.includes("wZakresie: false"))).toBe(true);
  });

  it("reports a bulletin day that failed and keeps the others", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({
      "2026-11-11": { status: 400 },
      "2026-11-12": { status: 200, body: ["12345"] },
    });

    const { headline, report } = await run({
      krs: [ACTIVE_KRS, QUIET_KRS],
      odDaty: "2026-11-11",
      doDaty: "2026-11-12",
      szczegoly: false,
    });

    expect(headline).toContain("wpisy u 1 z 2 podmiotów. Nie pobrano biuletynu za 1 dzień.");
    expect(report.niepobraneDni).toEqual([{ data: "2026-11-11", blad: "HTTP 400" }]);
    expect(report.bezZmian).toEqual([QUIET_KRS]);
    expect(report.uwagi.some((note: string) => note.includes("mogły mieć wpis w tych dniach"))).toBe(true);
  });

  it("returns an error instead of 'no changes' when no bulletin day could be fetched", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({ "2026-11-12": { status: 404 } });

    const { result, text } = await run({ krs: [ACTIVE_KRS], data: "2026-11-12" });

    expect(result).toHaveProperty("isError", true);
    expect(text).toContain("Nie udało się pobrać biuletynu KRS za 2026-11-12");
  });

  it("keeps a hit whose extract could not be fetched and says why", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi(
      { "2026-11-12": { status: 200, body: ["12345"] } },
      { [`OdpisAktualny/${ACTIVE_KRS}/P`]: { status: 400 } }
    );

    const { report } = await run({ krs: [ACTIVE_KRS], data: "2026-11-12" });

    expect(report.zmiany).toEqual([
      {
        krs: ACTIVE_KRS,
        dni: ["2026-11-12"],
        blad: "Nie udało się pobrać odpisu (OdpisAktualny) – API KRS zwróciło błąd.",
      },
    ]);
  });

  it("deduplicates the watched numbers and defaults the end of the range to today", async () => {
    const fetchSpy = mockApi({
      "2026-11-12": { status: 200, body: [] },
      "2026-11-13": { status: 200, body: [] },
    });

    const { headline, report } = await run({ krs: [QUIET_KRS, QUIET_KRS], odDaty: "2026-11-12" });

    expect(headline).toBe("Obserwowane podmioty w KRS – 2026-11-12 – 2026-11-13 (2 dni): wpisy u 0 z 1 podmiotu.");
    expect(report.liczbaPodmiotow).toBe(1);
    expect(report.zakres).toEqual({ od: "2026-11-12", do: "2026-11-13", liczbaDni: 2 });
    expect(report.uwagi).toContain("Biuletyn za dzisiejszy dzień może być jeszcze niepełny.");
    expect(bulletinCalls(fetchSpy)).toHaveLength(2);
  });

  it.each<[string, WatchlistArgs, string]>([
    ["both a day and a range", { krs: [ACTIVE_KRS], data: "2026-11-12", odDaty: "2026-11-01" }, "nie oba naraz"],
    ["no dates", { krs: [ACTIVE_KRS] }, "Podaj dzień"],
    ["only the end of a range", { krs: [ACTIVE_KRS], doDaty: "2026-11-12" }, "Brak początku zakresu"],
    ["a reversed range", { krs: [ACTIVE_KRS], odDaty: "2026-11-12", doDaty: "2026-11-01" }, "jest późniejszy"],
    ["a future day", { krs: [ACTIVE_KRS], data: "2026-11-14" }, "z przyszłości"],
    ["a range over 31 days", { krs: [ACTIVE_KRS], odDaty: "2026-10-01", doDaty: "2026-11-01" }, "ma 32 dni"],
  ])("rejects %s without calling the API", async (_label, args, message) => {
    const fetchSpy = mockApi({});

    const { result, text } = await run(args);

    expect(result).toHaveProperty("isError", true);
    expect(text).toContain(message);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("resolveDateRange", () => {
  it("accepts exactly 31 days and crosses month boundaries", () => {
    const range = resolveDateRange({ odDaty: "2026-10-13", doDaty: "2026-11-12" }, NOW);
    expect(typeof range).toBe("object");
    if (typeof range === "string") return;
    expect(range.days).toHaveLength(31);
    expect(range.days[0]).toBe("2026-10-13");
    expect(range.days[18]).toBe("2026-10-31");
    expect(range.days[19]).toBe("2026-11-01");
  });

  it("uses the Polish calendar day for 'today'", () => {
    // 23:30 UTC on 12 Nov is already 13 Nov in Warsaw (UTC+1).
    expect(todayInPoland(new Date("2026-11-12T23:30:00Z"))).toBe("2026-11-13");
  });
});
