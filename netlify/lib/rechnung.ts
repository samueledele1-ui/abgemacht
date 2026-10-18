import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Erzeugt das Rechnungs-PDF (A4, DIN-5008-ähnlich). Wird nur einmal beim Erstellen aufgerufen,
// danach liegt das PDF unveränderbar in der Datenbank (GoBD).

export type Absender = {
  name: string; firma?: string; strasse: string; plz_ort: string; email?: string; telefon?: string;
  steuernummer: string; iban?: string; bic?: string; bank?: string; kleinunternehmer: boolean; zahlungsziel: number;
};
export type Empfaenger = { firma: string; ansprechpartner?: string | null; adresse: string; email?: string | null };
export type Position = { text: string; datum?: string | null; betrag: number };
export type RechnungDaten = {
  art: "rechnung" | "storno"; nummer: string; datum: Date; leistungszeitraum: string;
  absender: Absender; empfaenger: Empfaenger; positionen: Position[]; summe: number; storno_zu_nummer?: string | null;
};

const TANNE = rgb(13 / 255, 79 / 255, 62 / 255);
const GRAU = rgb(85 / 255, 102 / 255, 95 / 255);
const LINIE = rgb(220 / 255, 229 / 255, 224 / 255);
const SCHWARZ = rgb(18 / 255, 32 / 255, 27 / 255);

export const euro = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
export const datumDE = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

// Nur Zeichen, die die Standardschrift (WinAnsi) darstellen kann; alles andere wird ersetzt
function sauber(font: PDFFont, s: string) {
  let out = "";
  for (const ch of String(s ?? "").replace(/\s+/g, " ")) {
    try { font.encodeText(ch); out += ch; } catch { out += ch === "→" ? "->" : ""; }
  }
  return out;
}

function umbrechen(font: PDFFont, text: string, size: number, breite: number) {
  const zeilen: string[] = [];
  for (const absatz of text.split("\n")) {
    let z = "";
    for (const wort of sauber(font, absatz).split(" ")) {
      const probe = z ? z + " " + wort : wort;
      if (font.widthOfTextAtSize(probe, size) > breite && z) { zeilen.push(z); z = wort; } else z = probe;
    }
    zeilen.push(z);
  }
  return zeilen;
}

