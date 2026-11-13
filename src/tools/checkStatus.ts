import { fetchKrsExtract } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { krsNumberSchema, Rejestr, rejestrSchema } from "../schemas/krs.js";
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
  let apiFailed = false;
  for (const reg of registers) {
    const result = await fetchKrsExtract<KrsExtract>({ type: "OdpisAktualny", rejestr: reg, krs });
    if (result.status === "ok") {
      return { status: "current", rejestr: reg, extract: result.data, report: analyzeCurrentExtract(result.data, reg, krs) };
    }
    if (result.status === "error") apiFailed = true;
  }

  // Without a definite "not found" we cannot tell a missing entity from an API outage.
  if (apiFailed) return { status: "error", stage: "OdpisAktualny" };

  for (const reg of registers) {
    const result = await fetchKrsExtract<KrsExtract>({ type: "OdpisPelny", rejestr: reg, krs });
    if (result.status === "ok") {
      return {
        status: "without_current",
        rejestr: reg,
        extract: result.data,
        report: analyzeEntityWithoutCurrentExtract(result.data, reg, krs),
      };
    }
    if (result.status === "error") apiFailed = true;
  }

  return apiFailed ? { status: "error", stage: "OdpisPelny" } : { status: "not_found" };
}

/**
 * Kontrola statusu i sygnałów ostrzegawczych podmiotu na podstawie odpisu KRS.
 * Bez podanego rejestru sprawdza kolejno P i S.
 */
export const checkKrsStatusTool = {
  schema: {
    krs: krsNumberSchema,
    rejestr: rejestrSchema
      .optional()
      .describe("Rejestr: P – przedsiębiorców, S – stowarzyszeń. Pomiń, aby sprawdzić oba rejestry."),
  },
  handler: async (args: { krs: string; rejestr?: Rejestr }) => {
    const { krs, rejestr } = args;
    const registers: Rejestr[] = rejestr ? [rejestr] : ["P", "S"];
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
