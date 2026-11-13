import { Rejestr } from "../schemas/krs.js";
import { KrsExtract } from "../types/krs.js";
import { currentFieldValue, getDanePodmiotu, getEntityName, getNaglowek } from "../utils/format.js";
import { analyzeCurrentExtract, StatusAssessment } from "./status.js";
import { asItems, hasContent, isRecord, str, truncate } from "./values.js";

/**
 * Karta podmiotu z odpisu aktualnego: dane identyfikacyjne, adres, kapitał, reprezentacja
 * (kto i jak może zaciągać zobowiązania), właściciele, przedmiot działalności i skrót statusu.
 *
 * Nie zawiera danych osób fizycznych. API maskuje imiona, nazwiska i PESEL, ale podaje np. daty urodzenia;
 * karta pokazuje tylko funkcje osób, a nazwy wyłącznie dla podmiotów (np. spółki-wspólnika).
 */

/** Długie listy (PKD, oddziały, wspólnicy) są przycinane, a pełna liczba trafia do pola `liczba…`. */
const MAX_LISTED = 15;
const NO_KRS = "0000000000";

export interface ProfileReport {
  krs: string;
  rejestr: Rejestr;
  nazwa: string | null;
  formaPrawna: string | null;
  identyfikatory: Record<string, string>;
  stanZDnia: string | null;
  dataRejestracjiWKRS: string | null;
  status: { ocena: StatusAssessment; podsumowanie: string; sygnaly: string[] };
  siedziba?: string;
  adres?: string;
  kontakt?: Record<string, string>;
  kapital?: Record<string, string>;
  reprezentacja?: Record<string, unknown>;
  organNadzoru?: Array<{ nazwa: string; liczbaCzlonkow: number }>;
  wlasciciele?: Record<string, unknown>;
  dzialalnosc?: Record<string, unknown>;
  organizacja?: Record<string, unknown>;
  inne?: Record<string, unknown>;
  uwagi: string[];
}

