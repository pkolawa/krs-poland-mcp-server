import { formatCompanyHeadline } from "./format.js";
import { KrsExtract } from "../types/krs.js";

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
      "Stowarzyszenie Przykładowe (KRS KRS ?)"
    );
  });

  it("returns defaults when extract is empty", () => {
    const extract: KrsExtract = {};
    expect(formatCompanyHeadline(extract)).toBe("Nieznana nazwa (KRS KRS ?)");
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
    expect(formatCompanyHeadline(extract)).toBe("Only Name (KRS KRS ?)");
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
