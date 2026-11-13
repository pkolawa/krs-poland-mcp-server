import { z } from "zod";
import { krsNumberSchema, optionalRejestrSchema, Rejestr } from "../schemas/krs.js";

/** How far back the prompt asks the model to look in the entry history. */
const HISTORY_MONTHS = 12;

export interface CounterpartyCheckArgs {
  krs: string;
  rejestr?: Rejestr;
  kontekst?: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthsAgo(today: Date, months: number): Date {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
  // 31.03 minus one month would overflow into March – clamp to the end of the target month instead.
  return date.getUTCDate() === today.getUTCDate() ? date : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
}

/**
 * Prompt MCP „Weryfikacja kontrahenta”: prowadzi model przez kartę podmiotu, status i historię zmian
 * z ostatnich 12 miesięcy, a potem prosi o raport z oceną i odpowiedzią „kto może podpisać umowę”.
 */
export const counterpartyCheckPrompt = {
  argsSchema: {
    krs: krsNumberSchema,
    rejestr: optionalRejestrSchema,
    kontekst: z
      .string()
      .max(500, "Kontekst może mieć najwyżej 500 znaków")
      .optional()
      .describe("Czego dotyczy weryfikacja, np. „umowa dostawy na 200 tys. zł” – raport odniesie do tego wnioski."),
  },
  build: (args: CounterpartyCheckArgs, today: Date = new Date()) => {
    const { krs, rejestr, kontekst } = args;
    const since = isoDate(monthsAgo(today, HISTORY_MONTHS));
    const registerArg = rejestr ? `, rejestr: "${rejestr}"` : "";
    const context = kontekst?.trim();

    const text = [
      `Zweryfikuj kontrahenta o numerze KRS ${krs}${rejestr ? ` (rejestr ${rejestr})` : ""}.` +
        (context ? ` Kontekst weryfikacji: ${context}.` : ""),
      "",
      "Korzystaj wyłącznie z narzędzi serwera KRS, w tej kolejności:",
      `1. Get_KRS_Entity_Profile (krs: "${krs}"${registerArg}) – identyfikacja, adres, kapitał, reprezentacja, właściciele.`,
      `2. Check_KRS_Status (krs: "${krs}"${registerArg}) – status i sygnały ostrzegawcze.`,
      `3. Get_KRS_Entry_History (krs: "${krs}"${registerArg}, odDaty: "${since}") – zmiany z ostatnich ${HISTORY_MONTHS} miesięcy. ` +
        "Wpisy dotyczące zarządu, wspólników, kapitału, nazwy lub siedziby sprawdź szczegółowo (parametr numerWpisu).",
      "Jeśli podmiot nie ma odpisu aktualnego (np. został wykreślony), oprzyj raport na Check_KRS_Status i Get_KRS_Entry_History.",
      "",
      "Przygotuj raport po polsku z sekcjami:",
      "- Podsumowanie: jedno zdanie i ocena ZIELONA (brak sygnałów ostrzegawczych), ŻÓŁTA (ostrzeżenia do wyjaśnienia) " +
        "albo CZERWONA (sygnały krytyczne lub podmiot wykreślony).",
      "- Identyfikacja: nazwa, forma prawna, KRS, NIP (z jego statusem, jeśli KRS go podaje), REGON, adres, data rejestracji.",
      "- Kto może podpisać umowę: przełóż sposób reprezentacji na konkretne kombinacje podpisów (np. „prezes samodzielnie” " +
        "albo „dwóch członków zarządu łącznie”), uwzględnij prokurę; zaznacz zawieszonych członków, likwidatorów lub kuratora.",
      "- Właściciele i kapitał.",
      "- Sygnały ostrzegawcze: każdy z datą i znaczeniem dla współpracy.",
      `- Zmiany z ostatnich ${HISTORY_MONTHS} miesięcy: zwłaszcza zarząd, wspólnicy, nazwa, siedziba i kapitał – ` +
        "częste zmiany zarządu albo siedziby to sygnał do wyjaśnienia.",
      ...(context ? [`- Wnioski dla kontekstu „${context}”: na co zwrócić uwagę przed zawarciem umowy.`] : []),
      "- Ograniczenia: ocena opiera się wyłącznie na KRS – nie obejmuje zadłużenia niewpisanego do rejestru ani wyników " +
        "finansowych (KRS podaje tylko daty złożenia sprawozdań).",
      "",
      "Nie podawaj danych osób fizycznych – serwer ich nie zwraca; posługuj się funkcjami (np. „prezes zarządu”).",
    ].join("\n");

    return {
      description: `Weryfikacja kontrahenta KRS ${krs}`,
      messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
    };
  },
};
