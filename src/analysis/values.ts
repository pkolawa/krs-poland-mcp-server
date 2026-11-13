/** Odczyt wartości z odpisu KRS, w którym puste pola przychodzą jako `{}` / `[]`, a teksty z dopiskami. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** API zwraca puste obiekty/tablice dla pól bez wpisu – traktujemy je jak brak wartości. */
export function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  if (isRecord(value)) return Object.values(value).some(hasContent);
  return true;
}

/** A list of objects, also when the API returns a single object where a list is possible. */
export function asItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** KRS texts often end with stray separators ("…LIKWIDACJI.,"); drop them so sentences end cleanly. */
export function trimTrailingPunctuation(text: string): string {
  return text.replace(/[\s,.;:-]+$/, "");
}

export function truncate(text: string, max = 300): string {
  const clean = trimTrailingPunctuation(text);
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const PERSON_FIELDS = new Set(["nazwisko", "imiona"]);
const PERSON_IDENTIFIERS = new Set(["pesel", "dataUrodzenia"]);

/**
 * Removes the data of natural persons that the API returns for board members, shareholders, proxies etc.:
 * names and PESEL come masked ("K*****", "7**********"), but e.g. a birth date does not. A record that held
 * such data is marked with `osobaFizyczna: true`, so "a person joined the board as X" is still visible.
 * Identifiers of legal entities (REGON, KRS, NIP) stay.
 */
export function withoutPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPersonalData);
  if (!isRecord(value)) return value;

  let person = false;
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (PERSON_FIELDS.has(key) || PERSON_IDENTIFIERS.has(key)) {
      person = true;
      continue;
    }
    if (key === "identyfikator" && isRecord(child)) {
      const rest = Object.fromEntries(Object.entries(child).filter(([name]) => !PERSON_IDENTIFIERS.has(name)));
      if (Object.keys(rest).length < Object.keys(child).length) person = true;
      if (Object.keys(rest).length) kept[key] = rest;
      continue;
    }
    kept[key] = withoutPersonalData(child);
  }
  return person ? { osobaFizyczna: true, ...kept } : kept;
}
