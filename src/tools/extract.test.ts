import { z } from "zod";
import { getKrsCurrentExtractTool, getKrsFullExtractTool, selectSections } from "./extract.js";
import { KrsExtract } from "../types/krs.js";

const KRS = "0000012345";

const EXTRACT: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: { numerKRS: KRS },
    dane: { dzial1: { danePodmiotu: { nazwa: "STOWARZYSZENIE TESTOWE" } } },
  },
};

const CURRENT_EXTRACT: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: { numerKRS: KRS, numerOstatniegoWpisu: 3 },
    dane: {
      dzial1: { danePodmiotu: { nazwa: "SPÓŁKA TESTOWA" } },
      dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD" } },
      dzial3: { przedmiotDzialalnosci: { przedmiotPrzewazajacejDzialalnosci: [{ kodDzial: "62" }] } },
      dzial4: {},
      dzial5: {},
      dzial6: {},
    },
  },
};

// Entry 1 registered the company, 2 changed its PKD codes, 3 replaced the president of the board.
const FULL_EXTRACT: KrsExtract = {
  odpis: {
    rodzaj: "Pełny",
    naglowekP: {
      numerKRS: KRS,
      wpis: [
        { numerWpisu: 1, opis: "WPIS DO REJESTRU", dataWpisu: "01.02.2010" },
        { numerWpisu: 2, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "03.04.2015" },
        { numerWpisu: 3, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "05.06.2020" },
      ],
    },
    dane: {
      dzial1: { danePodmiotu: { nazwa: [{ nazwa: "SPÓŁKA TESTOWA", nrWpisuWprow: "1" }] } },
      dzial2: {
        reprezentacja: {
          sklad: [
            { funkcjaWOrganie: [{ funkcjaWOrganie: "PREZES ZARZĄDU", nrWpisuWprow: "1", nrWpisuWykr: "3" }] },
            { funkcjaWOrganie: [{ funkcjaWOrganie: "PREZES ZARZĄDU", nrWpisuWprow: "3" }] },
          ],
        },
      },
      dzial3: { przedmiotDzialalnosci: { przedmiotPrzewazajacejDzialalnosci: [{ kodDzial: "62", nrWpisuWprow: "2" }] } },
      dzial4: {},
      dzial5: {},
      dzial6: {},
    },
  },
};

type Routes = Record<string, { status: number; body?: unknown }>;

/** Mocks fetch by "<OdpisAktualny|OdpisPelny>/<P|S>"; anything not listed answers 404. */
function mockApi(routes: Routes) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const type = url.pathname.includes("OdpisPelny") ? "OdpisPelny" : "OdpisAktualny";
    const rejestr = url.searchParams.get("rejestr") ?? url.pathname.split("/").at(-2);
    const route = routes[`${type}/${rejestr}`] ?? { status: 404 };
    return { ok: route.status === 200, status: route.status, json: async () => route.body } as Response;
  });
}

function text(result: Awaited<ReturnType<typeof getKrsCurrentExtractTool.handler>>): string {
  return result.content[0].text;
}

/** The JSON that follows the description lines of the answer. */
function json(output: string): KrsExtract {
  return JSON.parse(output.slice(output.indexOf("{")));
}

describe("extract tools (Get_Current_KRS_Record / Get_Full_KRS_Record)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the extract from the given register with a headline and the raw JSON", async () => {
    const fetchSpy = mockApi({ "OdpisAktualny/S": { status: 200, body: EXTRACT } });

    const output = text(await getKrsCurrentExtractTool.handler({ krs: KRS, rejestr: "S" }));

    expect(output.split("\n")[0]).toBe(`Odpis aktualny – STOWARZYSZENIE TESTOWE (KRS ${KRS}), rejestr S`);
    expect(output).toContain("(Zwrócono obiekt JSON z odpisem aktualnym)");
    expect(JSON.parse(output.slice(output.indexOf("{")))).toEqual(EXTRACT);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("tries register P, then S, when no register is given", async () => {
    mockApi({ "OdpisPelny/S": { status: 200, body: EXTRACT } });

    const output = text(await getKrsFullExtractTool.handler({ krs: KRS }));

    expect(output.split("\n")[0]).toBe(`Odpis pełny – STOWARZYSZENIE TESTOWE (KRS ${KRS}), rejestr S`);
    expect(output).toContain("(Zwrócono obiekt JSON z odpisem pełnym)");
  });

  it("points to Check_KRS_Status when there is no current extract (e.g. a deleted entity answers 204)", async () => {
    const fetchSpy = mockApi({ "OdpisAktualny/P": { status: 204 } });

    const output = text(await getKrsCurrentExtractTool.handler({ krs: KRS }));

    expect(output).toBe(
      `Nie znaleziono odpisu aktualnego dla KRS ${KRS} w rejestrze P ani S. ` +
        "Podmiot wykreślony z rejestru ma tylko odpis pełny – jego status pokaże Check_KRS_Status."
    );
    // 2 registers × 2 URL variants, each answered once – no retries for 204/404.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("says the full extract was not found without the deleted-entity hint", async () => {
    mockApi({});

    const output = text(await getKrsFullExtractTool.handler({ krs: KRS, rejestr: "P" }));

    expect(output).toBe(`Nie znaleziono odpisu pełnego dla KRS ${KRS} w rejestrze P.`);
  });

  it("reports an API failure instead of 'not found'", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({ "OdpisAktualny/P": { status: 400 } });

    const output = text(await getKrsCurrentExtractTool.handler({ krs: KRS }));

    expect(output).toBe(`Nie udało się pobrać odpisu aktualnego dla KRS ${KRS} – API KRS zwróciło błąd. Spróbuj ponownie później.`);
  });

  it("returns content without empty _meta fields", async () => {
    mockApi({ "OdpisAktualny/P": { status: 200, body: EXTRACT } });

    const result = await getKrsCurrentExtractTool.handler({ krs: KRS });

    expect(Object.keys(result.content[0])).toEqual(["type", "text"]);
  });

  it("returns the JSON on a single line, without indentation", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL_EXTRACT } });

    const output = text(await getKrsFullExtractTool.handler({ krs: KRS }));

    expect(output.split("\n").at(-1)).toBe(JSON.stringify(FULL_EXTRACT));
  });
});

