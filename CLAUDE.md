# KRS Poland MCP Server

Serwer MCP udostępniający dane z publicznego API Krajowego Rejestru Sądowego (KRS) Ministerstwa Sprawiedliwości.

## Architektura

- TypeScript + `@modelcontextprotocol/sdk`, transport stdio
- Sześć narzędzi MCP: odpis aktualny (`Get_Current_KRS_Record`), pełny (`Get_Full_KRS_Record`),
  kontrola statusu z sygnałami ostrzegawczymi (`Check_KRS_Status`), karta podmiotu (`Get_KRS_Entity_Profile`),
  historia wpisów (`Get_KRS_Entry_History`) i obserwowane podmioty (`Check_KRS_Watchlist`: które z ≤50 numerów KRS miały wpis w danym dniu/zakresie ≤31 dni)
- HTTP client: retry (30s/60s backoff) tylko dla 5xx/408/429/błędów sieci; 404 i 204 → `not_found` bez ponawiania.
  Kolejność URL: query params (działa), potem path params (obecnie zawsze 404 – zapas na zmianę routingu)
- Odpis aktualny podmiotu wykreślonego zwraca 204 – wtedy jedynym źródłem jest odpis pełny (wpis „WYKREŚLENIE…”)
- Biuletyn (`/api/krs/Biuletyn/{RRRR-MM-DD}`): tablica numerów KRS bez zer wiodących, z duplikatami
  (jedna pozycja na zmianę). `fetchBulletin` normalizuje do 10 cyfr i deduplikuje; krótkie retry (2s/5s),
  404/204 to błąd (nie „brak zmian”). Dzień przyszły → `[]`. Parametry `godzinaOd`/`godzinaDo` są najpewniej ignorowane.
  Dzień w biuletynie bywa inny niż data ostatniego wpisu (np. wykreślenie) – stąd `wZakresie` w odpowiedzi
- Historii wpisów API nie wystawia – liczy ją `src/analysis/history.ts` z odpisu pełnego: wersja pola należy
  do wpisu z `nrWpisuWprow` (wprowadzenie) i `nrWpisuWykr` (wykreślenie). Pola elementu listy (członek zarządu,
  kod PKD, oddział) są składane w jedną zmianę; wersje wprowadzone i wykreślone tym samym wpisem są pomijane
  (zmiana netto zero). Odpowiedź ma budżet wartości (~4 tys. znaków), reszta trafia do liczników `pominieto`
- Cache w pamięci (`cached` w `src/utils/api.ts`): wyniki `ok` i `not_found` przez 10 min (`KRS_CACHE_TTL_SECONDS`, 0 = wyłączony),
  maks. 50 ostatnio używanych zapytań; błędy nie są zapamiętywane; równoległe zapytania o ten sam adres dzielą jedno.
  W testach cache czyści `src/test-setup.ts` przed każdym testem
- Prompt MCP `weryfikacja-kontrahenta` (`src/prompts/counterpartyCheck.ts`): karta → status → historia 12 mies. → raport
- CI (`.github/workflows/tests.yml`): lint, typecheck, testy i build na Node 22 i 24 + testy integracyjne;
  `krs-api-integration.yml` codziennie. `engines` deklaruje Node ≥ 18 (zbudowany serwer sprawdzony na 18 i 20)
- `overrides` w `package.json` wymuszają załatane `glob` (≥ 14.0.2) i `minimatch` (≥ 11.0.1) w narzędziach
  deweloperskich (Jest, ESLint) – do usunięcia, gdy te pakiety same przejdą na nowe wersje. `deepmerge` (Jest)
  nie ma poprawki – niska waga, łączy tylko lokalną konfigurację
- TypeScript 6: `types: ["node", "jest"]` w `tsconfig.json` (domyślnie pusta lista); ts-jest kompiluje do
  CommonJS z `moduleResolution: "Bundler"` (`Node`/node10 jest przestarzałe)
- Build: esbuild do jednego pliku ESM (`build/index.mjs`); `@modelcontextprotocol/sdk` i `zod` (v4) są external –
  instalowane z `dependencies`, dzięki czemu serwer i SDK używają tej samej kopii zod

## Komendy

- `npm run build` — unit tests + esbuild bundle
- `npm run test:unit` — testy unit (mockowany fetch)
- `npm run test:integration` — testy z prawdziwym API KRS
- `npm run lint` — ESLint 10 (flat config `eslint.config.mjs`): `src/`, `scripts/`, `build.mjs`
- `npm run typecheck` — TypeScript strict mode

