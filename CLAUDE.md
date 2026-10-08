# KRS Poland MCP Server

Serwer MCP udostępniający dane z publicznego API Krajowego Rejestru Sądowego (KRS) Ministerstwa Sprawiedliwości.

## Architektura

- TypeScript + `@modelcontextprotocol/sdk`, transport stdio
- Dwa narzędzia MCP: odpis aktualny (`Get_Current_KRS_Record`) i pełny (`Get_Full_KRS_Record`)
- HTTP client z retry (30s/60s backoff) i dual URL fallback (path params + query params)
- Build: esbuild do jednego pliku ESM (`build/index.mjs`)

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

- Walidacja inputów przez Zod ze schematem inline w tool definitions
- Odpowiedzi MCP zawierają `type: "text"` z JSON w treści
- API KRS: `https://api-krs.ms.gov.pl/api/krs/{typ}/{rejestr}/{krs}?format=json`
- Numer KRS: 10 cyfr zaczynających się od 0, rejestr: P (przedsiębiorców) lub S (stowarzyszeń)

## Struktura plików

```
src/index.ts        — entrypoint
src/server.ts       — rejestracja narzędzi
src/tools/          — handlery narzędzi MCP
src/types/krs.ts    — interfejs KrsExtract
src/utils/api.ts    — HTTP client
src/utils/format.ts — formatowanie nagłówka
```

@TODO.md
