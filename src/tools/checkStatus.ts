import { fetchKrsExtractFromRegisters } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { krsLookupInputSchema, Rejestr, registersToCheck } from "../schemas/krs.js";
import { analyzeCurrentExtract, analyzeEntityWithoutCurrentExtract, StatusReport } from "../analysis/status.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function formatReport(report: StatusReport): string {
  const name = report.nazwa ?? "Nieznana nazwa";
  return (
    `Status podmiotu – ${name} (KRS ${report.krs}, rejestr ${report.rejestr})\n` +
    `Ocena: ${report.ocena} – ${report.podsumowanie}\n\n` +
    JSON.stringify(report, null, 2)
  );
}

/**
 * Wynik ustalania statusu podmiotu: z odpisu aktualnego, z odpisu pełnego (podmiot bez odpisu
 * aktualnego, czyli wykreślony), brak podmiotu albo błąd API na danym etapie.
 */
export type EntityStatusLookup =
  | { status: "current" | "without_current"; rejestr: Rejestr; extract: KrsExtract; report: StatusReport }
  | { status: "not_found" }
  | { status: "error"; stage: "OdpisAktualny" | "OdpisPelny" };

/**
 * Sprawdza kolejno podane rejestry. Gdy odpisu aktualnego nie ma w żadnym, sięga po odpis pełny,
 * żeby wykryć wykreślenie z rejestru.
 */
export async function lookupEntityStatus(krs: string, registers: Rejestr[]): Promise<EntityStatusLookup> {
  const current = await fetchKrsExtractFromRegisters<KrsExtract, Rejestr>("OdpisAktualny", krs, registers);
  if (current.status === "ok") {
    const { rejestr, data } = current;
    return { status: "current", rejestr, extract: data, report: analyzeCurrentExtract(data, rejestr, krs) };
  }
  if (current.status === "error") return { status: "error", stage: "OdpisAktualny" };

  const full = await fetchKrsExtractFromRegisters<KrsExtract, Rejestr>("OdpisPelny", krs, registers);
  if (full.status === "ok") {
    const { rejestr, data } = full;
    return { status: "without_current", rejestr, extract: data, report: analyzeEntityWithoutCurrentExtract(data, rejestr, krs) };
  }
  return full.status === "error" ? { status: "error", stage: "OdpisPelny" } : { status: "not_found" };
}

/**
 * Kontrola statusu i sygnałów ostrzegawczych podmiotu na podstawie odpisu KRS.
 * Bez podanego rejestru sprawdza kolejno P i S.
 */
export const checkKrsStatusTool = {
  schema: krsLookupInputSchema,
  handler: async (args: { krs: string; rejestr?: Rejestr }) => {
    const { krs, rejestr } = args;
    const registers = registersToCheck(rejestr);
    const lookup = await lookupEntityStatus(krs, registers);

    switch (lookup.status) {
      case "current":
      case "without_current":
        return textResult(formatReport(lookup.report));
      case "error":
        return textResult(
          lookup.stage === "OdpisAktualny"
            ? `Nie udało się pobrać odpisu aktualnego dla KRS ${krs} – API KRS zwróciło błąd. Spróbuj ponownie później.`
            : `Nie udało się ustalić statusu KRS ${krs} – API KRS zwróciło błąd przy pobieraniu odpisu pełnego.`
        );
      case "not_found":
        return textResult(`Nie znaleziono podmiotu o numerze KRS ${krs} w rejestrze ${registers.join(" ani ")}.`);
    }
  },
};
