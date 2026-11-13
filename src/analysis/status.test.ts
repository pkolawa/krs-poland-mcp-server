import {
  analyzeCurrentExtract,
  analyzeEntityWithoutCurrentExtract,
  expectedPeriodEnd,
  formatKrsDate,
  hasContent,
  parseKrsDate,
  parsePeriodEnd,
  StatusReport,
} from "./status.js";
import { KrsExtract, KrsOdpisDane, KrsWpis } from "../types/krs.js";

// Fixtures mirror the shapes returned by api-krs.ms.gov.pl (empty {} / [] for fields without an entry).
const TODAY = new Date(Date.UTC(2026, 10, 13)); // 13.11.2026 → FY 2025 statements are due

const BOARD = {
  nazwaOrganu: "ZARZĄD",
  sposobReprezentacji: "PREZES ZARZĄDU JEDNOOSOBOWO",
  sklad: [{ nazwisko: { nazwiskoICzlon: "K*****" }, funkcjaWOrganie: "PREZES ZARZĄDU", czyZawieszona: false }],
};

const FILED_UP_TO_2025 = {
  wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego: [
    { dataZlozenia: "10.07.2025", zaOkresOdDo: "OD 01.01.2024 DO 31.12.2024" },
    { dataZlozenia: "08.07.2026", zaOkresOdDo: "OD 01.01.2025 DO 31.12.2025" },
  ],
};

interface Overrides {
  formaPrawna?: string;
  dataRejestracjiWKRS?: string;
  dzial2?: KrsOdpisDane["dzial2"];
  dzial3?: KrsOdpisDane["dzial3"];
  dzial4?: Record<string, unknown>;
  dzial5?: Record<string, unknown>;
  dzial6?: Record<string, unknown>;
}

function currentExtract(overrides: Overrides = {}): KrsExtract {
  return {
    odpis: {
      rodzaj: "Aktualny",
      naglowekA: {
        rejestr: "RejP",
        numerKRS: "0000012345",
        stanZDnia: "12.11.2026",
        dataRejestracjiWKRS: overrides.dataRejestracjiWKRS ?? "18.04.2001",
        dataOstatniegoWpisu: "01.10.2026",
      },
      dane: {
        dzial1: {
          danePodmiotu: {
            formaPrawna: overrides.formaPrawna ?? "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            nazwa: "TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
          },
        },
        dzial2: overrides.dzial2 ?? { reprezentacja: BOARD },
        dzial3: overrides.dzial3 ?? {
          informacjaODniuKonczacymRokObrotowy: { dzienKonczacyPierwszyRokObrotowy: "31.12.2001" },
          wzmiankiOZlozonychDokumentach: FILED_UP_TO_2025,
        },
        dzial4: overrides.dzial4 ?? {},
        dzial5: overrides.dzial5 ?? {},
        dzial6: overrides.dzial6 ?? {},
      },
    },
  };
}

function analyze(overrides: Overrides = {}): StatusReport {
  return analyzeCurrentExtract(currentExtract(overrides), "P", "0000012345", TODAY);
}

function codes(report: StatusReport): string[] {
  return report.sygnaly.map((s) => `${s.waga}:${s.kod}`);
}

