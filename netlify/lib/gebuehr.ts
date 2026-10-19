// Freischaltgebühr für Betriebe (gilt erst nach Ankündigung und Zustimmung, siehe Bedingungen Abschnitt 3):
// Der Betrieb zahlt einmal, wenn der Auftraggeber sein Angebot angenommen hat, und bekommt dann die Kontaktdaten.
// Die Stufe richtet sich nach dem Budget des Auftraggebers (sonst nach dem Angebotspreis), bei regelmäßigen
// Aufträgen nach dem Wert des ersten Jahres. Gründungspartner (die ersten 30 festen Partner) zahlen dauerhaft die Hälfte.
export const STUFEN = [
  { nr: 1, bis: 500, preis: 9, text: "bis 500 €" },
  { nr: 2, bis: 2000, preis: 29, text: "bis 2.000 €" },
  { nr: 3, bis: 10000, preis: 69, text: "bis 10.000 €" },
  { nr: 4, bis: Infinity, preis: 129, text: "über 10.000 € oder große Daueraufträge" },
];
export const GRUENDER_RABATT = 0.5;
export const GRUENDER_PLAETZE = 30;

const cent = (n: number) => Math.round(n * 100) / 100;

// Größte Zahl aus einem Budget-Text, z. B. „1.000–2.000 €“ → 2000, „ca. 400 € im Monat“ → 400 (× 12 bei Monatsbeträgen)
export function budgetWert(text: string | null | undefined, art: string): number | null {
  const s = String(text || "").toLowerCase();
  const zahlen = [...s.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(k|tsd|tausend)?/g)]
    .map((m) => Number(m[1].replace(/[.\s]/g, "")) * (m[3] ? 1000 : 1))
    .filter((n) => n > 0 && n < 100_000_000);
  if (!zahlen.length) return null;
  const max = Math.max(...zahlen);
  const monatlich = art === "langzeit" || /monat|mtl|\/\s*m\b/.test(s);
  return monatlich ? max * 12 : max;
}

// Auftragswert aus einem Angebot: bei regelmäßigen Aufträgen Monatspreis × 12 (= erstes Vertragsjahr)
export function auftragswert(art: string, betrag: number | null): number | null {
  if (!betrag) return null;
  return art === "langzeit" ? cent(betrag * 12) : betrag;
}

export function stufeFuer(wert: number | null): number {
  if (!wert) return 2;
  return (STUFEN.find((s) => wert <= s.bis) || STUFEN[3]).nr;
}

// Freischaltgebühr: Stufe aus (1) Hand-Einstellung im Büro, (2) Budget des Kunden, (3) Angebotspreis
export function freischaltung(o: { art: string; budget?: string | null; betrag?: number | null; wert?: number | null; stufe?: number | null; gruender?: boolean }) {
  const ausBudget = budgetWert(o.budget, o.art);
  const ausAngebot = o.wert ?? auftragswert(o.art, o.betrag ?? null);
  const wert = ausBudget ?? ausAngebot;
  const nr = o.stufe && o.stufe >= 1 && o.stufe <= 4 ? o.stufe : stufeFuer(wert);
  const s = STUFEN[nr - 1];
  const preis = o.gruender ? cent(s.preis * GRUENDER_RABATT) : s.preis;
  return { stufe: nr, grundpreis: s.preis, preis, rabatt: !!o.gruender, wert, quelle: o.stufe ? "hand" : ausBudget != null ? "budget" : ausAngebot != null ? "angebot" : "standard" };
}

// Kompatibel zu älterem Code: Gebühr ohne Rabatt nach Auftragswert
export function gebuehr(art: string, wert: number | null): number | null {
  return STUFEN[stufeFuer(wert) - 1].preis;
}
