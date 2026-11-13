# TODO

> Wygenerowano przez /recognize — 2026-05-17
> Fokus: jakość kodu

## Krytyczne
- [x] Wyekstrahować wspólny schemat Zod (KRS + rejestr) do `src/schemas/krs.ts` — duplikacja w `currentExtract.ts` i `fullExtract.ts`

## Ważne
- [x] Stworzyć generyczną fabrykę tool handlerów w `src/tools/` — `currentExtract.ts` i `fullExtract.ts` to prawie identyczne pliki, różnią się tylko typem odpisu i tekstem
- [x] Rozbudować interfejs `KrsExtract` w `src/types/krs.ts` — dodać sekcje `odpis.dane.dzial1-6` na podstawie faktycznej struktury API zamiast `[key: string]: unknown`
- [x] Zsynchronizować wersję w `src/server.ts` z `package.json` — rozwiązane hookiem `version` (`scripts/sync-version.mjs`), preflightem i testem w `src/server.test.ts`
- [x] Usunąć puste `_meta: {}` z odpowiedzi w `src/tools/currentExtract.ts` i `fullExtract.ts`
- [x] Dodać testy unit dla `src/utils/format.ts` — edge cases: brak danych, puste obiekty, tylko `nazwa`

## Drobne usprawnienia
- [x] Dodać test rejestracji narzędzi MCP w `src/server.ts`
- [x] Rozważyć lepsze formatowanie odpowiedzi — wyciąganie kluczowych danych (nazwa, NIP, adres, zarząd) zamiast zwracania surowego JSON — `Get_KRS_Entity_Profile`
