# Raport analizy projektu: KRS Poland MCP Server

> Wygenerowano: 2026-05-17

## 1. Rozpoznanie projektu

- **Typ:** Serwer MCP (Model Context Protocol) — narzędzie CLI do integracji z asystentami AI
- **Wersja:** 1.2.2
- **Licencja:** MIT
- **Autor:** Piotr Kolawa

### Stos technologiczny

| Kategoria | Technologia |
|-----------|-------------|
| Język | TypeScript 5.9, ES2022 |
| Framework | @modelcontextprotocol/sdk 1.18 |
| Walidacja | Zod 3.25 |
| Build | esbuild (single ESM bundle) |
| Testy | Jest + ts-jest |
| Linting | ESLint + Prettier |
| CI/CD | GitHub Actions |
| Transport | stdio |

### Struktura katalogów

```
src/
├── index.ts                — entrypoint (stdio transport)
├── server.ts               — rejestracja narzędzi MCP
├── tools/
│   ├── currentExtract.ts   — narzędzie: odpis aktualny
│   └── fullExtract.ts      — narzędzie: odpis pełny
├── types/
│   └── krs.ts              — interfejs KrsExtract
└── utils/
    ├── api.ts              — HTTP client z retry i fallback URL
    ├── api.test.ts         — testy unit (mockowany fetch)
    ├── api.integration.test.ts — testy integracyjne (prawdziwe API)
    └── format.ts           — formatowanie nagłówka firmy
```

~350 LOC kodu produkcyjnego, ~190 LOC testów.

## 2. Analiza funkcjonalności

### Narzędzia MCP

1. **Get_Current_KRS_Record** — pobiera odpis aktualny z KRS po numerze KRS i typie rejestru (P/S)
2. **Get_Full_KRS_Record** — pobiera odpis pełny (historyczny) z KRS

### Moduły

| Moduł | Odpowiedzialność |
|-------|-----------------|
| `server.ts` | Rejestracja narzędzi w McpServer |
| `currentExtract.ts` | Handler odpisu aktualnego, walidacja Zod |
| `fullExtract.ts` | Handler odpisu pełnego, walidacja Zod |
| `api.ts` | HTTP client: retry (30s/60s backoff), timeout 10s, dual URL fallback |
| `format.ts` | Ekstrakcja nazwy i numeru KRS z różnych wariantów struktury JSON |
| `krs.ts` | Luźny interfejs TypeScript dla odpowiedzi API |

### Integracja zewnętrzna

- API publiczne KRS Ministerstwa Sprawiedliwości: `https://api-krs.ms.gov.pl/api/krs`
- Dwa warianty URL: path params (`/{typ}/{rejestr}/{krs}`) i query params (`/{typ}/{krs}?rejestr=...`)

## 3. Ocena jakości kodu

### Mocne strony

- Czytelny, zwięzły kod
- Solidne testy unit z mockowaniem fetch i fake timers
- Testy integracyjne z prawdziwym API + codzienny cron CI
- Retry z backoff i fallback URL — odporność na niestabilność API
- ESLint + Prettier + typecheck w CI pipeline
- Poprawna konfiguracja esbuild (bundle, shebang, chmod)

### Obszary wymagające uwagi

| Problem | Kategoria | Wpływ |
|---------|-----------|-------|
| Prawie identyczny kod w `currentExtract.ts` i `fullExtract.ts` | Duplikacja | Utrzymanie |
| Duplikacja schematu Zod (KRS + rejestr) | Duplikacja | Utrzymanie |
| `_meta: {}` w odpowiedziach bez wartości | Czystość | Niski |
| Brak testów dla `format.ts` | Testy | Średni |
| `KrsExtract` zbyt luźny typ | Typizacja | Średni |
| Wersja hardcoded w `server.ts` | Synchronizacja | Niski |
| Pliki `.mcpregistry_*` w repozytorium | Bezpieczeństwo | Wysoki |

## 4. CI/CD

- `tests.yml` — PR trigger: lint, typecheck, unit tests, integration tests
- `krs-api-integration.yml` — cron (5:30 UTC daily) + manual dispatch: integration tests
- Node 20, npm ci, cache npm

## 5. Propozycje usprawnień

### Jakość kodu (priorytet użytkownika)

1. Wyekstrahować wspólny schemat Zod do `src/schemas/krs.ts`
2. Stworzyć generyczną fabrykę tool handlerów zamiast duplikacji
3. Rozbudować `KrsExtract` o faktyczną strukturę odpowiedzi API
4. Usunąć `_meta: {}` z odpowiedzi (niepotrzebne)
5. Zsynchronizować wersję między `package.json` a `server.ts`

### Bezpieczeństwo

6. Dodać `.mcpregistry_*` do `.gitignore`

### Testy

7. Dodać testy dla `format.ts`
8. Dodać test rejestracji narzędzi w `server.ts`

### Nowe funkcjonalności

9. Wyszukiwanie podmiotów po nazwie/NIP/REGON
10. Lepsze formatowanie odpowiedzi (strukturyzowany tekst zamiast raw JSON)
