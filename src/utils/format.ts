import { KrsExtract, KrsNaglowek, KrsWersjaPola } from "../types/krs.js";

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

const INLINE_JSON_MAX_WIDTH = 160;

/**
 * JSON z wcięciami jak `JSON.stringify(value, null, 2)`, ale obiekty i tablice z samymi wartościami prostymi
 * (adres, kod PKD, lista ścieżek) trafiają do jednej linii, o ile się mieszczą. Wynik pozostaje poprawnym JSON-em,
 * a odpowiedź jest kilka razy krótsza niż przy pełnym formatowaniu.
 */
export function formatCompactJson(value: unknown, indent = ""): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";

  const isArray = Array.isArray(value);
  const entries: Array<[string | null, unknown]> = isArray
    ? value.map((item): [null, unknown] => [null, item === undefined ? null : item])
    : Object.entries(value).filter(([, item]) => item !== undefined);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return `${open}${close}`;

  const childIndent = `${indent}  `;
  const parts = entries.map(([key, item]) => (key === null ? "" : `${JSON.stringify(key)}: `) + formatCompactJson(item, childIndent));
  const isFlat = entries.every(([, item]) => item === null || typeof item !== "object");
  if (isFlat) {
    const line = isArray ? `[${parts.join(", ")}]` : `{ ${parts.join(", ")} }`;
    if (indent.length + line.length <= INLINE_JSON_MAX_WIDTH) return line;
  }
  return `${open}\n${parts.map((part) => childIndent + part).join(",\n")}\n${indent}${close}`;
}