describe("section filter (dzialy)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns only the chosen sections of the full extract and the entries that changed them", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL_EXTRACT } });

    const output = text(await getKrsFullExtractTool.handler({ krs: KRS, dzialy: [2] }));
    const extract = json(output);

    expect(output.split("\n").slice(0, 4)).toEqual([
      `Odpis pełny – SPÓŁKA TESTOWA (KRS ${KRS}), rejestr P`,
      "",
      "(Zwrócono obiekt JSON z odpisem pełnym – tylko dział 2)",
      "Lista wpisów w nagłówku: 2 z 3 – tylko wpisy, które wprowadziły lub wykreśliły pola wybranych działów.",
    ]);
    expect(Object.keys(extract.odpis?.dane ?? {})).toEqual(["dzial2"]);
    expect(extract.odpis?.dane?.dzial2).toEqual(FULL_EXTRACT.odpis?.dane?.dzial2);
    expect(extract.odpis?.naglowekP?.wpis?.map((entry) => entry.numerWpisu)).toEqual([1, 3]);
    expect(extract.odpis?.naglowekP?.numerKRS).toBe(KRS);
    expect(extract.odpis?.rodzaj).toBe("Pełny");
  });

  it("keeps several sections in register order and names them once each", async () => {
    mockApi({ "OdpisAktualny/P": { status: 200, body: CURRENT_EXTRACT } });

    const output = text(await getKrsCurrentExtractTool.handler({ krs: KRS, dzialy: [3, 1, 3] }));
    const extract = json(output);

    expect(output.split("\n")[2]).toBe("(Zwrócono obiekt JSON z odpisem aktualnym – tylko działy 1, 3)");
    // The current extract has no list of entries, so there is nothing to narrow.
    expect(output).not.toContain("Lista wpisów");
    expect(Object.keys(extract.odpis?.dane ?? {})).toEqual(["dzial1", "dzial3"]);
    expect(extract.odpis?.naglowekA).toEqual(CURRENT_EXTRACT.odpis?.naglowekA);
  });

  it("names the entity in the headline even when section 1 is left out", async () => {
    mockApi({ "OdpisAktualny/P": { status: 200, body: CURRENT_EXTRACT } });

    const output = text(await getKrsCurrentExtractTool.handler({ krs: KRS, dzialy: [5] }));

    expect(output.split("\n")[0]).toBe(`Odpis aktualny – SPÓŁKA TESTOWA (KRS ${KRS}), rejestr P`);
    expect(json(output).odpis?.dane).toEqual({ dzial5: {} });
  });

  it("does not change the cached extract, so a later call without a filter gets the whole of it", async () => {
    const body = structuredClone(FULL_EXTRACT);
    const fetchSpy = mockApi({ "OdpisPelny/P": { status: 200, body } });

    await getKrsFullExtractTool.handler({ krs: KRS, dzialy: [2] });
    const output = text(await getKrsFullExtractTool.handler({ krs: KRS }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(body).toEqual(FULL_EXTRACT);
    expect(json(output)).toEqual(FULL_EXTRACT);
  });

  it("keeps no entries when the chosen sections reference none", () => {
    const { extract, wpisy } = selectSections(FULL_EXTRACT, [6]);

    expect(wpisy).toEqual({ pokazane: 0, wszystkie: 3 });
    expect(extract.odpis?.naglowekP?.wpis).toEqual([]);
    expect(extract.odpis?.dane).toEqual({ dzial6: {} });
  });

  it("accepts section numbers 1–6 only", () => {
    const schema = z.object(getKrsFullExtractTool.schema);
    const parse = (dzialy: unknown) => schema.safeParse({ krs: KRS, dzialy }).success;

    expect(parse(undefined)).toBe(true);
    expect(parse([1, 6])).toBe(true);
    expect(parse([])).toBe(false);
    expect(parse([0])).toBe(false);
    expect(parse([7])).toBe(false);
    expect(parse([2.5])).toBe(false);
    expect(parse(["2"])).toBe(false);
  });
});
