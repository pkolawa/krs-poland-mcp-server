import { withoutPersonalData } from "./values.js";

describe("withoutPersonalData", () => {
  it("drops masked names, PESEL and birth dates and marks the record as a natural person", () => {
    const member = {
      nazwisko: { nazwiskoICzlon: "K**********" },
      imiona: { imie: "G******" },
      identyfikator: { pesel: "6**********", dataUrodzenia: "05.04.1969" },
      funkcjaWOrganie: "PREZES ZARZĄDU",
    };

    expect(withoutPersonalData(member)).toEqual({ osobaFizyczna: true, funkcjaWOrganie: "PREZES ZARZĄDU" });
  });

  it("keeps legal entities and their identifiers untouched", () => {
    const shareholder = { nazwa: "CHEMETALL GMBH", identyfikator: { regon: "00128630000000" }, krs: { krs: "0000000000" } };

    expect(withoutPersonalData(shareholder)).toEqual(shareholder);
  });

  it("keeps the non-personal identifiers of a person-like record and works inside nested lists", () => {
    const change = { pole: "dzial1.wspolnicySpzoo", wprowadzono: [{ identyfikator: { pesel: "7**********", regon: "123" }, posiadaneUdzialy: "10" }] };

    expect(withoutPersonalData(change)).toEqual({
      pole: "dzial1.wspolnicySpzoo",
      wprowadzono: [{ osobaFizyczna: true, identyfikator: { regon: "123" }, posiadaneUdzialy: "10" }],
    });
  });
});