export async function rechnungPdf(r: RechnungDaten): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${r.art === "storno" ? "Stornorechnung" : "Rechnung"} ${r.nummer}`);
  doc.setAuthor(r.absender.firma ? `${r.absender.firma} – ${r.absender.name}` : r.absender.name);
  doc.setCreator("Abgemacht Vermittlung");
  doc.setCreationDate(r.datum);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const B = 595.28, H = 841.89, L = 62, R = B - 56;
  let page: PDFPage = doc.addPage([B, H]);
  const t = (s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: any; rechts?: boolean } = {}) => {
    const font = o.bold ? fb : f, size = o.size ?? 10, txt = sauber(font, s);
    const xx = o.rechts ? x - font.widthOfTextAtSize(txt, size) : x;
    page.drawText(txt, { x: xx, y, size, font, color: o.color ?? SCHWARZ });
  };
  const a = r.absender;
  const absName = a.firma ? `${a.firma} · ${a.name}` : a.name;

  // Kopf
  t(a.firma || a.name, L, H - 70, { size: 20, bold: true, color: TANNE });
  if (a.firma) t(`Inhaber ${a.name}`, L, H - 86, { size: 9, color: GRAU });
  const kopfRechts = [a.strasse, a.plz_ort, a.telefon ? "Tel. " + a.telefon : "", a.email || ""].filter(Boolean);
  kopfRechts.forEach((z, i) => t(z, R, H - 62 - i * 12, { size: 9, color: GRAU, rechts: true }));

  // Anschrift (Fenster-Bereich)
  let y = H - 150;
  t(`${absName} · ${a.strasse} · ${a.plz_ort}`, L, y, { size: 7, color: GRAU });
  y -= 18;
  const anschrift = [r.empfaenger.firma, r.empfaenger.ansprechpartner ? "z. Hd. " + r.empfaenger.ansprechpartner : "", ...String(r.empfaenger.adresse || "").split(/\n|,\s*(?=\d{5}\b)/)]
    .map((s) => (s || "").trim()).filter(Boolean);
  anschrift.forEach((z) => { t(z, L, y, { size: 10.5 }); y -= 14; });

  // Infoblock rechts
  const info: [string, string][] = [
    [r.art === "storno" ? "Storno-Nr." : "Rechnungs-Nr.", r.nummer],
    ["Rechnungsdatum", datumDE(r.datum)],
    ["Leistungszeitraum", r.leistungszeitraum],
    ["Steuernummer", a.steuernummer],
  ];
  if (r.storno_zu_nummer) info.splice(1, 0, ["zu Rechnung", r.storno_zu_nummer]);
  let yi = H - 168;
  for (const [k, v] of info) { t(k, R - 190, yi, { size: 9, color: GRAU }); t(v, R, yi, { size: 9, bold: true, rechts: true }); yi -= 13; }

  // Titel
  y = Math.min(y, yi) - 34;
  t(r.art === "storno" ? `Stornorechnung zu Rechnung ${r.storno_zu_nummer}` : `Rechnung ${r.nummer}`, L, y, { size: 16, bold: true });
  y -= 22;
  const einleitung = r.art === "storno"
    ? "Hiermit stornieren wir die oben genannte Rechnung vollständig. Bereits gezahlte Beträge erstatten wir."
    : `für die Vermittlung von Aufträgen über Abgemacht im Leistungszeitraum ${r.leistungszeitraum} berechnen wir Ihnen folgende Vermittlungsgebühren:`;
  for (const z of umbrechen(f, (r.art === "storno" ? "" : "Sehr geehrte Damen und Herren,\n") + einleitung, 10, R - L)) { t(z, L, y); y -= 14; }
  y -= 10;

  // Tabelle
  const kopfzeile = () => {
    page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 20, color: rgb(241 / 255, 245 / 255, 243 / 255) });
    t("Pos.", L + 6, y, { size: 9, bold: true, color: GRAU });
    t("Leistung", L + 40, y, { size: 9, bold: true, color: GRAU });
    t("Betrag", R - 6, y, { size: 9, bold: true, color: GRAU, rechts: true });
    y -= 24;
  };
  kopfzeile();
  r.positionen.forEach((p, i) => {
    const zeilen = umbrechen(f, p.text, 9.5, R - L - 140);
    if (y - zeilen.length * 12 < 150) { page = doc.addPage([B, H]); y = H - 70; kopfzeile(); }
    t(String(i + 1), L + 6, y, { size: 9.5 });
    zeilen.forEach((z, j) => t(z, L + 40, y - j * 12, { size: 9.5 }));
    t(euro(p.betrag), R - 6, y, { size: 9.5, rechts: true });
    y -= zeilen.length * 12;
    page.drawLine({ start: { x: L, y: y + 6 }, end: { x: R, y: y + 6 }, thickness: 0.5, color: LINIE });
    y -= 10;
  });
  y -= 8;
  t("Gesamtbetrag", R - 150, y, { size: 11, bold: true });
  t(euro(r.summe), R - 6, y, { size: 11, bold: true, rechts: true });
  page.drawLine({ start: { x: R - 150, y: y - 6 }, end: { x: R, y: y - 6 }, thickness: 1, color: SCHWARZ });
  y -= 30;

  // Hinweise
  const hinweise: string[] = [];
  if (a.kleinunternehmer) hinweise.push("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).");
  if (r.art === "rechnung") {
    const faellig = new Date(r.datum.getTime() + a.zahlungsziel * 864e5);
    hinweise.push(`Bitte überweisen Sie den Betrag bis zum ${datumDE(faellig)} ohne Abzug${a.iban ? ` auf das unten genannte Konto` : ""}. Verwendungszweck: ${r.nummer}.`);
  }
  hinweise.push("Der Leistungszeitpunkt entspricht dem jeweils angegebenen Vermittlungsdatum.");
  for (const h of hinweise) { for (const z of umbrechen(f, h, 9.5, R - L)) { if (y < 110) { page = doc.addPage([B, H]); y = H - 70; } t(z, L, y, { size: 9.5 }); y -= 13; } y -= 4; }
  y -= 8;
  if (r.art === "rechnung") { t("Vielen Dank für die Zusammenarbeit!", L, y, { size: 10 }); }

  // Fußzeile auf jeder Seite
  const seiten = doc.getPages();
  seiten.forEach((pg, i) => {
    page = pg;
    pg.drawLine({ start: { x: L, y: 78 }, end: { x: R, y: 78 }, thickness: 0.5, color: LINIE });
    const sp = [
      [absName, a.strasse, a.plz_ort],
      [a.telefon ? "Tel. " + a.telefon : "", a.email || "", "Steuernummer " + a.steuernummer],
      [a.bank || "", a.iban ? "IBAN " + a.iban : "", a.bic ? "BIC " + a.bic : ""],
    ];
    const w = (R - L) / 3;
    sp.forEach((col, ci) => col.filter(Boolean).forEach((z, zi) => t(z, L + ci * w, 64 - zi * 10, { size: 7.5, color: GRAU })));
    if (seiten.length > 1) t(`Seite ${i + 1} von ${seiten.length}`, R, 28, { size: 7.5, color: GRAU, rechts: true });
  });
  return await doc.save();
}
