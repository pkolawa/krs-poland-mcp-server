import { Rejestr } from "../schemas/krs.js";
import { KrsExtract, KrsWpis } from "../types/krs.js";
import { getEntityName, getNaglowek } from "../utils/format.js";
import { formatKrsDate, parseKrsDate, plural } from "./status.js";

/**
 * Historia wpisów podmiotu wyliczana z odpisu pełnego (API KRS nie ma osobnego endpointu historii):
 * - lista wpisów z nagłówka `naglowekP.wpis` wraz z polami, których dotyczył każdy wpis,
 * - zmiany wprowadzone przez konkretny wpis – wersje pól z `nrWpisuWprow`/`nrWpisuWykr` równym jego numerowi.
 *
 * W odpisie pełnym każde pole jest tablicą wersji. Elementy list (członek zarządu, kod PKD, oddział)
 * nie mają własnych numerów wpisów – mają je dopiero ich pola, dlatego zmiany są składane z powrotem
 * do poziomu elementu listy: nowy członek zarządu to jedna pozycja, a nie pięć osobnych pól.
 */

export const DEFAULT_ENTRY_LIMIT = 20;
export const MAX_ENTRY_LIMIT = 100;

/** Ile pól wypisać przy jednym wpisie na liście – rejestracja dotyka kilkudziesięciu. */
const MAX_FIELDS_PER_LISTED_ENTRY = 8;
/**
 * Budżet na wartości w opisie jednego wpisu, w znakach JSON. Rejestracja albo reorganizacja oddziałów
 * dotyka setek wartości; reszta trafia do liczników `pominieto`.
 */
const MAX_VALUE_CHARS_PER_ENTRY = 4_000;
/** Ile wartości pokazać dla jednego pola, zanim reszta trafi do licznika `pominieto`. */
const MAX_VALUES_PER_FIELD = 15;
const MAX_TEXT_LENGTH = 300;

const NOTES = [
  "Historia wyliczona z odpisu pełnego KRS: pole jest przypisane do wpisu, który je wprowadził (nrWpisuWprow) lub wykreślił (nrWpisuWykr).",
  "Dane osobowe (imiona, nazwiska, PESEL) API KRS zwraca zamaskowane.",
];

type UnknownRecord = Record<string, unknown>;

interface FieldVersion extends UnknownRecord {
  nrWpisuWprow?: string;
  nrWpisuWykr?: string;
}

/** Pole odpisu pełnego z historią wersji. */
interface VersionedField {
  /** Element listy, do którego należy pole (np. `dzial2.reprezentacja[0].sklad[3]`), albo null. */
  item: string | null;
  /** Ścieżka bez indeksów list – wspólna dla wszystkich elementów danej listy (np. `dzial2.reprezentacja.sklad`). */
  topic: string;
  /** Ścieżka pola względem elementu listy (np. `funkcjaWOrganie`), a poza listami pełna ścieżka pola. */
  key: string;
  versions: FieldVersion[];
}

export interface EntrySummary {
  numerWpisu: number;
  dataWpisu: string | null;
  opis: string | null;
  sygnatura?: string;
  dataUprawomocnienia?: string;
  /** Pola (ścieżki w `dane` bez indeksów list), w których wpis coś wprowadził lub wykreślił. */
  zmienionePola: string[];
}

export interface EntryList {
  krs: string;
  rejestr: Rejestr;
  nazwa: string | null;
  stanZDnia: string | null;
  liczbaWpisow: number;
  pierwszyWpis: { numerWpisu: number; dataWpisu: string | null } | null;
  ostatniWpis: { numerWpisu: number; dataWpisu: string | null } | null;
  filtr: { odDaty?: string; limit: number };
  /** Wpisy spełniające filtr, ale niezwrócone z powodu limitu (starsze niż zwrócone). */
  pominieto: number;
  wpisy: EntrySummary[];
  uwagi: string[];
}

export interface ItemChange {
  /** Wartości pól elementu listy, których wpis nie zmienił – pozwalają ustalić, kogo/czego dotyczy zmiana. */
  dotyczy?: unknown;
  przed?: unknown;
  po?: unknown;
}

