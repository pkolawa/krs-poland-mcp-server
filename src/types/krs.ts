/**
 * Struktura odpowiedzi API KRS. Opisane są tylko pola, z których korzysta serwer –
 * API zwraca znacznie więcej, stąd sygnatury indeksowe.
 *
 * Odpis aktualny ma nagłówek `naglowekA`, a wartości pól są proste (string/obiekt).
 * Odpis pełny ma nagłówek `naglowekP` z listą wpisów, a pola są tablicami wersji
 * z numerami wpisów, które je wprowadziły (`nrWpisuWprow`) i wykreśliły (`nrWpisuWykr`).
 */

export interface KrsWpis {
  numerWpisu?: number;
  opis?: string;
  dataWpisu?: string;
  sygnaturaAktSprawyDotyczacejWpisu?: string;
  oznaczenieSaduDokonujacegoWpisu?: string;
  dataUprawomocnienia?: string;
  [key: string]: unknown;
}

export interface KrsNaglowek {
  dataCzasOdpisu?: string;
  numerKRS?: string;
  rejestr?: string;
  stanPozycji?: number;
  stanZDnia?: string;
  dataRejestracjiWKRS?: string;
  numerOstatniegoWpisu?: number;
  dataOstatniegoWpisu?: string;
  wpis?: KrsWpis[];
  [key: string]: unknown;
}

/** Wartość pola w odpisie pełnym – jedna wersja z historii. */
export interface KrsWersjaPola {
  nrWpisuWprow?: string;
  nrWpisuWykr?: string;
  [key: string]: unknown;
}

export interface KrsDanePodmiotu {
  nazwa?: string | Array<KrsWersjaPola & { nazwa?: string }>;
  formaPrawna?: string | Array<KrsWersjaPola & { formaPrawna?: string }>;
  identyfikatory?: { nip?: string; regon?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface KrsDzial1 {
  danePodmiotu?: KrsDanePodmiotu;
  danePodmiotuZagranicznego?: KrsDanePodmiotu;
  [key: string]: unknown;
}

export interface KrsDzial2 {
  reprezentacja?: {
    nazwaOrganu?: string;
    sposobReprezentacji?: string;
    sklad?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface KrsOkresSprawozdania {
  dataZlozenia?: string;
  zaOkresOdDo?: string;
  [key: string]: unknown;
}

export interface KrsDzial3 {
  informacjaODniuKonczacymRokObrotowy?: { dzienKonczacyPierwszyRokObrotowy?: string; [key: string]: unknown };
  wzmiankiOZlozonychDokumentach?: {
    wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego?: KrsOkresSprawozdania[];
    wzmiankaOBrakuObowiazkuSporzadzeniaZlozeniaRocznegoSprawozdaniaFinansowego?: KrsOkresSprawozdania[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Działy 4–6 (zaległości, kurator, likwidacja/upadłość itp.) analizuje `src/analysis/status.ts`. */
export type KrsDzialOgolny = Record<string, unknown>;

export interface KrsOdpisDane {
  dzial1?: KrsDzial1;
  dzial2?: KrsDzial2;
  dzial3?: KrsDzial3;
  dzial4?: KrsDzialOgolny;
  dzial5?: KrsDzialOgolny;
  dzial6?: KrsDzialOgolny;
  [key: string]: unknown;
}

export interface KrsOdpis {
  rodzaj?: string;
  naglowekA?: KrsNaglowek;
  naglowekP?: KrsNaglowek;
  naglowekS?: KrsNaglowek;
  naglowek?: KrsNaglowek;
  dane?: KrsOdpisDane;
  [key: string]: unknown;
}

export interface KrsExtract {
  odpis?: KrsOdpis;
  dzial1?: {
    danePodstawowe?: {
      numerKRS?: string;
      nazwa?: string;
      formaPrawna?: string;
      siedziba?: string;
      adres?: string;
      nip?: string;
      regon?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  podstawoweDane?: {
    numerKRS?: string;
    nazwa?: string;
    formaPrawna?: string;
    nip?: string;
    regon?: string;
    [key: string]: unknown;
  };
  nazwa?: string;
  [key: string]: unknown;
}
