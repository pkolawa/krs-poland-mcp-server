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
 * Kontrola statusu i sygnałów ostrzegawczych podmiotu na podstawie odpisu KRS.
 * Bez podanego rejestru sprawdza kolejno P i S. Gdy odpisu aktualnego nie ma,
 * sięga po odpis pełny, żeby wykryć wykreślenie z rejestru.
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
    const registersLabel = registers.join(" ani ");

    let apiFailed = false;
    for (const reg of registers) {
      const result = await fetchKrsExtract<KrsExtract>({ type: "OdpisAktualny", rejestr: reg, krs });
      if (result.status === "ok") {
        return textResult(formatReport(analyzeCurrentExtract(result.data, reg, krs)));
      }
      if (result.status === "error") apiFailed = true;
    }

    // Without a definite "not found" we cannot tell a missing entity from an API outage.
    if (apiFailed) {
      return textResult(`Nie udało się pobrać odpisu aktualnego dla KRS ${krs} – API KRS zwróciło błąd. Spróbuj ponownie później.`);
    }

    for (const reg of registers) {
      const result = await fetchKrsExtract<KrsExtract>({ type: "OdpisPelny", rejestr: reg, krs });
      if (result.status === "ok") {
        return textResult(formatReport(analyzeEntityWithoutCurrentExtract(result.data, reg, krs)));
      }
      if (result.status === "error") apiFailed = true;
    }

    return textResult(
      apiFailed
        ? `Nie udało się ustalić statusu KRS ${krs} – API KRS zwróciło błąd przy pobieraniu odpisu pełnego.`
        : `Nie znaleziono podmiotu o numerze KRS ${krs} w rejestrze ${registersLabel}.`
    );
  },
};