export interface FieldChanges {
  /** Ścieżka pola w `dane` bez indeksów list, np. `dzial1.danePodmiotu.nazwa` albo `dzial2.reprezentacja.sklad`. */
  pole: string;
  wprowadzono?: unknown[];
  wykreslono?: unknown[];
  zmieniono?: ItemChange[];
  /** Liczba wartości pominiętych, żeby odpowiedź pozostała zwięzła. */
  pominieto?: number;
}

export interface EntryChanges {
  krs: string;
  rejestr: Rejestr;
  nazwa: string | null;
  wpis: {
    numerWpisu: number;
    dataWpisu: string | null;
    opis: string | null;
    sygnatura?: string;
    sad?: string;
    dataUprawomocnienia?: string;
  };
  poprzedniWpis: number | null;
  nastepnyWpis: number | null;
  zmiany: FieldChanges[];
  /** Łączna liczba wartości pominiętych w `zmiany`. */
  pominietoWartosci: number;
  uwagi: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is FieldVersion {
  return isRecord(value) && ("nrWpisuWprow" in value || "nrWpisuWykr" in value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

function stripIndices(path: string): string {
  return path.replace(/\[\d+\]/g, "");
}

function entryNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

/**
 * Zbiera wszystkie pola z wersjami. Tablica, której elementy mają `nrWpisuWprow`/`nrWpisuWykr`,
 * to historia jednego pola; tablica innych obiektów to lista elementów (np. składu zarządu).
 */
function collectVersionedFields(dane: unknown): VersionedField[] {
  const fields: VersionedField[] = [];

  const visit = (value: unknown, path: string, item: string | null, relative: string): void => {
    if (Array.isArray(value)) {
      if (value.some(isVersion)) {
        fields.push({
          item,
          topic: item ? stripIndices(item) : path,
          key: item ? relative : path,
          versions: value.filter(isVersion),
        });
        return;
      }
      value.forEach((element, index) => {
        if (isRecord(element)) visit(element, `${path}[${index}]`, `${path}[${index}]`, "");
      });
      return;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, joinPath(path, key), item, joinPath(relative, key));
      }
    }
  };

  visit(dane, "", null, "");
  return fields;
}

/** Usuwa puste wartości (API zwraca brak danych jako `{}`/`[]`/`""`) i przycina długie teksty. */
function cleanValue(value: unknown): unknown {
  if (typeof value === "string") return value.trim() ? truncate(value.trim()) : undefined;
  if (Array.isArray(value)) {
    const items = value.map(cleanValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, child]) => [key, cleanValue(child)] as const)
      .filter(([, child]) => child !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value ?? undefined;
}

/**
 * Wartość jednej wersji pola bez numerów wpisów. Wersja `{nazwa: "X", nrWpisuWprow: "1"}` pola `nazwa`
 * daje samo "X"; wersje z kilkoma polami (adres, kod PKD) zostają obiektami.
 */
function versionValue(version: FieldVersion, key: string): unknown {
  const content = cleanValue(Object.fromEntries(Object.entries(version).filter(([name]) => !name.startsWith("nrWpisu"))));
  if (!isRecord(content)) return content ?? null;
  const names = Object.keys(content);
  const fieldName = key.split(".").at(-1);
  return names.length === 1 && names[0] === fieldName ? content[fieldName] : content;
}

function versionsValue(versions: FieldVersion[], key: string): unknown {
  const values = versions.map((version) => versionValue(version, key));
  return values.length === 1 ? values[0] : values;
}

/**
 * Wartości pól elementu listy. Element, który ma tylko jedno pole (np. `pozycja` z kodem PKD
 * albo wzmianką o sprawozdaniu), daje samą wartość – nazwa pola nic tu nie wnosi.
 */
function itemValue(values: Map<string, unknown>, singleField: boolean): unknown {
  if (singleField && values.size === 1) return [...values.values()][0];
  return Object.fromEntries(values);
}

/**
 * API potrafi zwrócić wersję wprowadzoną i wykreśloną tym samym wpisem (np. adres oddziału zmieniony
 * w tym samym wpisie, który wykreśla oddział). Nie zmienia ona stanu przed wpisem ani po nim, więc jest pomijana.
 */
function isTransient(version: FieldVersion): boolean {
  const introduced = entryNumber(version.nrWpisuWprow);
  return introduced !== null && introduced === entryNumber(version.nrWpisuWykr);
}

function isActiveAfter(version: FieldVersion, entry: number): boolean {
  const introduced = entryNumber(version.nrWpisuWprow);
  const struckOut = entryNumber(version.nrWpisuWykr);
  return introduced !== null && introduced <= entry && (struckOut === null || struckOut > entry);
}

function introducedBy(field: VersionedField, entry: number): FieldVersion[] {
  return field.versions.filter((version) => entryNumber(version.nrWpisuWprow) === entry && !isTransient(version));
}

function struckOutBy(field: VersionedField, entry: number): FieldVersion[] {
  return field.versions.filter((version) => entryNumber(version.nrWpisuWykr) === entry && !isTransient(version));
}

/** Wpisy z nagłówka odpisu pełnego, posortowane rosnąco po numerze. */
export function getEntries(extract: KrsExtract): KrsWpis[] {
  const entries = getNaglowek(extract)?.wpis;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entryNumber(entry?.numerWpisu) !== null)
    .sort((a, b) => Number(a.numerWpisu) - Number(b.numerWpisu));
}

