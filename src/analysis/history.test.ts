import { describeEntry, getEntries, listEntries, parseDateInput } from "./history.js";
import { KrsExtract, KrsOdpisDane, KrsWpis } from "../types/krs.js";

// Fixtures mirror odpis pełny from api-krs.ms.gov.pl: every field is a list of versions with the numbers
// of the entries that introduced (nrWpisuWprow) and struck out (nrWpisuWykr) it.
const KRS = "0000012345";
const COURT = "SĄD REJONOWY DLA M.ST. WARSZAWY W WARSZAWIE, XII WYDZIAŁ GOSPODARCZY KRAJOWEGO REJESTRU SĄDOWEGO";

const ENTRIES: KrsWpis[] = [
  { numerWpisu: 1, opis: "REJESTRACJA W KRAJOWYM REJESTRZE SĄDOWYM", dataWpisu: "11.06.2001", sygnaturaAktSprawyDotyczacejWpisu: "WA.XIX NS-REJ.KRS/1/01/1", oznaczenieSaduDokonujacegoWpisu: COURT },
  { numerWpisu: 2, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "04.07.2005", sygnaturaAktSprawyDotyczacejWpisu: "WA.XII NS-REJ.KRS/2/05/2", oznaczenieSaduDokonujacegoWpisu: COURT },
  { numerWpisu: 3, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "08.01.2025", sygnaturaAktSprawyDotyczacejWpisu: "WA.XII NS-REJ.KRS/3/24/3", oznaczenieSaduDokonujacegoWpisu: COURT },
  { numerWpisu: 4, opis: "ZMIANA DANYCH W REJESTRZE", dataWpisu: "09.07.2026", sygnaturaAktSprawyDotyczacejWpisu: "RDF/4/26/4", oznaczenieSaduDokonujacegoWpisu: COURT, dataUprawomocnienia: "20.07.2026" },
  { numerWpisu: 5, opis: "SPROSTOWANIE WPISU", dataWpisu: "01.08.2026", oznaczenieSaduDokonujacegoWpisu: COURT },
];

function person(surname: string, introduced: string, struckOut?: string) {
  const version = (value: Record<string, unknown>) => ({ ...value, nrWpisuWprow: introduced, ...(struckOut ? { nrWpisuWykr: struckOut } : {}) });
  return {
    nazwisko: [version({ nazwisko: { nazwiskoICzlon: surname } })],
    imiona: [version({ imiona: { imie: "J***" } })],
    identyfikator: [version({ pesel: "7**********" })],
    czyZawieszona: [version({ czyZawieszona: false })],
    dataZawieszeniaDo: [],
  };
}

