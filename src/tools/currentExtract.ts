import { makeKRSRequest, buildExtractUrls } from "../utils/api.js";
import { KrsExtract } from "../types/krs.js";
import { krsExtractInputSchema } from "../schemas/krs.js";
import { formatCompanyHeadline } from "../utils/format.js";

/**
 * KRS Open API – odpis aktualny (JSON)
 * rejestr: 'P' (przedsiębiorców) | 'S' (stowarzyszeń)
 */
export const getKrsCurrentExtractTool = {
  description: "Get current registry based on KRS number",
  schema: krsExtractInputSchema,
  handler: async (args: { krs: string; rejestr: string }) => {
    const { krs, rejestr } = args;
    const urls = buildExtractUrls({ type: "OdpisAktualny", rejestr, krs });
    const extract = await makeKRSRequest<KrsExtract>(urls);

    if (!extract) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Nie udało się pobrać odpisu aktualnego dla KRS ${krs} (${rejestr}).`,
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
          text: `Odpis aktualny – ${headline}\n\n(Zwrócono obiekt JSON z odpisem aktualnym)\n\n${JSON.stringify(extract, null, 2)}`,
          _meta: {},
        }
      ],
    };
  },
};
