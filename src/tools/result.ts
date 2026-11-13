/** Wynik narzędzia MCP z jednym blokiem tekstu. */
export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Wywołanie, które się nie udało (np. API KRS zwróciło błąd, zakres dat jest niepoprawny). `isError` mówi
 * modelowi, że to nie jest odpowiedź, tylko niepowodzenie, które można poprawić albo powtórzyć.
 * „Nie znaleziono podmiotu” nie jest błędem – to poprawna odpowiedź rejestru.
 */
export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