// 1 – registration; 2 – new name, second board member; 3 – member's function and a PKD code replaced;
// 4 – first member and a branch struck out, annual statements filed; 5 – correction without visible changes.
const DANE = {
  dzial1: {
    danePodmiotu: {
      formaPrawna: [{ formaPrawna: "SPÓŁKA AKCYJNA", nrWpisuWprow: "1" }],
      identyfikatory: [{ identyfikatory: { regon: "00012345600000" }, nrWpisuWprow: "1" }],
      nazwa: [
        { nazwa: "STARA NAZWA SPÓŁKA AKCYJNA", nrWpisuWprow: "1", nrWpisuWykr: "2" },
        { nazwa: "NOWA NAZWA SPÓŁKA AKCYJNA", nrWpisuWprow: "2" },
      ],
    },
    siedzibaIAdres: {
      adres: [{ ulica: "TESTOWA", nrDomu: "1", miejscowosc: "WARSZAWA", kodPocztowy: "00-001", poczta: "WARSZAWA", kraj: "POLSKA", nrWpisuWprow: "1" }],
      adresStronyInternetowej: [],
    },
    jednostkiTerenoweOddzialy: [
      {
        nazwa: [{ nazwa: "ODDZIAŁ W GDAŃSKU", nrWpisuWprow: "1", nrWpisuWykr: "4" }],
        adres: [
          { ulica: "DYREKCYJNA", nrDomu: "2", miejscowosc: "GDAŃSK", nrWpisuWprow: "1", nrWpisuWykr: "4" },
          // The API returns versions introduced and struck out by the same entry – they change nothing.
          { ulica: "PRZEJŚCIOWA", nrDomu: "9", miejscowosc: "GDAŃSK", nrWpisuWprow: "4", nrWpisuWykr: "4" },
        ],
      },
    ],
  },
  dzial2: {
    reprezentacja: [
      {
        nazwaOrganu: [{ nazwaOrganu: "ZARZĄD", nrWpisuWprow: "1" }],
        sposobReprezentacji: [{ sposobReprezentacji: "PREZES ZARZĄDU JEDNOOSOBOWO", nrWpisuWprow: "1" }],
        sklad: [
          { ...person("A*****", "1", "4"), funkcjaWOrganie: [{ funkcjaWOrganie: "PREZES ZARZĄDU", nrWpisuWprow: "1", nrWpisuWykr: "4" }] },
          {
            ...person("B*****", "2"),
            funkcjaWOrganie: [
              { funkcjaWOrganie: "CZŁONEK ZARZĄDU", nrWpisuWprow: "2", nrWpisuWykr: "3" },
              { funkcjaWOrganie: "WICEPREZES ZARZĄDU", nrWpisuWprow: "3" },
            ],
          },
        ],
      },
    ],
    prokurenci: [],
  },
  dzial3: {
    przedmiotDzialalnosci: {
      przedmiotPozostalejDzialalnosci: [
        { pozycja: [{ opis: "TRANSPORT KOLEJOWY", kodDzial: "49", kodKlasa: "10", kodPodklasa: "Z", nrWpisuWprow: "1", nrWpisuWykr: "3" }] },
        { pozycja: [{ opis: "WYNAJEM NIERUCHOMOŚCI", kodDzial: "68", kodKlasa: "20", kodPodklasa: "Z", nrWpisuWprow: "3" }] },
      ],
    },
    wzmiankiOZlozonychDokumentach: {
      wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego: [
        { pozycja: [{ dataZlozenia: "08.07.2026", zaOkresOdDo: "01.01.2025 - 31.12.2025", nrWpisuWprow: "4" }] },
      ],
    },
  },
  dzial4: {},
  dzial5: {},
  dzial6: {},
};

function fullExtract(dane: Record<string, unknown> = DANE, wpis: KrsWpis[] = ENTRIES): KrsExtract {
  return {
    odpis: {
      rodzaj: "Pełny",
      naglowekP: { rejestr: "RejP", numerKRS: KRS, stanZDnia: "12.11.2026", wpis },
      dane: dane as KrsOdpisDane,
    },
  };
}

function describe_(numerWpisu: number) {
  const changes = describeEntry(fullExtract(), "P", KRS, numerWpisu);
  if (!changes) throw new Error(`entry ${numerWpisu} not found`);
  return changes;
}

function field(numerWpisu: number, pole: string) {
  return describe_(numerWpisu).zmiany.find((change) => change.pole === pole);
}

