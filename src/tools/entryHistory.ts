import { z } from "zod";
import { fetchKrsExtractFromRegisters } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { krsLookupInputSchema, Rejestr, registersToCheck } from "../schemas/krs.js";
import { formatCompactJson } from "../utils/format.js";
import { plural } from "../analysis/status.js";
import {
  DEFAULT_ENTRY_LIMIT,
  describeEntry,
  EntryChanges,
  EntryList,
  getEntries,
  listEntries,
  MAX_ENTRY_LIMIT,
  parseDateInput,
} from "../analysis/history.js";

export interface EntryHistoryArgs {
  krs: string;
  rejestr?: Rejestr;
  odDaty?: string;
  numerWpisu?: number;
  limit?: number;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function entityLabel(report: { nazwa: string | null; krs: string; rejestr: Rejestr }): string {
  return `${report.nazwa ?? "Nieznana nazwa"} (KRS ${report.krs}, rejestr ${report.rejestr})`;
}

function formatList(list: EntryList): string {
  const range =
    list.pierwszyWpis && list.ostatniWpis
      ? ` (pierwszy z ${list.pierwszyWpis.dataWpisu ?? "?"}, ostatni nr ${list.ostatniWpis.numerWpisu} z ${list.ostatniWpis.dataWpisu ?? "?"})`
      : "";
  const scope = list.filtr.odDaty ? ` od ${list.filtr.odDaty}` : "";
  const shown = list.wpisy.length
    ? `Pokazano ${plural(list.wpisy.length, "najnowszy wpis", "najnowsze wpisy", "najnowszych wpisów")}${scope}` +
      (list.pominieto
        ? `, pominięto ${plural(list.pominieto, "starszy", "starsze", "starszych")} (zwiększ limit lub zawęź odDaty)`
        : "") +
      ". Co zmienił konkretny wpis: podaj numerWpisu."
    : `Brak wpisów${scope}.`;
  return `Historia wpisów – ${entityLabel(list)}\nWpisów w KRS: ${list.liczbaWpisow}${range}. ${shown}\n\n${formatCompactJson(list)}`;
}

function formatEntry(changes: EntryChanges): string {
  const { wpis } = changes;
  return (
    `Wpis nr ${wpis.numerWpisu} z ${wpis.dataWpisu ?? "?"} – ${wpis.opis ?? "bez opisu"}\n` +
    `${entityLabel(changes)}\n\n` +
    formatCompactJson(changes)
  );
}

function render(extract: KrsExtract, rejestr: Rejestr, args: EntryHistoryArgs): string {
  const { krs, numerWpisu } = args;
  if (numerWpisu !== undefined) {
    const changes = describeEntry(extract, rejestr, krs, numerWpisu);
    if (changes) return formatEntry(changes);
    const last = getEntries(extract).at(-1)?.numerWpisu;
    return (
      `Odpis pełny KRS ${krs} (rejestr ${rejestr}) nie zawiera wpisu nr ${numerWpisu}` +
      (last !== undefined ? ` – wpisy mają numery od 1 do ${last}.` : " – odpis nie zawiera listy wpisów.")
    );
  }
  const odDaty = args.odDaty ? (parseDateInput(args.odDaty) ?? undefined) : undefined;
  return formatList(listEntries(extract, rejestr, krs, { odDaty, limit: args.limit }));
}

/**
 * Historia wpisów podmiotu w KRS wyliczona z odpisu pełnego: lista wpisów (od najnowszego) z polami,
 * których dotyczyły, albo – dla podanego numeru wpisu – wartości, które ten wpis wprowadził i wykreślił.
 * Odpis pełny istnieje także dla podmiotów wykreślonych. Bez podanego rejestru sprawdza kolejno P i S.
 */
export const getKrsEntryHistoryTool = {
  schema: {
    ...krsLookupInputSchema,
    odDaty: z
      .string()
      .regex(/^(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/, "Data w formacie dd.mm.yyyy lub yyyy-mm-dd")
      .refine((value) => parseDateInput(value) !== null, "Taka data nie istnieje")
      .optional()
      .describe("Pokaż tylko wpisy dokonane tego dnia lub później (dd.mm.yyyy albo yyyy-mm-dd)."),
    numerWpisu: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Numer wpisu – zwraca, co ten wpis wprowadził, wykreślił i zmienił. Pozostałe filtry są wtedy pomijane."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_ENTRY_LIMIT)
      .optional()
      .describe(`Maksymalna liczba wpisów na liście, od najnowszego (domyślnie ${DEFAULT_ENTRY_LIMIT}, maks. ${MAX_ENTRY_LIMIT}).`),
  },
  handler: async (args: EntryHistoryArgs) => {
    const { krs, rejestr } = args;
    const registers = registersToCheck(rejestr);
    const result = await fetchKrsExtractFromRegisters<KrsExtract, Rejestr>("OdpisPelny", krs, registers);

    if (result.status === "ok") return textResult(render(result.data, result.rejestr, args));
    return textResult(
      result.status === "error"
        ? `Nie udało się pobrać odpisu pełnego dla KRS ${krs} – API KRS zwróciło błąd. Spróbuj ponownie później.`
        : `Nie znaleziono podmiotu o numerze KRS ${krs} w rejestrze ${registers.join(" ani ")}.`
    );
  },
};