/** Pola dotknięte przez każdy wpis: numer wpisu → ścieżki pól w kolejności z odpisu. */
function fieldsByEntry(fields: VersionedField[]): Map<number, Set<string>> {
  const index = new Map<number, Set<string>>();
  const add = (entry: number | null, topic: string) => {
    if (entry === null) return;
    const topics = index.get(entry) ?? new Set<string>();
    topics.add(topic);
    index.set(entry, topics);
  };
  for (const field of fields) {
    for (const version of field.versions) {
      if (isTransient(version)) continue;
      add(entryNumber(version.nrWpisuWprow), field.topic);
      add(entryNumber(version.nrWpisuWykr), field.topic);
    }
  }
  return index;
}

function summarizeTopics(topics: Set<string> | undefined): string[] {
  const list = [...(topics ?? [])];
  if (list.length <= MAX_FIELDS_PER_LISTED_ENTRY) return list;
  const shown = list.slice(0, MAX_FIELDS_PER_LISTED_ENTRY);
  return [...shown, `… i ${plural(list.length - shown.length, "inne pole", "inne pola", "innych pól")}`];
}

/**
 * Akceptuje datę `dd.mm.yyyy` albo `yyyy-mm-dd`. Zwraca null dla innych formatów i dat nieistniejących
 * (np. 31.02.2024).
 */
export function parseDateInput(value: string): Date | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const polish = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const parts = iso ? [iso[1], iso[2], iso[3]] : polish ? [polish[3], polish[2], polish[1]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date : null;
}

export interface EntryListOptions {
  odDaty?: Date;
  limit?: number;
}

