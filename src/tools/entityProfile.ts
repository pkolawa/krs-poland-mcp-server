import { fetchKrsExtractFromRegisters } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { krsLookupInputSchema, Rejestr, registersToCheck } from "../schemas/krs.js";
import { buildEntityProfile, ProfileReport } from "../analysis/profile.js";
import { formatCompactJson } from "../utils/format.js";
import { errorResult, textResult } from "./result.js";


function formatProfile(profile: ProfileReport): string {
  return (
    `Karta podmiotu – ${profile.nazwa ?? "Nieznana nazwa"} (KRS ${profile.krs}, rejestr ${profile.rejestr})\n` +
    `Status: ${profile.status.ocena} – ${profile.status.podsumowanie}\n\n` +
    formatCompactJson(profile)
  );
}

/**
 * Karta podmiotu z odpisu aktualnego: identyfikatory, adres, kapitał, reprezentacja, właściciele,
 * działalność i skrót statusu. Bez podanego rejestru sprawdza kolejno P i S.
 */
export const getKrsEntityProfileTool = {
  schema: krsLookupInputSchema,
  handler: async (args: { krs: string; rejestr?: Rejestr }) => {
    const { krs, rejestr } = args;
    const registers = registersToCheck(rejestr);
    const result = await fetchKrsExtractFromRegisters<KrsExtract, Rejestr>("OdpisAktualny", krs, registers);

    switch (result.status) {
      case "ok":
        return textResult(formatProfile(buildEntityProfile(result.data, result.rejestr, krs)));
      case "error":
        return errorResult(`Nie udało się pobrać odpisu aktualnego dla KRS ${krs} – API KRS zwróciło błąd. Spróbuj ponownie później.`);
      case "not_found":
        return textResult(
          `Nie znaleziono odpisu aktualnego dla KRS ${krs} w rejestrze ${registers.join(" ani ")}. ` +
            "Podmiot wykreślony z rejestru nie ma karty – jego status i historię pokażą Check_KRS_Status i Get_KRS_Entry_History."
        );
    }
  },
};
