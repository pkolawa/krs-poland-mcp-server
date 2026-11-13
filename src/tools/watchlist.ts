import { z } from "zod";
import { fetchBulletin } from "../utils/api.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { getLastEntry, LastEntry } from "../utils/format.js";
import { krsNumberSchema, Rejestr } from "../schemas/krs.js";
import { parseKrsDate, StatusAssessment } from "../analysis/status.js";
import { lookupEntityStatus } from "./checkStatus.js";
import { errorResult, textResult } from "./result.js";

/**
 * Obserwowane podmioty: które z podanych numerów KRS miały wpis w rejestrze danego dnia
 * lub w zakresie dat. Źródłem jest dzienny biuletyn KRS (lista numerów z wpisem w danym dniu);
 * dla trafień narzędzie dociąga odpis, żeby podać ostatni wpis i ocenę statusu.
 */

export const MAX_WATCHED_KRS = 50;
export const MAX_RANGE_DAYS = 31;
// Small bursts: a 31-day range is 31 bulletin calls, then one extract lookup per hit.
const BULLETIN_CONCURRENCY = 3;
const DETAILS_CONCURRENCY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDateSchema = z.iso.date("Data w formacie RRRR-MM-DD");

export interface WatchlistArgs {
  krs: string[];
  data?: string;
  odDaty?: string;
  doDaty?: string;
  szczegoly?: boolean;
}

export interface WatchlistHit {
  krs: string;
  nazwa?: string | null;
  rejestr?: Rejestr;
  /** Dni z zakresu, w których numer był w biuletynie (RRRR-MM-DD). */
  dni: string[];
  ostatniWpis?: (LastEntry & { wZakresie: boolean | null }) | null;
  ocena?: StatusAssessment;
  podsumowanie?: string;
  blad?: string;
}

export interface WatchlistReport {
  zakres: { od: string; do: string; liczbaDni: number };
  liczbaPodmiotow: number;
  zmiany: WatchlistHit[];
  bezZmian: string[];
  niepobraneDni: { data: string; blad: string }[];
  uwagi: string[];
}

export type DateRange = { from: string; to: string; days: string[] };

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Current calendar day in Poland – the register works on Polish dates regardless of the server's zone. */
export function todayInPoland(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Validates `data` / `odDaty` / `doDaty` and lists the days of the range; returns an error message otherwise. */
export function resolveDateRange(args: Pick<WatchlistArgs, "data" | "odDaty" | "doDaty">, now: Date): DateRange | string {
  const { data, odDaty, doDaty } = args;
  const today = todayInPoland(now);

  if (data && (odDaty || doDaty)) return "Podaj albo `data`, albo zakres `odDaty`/`doDaty` – nie oba naraz.";
  if (!data && !odDaty) {
    return doDaty
      ? "Brak początku zakresu – podaj `odDaty` (albo pojedynczy dzień w `data`)."
      : "Podaj dzień (`data`) albo zakres dat (`odDaty`, opcjonalnie `doDaty`) w formacie RRRR-MM-DD.";
  }

  const from = (data ?? odDaty) as string;
  const to = data ?? doDaty ?? today;
  if (from > to) return `Początek zakresu (${from}) jest późniejszy niż koniec (${to}).`;
  if (to > today) return `Data ${to} jest z przyszłości – biuletyn KRS obejmuje dni do dzisiaj (${today}).`;

  const start = Date.parse(`${from}T00:00:00Z`);
  const count = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / DAY_MS) + 1;
  if (count > MAX_RANGE_DAYS) {
    return `Zakres ${from} – ${to} ma ${count} dni; maksymalnie ${MAX_RANGE_DAYS}. Podziel go na krótsze okresy.`;
  }

  const days = Array.from({ length: count }, (_, i) => toIsoDate(new Date(start + i * DAY_MS)));
  return { from, to, days };
}

function krsDateToIso(value: string | null | undefined): string | null {
  const date = parseKrsDate(value ?? undefined);
  return date ? toIsoDate(date) : null;
}

async function describeHit(krs: string, dni: string[], range: DateRange): Promise<WatchlistHit> {
  const lookup = await lookupEntityStatus(krs, ["P", "S"]);

  if (lookup.status === "error") {
    return { krs, dni, blad: `Nie udało się pobrać odpisu (${lookup.stage}) – API KRS zwróciło błąd.` };
  }
  if (lookup.status === "not_found") {
    return { krs, dni, blad: "Nie znaleziono odpisu w rejestrze P ani S." };
  }

  const entry = getLastEntry(lookup.extract);
  const entryDate = krsDateToIso(entry?.data);
  return {
    krs,
    nazwa: lookup.report.nazwa,
    rejestr: lookup.rejestr,
    dni,
    ostatniWpis: entry
      ? { ...entry, wZakresie: entryDate ? entryDate >= range.from && entryDate <= range.to : null }
      : null,
    ocena: lookup.report.ocena,
    podsumowanie: lookup.report.podsumowanie,
  };
}

function rangeLabel(range: DateRange): string {
  return range.from === range.to ? range.from : `${range.from} – ${range.to} (${range.days.length} dni)`;
}

