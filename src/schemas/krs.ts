import { z } from "zod";

export type Rejestr = "P" | "S";

export const krsNumberSchema = z
  .string()
  .regex(/^[0]\d{9}$/, "Numer KRS powinien mieć 10 cyfr")
  .describe("Numer KRS (10 cyfr)");

export const rejestrSchema = z
  .string()
  .length(1, "Rejestr musi być pojedynczym znakiem: P lub S")
  .regex(/^[pPsS]$/, "Rejestr musi być literą P lub S (wielkość liter bez znaczenia)")
  .transform((val) => val.toUpperCase() as Rejestr)
  .describe("Rejestr: P – przedsiębiorców, S – stowarzyszeń (P/S, wielkość liter bez znaczenia)");

/** Wejście narzędzi zwracających odpis: numer KRS + wymagany rejestr. */
export const krsExtractInputSchema = {
  krs: krsNumberSchema,
  rejestr: rejestrSchema,
};
