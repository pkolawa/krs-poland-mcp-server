# KRS Poland MCP Server

Serwer MCP udostępniający dane z publicznego API Krajowego Rejestru Sądowego (KRS) Ministerstwa Sprawiedliwości.

## Architektura

- TypeScript + `@modelcontextprotocol/sdk`, transport stdio
- Cztery narzędzia MCP: odpis aktualny (`Get_Current_KRS_Record`), pełny (`Get_Full_KRS_Record`),
  kontrola statusu z sygnałami ostrzegawczymi (`Check_KRS_Status`) i obserwowane podmioty
  (`Check_KRS_Watchlist`: które z ≤50 numerów KRS miały wpis w danym dniu/zakresie ≤31 dni)
- HTTP client: retry (30s/60s backoff) tylko dla 5xx/408/429/błędów sieci; 404 i 204 → `not_found` bez ponawiania.
  Kolejność URL: query params (działa), potem path params (obecnie zawsze 404 – zapas na zmianę routingu)
- Odpis aktualny podmiotu wykreślonego zwraca 204 – wtedy jedynym źródłem jest odpis pełny (wpis „WYKREŚLENIE…”)
- Biuletyn (`/api/krs/Biuletyn/{RRRR-MM-DD}`): tablica numerów KRS bez zer wiodących, z duplikatami
  (jedna pozycja na zmianę). `fetchBulletin` normalizuje do 10 cyfr i deduplikuje; krótkie retry (2s/5s),
  404/204 to błąd (nie „brak zmian”). Dzień przyszły → `[]`. Parametry `godzinaOd`/`godzinaDo` są najpewniej ignorowane.
  Dzień w biuletynie bywa inny niż data ostatniego wpisu (np. wykreślenie) – stąd `wZakresie` w odpowiedzi
- Build: esbuild do jednego pliku ESM (`build/index.mjs`); `@modelcontextprotocol/sdk` i `zod` (v4) są external –
  instalowane z `dependencies`, dzięki czemu serwer i SDK używają tej samej kopii zod

## Komendy

- `npm run build` — unit tests + esbuild bundle
- `npm run test:unit` — testy unit (mockowany fetch)
- `npm run test:integration` — testy z prawdziwym API KRS
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript strict mode

## Wydawanie wersji

1. `npm version patch|minor|major` — hook `version` uruchamia `scripts/sync-version.mjs`
   (aktualizuje `src/server.ts` i `server.json`), tworzy commit i tag.
2. `npm publish` — reszta dzieje się automatycznie:
   - `prepublishOnly`: preflight (sync wersji, blokada duplikatu na npm) → lint → typecheck
     → build → weryfikacja `build/index.mjs`
   - `postpublish`: `git push --follow-tags` + `mcp-publisher publish`
3. Ręcznie zostaje tylko PR `dev` → `main`.

Wymagane logowania: `npm login` oraz `mcp-publisher login github` (token rejestru wygasa).

## Konwencje

- Walidacja inputów przez Zod – wspólne schematy w `src/schemas/krs.ts`
- Odpowiedzi MCP zawierają `type: "text"` z JSON w treści
- API KRS: `https://api-krs.ms.gov.pl/api/krs/{typ}/{krs}?rejestr={P|S}&format=json`
- Odpis aktualny: nagłówek `naglowekA`, pola proste; ostatni wpis tylko jako `numer/data/sygnatura/sąd…OstatniegoWpisu`
  (bez opisu – opis wpisu ma tylko odpis pełny). Odpis pełny: `naglowekP` z listą `wpis`,
  pola jako tablice wersji z `nrWpisuWprow`/`nrWpisuWykr`. Puste pola API zwraca jako `{}`/`[]`
- Dane osobowe (imiona, nazwiska, PESEL) są w API zamaskowane
- Numer KRS: 10 cyfr zaczynających się od 0, rejestr: P (przedsiębiorców) lub S (stowarzyszeń)

## Struktura plików

```
src/index.ts        — entrypoint
src/server.ts       — rejestracja narzędzi
src/tools/          — handlery narzędzi MCP (checkStatus.ts eksportuje też lookupEntityStatus,
                      używany przez watchlist.ts)
src/schemas/krs.ts  — wspólne schematy Zod (numer KRS, rejestr)
src/analysis/       — analiza odpisu (status.ts: sygnały z działów 2–6, wykreślenie)
src/types/krs.ts    — interfejsy odpowiedzi API KRS
src/utils/api.ts    — HTTP client (fetchKrs → ok / not_found / error), fetchBulletin
src/utils/format.ts — nagłówek oraz odczyt nazwy/numeru/ostatniego wpisu z odpisu aktualnego i pełnego
src/utils/concurrency.ts — mapWithConcurrency (mała współbieżność zapytań do API)
```

@TODO.md
