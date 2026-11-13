import { getKrsCurrentExtractTool, getKrsFullExtractTool } from "./extract.js";
import { checkKrsStatusTool } from "./checkStatus.js";
import { getKrsEntryHistoryTool } from "./entryHistory.js";
import { getKrsEntityProfileTool } from "./entityProfile.js";
import { errorResult, textResult } from "./result.js";
import { KrsExtract } from "../types/krs.js";

const KRS = "0000012345";

const EXTRACT: KrsExtract = {
  odpis: {
    rodzaj: "Aktualny",
    naglowekA: { numerKRS: KRS },
    naglowekP: { numerKRS: KRS, wpis: [{ numerWpisu: 1, opis: "WPIS DO REJESTRU", dataWpisu: "02.04.2001" }] },
    dane: { dzial1: { danePodmiotu: { nazwa: "SPÓŁKA TESTOWA", formaPrawna: "SPÓŁKA AKCYJNA" } } },
  },
};

type Handler = (args: { krs: string }) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

const TOOLS: Array<[string, Handler]> = [
  ["Get_Current_KRS_Record", (args) => getKrsCurrentExtractTool.handler(args)],
  ["Get_Full_KRS_Record", (args) => getKrsFullExtractTool.handler(args)],
  ["Check_KRS_Status", (args) => checkKrsStatusTool.handler(args)],
  ["Get_KRS_Entry_History", (args) => getKrsEntryHistoryTool.handler(args)],
  ["Get_KRS_Entity_Profile", (args) => getKrsEntityProfileTool.handler(args)],
];

function mockApi(status: number) {
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: status === 200, status, json: async () => EXTRACT } as Response);
}

describe("isError contract", () => {
  afterEach(() => jest.restoreAllMocks());

  it("textResult and errorResult build one text block, only errorResult flags isError", () => {
    expect(textResult("ok")).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(errorResult("fail")).toEqual({ content: [{ type: "text", text: "fail" }], isError: true });
  });

  describe.each(TOOLS)("%s", (_name, handler) => {
    it("returns a regular result for a found entity", async () => {
      mockApi(200);
      expect(await handler({ krs: KRS })).not.toHaveProperty("isError");
    });

    it("treats 'not found' as an answer, not an error", async () => {
      mockApi(404);
      const result = await handler({ krs: KRS });
      expect(result).not.toHaveProperty("isError");
      expect(result.content[0].text).toMatch(/Nie znaleziono/);
    });

    it("flags an API failure with isError", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      mockApi(400);
      const result = await handler({ krs: KRS });
      expect(result).toHaveProperty("isError", true);
      expect(result.content[0].text).toContain("API KRS zwróciło błąd");
    });
  });
});
