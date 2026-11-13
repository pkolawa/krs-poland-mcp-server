import { buildEntityProfile, formatAddress, formatSeat } from "./profile.js";
import { KrsExtract, KrsOdpisDane } from "../types/krs.js";
import { formatCompactJson } from "../utils/format.js";

const TODAY = new Date(Date.UTC(2026, 10, 13));
const KRS = "0000012345";

// A board member as the API returns it: names and PESEL masked, but the birth date is not.
const PERSON = {
  nazwisko: { nazwiskoICzlon: "K**********", nazwiskoIICzlon: "L****" },
  imiona: { imie: "G******", imieDrugie: "Z*******" },
  identyfikator: { pesel: "6**********", dataUrodzenia: "05.04.1969" },
};

function extract(dane: KrsOdpisDane, rejestr = "RejP"): KrsExtract {
  return {
    odpis: {
      rodzaj: "Aktualny",
      naglowekA: { rejestr, numerKRS: KRS, stanZDnia: "12.11.2026", dataRejestracjiWKRS: "18.04.2001" },
      dane,
    },
  };
}

const COMPANY: KrsOdpisDane = {
  dzial1: {
    danePodmiotu: {
      formaPrawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      nazwa: "TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      identyfikatory: { regon: "32042896000000", nip: "8513177593", statusNip: "UCHYLONY", dataDecyzji: "2026-11-12" },
    },
    siedzibaIAdres: {
      siedziba: { kraj: "POLSKA", wojewodztwo: "ZACHODNIOPOMORSKIE", powiat: "POLICKI", gmina: "KOŁBASKOWO", miejscowosc: "PRZECŁAW" },
      adres: { ulica: "UL. PRZECŁAW", nrDomu: "92D", nrLokalu: "3", miejscowosc: "PRZECŁAW", kodPocztowy: "72-005", poczta: "PRZECŁAW", kraj: "POLSKA" },
      adresStronyInternetowej: "WWW.TESTOWA.PL",
      adresDoDoreczenElektronicznychWpisanyDoBAE: "AE:PL-43364-13543-JEUCB-26",
    },
    kapital: {
      wysokoscKapitaluZakladowego: { wartosc: "50000,00", waluta: "PLN" },
      lacznaLiczbaAkcjiUdzialow: "100",
      wartoscJednejAkcji: { wartosc: "500,00", waluta: "PLN" },
      wniesioneAporty: {},
    },
    wspolnicySpzoo: [
      { ...PERSON, posiadaneUdzialy: "60 UDZIAŁÓW O ŁĄCZNEJ WYSOKOŚCI 30.000,00 ZŁ", czyPosiadaCaloscUdzialow: false },
      {
        nazwa: "CHEMETALL GMBH",
        identyfikator: { regon: "00128630000000" },
        krs: { krs: "0000000000" },
        posiadaneUdzialy: "40 UDZIAŁÓW",
        czyPosiadaCaloscUdzialow: false,
      },
    ],
    pozostaleInformacje: { czasNaJakiUtworzonyZostalPodmiot: "NIEOZNACZONY", informacjaOLiczbieUdzialow: "WIĘKSZĄ LICZBĘ UDZIAŁÓW" },
    jednostkiTerenoweOddzialy: [],
  },
  dzial2: {
    reprezentacja: {
      nazwaOrganu: "ZARZĄD",
      sposobReprezentacji: "DWÓCH CZŁONKÓW ZARZĄDU ŁĄCZNIE LUB CZŁONEK ZARZĄDU Z PROKURENTEM.",
      sklad: [
        { ...PERSON, funkcjaWOrganie: "PREZES ZARZĄDU", czyZawieszona: false },
        { ...PERSON, funkcjaWOrganie: "CZŁONEK ZARZĄDU", czyZawieszona: false },
        { ...PERSON, funkcjaWOrganie: "CZŁONEK ZARZĄDU", czyZawieszona: true },
      ],
    },
    prokurenci: [{ ...PERSON, rodzajProkury: "PROKURA ŁĄCZNA WSPÓLNIE Z CZŁONKIEM ZARZĄDU" }],
    organNadzoru: [{ nazwa: "RADA NADZORCZA", sklad: [PERSON, PERSON, PERSON] }],
  },
  dzial3: {
    przedmiotDzialalnosci: {
      przedmiotPrzewazajacejDzialalnosci: [{ opis: "DZIAŁALNOŚĆ FIRM CENTRALNYCH", kodDzial: "70", kodKlasa: "10", kodPodklasa: "Z" }],
      przedmiotPozostalejDzialalnosci: [{ opis: "WYNAJEM NIERUCHOMOŚCI", kodDzial: "68", kodKlasa: "20", kodPodklasa: "Z" }],
    },
    wzmiankiOZlozonychDokumentach: {
      wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego: [{ dataZlozenia: "01.07.2026", zaOkresOdDo: "OD 01.01.2025 DO 31.12.2025" }],
    },
  },
  dzial4: {},
  dzial5: {},
  dzial6: {},
};