describe("parseDateInput", () => {
  it("accepts dd.mm.yyyy and yyyy-mm-dd", () => {
    expect(parseDateInput("08.01.2025")).toEqual(new Date(Date.UTC(2025, 0, 8)));
    expect(parseDateInput("2025-01-08")).toEqual(new Date(Date.UTC(2025, 0, 8)));
    expect(parseDateInput(" 2025-01-08 ")).toEqual(new Date(Date.UTC(2025, 0, 8)));
  });

  it("rejects other formats and dates that do not exist", () => {
    expect(parseDateInput("31.02.2024")).toBeNull();
    expect(parseDateInput("2024-13-01")).toBeNull();
    expect(parseDateInput("8.1.2025")).toBeNull();
    expect(parseDateInput("08/01/2025")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
});

describe("getEntries", () => {
  it("sorts entries by number and drops ones without a number", () => {
    const shuffled = [ENTRIES[2], { opis: "BEZ NUMERU" }, ENTRIES[0], ENTRIES[1]];
    expect(getEntries(fullExtract(DANE, shuffled)).map((entry) => entry.numerWpisu)).toEqual([1, 2, 3]);
  });

  it("returns an empty list when the header has no entries", () => {
    expect(getEntries({ odpis: { naglowekP: { numerKRS: KRS } } })).toEqual([]);
  });
});

describe("listEntries", () => {
  it("lists entries newest first with the fields each entry changed", () => {
    const list = listEntries(fullExtract(), "P", KRS);

    expect(list).toMatchObject({
      krs: KRS,
      rejestr: "P",
      nazwa: "NOWA NAZWA SPÓŁKA AKCYJNA",
      stanZDnia: "12.11.2026",
      liczbaWpisow: 5,
      pierwszyWpis: { numerWpisu: 1, dataWpisu: "11.06.2001" },
      ostatniWpis: { numerWpisu: 5, dataWpisu: "01.08.2026" },
      filtr: { limit: 20 },
      pominieto: 0,
    });
    expect(list.wpisy.map((entry) => entry.numerWpisu)).toEqual([5, 4, 3, 2, 1]);
    expect(list.wpisy[3]).toEqual({
      numerWpisu: 2,
      dataWpisu: "04.07.2005",
      opis: "ZMIANA DANYCH W REJESTRZE",
      sygnatura: "WA.XII NS-REJ.KRS/2/05/2",
      zmienionePola: ["dzial1.danePodmiotu.nazwa", "dzial2.reprezentacja.sklad"],
    });
    expect(list.wpisy[1]).toMatchObject({
      numerWpisu: 4,
      dataUprawomocnienia: "20.07.2026",
      zmienionePola: [
        "dzial1.jednostkiTerenoweOddzialy",
        "dzial2.reprezentacja.sklad",
        "dzial3.wzmiankiOZlozonychDokumentach.wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego",
      ],
    });
    expect(list.wpisy[0]).toEqual({ numerWpisu: 5, dataWpisu: "01.08.2026", opis: "SPROSTOWANIE WPISU", zmienionePola: [] });
  });

  it("filters by date (inclusive) and reports entries cut off by the limit", () => {
    const list = listEntries(fullExtract(), "P", KRS, { odDaty: new Date(Date.UTC(2025, 0, 8)), limit: 2 });

    expect(list.filtr).toEqual({ odDaty: "08.01.2025", limit: 2 });
    expect(list.wpisy.map((entry) => entry.numerWpisu)).toEqual([5, 4]);
    expect(list.pominieto).toBe(1);
    expect(list.liczbaWpisow).toBe(5);
  });

  it("returns no entries when none were made on or after the date", () => {
    const list = listEntries(fullExtract(), "P", KRS, { odDaty: new Date(Date.UTC(2026, 10, 1)) });

    expect(list.wpisy).toEqual([]);
    expect(list.pominieto).toBe(0);
  });

  it("keeps the limit within 1–100", () => {
    expect(listEntries(fullExtract(), "P", KRS, { limit: 0 }).filtr.limit).toBe(1);
    expect(listEntries(fullExtract(), "P", KRS, { limit: 500 }).filtr.limit).toBe(100);
  });

  it("shortens the field list of an entry that touched many fields", () => {
    const dane = {
      dzial1: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`pole${index}`, [{ [`pole${index}`]: "X", nrWpisuWprow: "1" }]])
      ),
    };

    const [entry] = listEntries(fullExtract(dane, [ENTRIES[0]]), "P", KRS).wpisy;

    expect(entry.zmienionePola).toHaveLength(9);
    expect(entry.zmienionePola[0]).toBe("dzial1.pole0");
    expect(entry.zmienionePola[8]).toBe("… i 4 inne pola");
  });
});

