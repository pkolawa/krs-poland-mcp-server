import { z } from "zod";
import { makeKRSRequest, buildExtractUrls } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { formatCompanyHeadline } from "../utils/format.js";

/**
 * KRS Open API – odpis pełny (JSON)
 */
export const getKrsFullExtractTool = {
  description: "Get current registry based on KRS number",
  schema: {
    krs: z
      .string()
      .regex(/^[0]\d{9}$/, "Numer KRS powinien mieć 10 cyfr")
      .describe("Numer KRS (10 cyfr)"),
    rejestr:
      z
        .string()
        .length(1, "Rejestr musi być pojedynczym znakiem: P lub S")
        .regex(/^[pPsS]$/, "Rejestr musi być literą P lub S (wielkość liter bez znaczenia)")
        .transform((val) => val.toUpperCase() as "P" | "S")
        .describe("Rejestr: P – przedsiębiorców, S – stowarzyszeń (P/S, wielkość liter bez znaczenia)"),
  },
  handler: async (args: { krs: string; rejestr: "P" | "S" }) => {
    const { krs, rejestr } = args;
    const urls = buildExtractUrls({ type: "OdpisPelny", rejestr, krs });
    const extract = await makeKRSRequest<KrsExtract>(urls);

    if (!extract) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Nie udało się pobrać odpisu pełnego dla KRS ${krs} (${rejestr}).`,
            _meta: {},
          },
        ],
      };
    }

    const headline = formatCompanyHeadline(extract);
    return {
      content: [
        {
          type: "text" as const,
          text: `Odpis pełny – ${headline}\n\n(Zwrócono obiekt JSON z odpisem pełnym)\n\n${JSON.stringify(extract, null, 2)}`,
          _meta: {},
        }
      ],
    };
  },
};
