import { z } from "zod";
import { ExtractType, fetchKrsExtractFromRegisters } from "../utils/api.js";
import { KrsExtract, KrsOdpis } from "../types/krs.js";
import { krsLookupInputSchema, Rejestr, registersToCheck } from "../schemas/krs.js";
import { formatCompanyHeadline } from "../utils/format.js";
import { isRecord } from "../analysis/values.js";
import { errorResult, textResult } from "./result.js";

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

const dzialySchema = z
  .array(z.number().int().min(1).max(6))
  .min(1)
  .optional()
  .describe(
    "Zwróć tylko wybrane działy odpisu, np. [2]. Pomiń, aby dostać cały odpis. " +
      "1 – podmiot: nazwa, siedziba i adres, kapitał, wspólnicy, oddziały; " +
      "2 – reprezentacja: zarząd i sposób reprezentacji, rada nadzorcza, prokurenci, pełnomocnicy; " +
      "3 – przedmiot działalności (PKD), złożone sprawozdania finansowe, koniec roku obrotowego; " +
      "4 – zaległości, wierzytelności, zabezpieczenie majątku, oddalone wnioski o upadłość; 5 – kurator; " +
      "6 – likwidacja, rozwiązanie, upadłość, restrukturyzacja, połączenie, podział, przekształcenie, zawieszenie działalności."
  );

interface ExtractArgs {
  krs: string;
  rejestr?: Rejestr;
  dzialy?: number[];
}

/** Odpis z wybranymi działami. `wpisy` – tylko odpis pełny: ile wpisów zostało w nagłówku, a ile ma podmiot. */
interface SectionSelection {
  extract: KrsExtract;
  wpisy?: { pokazane: number; wszystkie: number };
}

/** Collects the entry numbers (`nrWpisuWprow` / `nrWpisuWykr`) referenced anywhere in `value`. */
function collectEntryNumbers(value: unknown, numbers = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectEntryNumbers(item, numbers);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "nrWpisuWprow" || key === "nrWpisuWykr") && (typeof child === "string" || typeof child === "number")) {
        numbers.add(String(child).trim());
      } else {
        collectEntryNumbers(child, numbers);
      }
    }
  }
  return numbers;
}

/**
 * Zostawia w odpisie tylko wybrane działy. W odpisie pełnym lista wpisów w nagłówku zostaje zawężona do wpisów,
 * które wprowadziły albo wykreśliły pola tych działów – to z niej odczytuje się datę i opis wpisu o danym numerze.
 * Nie zmienia przekazanego odpisu (ten sam obiekt trzyma cache).
 */
export function selectSections(extract: KrsExtract, dzialy: readonly number[]): SectionSelection {
  const odpis = extract.odpis;
  if (!odpis) return { extract };

  const wanted = new Set(dzialy.map((n) => `dzial${n}`));
  const dane = Object.fromEntries(Object.entries(odpis.dane ?? {}).filter(([key]) => wanted.has(key)));
  const narrowed: KrsOdpis = { ...odpis, dane };

  let wpisy: SectionSelection["wpisy"];
  const referenced = collectEntryNumbers(dane);
  for (const [key, naglowek] of Object.entries(odpis)) {
    if (!key.startsWith("naglowek") || !isRecord(naglowek) || !Array.isArray(naglowek.wpis)) continue;
    const kept = naglowek.wpis.filter((entry) => isRecord(entry) && referenced.has(String(entry.numerWpisu)));
    narrowed[key] = { ...naglowek, wpis: kept };
    wpisy = { pokazane: kept.length, wszystkie: naglowek.wpis.length };
  }

  return { extract: { ...extract, odpis: narrowed }, wpisy };
}

/** "dział 2" / "działy 1, 2" */
function describeSections(dzialy: readonly number[]): string {
  const sorted = [...new Set(dzialy)].sort((a, b) => a - b);
  return sorted.length === 1 ? `dział ${sorted[0]}` : `działy ${sorted.join(", ")}`;
}

/**
 * Narzędzie zwracające surowy odpis KRS (aktualny albo pełny) jako JSON – cały albo tylko wybrane działy.
 * Bez podanego rejestru sprawdza kolejno P i S.
 */
export function createExtractTool(type: ExtractType) {
  const labels = LABELS[type];

  return {
    schema: { ...krsLookupInputSchema, dzialy: dzialySchema },
    handler: async (args: ExtractArgs) => {
      const { krs, rejestr, dzialy } = args;
      const registers = registersToCheck(rejestr);
      const result = await fetchKrsExtractFromRegisters<KrsExtract, Rejestr>(type, krs, registers);

      switch (result.status) {
        case "ok": {
          const lines = [`${labels.title} – ${formatCompanyHeadline(result.data)}, rejestr ${result.rejestr}`, ""];
          let extract = result.data;
          if (dzialy?.length) {
            const selection = selectSections(result.data, dzialy);
            extract = selection.extract;
            lines.push(`(Zwrócono obiekt JSON z ${labels.instrumental} – tylko ${describeSections(dzialy)})`);
            if (selection.wpisy) {
              lines.push(
                `Lista wpisów w nagłówku: ${selection.wpisy.pokazane} z ${selection.wpisy.wszystkie} – ` +
                  "tylko wpisy, które wprowadziły lub wykreśliły pola wybranych działów."
              );
            }
          } else {
            lines.push(`(Zwrócono obiekt JSON z ${labels.instrumental})`);
          }
          // No indentation: it doubles the size of a large company's full extract (~430k vs ~210k characters).
          return textResult(`${lines.join("\n")}\n\n${JSON.stringify(extract)}`);
        }
        case "error":
          return errorResult(`Nie udało się pobrać ${labels.genitive} dla KRS ${krs} – API KRS zwróciło błąd. Spróbuj ponownie później.`);
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
