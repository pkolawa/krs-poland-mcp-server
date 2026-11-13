import { ExtractType, fetchKrsExtractFromRegisters } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { krsLookupInputSchema, Rejestr, registersToCheck } from "../schemas/krs.js";
import { formatCompanyHeadline } from "../utils/format.js";

interface ExtractLabels {
  /** "Odpis aktualny" – nagłówek odpowiedzi. */
  title: string;
  /** "odpisu aktualnego" – w komunikatach o błędach. */
  genitive: string;
  /** "odpisem aktualnym" – w opisie zwracanego JSON-a. */
  instrumental: string;
  /** Dopisek, gdy w żadnym rejestrze nie ma odpisu. */
  notFoundHint: string;
}

const LABELS: Record<ExtractType, ExtractLabels> = {
  OdpisAktualny: {
    title: "Odpis aktualny",
    genitive: "odpisu aktualnego",
    instrumental: "odpisem aktualnym",
    // A struck-off entity has no current extract (the API answers 204), only the full one.
    notFoundHint: " Podmiot wykreślony z rejestru ma tylko odpis pełny – jego status pokaże Check_KRS_Status.",
  },
  OdpisPelny: {
    title: "Odpis pełny",
    genitive: "odpisu pełnego",
    instrumental: "odpisem pełnym",
    notFoundHint: "",
  },
};

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Narzędzie zwracające surowy odpis KRS (aktualny albo pełny) jako JSON.
 * Bez podanego rejestru sprawdza kolejno P i S.
 */
export function createExtractTool(type: ExtractType) {
  const labels = LABELS[type];

  return {
    schema: krsLookupInputSchema,
    handler: async (args: { krs: string; rejestr?: Rejestr }) => {
      const { krs, rejestr } = args;
      const registers = registersToCheck(rejestr);
      const result = await fetchKrsExtractFromRegisters<KrsExtract, Rejestr>(type, krs, registers);

      switch (result.status) {
        case "ok":
          return textResult(
            `${labels.title} – ${formatCompanyHeadline(result.data)}, rejestr ${result.rejestr}\n\n` +
              `(Zwrócono obiekt JSON z ${labels.instrumental})\n\n${JSON.stringify(result.data, null, 2)}`
          );
        case "error":
          return textResult(`Nie udało się pobrać ${labels.genitive} dla KRS ${krs} – API KRS zwróciło błąd. Spróbuj ponownie później.`);
        case "not_found":
          return textResult(
            `Nie znaleziono ${labels.genitive} dla KRS ${krs} w rejestrze ${registers.join(" ani ")}.${labels.notFoundHint}`
          );
      }
    },
  };
}

export const getKrsCurrentExtractTool = createExtractTool("OdpisAktualny");
export const getKrsFullExtractTool = createExtractTool("OdpisPelny");
