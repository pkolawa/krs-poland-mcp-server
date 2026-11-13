import { counterpartyCheckPrompt } from "./counterpartyCheck.js";

const TODAY = new Date(Date.UTC(2026, 10, 13));

function promptText(args: Parameters<typeof counterpartyCheckPrompt.build>[0], today = TODAY): string {
  const { messages } = counterpartyCheckPrompt.build(args, today);
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe("user");
  return messages[0].content.text;
}

describe("counterpartyCheckPrompt", () => {
  it("asks for the profile, the status and the last 12 months of history, in that order", () => {
    const text = promptText({ krs: "0000019193" });

    const order = ["Get_KRS_Entity_Profile", "Check_KRS_Status", "Get_KRS_Entry_History"].map((tool) => text.indexOf(tool));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('Get_KRS_Entry_History (krs: "0000019193", odDaty: "2025-11-13")');
    expect(text).toContain("Kto może podpisać umowę");
    expect(text).toContain("ZIELONA");
    expect(text).not.toContain("rejestr:");
  });

  it("passes the register to every tool call and adds a section for the given context", () => {
    const text = promptText({ krs: "0000038316", rejestr: "S", kontekst: "  umowa dostawy na 200 tys. zł " });

    expect(text.split("\n")[0]).toBe("Zweryfikuj kontrahenta o numerze KRS 0000038316 (rejestr S). Kontekst weryfikacji: umowa dostawy na 200 tys. zł.");
    expect(text.match(/rejestr: "S"/g)).toHaveLength(3);
    expect(text).toContain("- Wnioski dla kontekstu „umowa dostawy na 200 tys. zł”");
  });

  it("clamps the history start to the end of a shorter month", () => {
    expect(promptText({ krs: "0000019193" }, new Date(Date.UTC(2028, 1, 29)))).toContain('odDaty: "2027-02-28"');
  });

  it("validates its arguments with the shared schemas", () => {
    const { krs, rejestr, kontekst } = counterpartyCheckPrompt.argsSchema;
    expect(krs.safeParse("123").success).toBe(false);
    expect(rejestr.parse("s")).toBe("S");
    expect(rejestr.parse(undefined)).toBeUndefined();
    expect(kontekst.safeParse("x".repeat(501)).success).toBe(false);
  });
});
