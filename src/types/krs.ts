export interface KrsNaglowek {
  dataCzasOdpisu?: string;
  numerKRS?: string;
  rejestr?: string;
  stanPozycji?: number;
  stanZDnia?: string;
  [key: string]: unknown;
}

export interface KrsDanePodmiotu {
  nazwa?: Array<{ nazwa?: string; [key: string]: unknown }>;
  formaPrawna?: string;
  siedziba?: string;
  adres?: string;
  nip?: string;
  regon?: string;
  [key: string]: unknown;
}

export interface KrsDzial {
  danePodmiotu?: KrsDanePodmiotu;
  [key: string]: unknown;
}

export interface KrsOdpisDane {
  dzial1?: KrsDzial;
  dzial2?: KrsDzial;
  dzial3?: KrsDzial;
  dzial4?: KrsDzial;
  dzial5?: KrsDzial;
  dzial6?: KrsDzial;
  [key: string]: unknown;
}

export interface KrsOdpis {
  rodzaj?: string;
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