describe("buildEntityProfile", () => {
  const profile = buildEntityProfile(extract(COMPANY), "P", KRS, TODAY);

  it("reads identification, NIP status, seat, address and contact data", () => {
    expect(profile).toMatchObject({
      krs: KRS,
      rejestr: "P",
      nazwa: "TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      formaPrawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      identyfikatory: { nip: "8513177593", regon: "32042896000000", statusNip: "UCHYLONY", dataDecyzjiWSprawieNip: "2026-11-12" },
      stanZDnia: "12.11.2026",
      dataRejestracjiWKRS: "18.04.2001",
      siedziba: "PRZECŁAW, gm. KOŁBASKOWO, pow. POLICKI, woj. ZACHODNIOPOMORSKIE",
      adres: "UL. PRZECŁAW 92D/3, 72-005 PRZECŁAW",
      kontakt: { www: "WWW.TESTOWA.PL", adresDoDoreczenElektronicznych: "AE:PL-43364-13543-JEUCB-26" },
    });
  });

  it("summarizes capital without empty fields", () => {
    expect(profile.kapital).toEqual({ zakladowy: "50000,00 PLN", liczbaAkcjiUdzialow: "100", wartoscJednejAkcjiUdzialu: "500,00 PLN" });
  });

  it("describes representation by function, with suspended members, proxies and the representation rule", () => {
    expect(profile.reprezentacja).toEqual({
      organ: "ZARZĄD",
      sposobReprezentacji: "DWÓCH CZŁONKÓW ZARZĄDU ŁĄCZNIE LUB CZŁONEK ZARZĄDU Z PROKURENTEM",
      sklad: { "PREZES ZARZĄDU": 1, "CZŁONEK ZARZĄDU": 2 },
      zawieszeniCzlonkowie: 1,
      prokura: ["PROKURA ŁĄCZNA WSPÓLNIE Z CZŁONKIEM ZARZĄDU"],
    });
    expect(profile.organNadzoru).toEqual([{ nazwa: "RADA NADZORCZA", liczbaCzlonkow: 3 }]);
  });

  it("names companies among the owners but not people, and drops the placeholder KRS number", () => {
    expect(profile.wlasciciele).toEqual({
      wspolnicy: [
        { wspolnik: "osoba fizyczna", udzialy: "60 UDZIAŁÓW O ŁĄCZNEJ WYSOKOŚCI 30.000,00 ZŁ" },
        { wspolnik: { nazwa: "CHEMETALL GMBH", regon: "00128630000000" }, udzialy: "40 UDZIAŁÓW" },
      ],
      informacjaOLiczbieUdzialow: "WIĘKSZĄ LICZBĘ UDZIAŁÓW",
    });
  });

  it("lists PKD codes and adds the status assessment", () => {
    expect(profile.dzialalnosc).toEqual({
      przewazajaca: ["70.10.Z – DZIAŁALNOŚĆ FIRM CENTRALNYCH"],
      pozostala: ["68.20.Z – WYNAJEM NIERUCHOMOŚCI"],
    });
    expect(profile.status).toEqual({ ocena: "BRAK_SYGNALOW", podsumowanie: "Brak sygnałów ostrzegawczych w KRS.", sygnaly: [] });
  });

  it("never returns personal data, although the API sends masked names, PESEL and birth dates", () => {
    const json = formatCompactJson(profile);
    expect(json).not.toMatch(/pesel|dataUrodzenia|05\.04\.1969|nazwisko|"imie/i);
    expect(json).not.toMatch(/[A-ZĄĆĘŁŃÓŚŹŻ0-9]\*{2,}/);
  });

  it("explains who represents an entity in liquidation and lists its status signals", () => {
    const inLiquidation = buildEntityProfile(
      extract({
        ...COMPANY,
        dzial2: {},
        dzial6: {
          likwidacja: [
            { otwarcieLikwidacji: "UCHWAŁA Z 01.02.2026", sposobReprezentacjiPodmiotuPrzezLikwidatorow: "LIKWIDATOR JEDNOOSOBOWO", likwidatorzy: [PERSON] },
          ],
        },
      }),
      "P",
      KRS,
      TODAY
    );

    expect(inLiquidation.reprezentacja).toEqual({
      uwagi: ["Podmiot w likwidacji – reprezentują go likwidatorzy (1): LIKWIDATOR JEDNOOSOBOWO."],
    });
    expect(inLiquidation.status.ocena).toBe("KRYTYCZNE");
    expect(inLiquidation.status.sygnaly).toEqual(["LIKWIDACJA"]);
  });

  it("covers associations: purpose, public-benefit status, supervising authority and long branch lists", () => {
    const branches = Array.from({ length: 21 }, (_, i) => ({ nazwa: `ODDZIAŁ ${i + 1},------`, siedziba: { miejscowosc: `MIASTO ${i + 1}` } }));
    const association = buildEntityProfile(
      extract(
        {
          dzial1: {
            danePodmiotu: { formaPrawna: "STOWARZYSZENIE", nazwa: "TOWARZYSTWO TESTOWE", czyPosiadaStatusOPP: true },
            organSprawujacyNadzor: { nazwa: "STAROSTA POWIATU WARSZAWSKIEGO" },
            jednostkiTerenoweOddzialy: branches,
          },
          dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD GŁÓWNY", sklad: [{ ...PERSON, funkcjaWOrganie: "PRZEWODNICZĄCA" }] } },
          dzial3: {
            celDzialaniaOrganizacji: { celDzialania: "ROZWIJANIE PSYCHOLOGII." },
            przedmiotDzialalnosciOPP: { nieodplatnyPkd: [{ opis: "POZOSTAŁE FORMY EDUKACJI", kodDzial: "85", kodKlasa: "59", kodPodklasa: "B" }] },
          },
        },
        "RejS"
      ),
      "S",
      KRS,
      TODAY
    );

    expect(association.organizacja).toEqual({
      celDzialania: "ROZWIJANIE PSYCHOLOGII",
      statusOPP: true,
      dzialalnoscOPPNieodplatna: ["85.59.B – POZOSTAŁE FORMY EDUKACJI"],
    });
    expect(association.inne?.organSprawujacyNadzor).toBe("STAROSTA POWIATU WARSZAWSKIEGO");
    expect(association.inne?.oddzialy).toHaveLength(15);
    expect((association.inne?.oddzialy as string[])[0]).toBe("ODDZIAŁ 1 (MIASTO 1)");
    expect(association.inne?.oddzialyLacznie).toBe(21);
  });

  it("names legal entities that sit on the board and the sole shareholder", () => {
    const withEntities = buildEntityProfile(
      extract({
        ...COMPANY,
        dzial1: {
          ...COMPANY.dzial1,
          wspolnicySpzoo: [],
          jedynyAkcjonariusz: [{ nazwa: "TAURON POLSKA ENERGIA SPÓŁKA AKCYJNA", krs: { krs: "0000271562" }, czyPosiadaCaloscAkcji: true }],
        },
        dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD", sklad: [{ nazwa: "KOMPLEMENTARIUSZ SP. Z O.O.", krs: { krs: "0000999999" }, funkcjaWOrganie: "WSPÓLNIK" }] } },
      }),
      "P",
      KRS,
      TODAY
    );

    expect(withEntities.wlasciciele).toEqual({
      jedynyAkcjonariusz: [{ akcjonariusz: { nazwa: "TAURON POLSKA ENERGIA SPÓŁKA AKCYJNA", krs: "0000271562" }, caloscAkcji: true }],
      informacjaOLiczbieUdzialow: "WIĘKSZĄ LICZBĘ UDZIAŁÓW",
    });
    expect(withEntities.reprezentacja?.podmiotyWSkladzie).toEqual([{ nazwa: "KOMPLEMENTARIUSZ SP. Z O.O.", krs: "0000999999", funkcja: "WSPÓLNIK" }]);
  });
});

describe("address helpers", () => {
  it("formats an address without street, with a different post office and a foreign country", () => {
    expect(formatAddress({ nrDomu: "12", miejscowosc: "WÓLKA", kodPocztowy: "05-000", poczta: "PIASECZNO", kraj: "POLSKA" })).toBe(
      "WÓLKA 12, 05-000 WÓLKA (poczta PIASECZNO)"
    );
    expect(formatAddress({ ulica: "HAUPTSTRASSE", nrDomu: "1", miejscowosc: "BERLIN", kodPocztowy: "10115", kraj: "NIEMCY" })).toBe(
      "HAUPTSTRASSE 1, 10115 BERLIN, NIEMCY"
    );
    expect(formatAddress({})).toBeUndefined();
  });

  it("skips repeated parts of the seat (city with county rights)", () => {
    expect(formatSeat({ kraj: "POLSKA", wojewodztwo: "MAZOWIECKIE", powiat: "WARSZAWA", gmina: "WARSZAWA", miejscowosc: "WARSZAWA" })).toBe(
      "WARSZAWA, woj. MAZOWIECKIE"
    );
  });
});