describe("analyzeCurrentExtract", () => {
  it("reports no signals for an active entity with a board and up-to-date statements", () => {
    const report = analyze();

    expect(report.ocena).toBe("BRAK_SYGNALOW");
    expect(report.sygnaly).toEqual([]);
    expect(report.podsumowanie).toBe("Brak sygnałów ostrzegawczych w KRS.");
    expect(report).toMatchObject({
      krs: "0000012345",
      rejestr: "P",
      nazwa: "TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      formaPrawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      stanZDnia: "12.11.2026",
      dataRejestracjiWKRS: "18.04.2001",
      dataOstatniegoWpisu: "01.10.2026",
      sprawozdaniaFinansowe: {
        ostatnieZlozone: { zaOkres: "OD 01.01.2025 DO 31.12.2025", dataZlozenia: "08.07.2026" },
        oczekiwaneZaRokObrotowyDo: "31.12.2025",
      },
    });
    expect(report.uwagi.length).toBeGreaterThan(0);
  });

  describe("dział 6", () => {
    it("flags an ongoing liquidation and dissolution as critical and skips the board check", () => {
      const report = analyze({
        dzial2: {},
        dzial6: {
          likwidacja: [
            {
              otwarcieLikwidacji: "27.06.2023 R. POSTANOWIENIE SĄDU REJONOWEGO W BIAŁYMSTOKU ,",
              sposobReprezentacjiPodmiotuPrzezLikwidatorow: "LIKWIDATOR JEDNOOSOBOWO",
              likwidatorzy: [{ nazwisko: { nazwiskoICzlon: "Z*****" } }],
            },
          ],
          rozwiazanieUniewaznienie: {
            okreslenieOkolicznosci: "ROZWIĄZANIE",
            informacjaORozwiazaniuUniewaznieniu: "27.06.2023 R. POSTANOWIENIE SĄDU ,",
          },
        },
      });

      expect(report.ocena).toBe("KRYTYCZNE");
      expect(codes(report)).toEqual(["krytyczny:LIKWIDACJA", "krytyczny:ROZWIAZANIE_UNIEWAZNIENIE"]);
      expect(report.sygnaly[0].opis).toBe("Podmiot w likwidacji (otwarcie: 27.06.2023 R. POSTANOWIENIE SĄDU REJONOWEGO W BIAŁYMSTOKU).");
      expect(report.sygnaly[0].szczegoly).toEqual({
        sposobReprezentacjiPrzezLikwidatorow: "LIKWIDATOR JEDNOOSOBOWO",
        liczbaLikwidatorow: 1,
      });
      expect(report.sygnaly[1].opis).toBe("Rozwiązanie podmiotu – 27.06.2023 R. POSTANOWIENIE SĄDU.");
    });

    it("treats dissolution as historical when the liquidation was ended (e.g. repealed)", () => {
      const report = analyze({
        dzial6: {
          likwidacja: [
            {
              otwarcieLikwidacji: "18.12.2019 R. - UCHWAŁA W SPRAWIE LIKWIDACJI",
              zakonczenieLikwidacji: "UCHWAŁA Z DNIA 20.06.2020 R. W PRZEDMIOCIE UCHYLENIA LIKWIDACJI.,",
              likwidatorzy: [],
            },
          ],
          rozwiazanieUniewaznienie: { informacjaORozwiazaniuUniewaznieniu: "18.12.2019 R. - UCHWAŁA" },
        },
      });

      expect(report.ocena).toBe("BRAK_SYGNALOW");
      expect(codes(report)).toEqual(["informacja:LIKWIDACJA_ZAKONCZONA", "informacja:ROZWIAZANIE_UNIEWAZNIENIE"]);
      expect(report.sygnaly[0].opis).toBe(
        "Likwidacja zakończona: UCHWAŁA Z DNIA 20.06.2020 R. W PRZEDMIOCIE UCHYLENIA LIKWIDACJI."
      );
      expect(report.sygnaly[1].opis).toContain("sprawdź, czy wpis jest nadal aktualny");
      expect(report.podsumowanie).toBe("Brak sygnałów ostrzegawczych w KRS (2 informacje historyczne).");
    });

    it("distinguishes ongoing and finished bankruptcy proceedings", () => {
      const report = analyze({
        dzial6: {
          postepowanieUpadlosciowe: [
            {
              informacjaOOgloszeniuUpadlosci: { organWydajacy: "SĄD REJONOWY W KROŚNIE", sygnatura: "V GU 1/09", data: "27.03.2009" },
              opisZakonczeniaProcesuUpadlosci: {},
              sposobProwadzeniaPostepowania: "UPADŁOŚĆ OBEJMUJĄCA LIKWIDACJĘ MAJĄTKU DŁUŻNIKA",
              informacjaOUchyleniuUkladu: {},
            },
            {
              informacjaOOgloszeniuUpadlosci: { organWydajacy: "SĄD REJONOWY W POZNANIU", sygnatura: "XV GU 188/05", data: "12.09.2005" },
              opisZakonczeniaProcesuUpadlosci: { opisSposobuZakonczeniaPostepowania: "POSTANOWIENIE O ZAKOŃCZENIU" },
            },
          ],
        },
      });

      expect(codes(report)).toEqual(["krytyczny:UPADLOSC", "informacja:UPADLOSC_ZAKONCZONA"]);
      expect(report.sygnaly[0].opis).toBe(
        "Ogłoszono upadłość (SĄD REJONOWY W KROŚNIE, sygn. V GU 1/09, 27.03.2009); brak wpisu o zakończeniu postępowania."
      );
      expect(report.sygnaly[0].szczegoly).toEqual({
        sposobProwadzeniaPostepowania: "UPADŁOŚĆ OBEJMUJĄCA LIKWIDACJĘ MAJĄTKU DŁUŻNIKA",
      });
    });

    it("skips the board check during bankruptcy", () => {
      const report = analyze({
        dzial2: {},
        dzial6: { postepowanieUpadlosciowe: [{ informacjaOOgloszeniuUpadlosci: { data: "01.01.2026" } }] },
      });
      expect(codes(report)).toEqual(["krytyczny:UPADLOSC"]);
    });

    it("reports restructuring, arrangement proceedings and repealed arrangements", () => {
      const report = analyze({
        dzial6: {
          postepowanieRestrukturyzacyjneNaprawczePrzymusowaRestrukturyzacjaUporzadkowanaLikwidacja: [
            {
              otwarciePostepowaniaRestrukturyzacyjnegoNaprawczegoPrzymusowejRestrukturyzacjiUporzadkowanejLikwidacji: {
                organWydajacy: "SĄD REJONOWY W BIAŁYMSTOKU",
                sygnatura: "VIII GR 7/18",
                dataNadaniaKlauzuliWykonalnosci: "27.03.2018",
                rodzajPostepowania: "POSTĘPOWANIE O ZATWIERDZENIE UKŁADU",
              },
              zakonczeniePostepowaniaRestrukturyzacyjnegoNaprawczegoPrzymusowejRestrukturyzacjiUporzadkowanejLikwidacji: {},
              uchylenieUkladu: {},
            },
            {
              otwarciePostepowaniaRestrukturyzacyjnegoNaprawczegoPrzymusowejRestrukturyzacjiUporzadkowanejLikwidacji: {
                rodzajPostepowania: "POSTĘPOWANIE RESTRUKTURYZACYJNE",
              },
              zakonczeniePostepowaniaRestrukturyzacyjnegoNaprawczegoPrzymusowejRestrukturyzacjiUporzadkowanejLikwidacji: {
                data: "16.11.2023",
                opis: "ZAKOŃCZENIE PRZEZ ZATWIERDZENIE UKŁADU",
              },
              uchylenieUkladu: {},
            },
          ],
          postepowanieUkladowe: [
            {
              otwarciePostepowaniaUkladowego: { organWydajacy: "SĄD REJONOWY W GLIWICACH", sygnaturaSprawy: "GL1G/GR/8/2024" },
              zakonczeniePostepowaniaUkladowego: {},
              uchylenieUkladu: { data: "01.02.2025" },
            },
          ],
        },
      });

      expect(codes(report)).toEqual([
        "ostrzezenie:UKLAD_UCHYLONY",
        "ostrzezenie:RESTRUKTURYZACJA",
        "informacja:RESTRUKTURYZACJA_ZAKONCZONE",
      ]);
      expect(report.ocena).toBe("OSTRZEZENIA");
      expect(report.sygnaly[1].opis).toBe(
        "Postępowanie o zatwierdzenie układu (SĄD REJONOWY W BIAŁYMSTOKU, sygn. VIII GR 7/18, 27.03.2018); brak wpisu o zakończeniu."
      );
      expect(report.sygnaly[2].opis).toBe(
        "Postępowanie restrukturyzacyjne zakończone: 16.11.2023, ZAKOŃCZENIE PRZEZ ZATWIERDZENIE UKŁADU."
      );
    });

    it("reports suspension only while there is no resumption date", () => {
      const report = analyze({
        dzial6: {
          zawieszenieWznowienie: [{ dataZawieszenia: "13.09.2011", dataWznowienia: "20.05.2014" }, { dataZawieszenia: "01.10.2026" }],
        },
      });

      expect(codes(report)).toEqual(["ostrzezenie:ZAWIESZENIE_DZIALALNOSCI", "informacja:ZAWIESZENIE_ZAKONCZONE"]);
      expect(report.sygnaly[0].opis).toBe("Działalność zawieszona od 01.10.2026; brak wpisu o wznowieniu.");
    });

    it("lists merged entities with registry filler stripped from names", () => {
      const report = analyze({
        dzial6: {
          polaczeniePodzialPrzeksztalcenie: [
            {
              okreslenieOkolicznosci: "PRZEJĘCIE INNEJ SPÓŁKI",
              podmiotyPrzejmowane: [{ nazwa: "ZESPÓŁ ELEKTROCIEPŁOWNI SPÓŁKA AKCYJNA,------" }],
              podmiotyPowstalePrzejmujace: [{ nazwa: "TAURON CIEPŁO SPÓŁKA AKCYJNA,------" }],
            },
          ],
        },
      });

      expect(report.sygnaly).toEqual([
        {
          kod: "POLACZENIE_PODZIAL_PRZEKSZTALCENIE",
          waga: "informacja",
          dzial: 6,
          opis: "Przejęcie innej spółki.",
          szczegoly: {
            podmiotyPrzejmowane: ["ZESPÓŁ ELEKTROCIEPŁOWNI SPÓŁKA AKCYJNA"],
            podmiotyPowstalePrzejmujace: ["TAURON CIEPŁO SPÓŁKA AKCYJNA"],
          },
        },
      ]);
    });

    it("reports unknown non-empty entries generically and ignores empty ones", () => {
      const report = analyze({ dzial6: { nowaSekcja: [{ opis: "COŚ NOWEGO" }], pustaSekcja: [{}] } });
      expect(report.sygnaly).toEqual([
        {
          kod: "WPIS_DZIAL_6",
          waga: "ostrzezenie",
          dzial: 6,
          opis: "Wpis w dziale 6 odpisu: nowaSekcja.",
          szczegoly: { nowaSekcja: [{ opis: "COŚ NOWEGO" }] },
        },
      ]);
    });
  });

  describe("dział 4", () => {
    function arrear(wartosc: string, data: string, ended = false) {
      return {
        charakterZaleglosci: "PODATKOWA",
        wysokoscZaleglosci: { wartosc, waluta: "PLN" },
        wszczecieEgzekucji: {
          organWydajacyTytulWykonawczy: "NACZELNIK URZĘDU SKARBOWEGO",
          numerTytuluWykonawczego: `T/${data}`,
          dataWszczeciaEgzekucji: data,
        },
        zakonczenieEgzekucji: ended ? { data: "01.01.2026" } : {},
      };
    }

    it("lists up to five arrears individually", () => {
      const report = analyze({ dzial4: { zaleglosci: [arrear("24368,81", "10.07.2026"), arrear("100,00", "01.01.2020", true)] } });

      expect(codes(report)).toEqual(["ostrzezenie:ZALEGLOSC", "informacja:ZALEGLOSC_ZAKONCZONA"]);
      expect(report.sygnaly[0]).toEqual({
        kod: "ZALEGLOSC",
        waga: "ostrzezenie",
        dzial: 4,
        opis:
          "Zaległość podatkowa w wysokości 24368,81 PLN; egzekucję wszczęto 10.07.2026 (NACZELNIK URZĘDU SKARBOWEGO); " +
          "brak wpisu o zakończeniu egzekucji.",
        szczegoly: { numerTytuluWykonawczego: "T/10.07.2026" },
      });
      expect(report.sygnaly[1].opis).toBe("Zaległość podatkowa w wysokości 100,00 PLN – egzekucję zakończono.");
    });

    it("aggregates more than five arrears into one signal with a total and the largest items", () => {
      const zaleglosci = [
        arrear("10,00", "12.03.2021"),
        arrear("1000,50", "01.06.2022"),
        arrear("20,00", "01.01.2023"),
        arrear("30,00", "01.01.2024"),
        arrear("40,00", "01.01.2025"),
        arrear("5000,00", "22.07.2026"),
      ];
      const report = analyze({ dzial4: { zaleglosci } });

      expect(report.sygnaly).toHaveLength(1);
      const [signal] = report.sygnaly;
      expect(signal.kod).toBe("ZALEGLOSCI");
      expect(signal.opis).toBe(
        "6 zaległości bez wpisu o zakończeniu egzekucji, łącznie 6100,50 PLN (podatkowa ×6); " +
          "egzekucje wszczęte od 12.03.2021 do 22.07.2026."
      );
      const largest = (signal.szczegoly?.najwiekszeZaleglosci ?? []) as Array<{ kwota: string }>;
      expect(largest).toHaveLength(5);
      expect(largest.map((item) => item.kwota)).toEqual(["5000,00 PLN", "1000,50 PLN", "40,00 PLN", "30,00 PLN", "20,00 PLN"]);
    });

    it("reports asset security, dismissed bankruptcy petitions and skips empty sub-entries", () => {
      const report = analyze({
        dzial4: {
          zabezpieczenieMajatkuOddalenieWnioskuOUpadlosc: [
            {
              oddalenieWnioskuOUpadlosc: {},
              zabezpieczenieMajatkuDluznikaWPostepowaniuUpadlosciowym: {
                organWydajacy: "POSTANOWIENIE SĄDU REJONOWEGO W GLIWICACH",
                sygnaturaSprawy: "SYGN. AKT GL1G/GU/902/2026",
                dataNadaniaKlauzuliWykonalnosci: "27.10.2026",
                informacjaOPrzedmiocieZabezpieczenia: "USTANOWIENIE TYMCZASOWEGO NADZORCY SĄDOWEGO",
              },
              zabezpieczenieMajatkuDluznikaWPostepowaniuRestrukturyzacyjnym: {},
              dalszePelnienieFunkcjiPoUkonczeniuPostepowaniaRestrukturyzacyjnego: {},
            },
            {
              oddalenieWnioskuOUpadlosc: { organWydajacy: "SĄD REJONOWY W OPOLU", sygnatura: "OP1O/GU/176/2026", data: "22.07.2026" },
            },
          ],
        },
      });

      expect(codes(report)).toEqual(["krytyczny:ODDALENIE_WNIOSKU_O_UPADLOSC", "ostrzezenie:ZABEZPIECZENIE_MAJATKU_UPADLOSC"]);
      expect(report.sygnaly[1].opis).toBe(
        "Sąd zabezpieczył majątek dłużnika w związku z wnioskiem o ogłoszenie upadłości " +
          "(POSTANOWIENIE SĄDU REJONOWEGO W GLIWICACH, SYGN. AKT GL1G/GU/902/2026, 27.10.2026)."
      );
      expect(report.sygnaly[1].szczegoly).toEqual({ przedmiotZabezpieczenia: "USTANOWIENIE TYMCZASOWEGO NADZORCY SĄDOWEGO" });
    });
  });

  describe("dział 5", () => {
    it("treats a curator without an end date or with a future one as active, and a past one as historical", () => {
      const report = analyze({
        dzial5: {
          kurator: [
            { dataPowolania: "14.10.2026", dataDoKtorejMaDzialac: "14.04.2027", podstawaPowolaniaZakresDzialania: "W TRYBIE ART. 42 KC" },
            { dataPowolania: "01.02.2027" },
            { dataPowolania: "01.01.2020", dataDoKtorejMaDzialac: "01.07.2020" },
          ],
        },
      });

      expect(codes(report)).toEqual(["ostrzezenie:KURATOR", "ostrzezenie:KURATOR", "informacja:KURATOR_ZAKONCZONY"]);
      expect(report.sygnaly[0].opis).toContain("Ustanowiono kuratora od 14.10.2026 do 14.04.2027.");
      expect(report.sygnaly[0].szczegoly).toEqual({ podstawaIZakres: "W TRYBIE ART. 42 KC" });
    });
  });

  describe("dział 2", () => {
    it("warns when no board members are entered", () => {
      const report = analyze({ dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD", sposobReprezentacji: "…" } } });
      expect(report.sygnaly).toEqual([
        {
          kod: "BRAK_SKLADU_ORGANU_REPREZENTACJI",
          waga: "ostrzezenie",
          dzial: 2,
          opis: "W KRS nie wpisano członków organu reprezentacji (zarząd).",
        },
      ]);
    });

    it("does not warn for entities represented through other fields (e.g. SPZOZ)", () => {
      const report = analyze({
        formaPrawna: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        dzial2: { reprezentacjaIBIGBPPSPZOZ: { sklad: [{ funkcja: "DYREKTOR" }] } },
      });
      expect(report.sygnaly).toEqual([]);
    });
  });

  describe("dział 3 – annual financial statements", () => {
    const fy = { informacjaODniuKonczacymRokObrotowy: { dzienKonczacyPierwszyRokObrotowy: "31.12.2001" } };

    it("warns a limited company whose latest statement is older than the expected year", () => {
      const report = analyze({
        dzial3: {
          ...fy,
          wzmiankiOZlozonychDokumentach: {
            wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego: [
              // Not chronological in the API – the newest period must win, not the last item.
              { dataZlozenia: "02.09.2024", zaOkresOdDo: "OD 01.01.2023 DO 31.12.2023" },
              { dataZlozenia: "15.07.2023", zaOkresOdDo: "01.01.2022R. - 31.12.2022R." },
            ],
          },
        },
      });

      expect(report.sygnaly).toEqual([
        {
          kod: "BRAK_SPRAWOZDANIA_FINANSOWEGO",
          waga: "ostrzezenie",
          dzial: 3,
          opis:
            "Brak wzmianki o złożeniu sprawozdania finansowego za rok obrotowy kończący się 31.12.2025 " +
            "(termin upłynął ok. 15.07.2026). Ostatnie złożone dotyczy okresu: OD 01.01.2023 DO 31.12.2023.",
        },
      ]);
      expect(report.sprawozdaniaFinansowe?.ostatnieZlozone).toEqual({
        zaOkres: "OD 01.01.2023 DO 31.12.2023",
        dataZlozenia: "02.09.2024",
      });
    });

    it("warns a limited company that never filed a statement", () => {
      const report = analyze({ dzial3: { ...fy, wzmiankiOZlozonychDokumentach: {} } });
      expect(codes(report)).toEqual(["ostrzezenie:BRAK_SPRAWOZDANIA_FINANSOWEGO"]);
      expect(report.sygnaly[0].opis).toContain("Brak wzmianek o złożeniu jakiegokolwiek rocznego sprawozdania");
    });

    it("only informs for forms whose obligation depends on size, and stays silent if they never filed", () => {
      const lapsed = analyze({
        formaPrawna: "SPÓŁKA JAWNA",
        dzial3: {
          ...fy,
          wzmiankiOZlozonychDokumentach: {
            wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego: [{ dataZlozenia: "12.10.2021", zaOkresOdDo: "OD 01.01.2020 DO 31.12.2020" }],
          },
        },
      });
      expect(codes(lapsed)).toEqual(["informacja:BRAK_SPRAWOZDANIA_FINANSOWEGO"]);
      expect(lapsed.sygnaly[0].opis).toContain("Obowiązek złożenia zależy od formy prawnej");

      const neverFiled = analyze({ formaPrawna: "STOWARZYSZENIE", dzial3: {} });
      expect(neverFiled.sygnaly).toEqual([]);
    });

    it("accepts a declaration of no obligation as covering the period", () => {
      const report = analyze({
        dzial3: {
          ...fy,
          wzmiankiOZlozonychDokumentach: {
            wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego: [{ dataZlozenia: "01.07.2022", zaOkresOdDo: "2021 ROK" }],
            wzmiankaOBrakuObowiazkuSporzadzeniaZlozeniaRocznegoSprawozdaniaFinansowego: [{ zaOkresOdDo: "OD 01.01.2025 DO 31.12.2025" }],
          },
        },
      });
      expect(report.sygnaly).toEqual([]);
    });

    it("does not expect statements from an entity registered in the second half of the expected year", () => {
      const report = analyze({ dataRejestracjiWKRS: "01.09.2025", dzial3: {} });
      expect(report.sygnaly).toEqual([]);
    });
  });

  it("orders signals by severity and summarizes them with Polish plurals", () => {
    const report = analyze({
      dzial2: { reprezentacja: { nazwaOrganu: "ZARZĄD" } },
      dzial5: { kurator: [{ dataPowolania: "01.10.2026" }] },
      dzial6: {
        polaczeniePodzialPrzeksztalcenie: [{ okreslenieOkolicznosci: "PODZIAŁ" }],
        upadloscPrzyszla: [{ x: "1" }],
        postepowanieUpadlosciowe: [{ informacjaOOgloszeniuUpadlosci: { data: "01.01.2026" } }],
      },
    });

    expect(report.sygnaly.map((s) => s.waga)).toEqual(["krytyczny", "ostrzezenie", "ostrzezenie", "informacja"]);
    expect(report.ocena).toBe("KRYTYCZNE");
    expect(report.podsumowanie).toBe("Wykryto: 1 sygnał krytyczny, 2 ostrzeżenia, 1 informacja historyczna.");
  });

  it("uses the 'many' plural form for 5 and 12–14", () => {
    const kurator = (n: number) => Array.from({ length: n }, () => ({ dataPowolania: "01.10.2026" }));
    expect(analyze({ dzial5: { kurator: kurator(5) } }).podsumowanie).toBe("Wykryto: 5 ostrzeżeń.");
    expect(analyze({ dzial5: { kurator: kurator(12) } }).podsumowanie).toBe("Wykryto: 12 ostrzeżeń.");
    expect(analyze({ dzial5: { kurator: kurator(22) } }).podsumowanie).toBe("Wykryto: 22 ostrzeżenia.");
  });
});

describe("analyzeEntityWithoutCurrentExtract", () => {
  function fullExtract(wpisy: KrsWpis[]): KrsExtract {
    return {
      odpis: {
        rodzaj: "Pełny",
        naglowekP: { rejestr: "RejP", numerKRS: "0000005433", stanZDnia: "12.11.2026", wpis: wpisy },
        dane: {
          dzial1: {
            danePodmiotu: {
              nazwa: [
                { nazwa: "\"KARO\" BRONISŁAWA KAMIŃSKA - SPÓŁKA JAWNA", nrWpisuWprow: "1", nrWpisuWykr: "26" },
                { nazwa: "KARO MIKOŁAJ KAMIŃSKI - SPÓŁKA JAWNA", nrWpisuWprow: "26", nrWpisuWykr: "41" },
              ],
              formaPrawna: [{ formaPrawna: "SPÓŁKA JAWNA", nrWpisuWprow: "1", nrWpisuWykr: "41" }],
            },
          },
        },
      },
    };
  }

  it("detects deletion from the register", () => {
    const report = analyzeEntityWithoutCurrentExtract(
      fullExtract([
        { numerWpisu: 1, opis: "WPIS DO REJESTRU", dataWpisu: "02.04.2001" },
        {
          numerWpisu: 41,
          opis: "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO",
          dataWpisu: "16.10.2026",
          dataUprawomocnienia: "29.10.2026",
          sygnaturaAktSprawyDotyczacejWpisu: "PO.VIII NS-REJ.KRS/32007/26/990",
          oznaczenieSaduDokonujacegoWpisu: "SĄD REJONOWY POZNAŃ",
        },
      ]),
      "P",
      "0000005433"
    );

    expect(report).toMatchObject({
      krs: "0000005433",
      rejestr: "P",
      nazwa: "KARO MIKOŁAJ KAMIŃSKI - SPÓŁKA JAWNA",
      formaPrawna: "SPÓŁKA JAWNA",
      ocena: "WYKRESLONY",
      podsumowanie: "Podmiot wykreślony z KRS 16.10.2026 (prawomocnie od 29.10.2026).",
      dataRejestracjiWKRS: "02.04.2001",
      dataOstatniegoWpisu: "16.10.2026",
    });
    expect(report.sygnaly).toEqual([
      {
        kod: "WYKRESLENIE",
        waga: "krytyczny",
        opis: "Wykreślenie z KRS wpisem nr 41 z dnia 16.10.2026 (prawomocnie od 29.10.2026).",
        szczegoly: { sygnatura: "PO.VIII NS-REJ.KRS/32007/26/990", sad: "SĄD REJONOWY POZNAŃ" },
      },
    ]);
  });

  it("returns NIEUSTALONA when there is no deletion entry", () => {
    const report = analyzeEntityWithoutCurrentExtract(
      fullExtract([{ numerWpisu: 1, opis: "WPIS DO REJESTRU", dataWpisu: "02.04.2001" }]),
      "P",
      "0000005433"
    );
    expect(report.ocena).toBe("NIEUSTALONA");
    expect(report.sygnaly).toEqual([]);
  });
});

describe("date helpers", () => {
  it("parses KRS dates with optional suffixes", () => {
    expect(formatKrsDate(parseKrsDate("31.12.2025 R.") as Date)).toBe("31.12.2025");
    expect(formatKrsDate(parseKrsDate("1.7.2020") as Date)).toBe("01.07.2020");
    expect(parseKrsDate("brak")).toBeNull();
    expect(parseKrsDate(undefined)).toBeNull();
  });

  it.each([
    ["OD 01.01.2024 DO 31.12.2024", "31.12.2024"],
    ["01.01.2000R.-31.12.2000R.", "31.12.2000"],
    ["1.01.2001 - 31.12.2001", "31.12.2001"],
    ["OD DNIA 01.07.2019 R. DO DNIA 30.06.2020 R.", "30.06.2020"],
    ["2019 ROK", "31.12.2019"],
    ["2018", "31.12.2018"],
  ])("parsePeriodEnd(%s) → %s", (period, expected) => {
    expect(formatKrsDate(parsePeriodEnd(period) as Date)).toBe(expected);
  });

  it("uses the fiscal year end for year-only periods and returns null for unparsable text", () => {
    expect(formatKrsDate(parsePeriodEnd("2019 R.", { day: 30, month: 6 }) as Date)).toBe("30.06.2019");
    expect(parsePeriodEnd("BRAK DANYCH")).toBeNull();
    expect(parsePeriodEnd(undefined)).toBeNull();
  });

  it("expects last year's statement only after the deadline plus a grace period", () => {
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
    // 31.12.2025 + 6 months + 15 days = 15.07.2026, + 30 days grace = 14.08.2026
    expect(formatKrsDate(expectedPeriodEnd(day("2026-08-13")))).toBe("31.12.2024");
    expect(formatKrsDate(expectedPeriodEnd(day("2026-08-14")))).toBe("31.12.2025");
    expect(formatKrsDate(expectedPeriodEnd(day("2026-11-13"), { day: 30, month: 6 }))).toBe("30.06.2025");
  });

  it("hasContent ignores the empty objects and arrays the API uses for missing data", () => {
    expect(hasContent({})).toBe(false);
    expect(hasContent([{}, { a: {} }])).toBe(false);
    expect(hasContent({ a: { b: " " } })).toBe(false);
    expect(hasContent({ a: { b: "X" } })).toBe(true);
    expect(hasContent(0)).toBe(true);
  });
});
