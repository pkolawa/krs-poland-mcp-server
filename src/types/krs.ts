export interface KrsExtract {
  // Many providers show a top-level split into działy (1..6) for odpisy.
  dzial1?: {
    danePodstawowe?: {
      numerKRS?: string;
      nazwa?: string;
      formaPrawna?: string;
      siedziba?: string;
      adres?: string;
      nip?: string;
      regon?: string;
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
  [key: string]: unknown; // keep schema-open for all other sections/fields
}