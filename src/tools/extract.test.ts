import { getKrsCurrentExtractTool, getKrsFullExtractTool } from "./extract.js";
import { KrsExtract } from "../types/krs.js";

const KRS = "0000012345";

const EXTRACT: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: { numerKRS: KRS },
    dane: { dzial1: { danePodmiotu: { nazwa: "STOWARZYSZENIE TESTOWE" } } },
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
});