describe("describeEntry", () => {
  it("describes the entry itself and its neighbours", () => {
    expect(describe_(4)).toMatchObject({
      krs: KRS,
      rejestr: "P",
      nazwa: "NOWA NAZWA SPÓŁKA AKCYJNA",
      wpis: {
        numerWpisu: 4,
        dataWpisu: "09.07.2026",
        opis: "ZMIANA DANYCH W REJESTRZE",
        sygnatura: "RDF/4/26/4",
        sad: COURT,
        dataUprawomocnienia: "20.07.2026",
      },
      poprzedniWpis: 3,
      nastepnyWpis: 5,
      pominietoWartosci: 0,
    });
    expect(describe_(1)).toMatchObject({ poprzedniWpis: null, nastepnyWpis: 2 });
  });

  it("returns null for an entry the extract does not have", () => {
    expect(describeEntry(fullExtract(), "P", KRS, 99)).toBeNull();
  });

  it("shows a replaced value as before/after", () => {
    expect(field(2, "dzial1.danePodmiotu.nazwa")).toEqual({
      pole: "dzial1.danePodmiotu.nazwa",
      zmieniono: [{ przed: "STARA NAZWA SPÓŁKA AKCYJNA", po: "NOWA NAZWA SPÓŁKA AKCYJNA" }],
    });
  });

  it("collapses the fields of a new list item (board member) into one value", () => {
    expect(field(2, "dzial2.reprezentacja.sklad")).toEqual({
      pole: "dzial2.reprezentacja.sklad",
      wprowadzono: [
        {
          nazwisko: { nazwiskoICzlon: "B*****" },
          imiona: { imie: "J***" },
          identyfikator: { pesel: "7**********" },
          czyZawieszona: false,
          funkcjaWOrganie: "CZŁONEK ZARZĄDU",
        },
      ],
    });
  });

  it("shows a change inside a list item together with the fields that identify it", () => {
    expect(field(3, "dzial2.reprezentacja.sklad")).toEqual({
      pole: "dzial2.reprezentacja.sklad",
      zmieniono: [
        {
          dotyczy: {
            nazwisko: { nazwiskoICzlon: "B*****" },
            imiona: { imie: "J***" },
            identyfikator: { pesel: "7**********" },
            czyZawieszona: false,
          },
          przed: { funkcjaWOrganie: "CZŁONEK ZARZĄDU" },
          po: { funkcjaWOrganie: "WICEPREZES ZARZĄDU" },
        },
      ],
    });
  });

  it("unwraps single-field list items such as PKD codes", () => {
    expect(field(3, "dzial3.przedmiotDzialalnosci.przedmiotPozostalejDzialalnosci")).toEqual({
      pole: "dzial3.przedmiotDzialalnosci.przedmiotPozostalejDzialalnosci",
      wprowadzono: [{ opis: "WYNAJEM NIERUCHOMOŚCI", kodDzial: "68", kodKlasa: "20", kodPodklasa: "Z" }],
      wykreslono: [{ opis: "TRANSPORT KOLEJOWY", kodDzial: "49", kodKlasa: "10", kodPodklasa: "Z" }],
    });
  });

  it("reports struck-out list items and ignores versions introduced and struck out by the same entry", () => {
    const changes = describe_(4).zmiany;

    expect(changes.map((change) => change.pole)).toEqual([
      "dzial1.jednostkiTerenoweOddzialy",
      "dzial2.reprezentacja.sklad",
      "dzial3.wzmiankiOZlozonychDokumentach.wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego",
    ]);
    expect(changes[0]).toEqual({
      pole: "dzial1.jednostkiTerenoweOddzialy",
      wykreslono: [{ nazwa: "ODDZIAŁ W GDAŃSKU", adres: { ulica: "DYREKCYJNA", nrDomu: "2", miejscowosc: "GDAŃSK" } }],
    });
    expect(changes[1].wykreslono).toEqual([expect.objectContaining({ funkcjaWOrganie: "PREZES ZARZĄDU" })]);
    expect(changes[2].wprowadzono).toEqual([{ dataZlozenia: "08.07.2026", zaOkresOdDo: "01.01.2025 - 31.12.2025" }]);
  });

  it("explains an entry that changed nothing visible in the extract", () => {
    const changes = describe_(5);

    expect(changes.zmiany).toEqual([]);
    expect(changes.uwagi[0]).toContain("nie wprowadził ani nie wykreślił");
  });

  it("shows at most 15 values per field and counts the ones left out", () => {
    const pkd = (index: number) => ({ pozycja: [{ opis: `DZIAŁALNOŚĆ ${index}`, kodDzial: String(index), nrWpisuWprow: "1" }] });
    const dane = {
      dzial3: { przedmiotDzialalnosci: { przedmiotPozostalejDzialalnosci: Array.from({ length: 20 }, (_, i) => pkd(i)) } },
      dzial6: { rozwiazanieUniewaznienie: { opis: [{ opis: "ZAMKNIĘCIE", nrWpisuWprow: "1" }] } },
    };

    const changes = describeEntry(fullExtract(dane, [ENTRIES[0]]), "P", KRS, 1);

    const [pkdChanges, dissolution] = changes?.zmiany ?? [];
    expect(pkdChanges.wprowadzono).toHaveLength(15);
    expect(pkdChanges.pominieto).toBe(5);
    expect(dissolution).toEqual({ pole: "dzial6.rozwiazanieUniewaznienie.opis", wprowadzono: ["ZAMKNIĘCIE"] });
    expect(changes?.pominietoWartosci).toBe(5);
    expect(changes?.uwagi[0]).toContain("Pominięto 5 wartości");
  });

  it("stops adding values once the entry's size budget is used up, but still lists every field", () => {
    const dane = {
      dzial1: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`pole${index}`, [{ [`pole${index}`]: "X".repeat(290), nrWpisuWprow: "1" }]])
      ),
    };

    const changes = describeEntry(fullExtract(dane, [ENTRIES[0]]), "P", KRS, 1);

    const zmiany = changes?.zmiany ?? [];
    const shown = zmiany.filter((change) => change.wprowadzono).length;
    expect(zmiany).toHaveLength(20);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(20);
    expect(zmiany.slice(shown).every((change) => change.pominieto === 1 && !change.wprowadzono)).toBe(true);
    expect(changes?.pominietoWartosci).toBe(20 - shown);
  });

  it("drops empty values and truncates long texts", () => {
    const dane = {
      dzial1: {
        umowaStatut: [{ tekst: "A".repeat(400), uwagi: "", zalaczniki: {}, nrWpisuWprow: "1" }],
      },
    };

    const [change] = describeEntry(fullExtract(dane, [ENTRIES[0]]), "P", KRS, 1)?.zmiany ?? [];

    const value = change.wprowadzono?.[0] as { tekst: string };
    expect(Object.keys(value)).toEqual(["tekst"]);
    expect(value.tekst).toHaveLength(300);
    expect(value.tekst.endsWith("…")).toBe(true);
  });

  it("shows a version holding just its field's value (after dropping empty fields) as the bare value", () => {
    const dane = { dzial1: { danePodmiotu: { nazwa: [{ nazwa: "SPÓŁKA", nazwaSkrocona: "", nrWpisuWprow: "1" }] } } };

    const [change] = describeEntry(fullExtract(dane, [ENTRIES[0]]), "P", KRS, 1)?.zmiany ?? [];

    expect(change).toEqual({ pole: "dzial1.danePodmiotu.nazwa", wprowadzono: ["SPÓŁKA"] });
  });
});
