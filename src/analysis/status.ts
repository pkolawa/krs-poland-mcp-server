import { Rejestr } from "../schemas/krs.js";
import { KrsDzial2, KrsDzial3, KrsDzialOgolny, KrsExtract, KrsOkresSprawozdania } from "../types/krs.js";
import { currentFieldValue, getDanePodmiotu, getEntityName, getNaglowek } from "../utils/format.js";

/**
 * Ocena statusu podmiotu na podstawie samego odpisu KRS:
 * - dział 2: brak składu organu reprezentacji,
 * - dział 3: zaległe roczne sprawozdania finansowe,
 * - dział 4: zaległości, egzekucje, zabezpieczenie majątku, oddalenie wniosku o upadłość,
 * - dział 5: kurator,
 * - dział 6: likwidacja, upadłość, restrukturyzacja, układ, zawieszenie, rozwiązanie, połączenie,
 * - odpis pełny bez odpisu aktualnego: wykreślenie z rejestru.
 *
 * Zakończone postępowania zostają w odpisie aktualnym, dlatego każdy wpis jest oceniany osobno
 * jako trwający (brak wpisu o zakończeniu) albo historyczny.
 */

export type SignalSeverity = "krytyczny" | "ostrzezenie" | "informacja";
export type StatusAssessment = "BRAK_SYGNALOW" | "OSTRZEZENIA" | "KRYTYCZNE" | "WYKRESLONY" | "NIEUSTALONA";

export interface StatusSignal {
  kod: string;
  waga: SignalSeverity;
  dzial?: number;
  opis: string;
  szczegoly?: Record<string, unknown>;
}

export interface FinancialStatementsSummary {
  ostatnieZlozone: { zaOkres: string; dataZlozenia: string | null } | null;
  oczekiwaneZaRokObrotowyDo: string;
}

export interface StatusReport {
  krs: string;
  rejestr: Rejestr;
  nazwa: string | null;
  formaPrawna: string | null;
  ocena: StatusAssessment;
  podsumowanie: string;
  stanZDnia: string | null;
  dataRejestracjiWKRS: string | null;
  dataOstatniegoWpisu: string | null;
  sygnaly: StatusSignal[];
  sprawozdaniaFinansowe?: FinancialStatementsSummary;
  uwagi: string[];
}

const NOTES = [
  "Ocena opiera się wyłącznie na wpisach w KRS. Nie uwzględnia danych spoza rejestru (np. długów niewpisanych do KRS).",
  "Wpisy oznaczone jako trwające to te, przy których w KRS brak wpisu o zakończeniu – rejestr bywa aktualizowany z opóźnieniem.",
];

/** Formy prawne, które zawsze składają roczne sprawozdanie finansowe do KRS. */
const FORMS_ALWAYS_FILING = new Set([
  "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  "SPÓŁKA AKCYJNA",
  "PROSTA SPÓŁKA AKCYJNA",
  "SPÓŁKA KOMANDYTOWO-AKCYJNA",
  "SPÓŁDZIELNIA",
]);

// Sprawozdanie zatwierdza się w ciągu 6 miesięcy od końca roku obrotowego i składa do KRS
// w ciągu 15 dni od zatwierdzenia. Wzmianka pojawia się w rejestrze z opóźnieniem, stąd zapas.
const FILING_DEADLINE_MONTHS = 6;
const FILING_DEADLINE_DAYS = 15;
const FILING_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const SEVERITY_ORDER: Record<SignalSeverity, number> = { krytyczny: 0, ostrzezenie: 1, informacja: 2 };

const KEY_RESTRUKTURYZACJA = "postepowanieRestrukturyzacyjneNaprawczePrzymusowaRestrukturyzacjaUporzadkowanaLikwidacja";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** API zwraca puste obiekty/tablice dla pól bez wpisu – traktujemy je jak brak wartości. */
export function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  if (isRecord(value)) return Object.values(value).some(hasContent);
  return true;
}

function asItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** KRS texts often end with stray separators ("…LIKWIDACJI.,"); drop them so sentences end cleanly. */
function trimTrailingPunctuation(text: string): string {
  return text.replace(/[\s,.;:-]+$/, "");
}

