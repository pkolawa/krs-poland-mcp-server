import { KrsExtract } from "../types/krs.js";

export function formatCompanyHeadline(extract: KrsExtract): string {
  // The JSON structure differs by section; we pick common safe fields if present:
  const krs = extract?.dzial1?.danePodstawowe?.numerKRS ?? extract?.podstawoweDane?.numerKRS ?? "KRS ?";
  const name =
    extract?.dzial1?.danePodstawowe?.nazwa ??
    extract?.podstawoweDane?.nazwa ??
    extract?.nazwa ??
    "Nieznana nazwa";

  return `${name} (KRS ${krs})`;
}