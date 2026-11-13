import { currentFieldValue, formatCompanyHeadline } from "./format.js";
import { KrsExtract } from "../types/krs.js";

describe("formatCompanyHeadline – API KRS response shapes", () => {
  it("reads odpis aktualny (naglowekA + plain nazwa)", () => {
    const extract: KrsExtract = {
      odpis: {
        rodzaj: "Aktualny",
        naglowekA: { numerKRS: "0000019193", rejestr: "RejP" },
        dane: { dzial1: { danePodmiotu: { nazwa: "POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA" } } },
      },
    };
    expect(formatCompanyHeadline(extract)).toBe("POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA (KRS 0000019193)");
  });

  it("reads odpis pełny (naglowekP + versioned nazwa) and picks the version still in force", () => {
    const extract: KrsExtract = {
      odpis: {
        rodzaj: "Pełny",
        naglowekP: { numerKRS: "0000019193" },
        dane: {
          dzial1: {
            danePodmiotu: {
              nazwa: [
                { nazwa: "PKP S.A. – STARA NAZWA", nrWpisuWprow: "1", nrWpisuWykr: "51" },
                { nazwa: "POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA", nrWpisuWprow: "51" },
              ],
            },
          },
        },
      },
    };
    expect(formatCompanyHeadline(extract)).toBe("POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA (KRS 0000019193)");
  });

  it("reads a foreign branch (danePodmiotuZagranicznego)", () => {
    const extract: KrsExtract = {
      odpis: {
        naglowekA: { numerKRS: "0000016709" },
        dane: { dzial1: { danePodmiotuZagranicznego: { nazwa: "SITA SP. Z O.O. ODDZIAŁ W POLSCE" } } },
      },
    };
    expect(formatCompanyHeadline(extract)).toBe("SITA SP. Z O.O. ODDZIAŁ W POLSCE (KRS 0000016709)");
  });
});

describe("currentFieldValue", () => {
  it("returns plain strings as they are", () => {
    expect(currentFieldValue("SPÓŁKA AKCYJNA", "formaPrawna")).toBe("SPÓŁKA AKCYJNA");
  });

  it("returns the newest version when every version was struck out (deleted entity)", () => {
    const versions = [
      { nazwa: "PIERWSZA", nrWpisuWprow: "1", nrWpisuWykr: "26" },
      { nazwa: "DRUGA", nrWpisuWprow: "26", nrWpisuWykr: "41" },
    ];
    expect(currentFieldValue(versions, "nazwa")).toBe("DRUGA");
  });

  it("returns undefined for missing or empty values", () => {
    expect(currentFieldValue(undefined, "nazwa")).toBeUndefined();
    expect(currentFieldValue([], "nazwa")).toBeUndefined();
  });
});

describe("formatCompanyHeadline", () => {
  it("extracts name and KRS from dzial1.danePodstawowe", () => {
    const extract: KrsExtract = {
      dzial1: {
        danePodstawowe: {
          numerKRS: "0000109411",
          nazwa: "GŁÓWNY URZĄD STATYSTYCZNY",
        },
      },
    };
    expect(formatCompanyHeadline(extract)).toBe(
      "GŁÓWNY URZĄD STATYSTYCZNY (KRS 0000109411)"
    );
  });

  it("extracts name and KRS from podstawoweDane", () => {
    const extract: KrsExtract = {
      podstawoweDane: {
        numerKRS: "0000012345",
        nazwa: "Firma Testowa Sp. z o.o.",
      },
    };
    expect(formatCompanyHeadline(extract)).toBe(
      "Firma Testowa Sp. z o.o. (KRS 0000012345)"
    );
  });

  it("falls back to top-level nazwa", () => {
    const extract: KrsExtract = {
      nazwa: "Stowarzyszenie Przykładowe",
    };
    expect(formatCompanyHeadline(extract)).toBe(
      "Stowarzyszenie Przykładowe (KRS ?)"
    );
  });

  it("returns defaults when extract is empty", () => {
    const extract: KrsExtract = {};
    expect(formatCompanyHeadline(extract)).toBe("Nieznana nazwa (KRS ?)");
  });

  it("prefers dzial1.danePodstawowe over podstawoweDane", () => {
    const extract: KrsExtract = {
      dzial1: {
        danePodstawowe: {
          numerKRS: "0000111111",
          nazwa: "Preferred Name",
        },
      },
      podstawoweDane: {
        numerKRS: "0000222222",
        nazwa: "Fallback Name",
      },
    };
    expect(formatCompanyHeadline(extract)).toBe(
      "Preferred Name (KRS 0000111111)"
    );
  });

  it("handles dzial1 without danePodstawowe", () => {
    const extract: KrsExtract = {
      dzial1: {},
      podstawoweDane: {
        numerKRS: "0000333333",
        nazwa: "From PodstawoweDane",
      },
    };
    expect(formatCompanyHeadline(extract)).toBe(
      "From PodstawoweDane (KRS 0000333333)"
    );
  });

  it("handles partial data — name present, KRS missing", () => {
    const extract: KrsExtract = {
      dzial1: {
        danePodstawowe: {
          nazwa: "Only Name",
        },
      },
    };
    expect(formatCompanyHeadline(extract)).toBe("Only Name (KRS ?)");
  });

  it("handles partial data — KRS present, name missing", () => {
    const extract: KrsExtract = {
      dzial1: {
        danePodstawowe: {
          numerKRS: "0000444444",
        },
      },
    };
    expect(formatCompanyHeadline(extract)).toBe(
      "Nieznana nazwa (KRS 0000444444)"
    );
  });
});