/** Lista wpisów od najnowszego, opcjonalnie od podanej daty (włącznie), z limitem. */
export function listEntries(
  extract: KrsExtract,
  rejestr: Rejestr,
  krs: string,
  options: EntryListOptions = {}
): EntryList {
  const entries = getEntries(extract);
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? DEFAULT_ENTRY_LIMIT)), MAX_ENTRY_LIMIT);
  const from = options.odDaty?.getTime();
  const matching = entries
    .filter((entry) => {
      if (from === undefined) return true;
      const date = parseKrsDate(entry.dataWpisu);
      return date !== null && date.getTime() >= from;
    })
    .reverse();
  const shown = matching.slice(0, limit);
  const touched = fieldsByEntry(collectVersionedFields(extract?.odpis?.dane));
  const first = entries[0];
  const last = entries[entries.length - 1];
  const brief = (entry: KrsWpis | undefined) =>
    entry ? { numerWpisu: Number(entry.numerWpisu), dataWpisu: str(entry.dataWpisu) ?? null } : null;

  return {
    krs,
    rejestr,
    nazwa: getEntityName(extract) ?? null,
    stanZDnia: str(getNaglowek(extract)?.stanZDnia) ?? null,
    liczbaWpisow: entries.length,
    pierwszyWpis: brief(first),
    ostatniWpis: brief(last),
    filtr: { ...(options.odDaty ? { odDaty: formatKrsDate(options.odDaty) } : {}), limit },
    pominieto: matching.length - shown.length,
    wpisy: shown.map((entry) => {
      const number = Number(entry.numerWpisu);
      const sygnatura = str(entry.sygnaturaAktSprawyDotyczacejWpisu);
      const dataUprawomocnienia = str(entry.dataUprawomocnienia);
      return {
        numerWpisu: number,
        dataWpisu: str(entry.dataWpisu) ?? null,
        opis: str(entry.opis) ?? null,
        ...(sygnatura ? { sygnatura } : {}),
        ...(dataUprawomocnienia ? { dataUprawomocnienia } : {}),
        zmienionePola: summarizeTopics(touched.get(number)),
      };
    }),
    uwagi: [...NOTES],
  };
}

type ChangeKind = "wprowadzono" | "wykreslono" | "zmieniono";

interface RawChange {
  topic: string;
  kind: ChangeKind;
  value: unknown;
}

/** Zmiana pola spoza list (np. nazwa, kapitał): wersje wykreślone i wprowadzone przez wpis. */
function plainFieldChanges(field: VersionedField, entry: number): RawChange[] {
  const added = introducedBy(field, entry);
  const removed = struckOutBy(field, entry);
  if (added.length && removed.length) {
    return [
      {
        topic: field.topic,
        kind: "zmieniono",
        value: { przed: versionsValue(removed, field.key), po: versionsValue(added, field.key) },
      },
    ];
  }
  return [
    ...removed.map((version) => ({ topic: field.topic, kind: "wykreslono" as const, value: versionValue(version, field.key) })),
    ...added.map((version) => ({ topic: field.topic, kind: "wprowadzono" as const, value: versionValue(version, field.key) })),
  ];
}

/**
 * Zmiana elementu listy. Element jest wprowadzony, gdy wpis dodał jego pola, a nic z niego nie obowiązywało
 * wcześniej; wykreślony, gdy wpis wykreślił jego pola i nic z niego nie zostało. W pozostałych przypadkach
 * element zmieniono, a niezmienione pola trafiają do `dotyczy`.
 */
function itemChange(fields: VersionedField[], entry: number): RawChange | null {
  const added = new Map<string, unknown>();
  const removed = new Map<string, unknown>();
  const unchanged = new Map<string, unknown>();

  for (const field of fields) {
    const fieldAdded = introducedBy(field, entry);
    const fieldRemoved = struckOutBy(field, entry);
    if (fieldAdded.length) added.set(field.key, versionsValue(fieldAdded, field.key));
    if (fieldRemoved.length) removed.set(field.key, versionsValue(fieldRemoved, field.key));
    if (!fieldAdded.length && !fieldRemoved.length) {
      const active = field.versions.filter((version) => isActiveAfter(version, entry));
      if (active.length) unchanged.set(field.key, versionsValue(active, field.key));
    }
  }

  if (!added.size && !removed.size) return null;
  const topic = fields[0].topic;
  const single = fields.length === 1;
  if (!unchanged.size && !removed.size) return { topic, kind: "wprowadzono", value: itemValue(added, single) };
  if (!unchanged.size && !added.size) return { topic, kind: "wykreslono", value: itemValue(removed, single) };
  return {
    topic,
    kind: "zmieniono",
    value: {
      ...(unchanged.size ? { dotyczy: itemValue(unchanged, single) } : {}),
      ...(removed.size ? { przed: itemValue(removed, single) } : {}),
      ...(added.size ? { po: itemValue(added, single) } : {}),
    },
  };
}

/**
 * Składa zmiany w rekordy per pole, w kolejności z odpisu. Pokazuje najwyżej MAX_VALUES_PER_FIELD wartości
 * jednego pola i łącznie ok. MAX_VALUE_CHARS_PER_ENTRY znaków; resztę tylko liczy.
 */