const NOTES = [
  "Dane osobowe są w API KRS zamaskowane – karta podaje funkcje osób, nie ich tożsamość.",
  "Szczegóły sygnałów ostrzegawczych zwraca Check_KRS_Status, historię zmian – Get_KRS_Entry_History.",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function amount(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const wartosc = str(value.wartosc);
  return wartosc ? [wartosc, str(value.waluta)].filter(Boolean).join(" ") : undefined;
}

/** Drops undefined values and returns undefined for an object that ends up empty. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && hasContent(item));
  return entries.length ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

/** `{ key: first MAX_LISTED items, keyLacznie: total }` – the total only when the list was cut. */
function limitList<T>(items: T[], key: string): Record<string, unknown> {
  return items.length > MAX_LISTED ? { [key]: items.slice(0, MAX_LISTED), [`${key}Lacznie`]: items.length } : { [key]: items };
}

/** { "PREZES ZARZĄDU": 1, "CZŁONEK ZARZĄDU": 3 } – in the order functions first appear. */
function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** "70.10.Z – DZIAŁALNOŚĆ FIRM CENTRALNYCH…" */
function pkd(item: Record<string, unknown>): string | undefined {
  const code = [str(item.kodDzial), str(item.kodKlasa), str(item.kodPodklasa)].filter(Boolean).join(".");
  const opis = str(item.opis);
  if (!code && !opis) return undefined;
  return [code, opis && truncate(opis, 120)].filter(Boolean).join(" – ");
}

function pkdList(value: unknown): string[] {
  return asItems(value)
    .map(pkd)
    .filter((item): item is string => Boolean(item));
}

/** "UL. PRZECŁAW 92D/3, 72-005 PRZECŁAW" (+ poczta and country when they differ). */
export function formatAddress(adres: unknown): string | undefined {
  if (!isRecord(adres)) return undefined;
  const ulica = str(adres.ulica);
  const numer = [str(adres.nrDomu), str(adres.nrLokalu)].filter(Boolean).join("/");
  const miejscowosc = str(adres.miejscowosc);
  const poczta = str(adres.poczta);
  const kraj = str(adres.kraj);
  const street = [ulica ?? (numer ? miejscowosc : undefined), numer].filter(Boolean).join(" ");
  const city = [str(adres.kodPocztowy), poczta && poczta !== miejscowosc ? `${miejscowosc ?? ""} (poczta ${poczta})`.trim() : miejscowosc]
    .filter(Boolean)
    .join(" ");
  const parts = [street, city, kraj && kraj !== "POLSKA" ? kraj : undefined].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** "PRZECŁAW, gm. KOŁBASKOWO, pow. POLICKI, woj. ZACHODNIOPOMORSKIE" */
export function formatSeat(siedziba: unknown): string | undefined {
  if (!isRecord(siedziba)) return undefined;
  const miejscowosc = str(siedziba.miejscowosc);
  const gmina = str(siedziba.gmina);
  const powiat = str(siedziba.powiat);
  const kraj = str(siedziba.kraj);
  const parts = [
    miejscowosc,
    gmina && gmina !== miejscowosc ? `gm. ${gmina}` : undefined,
    powiat && powiat !== miejscowosc && powiat !== gmina ? `pow. ${powiat}` : undefined,
    str(siedziba.wojewodztwo) && `woj. ${str(siedziba.wojewodztwo)}`,
    kraj && kraj !== "POLSKA" ? kraj : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** A legal entity listed among owners or organ members – people (masked in the API) get only a role. */
function legalEntity(item: Record<string, unknown>): Record<string, string> | undefined {
  const nazwa = str(item.nazwa);
  if (!nazwa) return undefined;
  const krs = isRecord(item.krs) ? str(item.krs.krs) : undefined;
  const regon = isRecord(item.identyfikator) ? str(item.identyfikator.regon) : undefined;
  return compact({ nazwa: nazwa.replace(/[,\s-]+$/, ""), krs: krs !== NO_KRS ? krs : undefined, regon }) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function representation(extract: KrsExtract, signalCodes: Set<string>) {
  const dane = extract.odpis?.dane;
  const dzial2 = dane?.dzial2 ?? {};
  const reprezentacja = isRecord(dzial2.reprezentacja) ? dzial2.reprezentacja : undefined;

  const members = asItems(reprezentacja?.sklad).filter(hasContent);
  const sklad = countBy(members.map((member) => str(member.funkcjaWOrganie) ?? "CZŁONEK ORGANU"));
  const suspended = members.filter((member) => member.czyZawieszona === true).length;
  const entityMembers = members
    .map((member) => {
      const entity = legalEntity(member);
      return entity && { ...entity, funkcja: str(member.funkcjaWOrganie) };
    })
    .filter(Boolean);

  const liquidation = asItems(dane?.dzial6?.likwidacja).find(
    (item) => hasContent(item) && !hasContent(item.zakonczenieLikwidacji)
  );
  const uwagi = [
    liquidation &&
      `Podmiot w likwidacji – reprezentują go likwidatorzy (${asItems(liquidation.likwidatorzy).length}): ` +
        (str(liquidation.sposobReprezentacjiPodmiotuPrzezLikwidatorow) ?? "sposób reprezentacji nieokreślony") + ".",
    signalCodes.has("UPADLOSC") && "Ogłoszono upadłość – majątkiem zarządza syndyk.",
    signalCodes.has("KURATOR") && "Sąd ustanowił kuratora (zob. Check_KRS_Status).",
    signalCodes.has("BRAK_SKLADU_ORGANU_REPREZENTACJI") && "W KRS nie wpisano członków organu reprezentacji.",
  ].filter((note): note is string => Boolean(note));

  const spzoz = isRecord(dzial2.reprezentacjaIBIGBPPSPZOZ) ? str(dzial2.reprezentacjaIBIGBPPSPZOZ.nazwaOrganu) : undefined;

  return compact({
    organ: str(reprezentacja?.nazwaOrganu) ?? spzoz,
    sposobReprezentacji: str(reprezentacja?.sposobReprezentacji) && truncate(str(reprezentacja?.sposobReprezentacji) as string, 600),
    sklad: members.length ? sklad : undefined,
    zawieszeniCzlonkowie: suspended || undefined,
    podmiotyWSkladzie: entityMembers.length ? entityMembers : undefined,
    prokura: asItems(dzial2.prokurenci).map((item) => str(item.rodzajProkury) ?? "PROKURA"),
    pelnomocnicy: asItems(dzial2.pelnomocnicy).map((item) =>
      str(item.zakresPelnomocnictwa) ? truncate(str(item.zakresPelnomocnictwa) as string, 200) : "PEŁNOMOCNIK"
    ),
    liczbaOsobReprezentujacychOddzial: asItems(dzial2.osobyReprezentujacePZ).length || undefined,
    uwagi,
  });
}

function owners(extract: KrsExtract) {
  const dzial1 = extract.odpis?.dane?.dzial1 ?? {};

  const shareholders = asItems(dzial1.wspolnicySpzoo).map((item) =>
    compact({
      wspolnik: legalEntity(item) ?? "osoba fizyczna",
      udzialy: str(item.posiadaneUdzialy) && truncate(str(item.posiadaneUdzialy) as string, 200),
      caloscUdzialow: item.czyPosiadaCaloscUdzialow === true ? true : undefined,
    })
  );
  const soleShareholder = asItems(dzial1.jedynyAkcjonariusz).map((item) =>
    compact({ akcjonariusz: legalEntity(item) ?? "osoba fizyczna", caloscAkcji: item.czyPosiadaCaloscAkcji === true ? true : undefined })
  );
  const partners = asItems(dzial1.wspolnicyPartnerzy).map((item) => legalEntity(item) ?? "osoba fizyczna");
  const pozostale = isRecord(dzial1.pozostaleInformacje) ? dzial1.pozostaleInformacje : {};

  return compact({
    ...limitList(shareholders, "wspolnicy"),
    jedynyAkcjonariusz: soleShareholder.length ? soleShareholder : undefined,
    ...limitList(partners, "wspolnicySpolkiOsobowej"),
    informacjaOLiczbieUdzialow: str(pozostale.informacjaOLiczbieUdzialow),
  });
}

function capital(extract: KrsExtract) {
  const kapital = extract.odpis?.dane?.dzial1?.kapital;
  if (!isRecord(kapital)) return undefined;
  return compact({
    zakladowy: amount(kapital.wysokoscKapitaluZakladowego),
    wplaconyPokryty: amount(kapital.czescKapitaluWplaconegoPokrytego),
    liczbaAkcjiUdzialow: str(kapital.lacznaLiczbaAkcjiUdzialow),
    wartoscJednejAkcjiUdzialu: amount(kapital.wartoscJednejAkcji),
    warunkowePodwyzszenie: amount(kapital.wartoscWarunkowegoPodwyzszeniaKapitaluZakladowego),
    docelowy: amount(kapital.wysokoscKapitaluDocelowegoZapasowego),
  }) as Record<string, string> | undefined;
}

function activity(extract: KrsExtract) {
  const przedmiot = extract.odpis?.dane?.dzial3?.przedmiotDzialalnosci;
  if (!isRecord(przedmiot)) return undefined;
  const other = pkdList(przedmiot.przedmiotPozostalejDzialalnosci);
  return compact({
    przewazajaca: pkdList(przedmiot.przedmiotPrzewazajacejDzialalnosci),
    ...limitList(other, "pozostala"),
  });
}

function organization(extract: KrsExtract) {
  const dane = extract.odpis?.dane;
  const cel = isRecord(dane?.dzial3?.celDzialaniaOrganizacji) ? str(dane?.dzial3?.celDzialaniaOrganizacji.celDzialania) : undefined;
  const opp = dane?.dzial3?.przedmiotDzialalnosciOPP;
  const statusOPP = getDanePodmiotu(extract)?.czyPosiadaStatusOPP;
  return compact({
    celDzialania: cel && truncate(cel, 600),
    statusOPP: statusOPP === true ? true : undefined,
    dzialalnoscOPPOdplatna: isRecord(opp) ? pkdList(opp.odplatnyPkd) : undefined,
    dzialalnoscOPPNieodplatna: isRecord(opp) ? pkdList(opp.nieodplatnyPkd) : undefined,
  });
}

function other(extract: KrsExtract) {
  const dane = extract.odpis?.dane;
  const dzial1 = dane?.dzial1 ?? {};
  const pozostale = isRecord(dzial1.pozostaleInformacje) ? dzial1.pozostaleInformacje : {};
  const powstanie = isRecord(dzial1.sposobPowstaniaPodmiotu) ? dzial1.sposobPowstaniaPodmiotu : {};
  const branches = asItems(dzial1.jednostkiTerenoweOddzialy).map((item) => {
    const name = str(item.nazwa)?.replace(/[,\s-]+$/, "") ?? "ODDZIAŁ";
    const seat = isRecord(item.siedziba) ? str(item.siedziba.miejscowosc) : undefined;
    return seat ? `${name} (${seat})` : name;
  });
  return compact({
    czasTrwania: str(pozostale.czasNaJakiUtworzonyZostalPodmiot),
    sposobPowstania: str(powstanie.okolicznosciPowstania),
    organSprawujacyNadzor: isRecord(dzial1.organSprawujacyNadzor) ? str(dzial1.organSprawujacyNadzor.nazwa) : undefined,
    organZalozycielski: isRecord(dzial1.organPodmiotZalozycielskiMinisterNadzorujacy)
      ? str(dzial1.organPodmiotZalozycielskiMinisterNadzorujacy.nazwa)
      : undefined,
    ...limitList(branches, "oddzialy"),
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function buildEntityProfile(extract: KrsExtract, rejestr: Rejestr, krs: string, today: Date = new Date()): ProfileReport {
  const naglowek = getNaglowek(extract);
  const danePodmiotu = getDanePodmiotu(extract);
  const dzial1 = extract.odpis?.dane?.dzial1 ?? {};
  const siedzibaIAdres = isRecord(dzial1.siedzibaIAdres)
    ? dzial1.siedzibaIAdres
    : isRecord(dzial1.siedzibaIAdresPodmiotuZagranicznego)
      ? dzial1.siedzibaIAdresPodmiotuZagranicznego
      : {};

  const status = analyzeCurrentExtract(extract, rejestr, krs, today);
  const signalCodes = new Set(status.sygnaly.filter((s) => s.waga !== "informacja").map((s) => s.kod));
  const identyfikatory = isRecord(danePodmiotu?.identyfikatory) ? danePodmiotu.identyfikatory : {};

  const organNadzoru = asItems(extract.odpis?.dane?.dzial2?.organNadzoru)
    .filter(hasContent)
    .map((organ) => ({ nazwa: str(organ.nazwa) ?? "ORGAN NADZORU", liczbaCzlonkow: asItems(organ.sklad).length }));

  return {
    krs: naglowek?.numerKRS ?? krs,
    rejestr,
    nazwa: getEntityName(extract) ?? null,
    formaPrawna: currentFieldValue(danePodmiotu?.formaPrawna, "formaPrawna") ?? null,
    identyfikatory: (compact({
      nip: str(identyfikatory.nip),
      regon: str(identyfikatory.regon),
      statusNip: str(identyfikatory.statusNip),
      dataDecyzjiWSprawieNip: str(identyfikatory.dataDecyzji),
    }) ?? {}) as Record<string, string>,
    stanZDnia: naglowek?.stanZDnia ?? null,
    dataRejestracjiWKRS: naglowek?.dataRejestracjiWKRS ?? null,
    status: { ocena: status.ocena, podsumowanie: status.podsumowanie, sygnaly: [...signalCodes] },
    siedziba: formatSeat(siedzibaIAdres.siedziba),
    adres: formatAddress(siedzibaIAdres.adres),
    kontakt: compact({
      www: str(siedzibaIAdres.adresStronyInternetowej),
      email: str(siedzibaIAdres.adresPocztyElektronicznej),
      adresDoDoreczenElektronicznych: str(siedzibaIAdres.adresDoDoreczenElektronicznychWpisanyDoBAE),
    }) as Record<string, string> | undefined,
    kapital: capital(extract),
    reprezentacja: representation(extract, signalCodes),
    organNadzoru: organNadzoru.length ? organNadzoru : undefined,
    wlasciciele: owners(extract),
    dzialalnosc: activity(extract),
    organizacja: organization(extract),
    inne: other(extract),
    uwagi: NOTES,
  };
}
