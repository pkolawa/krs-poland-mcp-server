import { getKrsEntityProfileTool } from "./entityProfile.js";
import { KrsExtract } from "../types/krs.js";

const KRS = "0000012345";

const EXTRACT: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: { numerKRS: KRS, stanZDnia: "12.11.2026", dataRejestracjiWKRS: "18.04.2001" },
    dane: {
      dzial1: { danePodmiotu: { nazwa: "STOWARZYSZENIE TESTOWE", formaPrawna: "STOWARZYSZENIE" } },
      dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD", sklad: [{ funkcjaWOrganie: "PREZES" }] } },
    },
  },
};

function mockApi(routes: Record<string, { status: number; body?: unknown }>) {
  return jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const rejestr = url.searchParams.get("rejestr") ?? url.pathname.split("/").at(-2);
    const route = routes[`OdpisAktualny/${rejestr}`] ?? { status: 404 };
    return { ok: route.status === 200, status: route.status, json: async () => route.body } as Response;
  });
}

async function text(args: { krs: string; rejestr?: "P" | "S" }): Promise<string> {
  return (await getKrsEntityProfileTool.handler(args)).content[0].text;
}

describe("Get_KRS_Entity_Profile handler", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the profile with a headline and a status line, checking P before S", async () => {
    mockApi({ "OdpisAktualny/S": { status: 200, body: EXTRACT } });

    const output = await text({ krs: KRS });
    const [headline, status] = output.split("\n");

    expect(headline).toBe(`Karta podmiotu – STOWARZYSZENIE TESTOWE (KRS ${KRS}, rejestr S)`);
    expect(status).toBe("Status: BRAK_SYGNALOW – Brak sygnałów ostrzegawczych w KRS.");
    expect(JSON.parse(output.slice(output.indexOf("{")))).toMatchObject({
      rejestr: "S",
      reprezentacja: { organ: "ZARZĄD", sklad: { PREZES: 1 } },
    });
  });

  it("points to the status and history tools when there is no current extract", async () => {
    mockApi({ "OdpisAktualny/P": { status: 204 } });

    expect(await text({ krs: KRS })).toBe(
      `Nie znaleziono odpisu aktualnego dla KRS ${KRS} w rejestrze P ani S. ` +
        "Podmiot wykreślony z rejestru nie ma karty – jego status i historię pokażą Check_KRS_Status i Get_KRS_Entry_History."
    );
  });

  it("reports an API failure instead of 'not found'", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({ "OdpisAktualny/P": { status: 400 } });

    expect(await text({ krs: KRS, rejestr: "P" })).toContain("API KRS zwróciło błąd");
  });
});