function groupChanges(changes: RawChange[]): { zmiany: FieldChanges[]; pominieto: number } {
  const byTopic = new Map<string, FieldChanges>();
  let budget = MAX_VALUE_CHARS_PER_ENTRY;
  let skipped = 0;

  for (const change of changes) {
    let record = byTopic.get(change.topic);
    if (!record) {
      record = { pole: change.topic };
      byTopic.set(change.topic, record);
    }
    const shownInRecord =
      (record.wprowadzono?.length ?? 0) + (record.wykreslono?.length ?? 0) + (record.zmieniono?.length ?? 0);
    if (budget <= 0 || shownInRecord >= MAX_VALUES_PER_FIELD) {
      record.pominieto = (record.pominieto ?? 0) + 1;
      skipped++;
      continue;
    }
    budget -= JSON.stringify(change.value)?.length ?? 0;
    if (change.kind === "zmieniono") {
      (record.zmieniono ??= []).push(change.value as ItemChange);
    } else {
      (record[change.kind] ??= []).push(change.value);
    }
  }

  return { zmiany: [...byTopic.values()], pominieto: skipped };
}

/**
 * Co zmienił wpis o podanym numerze: wartości wprowadzone, wykreślone i zmienione elementy list.
 * Zwraca null, gdy odpis nie zawiera takiego wpisu.
 */
export function describeEntry(extract: KrsExtract, rejestr: Rejestr, krs: string, numerWpisu: number): EntryChanges | null {
  const entries = getEntries(extract);
  const position = entries.findIndex((entry) => Number(entry.numerWpisu) === numerWpisu);
  if (position === -1) return null;
  const entry = entries[position];

  // Pola spoza list są oceniane osobno, pola jednego elementu listy – razem. Kolejność jak w odpisie.
  const units: Array<VersionedField | VersionedField[]> = [];
  const items = new Map<string, VersionedField[]>();
  for (const field of collectVersionedFields(extract?.odpis?.dane)) {
    if (field.item === null) {
      units.push(field);
      continue;
    }
    let itemFields = items.get(field.item);
    if (!itemFields) {
      itemFields = [];
      items.set(field.item, itemFields);
      units.push(itemFields);
    }
    itemFields.push(field);
  }

  const changes = units.flatMap((unit) =>
    Array.isArray(unit) ? (itemChange(unit, numerWpisu) ?? []) : plainFieldChanges(unit, numerWpisu)
  );
  const { zmiany, pominieto } = groupChanges(changes);

  const sygnatura = str(entry.sygnaturaAktSprawyDotyczacejWpisu);
  const sad = str(entry.oznaczenieSaduDokonujacegoWpisu);
  const dataUprawomocnienia = str(entry.dataUprawomocnienia);
  const uwagi = [...NOTES];
  if (!zmiany.length) {
    uwagi.unshift("Wpis nie wprowadził ani nie wykreślił żadnej wartości widocznej w odpisie pełnym (np. sprostowanie lub wpis techniczny).");
  }
  if (pominieto) {
    uwagi.unshift(
      `Pominięto ${plural(pominieto, "wartość", "wartości", "wartości")}, żeby odpowiedź pozostała zwięzła – ` +
        "pełne dane zawiera odpis pełny (Get_Full_KRS_Record)."
    );
  }

  return {
    krs,
    rejestr,
    nazwa: getEntityName(extract) ?? null,
    wpis: {
      numerWpisu,
      dataWpisu: str(entry.dataWpisu) ?? null,
      opis: str(entry.opis) ?? null,
      ...(sygnatura ? { sygnatura } : {}),
      ...(sad ? { sad } : {}),
      ...(dataUprawomocnienia ? { dataUprawomocnienia } : {}),
    },
    poprzedniWpis: position > 0 ? Number(entries[position - 1].numerWpisu) : null,
    nastepnyWpis: position < entries.length - 1 ? Number(entries[position + 1].numerWpisu) : null,
    zmiany,
    pominietoWartosci: pominieto,
    uwagi,
  };
}