function dayCount(count: number): string {
  return `${count} ${count === 1 ? "dzień" : "dni"}`;
}


export async function checkWatchlist(args: WatchlistArgs, now: Date = new Date()) {
  const range = resolveDateRange(args, now);
  if (typeof range === "string") return errorResult(range);

  const watched = [...new Set(args.krs)];
  const watchedSet = new Set(watched);
  const withDetails = args.szczegoly ?? true;

  const bulletins = await mapWithConcurrency(range.days, BULLETIN_CONCURRENCY, async (day) => ({
    day,
    result: await fetchBulletin(day),
  }));

  const daysByKrs = new Map<string, string[]>();
  const failedDays: WatchlistReport["niepobraneDni"] = [];
  for (const { day, result } of bulletins) {
    if (result.status === "error") {
      failedDays.push({ data: day, blad: result.error });
      continue;
    }
    for (const krs of result.data) {
      if (watchedSet.has(krs)) daysByKrs.set(krs, [...(daysByKrs.get(krs) ?? []), day]);
    }
  }

  if (failedDays.length === range.days.length) {
    return errorResult(
      `Nie udało się pobrać biuletynu KRS za ${rangeLabel(range)} – API KRS zwróciło błąd ` +
        `(${failedDays[0].blad}). Spróbuj ponownie później.`
    );
  }

  const hitNumbers = watched.filter((krs) => daysByKrs.has(krs));
  const hits: WatchlistHit[] = withDetails
    ? await mapWithConcurrency(hitNumbers, DETAILS_CONCURRENCY, (krs) =>
        describeHit(krs, daysByKrs.get(krs) ?? [], range)
      )
    : hitNumbers.map((krs) => ({ krs, dni: daysByKrs.get(krs) ?? [] }));

  const notes = [
    "Źródło: dzienny biuletyn KRS – lista podmiotów, które miały wpis w rejestrze danego dnia. " +
      "Biuletyn nie mówi, czego wpis dotyczył; szczegóły zmian zawiera odpis pełny (Get_Full_KRS_Record).",
  ];
  if (failedDays.length > 0) {
    notes.push(
      `Nie pobrano biuletynu za ${dayCount(failedDays.length)} (niepobraneDni) – podmioty z listy bezZmian ` +
        "mogły mieć wpis w tych dniach."
    );
  }
  if (hits.some((hit) => hit.ostatniWpis?.wZakresie === false)) {
    notes.push(
      "Ostatni wpis części podmiotów ma datę spoza zakresu (wZakresie: false) – data wpisu bywa inna niż dzień " +
        "w biuletynie (np. przy wykreśleniu), a późniejszy wpis mógł przykryć ten z zakresu."
    );
  }
  if (range.to === todayInPoland(now)) {
    notes.push("Biuletyn za dzisiejszy dzień może być jeszcze niepełny.");
  }

  const report: WatchlistReport = {
    zakres: { od: range.from, do: range.to, liczbaDni: range.days.length },
    liczbaPodmiotow: watched.length,
    zmiany: hits,
    bezZmian: watched.filter((krs) => !daysByKrs.has(krs)),
    niepobraneDni: failedDays,
    uwagi: notes,
  };

  const failedSuffix = failedDays.length > 0 ? ` Nie pobrano biuletynu za ${dayCount(failedDays.length)}.` : "";
  const headline =
    `Obserwowane podmioty w KRS – ${rangeLabel(range)}: ` +
    `wpisy u ${hits.length} z ${watched.length} ${watched.length === 1 ? "podmiotu" : "podmiotów"}.${failedSuffix}`;
  return textResult(`${headline}\n\n${JSON.stringify(report, null, 2)}`);
}

export const checkKrsWatchlistTool = {
  schema: {
    krs: z
      .array(krsNumberSchema)
      .min(1, "Podaj co najmniej jeden numer KRS")
      .max(MAX_WATCHED_KRS, `Maksymalnie ${MAX_WATCHED_KRS} numerów KRS w jednym zapytaniu`)
      .describe(`Numery KRS obserwowanych podmiotów (10 cyfr), od 1 do ${MAX_WATCHED_KRS}`),
    data: isoDateSchema.optional().describe("Dzień do sprawdzenia (RRRR-MM-DD). Podaj go albo zakres odDaty/doDaty."),
    odDaty: isoDateSchema.optional().describe(`Początek zakresu (RRRR-MM-DD, włącznie); zakres do ${MAX_RANGE_DAYS} dni`),
    doDaty: isoDateSchema.optional().describe("Koniec zakresu (RRRR-MM-DD, włącznie). Domyślnie dzisiaj (czas polski)."),
    szczegoly: z
      .boolean()
      .optional()
      .describe(
        "Dla podmiotów z wpisem pobierz odpis: nazwę, ostatni wpis i ocenę statusu jak w Check_KRS_Status " +
          "(domyślnie true). false – tylko lista numerów i dni."
      ),
  },
  handler: (args: WatchlistArgs) => checkWatchlist(args),
};
