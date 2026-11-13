import { checkKrsStatusTool } from "./checkStatus.js";
import { KrsExtract } from "../types/krs.js";

const KRS = "0000012345";

const ACTIVE: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: { numerKRS: KRS, stanZDnia: "12.11.2026", dataRejestracjiWKRS: "18.04.2001" },
    dane: {
      dzial1: { danePodmiotu: { nazwa: "STOWARZYSZENIE TESTOWE", formaPrawna: "STOWARZYSZENIE" } },
      dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD", sklad: [{ funkcjaWOrganie: "PREZES" }] } },
      dzial3: {},
      dzial4: {},
      dzial5: {},
      dzial6: {},
    },
  },
};

const DELETED: KrsExtract = {
  odpis: {
    rodzaj: "Pełny",
    naglowekP: {
      numerKRS: KRS,
      wpis: [
        { numerWpisu: 1, opis: "WPIS DO REJESTRU", dataWpisu: "02.04.2001" },
        { numerWpisu: 9, opis: "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO", dataWpisu: "16.10.2026" },
      ],
    },
    dane: { dzial1: { danePodmiotu: { nazwa: [{ nazwa: "SPÓŁKA USUNIĘTA", nrWpisuWprow: "1", nrWpisuWykr: "9" }] } } },
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

function text(result: Awaited<ReturnType<typeof checkKrsStatusTool.handler>>): string {
  return result.content[0].text;
}

function reportFrom(output: string) {
  return JSON.parse(output.slice(output.indexOf("{")));
}

describe("Check_KRS_Status handler", () => {
  afterEach(() => jest.restoreAllMocks());

  it("checks only the given register and returns a compact report", async () => {
    const fetchSpy = mockApi({ "OdpisAktualny/S": { status: 200, body: ACTIVE } });

    const output = text(await checkKrsStatusTool.handler({ krs: KRS, rejestr: "S" }));

    expect(output.split("\n")[0]).toBe(`Status podmiotu – STOWARZYSZENIE TESTOWE (KRS ${KRS}, rejestr S)`);
    expect(output).toContain("Ocena: BRAK_SYGNALOW – Brak sygnałów ostrzegawczych w KRS.");
    expect(reportFrom(output)).toMatchObject({ krs: KRS, rejestr: "S", ocena: "BRAK_SYGNALOW" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${KRS}?rejestr=S&format=json`
    );
  });

  it("tries register P, then S, when no register is given", async () => {
    mockApi({ "OdpisAktualny/S": { status: 200, body: ACTIVE } });

    const output = text(await checkKrsStatusTool.handler({ krs: KRS }));

    expect(reportFrom(output).rejestr).toBe("S");
  });

  it("detects a deleted entity from the full extract when there is no current one", async () => {
    // The API answers 204 No Content for the current extract of a deleted entity.
    mockApi({ "OdpisAktualny/P": { status: 204 }, "OdpisPelny/P": { status: 200, body: DELETED } });

    const output = text(await checkKrsStatusTool.handler({ krs: KRS }));

    expect(output).toContain("Ocena: WYKRESLONY – Podmiot wykreślony z KRS 16.10.2026.");
    expect(reportFrom(output)).toMatchObject({ nazwa: "SPÓŁKA USUNIĘTA", rejestr: "P", ocena: "WYKRESLONY" });
  });

  it("says the entity was not found when every register answers 404", async () => {
    const fetchSpy = mockApi({});

    const output = text(await checkKrsStatusTool.handler({ krs: KRS }));

    expect(output).toBe(`Nie znaleziono podmiotu o numerze KRS ${KRS} w rejestrze P ani S.`);
    // 2 registers × 2 extract types × 2 URL variants, each answered once (no retries on 404).
    expect(fetchSpy).toHaveBeenCalledTimes(8);
  });

  it("reports an API failure instead of 'not found' and does not fall through to the full extract", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = mockApi({ "OdpisAktualny/P": { status: 400 } });

    const output = text(await checkKrsStatusTool.handler({ krs: KRS, rejestr: "P" }));

    expect(output).toContain("API KRS zwróciło błąd");
    expect(fetchSpy.mock.calls.every(([url]) => !String(url).includes("OdpisPelny"))).toBe(true);
  });
});
