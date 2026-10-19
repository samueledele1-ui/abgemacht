// Gebührenmodell für Betriebe (gilt erst nach Ankündigung und Zustimmung, siehe Bedingungen Abschnitt 3)
//  Einmalig / Projekt:  bis 500 € → 9 €, bis 2.000 € → 29 €, darüber 3 % vom Auftragswert, höchstens 400 €
//  Regelmäßig (Dauerauftrag): einmalig 3 % vom Wert des ersten Vertragsjahres, mindestens 199 €, höchstens 1.500 €
export const SATZ = 0.03;
export const DECKEL_EINZEL = 400;
export const DAUER_MIN = 199;
export const DAUER_MAX = 1500;

const cent = (n: number) => Math.round(n * 100) / 100;

export function gebuehr(art: string, wert: number | null): number | null {
  if (art === "langzeit") {
    if (!wert) return DAUER_MIN;
    return cent(Math.min(DAUER_MAX, Math.max(DAUER_MIN, wert * SATZ)));
  }
  if (!wert) return null;
  if (wert <= 500) return 9;
  if (wert <= 2000) return 29;
  return cent(Math.min(DECKEL_EINZEL, wert * SATZ));
}

// Auftragswert aus einem Angebot: bei regelmäßigen Aufträgen Monatspreis × 12 (= erstes Vertragsjahr)
export function auftragswert(art: string, betrag: number | null): number | null {
  if (!betrag) return null;
  return art === "langzeit" ? cent(betrag * 12) : betrag;
}
