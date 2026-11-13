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

## Kolejne kroki (zweryfikowane 2026-11-13)
- [x] Migracja ESLint 8 → 9/10 (flat config) — ESLint 8 nie jest już wspierany; usunie też podatności w devDependencies — ESLint 10 w 1.5.1
- [ ] `Check_KRS_Status`: sygnał dla `statusNip: "UCHYLONY"` (API podaje status i datę decyzji; dziś widać go tylko w karcie podmiotu)
- [ ] Zasoby MCP (resources) z odpisami, np. `krs://P/0000019193/aktualny`
- [ ] Porównanie kilku podmiotów (karta/status obok siebie)
- [ ] Filtr działów dla `Get_Full_KRS_Record` (np. tylko `dzial2`) – odpis pełny dużej spółki ma setki tysięcy znaków

