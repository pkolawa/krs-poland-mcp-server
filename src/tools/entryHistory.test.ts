import { z } from "zod";
import { getKrsEntryHistoryTool } from "./entryHistory.js";
import { KrsExtract } from "../types/krs.js";

const KRS = "0000012345";

const FULL: KrsExtract = {
  odpis: {
    rodzaj: "Pełny",
    naglowekP: {
      numerKRS: KRS,
      stanZDnia: "12.11.2026",
      wpis: [
        { numerWpisu: 1, opis: "REJESTRACJA W KRAJOWYM REJESTRZE SĄDOWYM", dataWpisu: "11.06.2001" },
        { numerWpisu: 2, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "04.07.2005", sygnaturaAktSprawyDotyczacejWpisu: "WA.XII NS-REJ.KRS/2/05/2" },
        { numerWpisu: 3, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "08.01.2025" },
      ],
    },
    dane: {
      dzial1: {
        danePodmiotu: {
          nazwa: [
            { nazwa: "STARA NAZWA SPÓŁKA AKCYJNA", nrWpisuWprow: "1", nrWpisuWykr: "2" },
            { nazwa: "NOWA NAZWA SPÓŁKA AKCYJNA", nrWpisuWprow: "2" },
          ],
        },
        kapital: {
          wysokoscKapitaluZakladowego: [{ wartosc: "5000,00", waluta: "PLN", nrWpisuWprow: "3" }],
        },
      },
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

type Args = Parameters<typeof getKrsEntryHistoryTool.handler>[0];

async function run(args: Args): Promise<string> {
  const result = await getKrsEntryHistoryTool.handler(args);
  return result.content[0].text;
}

function jsonFrom(output: string) {
  return JSON.parse(output.slice(output.indexOf("{")));
}

describe("Get_KRS_Entry_History handler", () => {
  afterEach(() => jest.restoreAllMocks());

  it("lists entries newest first from the full extract of the given register", async () => {
    const fetchSpy = mockApi({ "OdpisPelny/P": { status: 200, body: FULL } });

    const output = await run({ krs: KRS, rejestr: "P" });

    const [title, summary] = output.split("\n");
    expect(title).toBe(`Historia wpisów – NOWA NAZWA SPÓŁKA AKCYJNA (KRS ${KRS}, rejestr P)`);
    expect(summary).toBe(
      "Wpisów w KRS: 3 (pierwszy z 11.06.2001, ostatni nr 3 z 08.01.2025). Pokazano 3 najnowsze wpisy. " +
        "Co zmienił konkretny wpis: podaj numerWpisu."
    );
    const list = jsonFrom(output);
    expect(list.wpisy.map((entry: { numerWpisu: number }) => entry.numerWpisu)).toEqual([3, 2, 1]);
    expect(list.wpisy[1]).toMatchObject({ sygnatura: "WA.XII NS-REJ.KRS/2/05/2", zmienionePola: ["dzial1.danePodmiotu.nazwa"] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`https://api-krs.ms.gov.pl/api/krs/OdpisPelny/${KRS}?rejestr=P&format=json`);
  });

  it("tries register P, then S, when no register is given", async () => {
    mockApi({ "OdpisPelny/S": { status: 200, body: FULL } });

    const output = await run({ krs: KRS });

    expect(output.split("\n")[0]).toContain("rejestr S)");
    expect(jsonFrom(output).rejestr).toBe("S");
  });

  it("applies odDaty (either date format) and limit, and says how many entries were left out", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL } });

    const iso = await run({ krs: KRS, rejestr: "P", odDaty: "2005-07-04", limit: 1 });
    const polish = await run({ krs: KRS, rejestr: "P", odDaty: "04.07.2005", limit: 1 });

    expect(iso).toBe(polish);
    expect(iso).toContain("Pokazano 1 najnowszy wpis od 04.07.2005, pominięto 1 starszy (zwiększ limit lub zawęź odDaty).");
    expect(jsonFrom(iso)).toMatchObject({ filtr: { odDaty: "04.07.2005", limit: 1 }, pominieto: 1, wpisy: [{ numerWpisu: 3 }] });
  });

  it("says so when no entry was made on or after odDaty", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL } });

    const output = await run({ krs: KRS, rejestr: "P", odDaty: "01.01.2026" });

    expect(output.split("\n")[1]).toBe("Wpisów w KRS: 3 (pierwszy z 11.06.2001, ostatni nr 3 z 08.01.2025). Brak wpisów od 01.01.2026.");
  });

  it("describes what a given entry changed", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL } });

    const output = await run({ krs: KRS, rejestr: "P", numerWpisu: 2, odDaty: "01.01.2026" });

    expect(output.split("\n").slice(0, 2)).toEqual([
      "Wpis nr 2 z 04.07.2005 – ZMIANA DANYCH W REJESTRZE",
      `NOWA NAZWA SPÓŁKA AKCYJNA (KRS ${KRS}, rejestr P)`,
    ]);
    expect(jsonFrom(output).zmiany).toEqual([
      { pole: "dzial1.danePodmiotu.nazwa", zmieniono: [{ przed: "STARA NAZWA SPÓŁKA AKCYJNA", po: "NOWA NAZWA SPÓŁKA AKCYJNA" }] },
    ]);
  });

  it("formats flat values on one line", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL } });

    const output = await run({ krs: KRS, rejestr: "P", numerWpisu: 3 });

    expect(output).toContain('"wprowadzono": [\n        { "wartosc": "5000,00", "waluta": "PLN" }\n      ]');
  });

  it("names the available range when the entry does not exist", async () => {
    mockApi({ "OdpisPelny/P": { status: 200, body: FULL } });

    const output = await run({ krs: KRS, rejestr: "P", numerWpisu: 7 });

    expect(output).toBe(`Odpis pełny KRS ${KRS} (rejestr P) nie zawiera wpisu nr 7 – wpisy mają numery od 1 do 3.`);
  });

  it("says the entity was not found when every register answers 404", async () => {
    const fetchSpy = mockApi({});

    const output = await run({ krs: KRS });

    expect(output).toBe(`Nie znaleziono podmiotu o numerze KRS ${KRS} w rejestrze P ani S.`);
    // 2 registers × 2 URL variants, each answered once (no retries on 404); the current extract is never needed.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls.every(([url]) => String(url).includes("OdpisPelny"))).toBe(true);
  });

  it("reports an API failure instead of 'not found'", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({ "OdpisPelny/P": { status: 400 } });

    const output = await run({ krs: KRS });

    expect(output).toBe(`Nie udało się pobrać odpisu pełnego dla KRS ${KRS} – API KRS zwróciło błąd. Spróbuj ponownie później.`);
  });
});

describe("Get_KRS_Entry_History input schema", () => {
  const schema = z.object(getKrsEntryHistoryTool.schema);

  it("accepts just the KRS number and normalizes the register", () => {
    expect(schema.parse({ krs: KRS })).toEqual({ krs: KRS });
    expect(schema.parse({ krs: KRS, rejestr: "s" })).toEqual({ krs: KRS, rejestr: "S" });
  });

  it("validates dates, entry numbers and the limit", () => {
    expect(schema.safeParse({ krs: KRS, odDaty: "2025-01-08" }).success).toBe(true);
    expect(schema.safeParse({ krs: KRS, odDaty: "08.01.2025" }).success).toBe(true);
    expect(schema.safeParse({ krs: KRS, odDaty: "31.02.2025" }).success).toBe(false);
    expect(schema.safeParse({ krs: KRS, odDaty: "wczoraj" }).success).toBe(false);
    expect(schema.safeParse({ krs: KRS, numerWpisu: 0 }).success).toBe(false);
    expect(schema.safeParse({ krs: KRS, numerWpisu: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ krs: KRS, limit: 100 }).success).toBe(true);
    expect(schema.safeParse({ krs: KRS, limit: 101 }).success).toBe(false);
  });
});