function truncate(text: string, max = 300): string {
  const clean = trimTrailingPunctuation(text);
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function capitalize(text: string): string {
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Flattens an object of strings (e.g. an "orzeczenie") into one readable line. */
function summarize(value: unknown, max = 300): string | undefined {
  if (typeof value === "string") return str(value) ? truncate(value.trim(), max) : undefined;
  if (!isRecord(value)) return undefined;
  const parts = Object.values(value).map(str).filter((part): part is string => Boolean(part));
  return parts.length ? truncate(parts.join(", "), max) : undefined;
}

/** "SĄD …, sygn. X, Y" z obiektu opisującego orzeczenie sądu lub organu. */
function describeDecision(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const organ = str(value.organWydajacy);
  const sygnatura = str(value.sygnatura) ?? str(value.sygnaturaSprawy);
  const data = str(value.data) ?? str(value.dataNadaniaKlauzuliWykonalnosci);
  // Some entries already carry the prefix ("SYGN. AKT GL1G/GU/902/2026").
  const sygn = sygnatura && (/^sygn/i.test(sygnatura) ? sygnatura : `sygn. ${sygnatura}`);
  const parts = [organ, sygn, data].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : undefined;
}

function findByPrefix(item: Record<string, unknown>, prefix: string): unknown {
  const key = Object.keys(item).find((k) => k.startsWith(prefix));
  return key ? item[key] : undefined;
}

/** Parses KRS dates such as "31.12.2025" or "31.12.2025 R." (UTC midnight). */
export function parseKrsDate(value: string | undefined): Date | null {
  const match = value?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

export function formatKrsDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

/** Adds calendar months, clamping to the last day of the target month (31.12 + 6 → 30.06). */
function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Liczba z polską odmianą rzeczownika: 1 wpis, 2 wpisy, 5 wpisów (12–14 jak „5”). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? `${n} ${few}` : `${n} ${many}`;
}

function genericSignal(dzial: number, key: string, value: unknown): StatusSignal {
  return {
    kod: `WPIS_DZIAL_${dzial}`,
    waga: "ostrzezenie",
    dzial,
    opis: `Wpis w dziale ${dzial} odpisu: ${key}.`,
    szczegoly: { [key]: value },
  };
}

// ---------------------------------------------------------------------------
// Dział 6 – rozwiązanie, likwidacja, upadłość, restrukturyzacja
// ---------------------------------------------------------------------------

interface ProceedingsState {
  liquidationActive: boolean;
  bankruptcyActive: boolean;
}

function analyzeDzial6(dzial6: KrsDzialOgolny | undefined): { signals: StatusSignal[]; state: ProceedingsState } {
  const signals: StatusSignal[] = [];
  const state: ProceedingsState = { liquidationActive: false, bankruptcyActive: false };
  if (!dzial6) return { signals, state };

  const liquidations = asItems(dzial6.likwidacja).filter(hasContent);
  for (const item of liquidations) {
    const otwarcie = summarize(item.otwarcieLikwidacji, 200);
    if (hasContent(item.zakonczenieLikwidacji)) {
      signals.push({
        kod: "LIKWIDACJA_ZAKONCZONA",
        waga: "informacja",
        dzial: 6,
        opis: `Likwidacja zakończona: ${summarize(item.zakonczenieLikwidacji, 200)}.`,
        szczegoly: otwarcie ? { otwarcieLikwidacji: otwarcie } : undefined,
      });
    } else {
      state.liquidationActive = true;
      signals.push({
        kod: "LIKWIDACJA",
        waga: "krytyczny",
        dzial: 6,
        opis: `Podmiot w likwidacji${otwarcie ? ` (otwarcie: ${otwarcie})` : ""}.`,
        szczegoly: {
          sposobReprezentacjiPrzezLikwidatorow: str(item.sposobReprezentacjiPodmiotuPrzezLikwidatorow),
          liczbaLikwidatorow: asItems(item.likwidatorzy).length,
        },
      });
    }
  }

  // A dissolution entry stays in the extract even after the liquidation was repealed.
  const allLiquidationsEnded = liquidations.length > 0 && !state.liquidationActive;
  for (const item of asItems(dzial6.rozwiazanieUniewaznienie).filter(hasContent)) {
    const okolicznosc = str(item.okreslenieOkolicznosci) ?? "rozwiązanie";
    const info = summarize(item.informacjaORozwiazaniuUniewaznieniu, 200);
    signals.push({
      kod: "ROZWIAZANIE_UNIEWAZNIENIE",
      waga: allLiquidationsEnded ? "informacja" : "krytyczny",
      dzial: 6,
      opis:
        `${capitalize(okolicznosc)} podmiotu${info ? ` – ${info}` : ""}.` +
        (allLiquidationsEnded ? " Likwidacja została zakończona – sprawdź, czy wpis jest nadal aktualny." : ""),
    });
  }

  for (const item of asItems(dzial6.postepowanieUpadlosciowe).filter(hasContent)) {
    const ogloszenie = describeDecision(item.informacjaOOgloszeniuUpadlosci);
    const sposob = str(item.sposobProwadzeniaPostepowania);
    if (hasContent(item.opisZakonczeniaProcesuUpadlosci)) {
      signals.push({
        kod: "UPADLOSC_ZAKONCZONA",
        waga: "informacja",
        dzial: 6,
        opis: `Postępowanie upadłościowe zakończone${ogloszenie ? ` (ogłoszenie upadłości: ${ogloszenie})` : ""}.`,
        szczegoly: { zakonczenie: summarize(item.opisZakonczeniaProcesuUpadlosci) },
      });
    } else {
      state.bankruptcyActive = true;
      signals.push({
        kod: "UPADLOSC",
        waga: "krytyczny",
        dzial: 6,
        opis: `Ogłoszono upadłość${ogloszenie ? ` (${ogloszenie})` : ""}; brak wpisu o zakończeniu postępowania.`,
        szczegoly: sposob ? { sposobProwadzeniaPostepowania: sposob } : undefined,
      });
    }
  }

  const arrangementProceedings: Array<[unknown, string, string]> = [
    [dzial6.postepowanieUkladowe, "POSTEPOWANIE_UKLADOWE", "postępowanie układowe"],
    [dzial6[KEY_RESTRUKTURYZACJA], "RESTRUKTURYZACJA", "postępowanie restrukturyzacyjne"],
  ];
  for (const [value, kod, defaultName] of arrangementProceedings) {
    for (const item of asItems(value).filter(hasContent)) {
      const otwarcieValue = findByPrefix(item, "otwarcie");
      const otwarcie = describeDecision(otwarcieValue);
      const rodzaj = (isRecord(otwarcieValue) && str(otwarcieValue.rodzajPostepowania)) || defaultName;
      const zakonczenie = findByPrefix(item, "zakonczenie");
      const suffix = otwarcie ? ` (${otwarcie})` : "";

      if (hasContent(item.uchylenieUkladu)) {
        signals.push({
          kod: "UKLAD_UCHYLONY",
          waga: "ostrzezenie",
          dzial: 6,
          opis: `Uchylono układ – ${rodzaj.toLowerCase()}${suffix}.`,
          szczegoly: { uchylenieUkladu: summarize(item.uchylenieUkladu) },
        });
      } else if (hasContent(zakonczenie)) {
        signals.push({
          kod: `${kod}_ZAKONCZONE`,
          waga: "informacja",
          dzial: 6,
          opis: `${capitalize(rodzaj)} zakończone${suffix}: ${summarize(zakonczenie, 200)}.`,
        });
      } else {
        signals.push({
          kod,
          waga: "ostrzezenie",
          dzial: 6,
          opis: `${capitalize(rodzaj)}${suffix}; brak wpisu o zakończeniu.`,
        });
      }
    }
  }

  for (const item of asItems(dzial6.zawieszenieWznowienie).filter(hasContent)) {
    const zawieszenie = str(item.dataZawieszenia);
    const wznowienie = str(item.dataWznowienia);
    if (!zawieszenie) continue;
    signals.push(
      wznowienie
        ? {
            kod: "ZAWIESZENIE_ZAKONCZONE",
            waga: "informacja",
            dzial: 6,
            opis: `Działalność była zawieszona od ${zawieszenie} do ${wznowienie}.`,
          }
        : {
            kod: "ZAWIESZENIE_DZIALALNOSCI",
            waga: "ostrzezenie",
            dzial: 6,
            opis: `Działalność zawieszona od ${zawieszenie}; brak wpisu o wznowieniu.`,
          }
    );
  }

  for (const item of asItems(dzial6.polaczeniePodzialPrzeksztalcenie).filter(hasContent)) {
    const names = (value: unknown) =>
      asItems(value)
        .map((entity) => str(entity.nazwa)?.replace(/[,\s-]+$/, ""))
        .filter((name): name is string => Boolean(name));
    signals.push({
      kod: "POLACZENIE_PODZIAL_PRZEKSZTALCENIE",
      waga: "informacja",
      dzial: 6,
      opis: `${capitalize(str(item.okreslenieOkolicznosci) ?? "połączenie, podział lub przekształcenie")}.`,
      szczegoly: {
        podmiotyPrzejmowane: names(item.podmiotyPrzejmowane),
        podmiotyPowstalePrzejmujace: names(item.podmiotyPowstalePrzejmujace),
      },
    });
  }

  const handled = new Set([
    "likwidacja",
    "rozwiazanieUniewaznienie",
    "postepowanieUpadlosciowe",
    "postepowanieUkladowe",
    KEY_RESTRUKTURYZACJA,
    "zawieszenieWznowienie",
    "polaczeniePodzialPrzeksztalcenie",
  ]);
  for (const [key, value] of Object.entries(dzial6)) {
    if (!handled.has(key) && hasContent(value)) signals.push(genericSignal(6, key, value));
  }

  return { signals, state };
}

// ---------------------------------------------------------------------------
// Dział 4 – zaległości, egzekucje, zabezpieczenie majątku
// ---------------------------------------------------------------------------

/** Above this many arrears they are reported as one aggregated signal to keep the report short. */
const MAX_INDIVIDUAL_ARREARS = 5;

interface Arrear {
  charakter?: string;
  wartosc?: string;
  waluta?: string;
  amount: number | null;
  dataEgzekucji?: string;
  organ?: string;
  numerTytulu?: string;
  ended: boolean;
}

function parseArrear(item: Record<string, unknown>): Arrear {
  const kwota = isRecord(item.wysokoscZaleglosci) ? item.wysokoscZaleglosci : {};
  const egzekucja = isRecord(item.wszczecieEgzekucji) ? item.wszczecieEgzekucji : {};
  const wartosc = str(kwota.wartosc);
  const amount = wartosc ? Number(wartosc.replace(/\s/g, "").replace(",", ".")) : NaN;
  return {
    charakter: str(item.charakterZaleglosci),
    wartosc,
    waluta: str(kwota.waluta),
    amount: Number.isFinite(amount) ? amount : null,
    dataEgzekucji: str(egzekucja.dataWszczeciaEgzekucji),
    organ: str(egzekucja.organWydajacyTytulWykonawczy),
    numerTytulu: str(egzekucja.numerTytuluWykonawczego),
    ended: hasContent(item.zakonczenieEgzekucji),
  };
}

function formatAmount(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function describeArrear(arrear: Arrear): string {
  const kwota = [arrear.wartosc, arrear.waluta].filter(Boolean).join(" ");
  return `Zaległość${arrear.charakter ? ` ${arrear.charakter.toLowerCase()}` : ""}${kwota ? ` w wysokości ${kwota}` : ""}`;
}

function arrearSignals(arrears: Arrear[], ended: boolean): StatusSignal[] {
  if (arrears.length === 0) return [];

  if (arrears.length <= MAX_INDIVIDUAL_ARREARS) {
    return arrears.map((arrear) =>
      ended
        ? { kod: "ZALEGLOSC_ZAKONCZONA", waga: "informacja", dzial: 4, opis: `${describeArrear(arrear)} – egzekucję zakończono.` }
        : {
            kod: "ZALEGLOSC",
            waga: "ostrzezenie",
            dzial: 4,
            opis:
              describeArrear(arrear) +
              (arrear.dataEgzekucji
                ? `; egzekucję wszczęto ${arrear.dataEgzekucji}${arrear.organ ? ` (${arrear.organ})` : ""}`
                : "") +
              "; brak wpisu o zakończeniu egzekucji.",
            szczegoly: arrear.numerTytulu ? { numerTytuluWykonawczego: arrear.numerTytulu } : undefined,
          }
    );
  }

  const totals = new Map<string, number>();
  const kinds = new Map<string, number>();
  for (const arrear of arrears) {
    if (arrear.amount !== null) {
      const currency = arrear.waluta ?? "?";
      totals.set(currency, (totals.get(currency) ?? 0) + arrear.amount);
    }
    const kind = arrear.charakter?.toLowerCase() ?? "nieokreślona";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const total = [...totals].map(([currency, sum]) => `${formatAmount(sum)} ${currency}`).join(" + ");
  const kindList = [...kinds].map(([kind, n]) => `${kind} ×${n}`).join(", ");
  const dates = arrears
    .map((arrear) => parseKrsDate(arrear.dataEgzekucji))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const range = dates.length ? `; egzekucje wszczęte od ${formatKrsDate(dates[0])} do ${formatKrsDate(dates[dates.length - 1])}` : "";
  const largest = [...arrears]
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, MAX_INDIVIDUAL_ARREARS)
    .map((arrear) => ({
      charakter: arrear.charakter,
      kwota: [arrear.wartosc, arrear.waluta].filter(Boolean).join(" "),
      dataWszczeciaEgzekucji: arrear.dataEgzekucji,
      organ: arrear.organ,
    }));

  return [
    ended
      ? {
          kod: "ZALEGLOSCI_ZAKONCZONE",
          waga: "informacja",
          dzial: 4,
          opis: `${arrears.length} zaległości z zakończoną egzekucją${total ? `, łącznie ${total}` : ""} (${kindList}).`,
        }
      : {
          kod: "ZALEGLOSCI",
          waga: "ostrzezenie",
          dzial: 4,
          opis:
            `${arrears.length} zaległości bez wpisu o zakończeniu egzekucji${total ? `, łącznie ${total}` : ""} ` +
            `(${kindList})${range}.`,
          szczegoly: { najwiekszeZaleglosci: largest },
        },
  ];
}

function analyzeDzial4(dzial4: KrsDzialOgolny | undefined): StatusSignal[] {
  const signals: StatusSignal[] = [];
  if (!dzial4) return signals;

  const arrears = asItems(dzial4.zaleglosci).filter(hasContent).map(parseArrear);
  signals.push(...arrearSignals(arrears.filter((a) => !a.ended), false));
  signals.push(...arrearSignals(arrears.filter((a) => a.ended), true));

  const securityEntries: Record<string, (decision: string) => Omit<StatusSignal, "dzial">> = {
    zabezpieczenieMajatkuDluznikaWPostepowaniuUpadlosciowym: (decision) => ({
      kod: "ZABEZPIECZENIE_MAJATKU_UPADLOSC",
      waga: "ostrzezenie",
      opis: `Sąd zabezpieczył majątek dłużnika w związku z wnioskiem o ogłoszenie upadłości${decision}.`,
    }),
    zabezpieczenieMajatkuDluznikaWPostepowaniuRestrukturyzacyjnym: (decision) => ({
      kod: "ZABEZPIECZENIE_MAJATKU_RESTRUKTURYZACJA",
      waga: "ostrzezenie",
      opis: `Sąd zabezpieczył majątek dłużnika w postępowaniu restrukturyzacyjnym${decision}.`,
    }),
    oddalenieWnioskuOUpadlosc: (decision) => ({
      kod: "ODDALENIE_WNIOSKU_O_UPADLOSC",
      waga: "krytyczny",
      opis:
        `Oddalono wniosek o ogłoszenie upadłości${decision}. ` +
        "Do KRS wpisuje się oddalenie z powodu braku majątku wystarczającego na koszty postępowania.",
    }),
    dalszePelnienieFunkcjiPoUkonczeniuPostepowaniaRestrukturyzacyjnego: (decision) => ({
      kod: "PO_RESTRUKTURYZACJI",
      waga: "informacja",
      opis: `Wpis o dalszym pełnieniu funkcji po ukończeniu postępowania restrukturyzacyjnego${decision}.`,
    }),
  };

  for (const item of asItems(dzial4.zabezpieczenieMajatkuOddalenieWnioskuOUpadlosc)) {
    for (const [key, value] of Object.entries(item)) {
      if (!hasContent(value)) continue;
      const build = securityEntries[key];
      if (!build) {
        signals.push(genericSignal(4, key, value));
        continue;
      }
      const decision = describeDecision(value);
      const signal: StatusSignal = { ...build(decision ? ` (${decision})` : ""), dzial: 4 };
      const przedmiot = isRecord(value) ? str(value.informacjaOPrzedmiocieZabezpieczenia) : undefined;
      if (przedmiot) signal.szczegoly = { przedmiotZabezpieczenia: truncate(przedmiot, 300) };
      signals.push(signal);
    }
  }

  const handled = new Set(["zaleglosci", "zabezpieczenieMajatkuOddalenieWnioskuOUpadlosc"]);
  for (const [key, value] of Object.entries(dzial4)) {
    if (!handled.has(key) && hasContent(value)) signals.push(genericSignal(4, key, value));
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Dział 5 – kurator
// ---------------------------------------------------------------------------

function analyzeDzial5(dzial5: KrsDzialOgolny | undefined, today: Date): StatusSignal[] {
  const signals: StatusSignal[] = [];
  if (!dzial5) return signals;

  for (const item of asItems(dzial5.kurator).filter(hasContent)) {
    const od = str(item.dataPowolania);
    const doDnia = str(item.dataDoKtorejMaDzialac);
    const koniec = parseKrsDate(doDnia);
    const okres = `${od ? ` od ${od}` : ""}${doDnia ? ` do ${doDnia}` : ""}`;
    const podstawa = str(item.podstawaPowolaniaZakresDzialania);
    const szczegoly = podstawa ? { podstawaIZakres: truncate(podstawa, 300) } : undefined;

    if (koniec && koniec.getTime() < today.getTime()) {
      signals.push({ kod: "KURATOR_ZAKONCZONY", waga: "informacja", dzial: 5, opis: `Kurator ustanowiony${okres}.`, szczegoly });
    } else {
      signals.push({
        kod: "KURATOR",
        waga: "ostrzezenie",
        dzial: 5,
        opis: `Ustanowiono kuratora${okres}. Sąd ustanawia go najczęściej, gdy podmiot nie ma organu zdolnego do działania.`,
        szczegoly,
      });
    }
  }

  for (const [key, value] of Object.entries(dzial5)) {
    if (key !== "kurator" && hasContent(value)) signals.push(genericSignal(5, key, value));
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Dział 2 – organ reprezentacji
// ---------------------------------------------------------------------------

function analyzeRepresentation(dzial2: KrsDzial2 | undefined, state: ProceedingsState): StatusSignal[] {
  // In liquidation or bankruptcy the liquidators / trustee represent the entity instead of the board.
  if (state.liquidationActive || state.bankruptcyActive) return [];
  // SPZOZ, research institutes and foreign branches list their representatives in other fields.
  if (hasContent(dzial2?.reprezentacjaIBIGBPPSPZOZ) || hasContent(dzial2?.osobyReprezentujacePZ)) return [];

  const reprezentacja = dzial2?.reprezentacja;
  if (Array.isArray(reprezentacja?.sklad) && reprezentacja.sklad.length > 0) return [];

  const organ = str(reprezentacja?.nazwaOrganu);
  return [
    {
      kod: "BRAK_SKLADU_ORGANU_REPREZENTACJI",
      waga: "ostrzezenie",
      dzial: 2,
      opis: `W KRS nie wpisano członków organu reprezentacji${organ ? ` (${organ.toLowerCase()})` : ""}.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Dział 3 – roczne sprawozdania finansowe
// ---------------------------------------------------------------------------

interface FiscalYearEnd {
  day: number;
  month: number;
}

function fiscalYearEnd(dzial3: KrsDzial3 | undefined): FiscalYearEnd {
  const first = parseKrsDate(dzial3?.informacjaODniuKonczacymRokObrotowy?.dzienKonczacyPierwszyRokObrotowy);
  return first ? { day: first.getUTCDate(), month: first.getUTCMonth() + 1 } : { day: 31, month: 12 };
}

/** End of the reporting period from texts like "OD 01.01.2024 DO 31.12.2024" or "2024 ROK". */
export function parsePeriodEnd(period: string | undefined, fy: FiscalYearEnd = { day: 31, month: 12 }): Date | null {
  if (!period) return null;
  const dates = [...period.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g)];
  const last = dates[dates.length - 1];
  if (last) return new Date(Date.UTC(Number(last[3]), Number(last[2]) - 1, Number(last[1])));

  const years = period.match(/\b\d{4}\b/g);
  if (!years) return null;
  return new Date(Date.UTC(Number(years[years.length - 1]), fy.month - 1, fy.day));
}

function filingDeadline(periodEnd: Date): Date {
  return addDays(addMonths(periodEnd, FILING_DEADLINE_MONTHS), FILING_DEADLINE_DAYS);
}

/** Latest fiscal year whose statement should already be visible in KRS on `today`. */
export function expectedPeriodEnd(today: Date, fy: FiscalYearEnd = { day: 31, month: 12 }): Date {
  for (let year = today.getUTCFullYear(); ; year--) {
    const end = new Date(Date.UTC(year, fy.month - 1, fy.day));
    if (addDays(filingDeadline(end), FILING_GRACE_DAYS).getTime() <= today.getTime()) return end;
  }
}

function latestPeriod(entries: KrsOkresSprawozdania[], fy: FiscalYearEnd) {
  let best: { end: Date; entry: KrsOkresSprawozdania } | null = null;
  for (const entry of entries) {
    const end = parsePeriodEnd(entry.zaOkresOdDo, fy);
    if (end && (!best || end.getTime() > best.end.getTime())) best = { end, entry };
  }
  return best;
}

function analyzeFinancialStatements(
  dzial3: KrsDzial3 | undefined,
  formaPrawna: string | undefined,
  registeredAt: Date | null,
  today: Date
): { signals: StatusSignal[]; summary: FinancialStatementsSummary } {
  const fy = fiscalYearEnd(dzial3);
  const wzmianki = dzial3?.wzmiankiOZlozonychDokumentach;
  const filed = asItems(wzmianki?.wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego) as KrsOkresSprawozdania[];
  const exempt = asItems(wzmianki?.wzmiankaOBrakuObowiazkuSporzadzeniaZlozeniaRocznegoSprawozdaniaFinansowego) as KrsOkresSprawozdania[];

  const lastFiled = latestPeriod(filed, fy);
  const lastCovered = latestPeriod([...filed, ...exempt], fy);
  const expected = expectedPeriodEnd(today, fy);

  const summary: FinancialStatementsSummary = {
    ostatnieZlozone: lastFiled
      ? { zaOkres: lastFiled.entry.zaOkresOdDo ?? "", dataZlozenia: lastFiled.entry.dataZlozenia ?? null }
      : null,
    oczekiwaneZaRokObrotowyDo: formatKrsDate(expected),
  };

  // A first fiscal year may run up to 23 months, so entities registered in the second half
  // of the expected year may legitimately have nothing to file yet.
  const tooYoung = registeredAt !== null && registeredAt.getTime() > addMonths(expected, -6).getTime();
  const covered = lastCovered !== null && lastCovered.end.getTime() >= expected.getTime() - 31 * DAY_MS;
  if (covered || tooYoung) return { signals: [], summary };

  const alwaysFiles = formaPrawna !== undefined && FORMS_ALWAYS_FILING.has(formaPrawna.toUpperCase());
  if (!alwaysFiles && !lastFiled) return { signals: [], summary };

  const deadline = formatKrsDate(filingDeadline(expected));
  const opis = lastFiled
    ? `Brak wzmianki o złożeniu sprawozdania finansowego za rok obrotowy kończący się ${formatKrsDate(expected)} ` +
      `(termin upłynął ok. ${deadline}). Ostatnie złożone dotyczy okresu: ${lastFiled.entry.zaOkresOdDo}.`
    : `Brak wzmianek o złożeniu jakiegokolwiek rocznego sprawozdania finansowego ` +
      `(oczekiwane co najmniej za rok obrotowy kończący się ${formatKrsDate(expected)}).`;

  return {
    signals: [
      {
        kod: "BRAK_SPRAWOZDANIA_FINANSOWEGO",
        waga: alwaysFiles ? "ostrzezenie" : "informacja",
        dzial: 3,
        opis: alwaysFiles ? opis : `${opis} Obowiązek złożenia zależy od formy prawnej i skali działalności.`,
      },
    ],
    summary,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function assess(signals: StatusSignal[]): StatusAssessment {
  if (signals.some((s) => s.waga === "krytyczny")) return "KRYTYCZNE";
  if (signals.some((s) => s.waga === "ostrzezenie")) return "OSTRZEZENIA";
  return "BRAK_SYGNALOW";
}

function summarizeSignals(signals: StatusSignal[]): string {
  const count = (waga: SignalSeverity) => signals.filter((s) => s.waga === waga).length;
  const critical = count("krytyczny");
  const warnings = count("ostrzezenie");
  const info = count("informacja");

  if (critical === 0 && warnings === 0) {
    const history = info ? ` (${plural(info, "informacja historyczna", "informacje historyczne", "informacji historycznych")})` : "";
    return `Brak sygnałów ostrzegawczych w KRS${history}.`;
  }

  const parts = [
    critical && plural(critical, "sygnał krytyczny", "sygnały krytyczne", "sygnałów krytycznych"),
    warnings && plural(warnings, "ostrzeżenie", "ostrzeżenia", "ostrzeżeń"),
    info && plural(info, "informacja historyczna", "informacje historyczne", "informacji historycznych"),
  ].filter(Boolean);
  return `Wykryto: ${parts.join(", ")}.`;
}

function sortSignals(signals: StatusSignal[]): StatusSignal[] {
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => SEVERITY_ORDER[a.signal.waga] - SEVERITY_ORDER[b.signal.waga] || a.index - b.index)
    .map(({ signal }) => signal);
}

/** Analyzes an odpis aktualny of an entity that is still in the register. */
export function analyzeCurrentExtract(extract: KrsExtract, rejestr: Rejestr, krs: string, today: Date = new Date()): StatusReport {
  const naglowek = getNaglowek(extract);
  const dane = extract.odpis?.dane;
  const formaPrawna = currentFieldValue(getDanePodmiotu(extract)?.formaPrawna, "formaPrawna");

  const dzial6 = analyzeDzial6(dane?.dzial6);
  const financial = analyzeFinancialStatements(dane?.dzial3, formaPrawna, parseKrsDate(naglowek?.dataRejestracjiWKRS), today);

  const signals = sortSignals([
    ...dzial6.signals,
    ...analyzeDzial4(dane?.dzial4),
    ...analyzeDzial5(dane?.dzial5, today),
    ...analyzeRepresentation(dane?.dzial2, dzial6.state),
    ...financial.signals,
  ]);

  return {
    krs: naglowek?.numerKRS ?? krs,
    rejestr,
    nazwa: getEntityName(extract) ?? null,
    formaPrawna: formaPrawna ?? null,
    ocena: assess(signals),
    podsumowanie: summarizeSignals(signals),
    stanZDnia: naglowek?.stanZDnia ?? null,
    dataRejestracjiWKRS: naglowek?.dataRejestracjiWKRS ?? null,
    dataOstatniegoWpisu: naglowek?.dataOstatniegoWpisu ?? null,
    sygnaly: signals,
    sprawozdaniaFinansowe: financial.summary,
    uwagi: NOTES,
  };
}

/**
 * Analyzes an odpis pełny of an entity that has no odpis aktualny – the API serves only
 * the full extract for entities struck off the register.
 */
export function analyzeEntityWithoutCurrentExtract(extract: KrsExtract, rejestr: Rejestr, krs: string): StatusReport {
  const naglowek = getNaglowek(extract);
  const wpisy = naglowek?.wpis ?? [];
  const deletion = [...wpisy].reverse().find((wpis) => /WYKREŚLENIE Z (KRAJOWEGO )?REJESTRU/i.test(wpis.opis ?? ""));

  const base = {
    krs: naglowek?.numerKRS ?? krs,
    rejestr,
    nazwa: getEntityName(extract) ?? null,
    formaPrawna: currentFieldValue(getDanePodmiotu(extract)?.formaPrawna, "formaPrawna") ?? null,
    stanZDnia: naglowek?.stanZDnia ?? null,
    dataRejestracjiWKRS: wpisy[0]?.dataWpisu ?? null,
    dataOstatniegoWpisu: wpisy[wpisy.length - 1]?.dataWpisu ?? null,
    uwagi: NOTES.slice(0, 1),
  };

  if (!deletion) {
    return {
      ...base,
      ocena: "NIEUSTALONA",
      podsumowanie: "API nie zwraca odpisu aktualnego, a w odpisie pełnym nie ma wpisu o wykreśleniu z rejestru.",
      sygnaly: [],
    };
  }

  const prawomocnie = deletion.dataUprawomocnienia ? ` (prawomocnie od ${deletion.dataUprawomocnienia})` : "";
  const dataWpisu = deletion.dataWpisu ? ` ${deletion.dataWpisu}` : "";
  return {
    ...base,
    ocena: "WYKRESLONY",
    podsumowanie: `Podmiot wykreślony z KRS${dataWpisu}${prawomocnie}.`,
    sygnaly: [
      {
        kod: "WYKRESLENIE",
        waga: "krytyczny",
        opis: `Wykreślenie z KRS wpisem nr ${deletion.numerWpisu ?? "?"} z dnia ${deletion.dataWpisu ?? "?"}${prawomocnie}.`,
        szczegoly: {
          sygnatura: deletion.sygnaturaAktSprawyDotyczacejWpisu,
          sad: deletion.oznaczenieSaduDokonujacegoWpisu,
        },
      },
    ],
  };
}