## Wydawanie wersji

1. `npm version patch|minor|major` — hook `version` uruchamia `scripts/sync-version.mjs`
   (aktualizuje `src/server.ts` i `server.json`), tworzy commit i tag.
2. `npm publish` — reszta dzieje się automatycznie:
   - `prepublishOnly`: preflight (sync wersji, blokada duplikatu na npm) → lint → typecheck
     → build → weryfikacja `build/index.mjs`
   - `postpublish`: `git push --follow-tags` + `mcp-publisher publish`
3. Ręcznie zostaje jeden krok, który `postpublish` wypisuje na końcu: przy wydaniu z `main` (po merge'u PR `dev` → `main`)
   przewinięcie `dev` do `main`; przy wydaniu z innej gałęzi – PR do `main`.

Wymagane logowania: `npm login` oraz `mcp-publisher login github` (token rejestru wygasa).

## Konwencje

- Walidacja inputów przez Zod – wspólne schematy w `src/schemas/krs.ts`; rejestr jest opcjonalny we wszystkich
  narzędziach (bez niego sprawdzane są kolejno P i S)
- Każde narzędzie ma `annotations: { readOnlyHint: true, openWorldHint: true }`
- Wyniki narzędzi przez `textResult` / `errorResult` (`src/tools/result.ts`): `isError: true` tylko przy
  niepowodzeniu (błąd API, niepoprawne wejście); „nie znaleziono” to zwykła odpowiedź
- Odpowiedzi MCP zawierają `type: "text"` z JSON w treści
- API KRS: `https://api-krs.ms.gov.pl/api/krs/{typ}/{krs}?rejestr={P|S}&format=json`
- Odpis aktualny: nagłówek `naglowekA`, pola proste; ostatni wpis tylko jako `numer/data/sygnatura/sąd…OstatniegoWpisu`
  (bez opisu – opis wpisu ma tylko odpis pełny). Odpis pełny: `naglowekP` z listą `wpis`,
  pola jako tablice wersji z `nrWpisuWprow`/`nrWpisuWykr`. Puste pola API zwraca jako `{}`/`[]`
- Dane osobowe (imiona, nazwiska, PESEL) są w API zamaskowane, ale np. `dataUrodzenia` już nie. Narzędzia
  analityczne (status, karta, historia, watchlist) nie zwracają danych osób fizycznych – tylko funkcje, nazwy
  wyłącznie dla podmiotów prawnych (`withoutPersonalData` w `src/analysis/values.ts`). Surowe odpisy
  (`Get_Current_KRS_Record`, `Get_Full_KRS_Record`) zwracają dane tak, jak podaje je API
- Numer KRS: 10 cyfr zaczynających się od 0, rejestr: P (przedsiębiorców) lub S (stowarzyszeń)

## Struktura plików

```
src/index.ts        — entrypoint
src/server.ts       — rejestracja narzędzi
src/tools/          — handlery narzędzi MCP (extract.ts: fabryka narzędzi odpisu aktualnego/pełnego;
                      checkStatus.ts eksportuje też lookupEntityStatus,
                      używany przez watchlist.ts)
src/schemas/krs.ts  — wspólne schematy Zod (numer KRS, opcjonalny rejestr) i registersToCheck (P, potem S)
src/analysis/       — analiza odpisu (status.ts: sygnały z działów 2–6, wykreślenie;
                      history.ts: lista wpisów i zmiany wprowadzone przez wpis;
                      profile.ts: karta podmiotu; values.ts: odczyt pól z pustymi `{}`/`[]`)
src/types/krs.ts    — interfejsy odpowiedzi API KRS
src/utils/api.ts    — HTTP client (fetchKrs → ok / not_found / error), fetchKrsExtractFromRegisters, fetchBulletin
src/utils/format.ts — nagłówek, odczyt nazwy/numeru/ostatniego wpisu z odpisu aktualnego i pełnego,
                      zwarty JSON (formatCompactJson)
src/utils/concurrency.ts — mapWithConcurrency (mała współbieżność zapytań do API)
src/prompts/         — prompty MCP (counterpartyCheck.ts: weryfikacja kontrahenta)
src/test-setup.ts   — setup Jest (czyszczenie cache przed każdym testem)
```

@TODO.md
