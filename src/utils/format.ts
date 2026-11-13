import { KrsExtract, KrsNaglowek, KrsWersjaPola, KrsWpis } from "../types/krs.js";

/**
 * Reads a field that is a plain value in odpis aktualny and a list of versions in odpis pełny.
 * For the list, returns the version that has not been struck out (or the newest one).
 */
export function currentFieldValue<K extends string>(
  value: string | Array<KrsWersjaPola & { [P in K]?: string }> | undefined,
  key: K
): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const active = value.filter((version) => !version.nrWpisuWykr);
  const chosen = active.length > 0 ? active[active.length - 1] : value[value.length - 1];
  const result = chosen?.[key];
  return typeof result === "string" ? result : undefined;
}

export function getNaglowek(extract: KrsExtract): KrsNaglowek | undefined {
  const odpis = extract?.odpis;
  return odpis?.naglowekA ?? odpis?.naglowekP ?? odpis?.naglowekS ?? odpis?.naglowek;
}

export function getDanePodmiotu(extract: KrsExtract) {
  const dzial1 = extract?.odpis?.dane?.dzial1;
  return dzial1?.danePodmiotu ?? dzial1?.danePodmiotuZagranicznego;
}

export function getEntityName(extract: KrsExtract): string | undefined {
  return (
    currentFieldValue(getDanePodmiotu(extract)?.nazwa, "nazwa") ??
    extract?.dzial1?.danePodstawowe?.nazwa ??
    extract?.podstawoweDane?.nazwa ??
    extract?.nazwa
  );
}

export function getKrsNumber(extract: KrsExtract): string | undefined {
  return (
    getNaglowek(extract)?.numerKRS ??
    extract?.dzial1?.danePodstawowe?.numerKRS ??
    extract?.podstawoweDane?.numerKRS
  );
}

export function formatCompanyHeadline(extract: KrsExtract): string {
  const krs = getKrsNumber(extract) ?? "?";
  const name = getEntityName(extract) ?? "Nieznana nazwa";
  return `${name} (KRS ${krs})`;
}

/** Ostatni wpis w rejestrze. `opis` i `dataUprawomocnienia` zna tylko odpis pełny. */
export interface LastEntry {
  numer: number | null;
  data: string | null;
  opis?: string;
  sygnatura?: string;
  sad?: string;
  dataUprawomocnienia?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reads the last register entry: from the `wpis` list of odpis pełny (highest `numerWpisu`)
 * or from the "…OstatniegoWpisu" fields of odpis aktualny.
 */
export function getLastEntry(extract: KrsExtract): LastEntry | undefined {
  const naglowek = getNaglowek(extract);
  if (!naglowek) return undefined;

  const entries = Array.isArray(naglowek.wpis) ? naglowek.wpis : [];
  if (entries.length > 0) {
    const last = entries.reduce<KrsWpis>(
      (latest, entry) => ((entry.numerWpisu ?? -1) >= (latest.numerWpisu ?? -1) ? entry : latest),
      entries[0]
    );
    return {
      numer: typeof last.numerWpisu === "number" ? last.numerWpisu : null,
      data: text(last.dataWpisu) ?? null,
      opis: text(last.opis),
      sygnatura: text(last.sygnaturaAktSprawyDotyczacejWpisu),
      sad: text(last.oznaczenieSaduDokonujacegoWpisu),
      dataUprawomocnienia: text(last.dataUprawomocnienia),
    };
  }

  const numer = typeof naglowek.numerOstatniegoWpisu === "number" ? naglowek.numerOstatniegoWpisu : null;
  const data = text(naglowek.dataOstatniegoWpisu) ?? null;
  if (numer === null && data === null) return undefined;
  return {
    numer,
    data,
    sygnatura: text(naglowek.sygnaturaAktSprawyDotyczacejOstatniegoWpisu),
    sad: text(naglowek.oznaczenieSaduDokonujacegoOstatniegoWpisu),
  };
}
