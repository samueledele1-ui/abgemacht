// Vermittlungsgebühr für Betriebe (gilt erst ab dem Datum „Gebühren ab“ und nach Zustimmung, siehe Bedingungen Abschnitt 3):
// Der Betrieb zahlt nur, wenn der Auftraggeber sein Angebot angenommen hat.
//   Einzelaufträge und Projekte: 5 % vom angenommenen Angebotspreis (bei einer Spanne der obere Wert), ohne Obergrenze.
//   Regelmäßige Aufträge: wahlweise einmal ein Monatsumsatz oder 8 % vom Monatspreis, monatlich für höchstens 24 Monate.
// Gründungspartner (die ersten 30 festen Partner) zahlen dauerhaft die Hälfte.
export const SATZ_EINZEL = 0.05;
export const SATZ_DAUER = 0.08;
export const DAUER_MONATE = 24;
export const GRUENDER_RABATT = 0.5;
export const GRUENDER_PLAETZE = 30;
export const DAUER_MODELLE = ["einmal", "monatlich"] as const;
export const MODELL_TEXT = {
  einzel: "5 % vom angenommenen Angebotspreis, ohne Obergrenze",
  einmal: "einmalig ein Monatsumsatz (Ihr Monatspreis)",
  monatlich: "8 % vom Monatspreis, monatlich für höchstens 24 Monate",
};

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

export const dauerModell = (v: unknown): "einmal" | "monatlich" => (v === "monatlich" ? "monatlich" : "einmal");

/* Gebühr bei Annahme.
   betrag = Angebotspreis (oberer Wert, bei regelmäßigen Aufträgen pro Monat)
   wert   = Auftragswert (bei regelmäßigen Aufträgen erstes Vertragsjahr), falls kein Angebotspreis vorliegt
   hand   = von Samuel im Büro festgelegte Gebühr (hat Vorrang)
   Rückgabe: preis = was bei der Freischaltung fällig ist (bei „monatlich“ die erste Monatsrate) */
export function freischaltung(o: { art: string; budget?: string | null; betrag?: number | null; wert?: number | null; hand?: number | null; gruender?: boolean; dauer_modell?: string | null }) {
  const lang = o.art === "langzeit";
  const modell = lang ? dauerModell(o.dauer_modell) : null;
  const ausBudget = budgetWert(o.budget, o.art);
  const wert = o.betrag != null ? (lang ? cent(o.betrag * 12) : o.betrag) : o.wert ?? ausBudget;
  const quelle = o.hand != null ? "hand" : o.betrag != null ? "angebot" : o.wert != null ? "wert" : ausBudget != null ? "budget" : "offen";
  const monatspreis = lang && wert != null ? cent(wert / 12) : null;
  let grundpreis = 0;
  if (lang) grundpreis = monatspreis == null ? 0 : modell === "monatlich" ? cent(monatspreis * SATZ_DAUER) : monatspreis;
  else grundpreis = wert == null ? 0 : cent(wert * SATZ_EINZEL);
  const rabatt = !!o.gruender;
  let preis = rabatt ? cent(grundpreis * GRUENDER_RABATT) : grundpreis;
  if (o.hand != null && Number.isFinite(Number(o.hand))) preis = cent(Math.max(0, Number(o.hand)));
  return {
    preis, grundpreis, rabatt, wert, quelle, monatspreis, modell,
    satz: lang ? (modell === "monatlich" ? SATZ_DAUER : null) : SATZ_EINZEL,
    raten: lang && modell === "monatlich" ? DAUER_MONATE : 1,
  };
}

// Monatsrate bei „8 % monatlich“ (gleich hoch wie die erste Rate)
export function monatsrate(v: { gebuehr?: number | string | null }) {
  return v.gebuehr == null ? 0 : cent(Number(v.gebuehr));
}

// Kompatibel zu älterem Code: Gebühr ohne Rabatt nach Auftragswert
export function gebuehr(art: string, wert: number | null): number | null {
  return freischaltung({ art, wert }).grundpreis;
}
