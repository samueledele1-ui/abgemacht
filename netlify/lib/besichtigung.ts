// Besichtigung vor dem Angebot bei größeren Aufträgen.
// Der Betrieb bestätigt vorher Gebühr und Kundenschutz. Adresse und Ansprechpartner vor Ort bekommt er erst,
// wenn der Termin bestätigt ist (von Samuel im Büro oder vom festen Partner im Portal). Name und direkte Kontaktdaten
// des Auftraggebers bleiben bis zur Annahme eines Angebots verborgen.
import { budgetWert } from "./gebuehr.ts";
import { seite, adminMail, esc, mailLayout, knopf, absatz, gruss, tabelle, sendeMail } from "./post.ts";

export const GRENZE_STANDARD = 2000;

export async function grenze(sql: any): Promise<number> {
  const r = await sql`SELECT wert FROM einstellungen WHERE schluessel = 'besichtigung_ab'`;
  const n = Number(r[0]?.wert);
  return Number.isFinite(n) && n > 0 ? n : GRENZE_STANDARD;
}

// Möglich, wenn im Büro „ja“ gesetzt ist oder (ohne „nein“) der geschätzte Auftragswert die Grenze erreicht
export function moeglich(v: { besichtigung?: string | null; budget?: string | null; art?: string | null }, ab: number) {
  if (v.besichtigung === "ja") return true;
  if (v.besichtigung === "nein") return false;
  const w = budgetWert(v.budget, v.art || "einmalig");
  return w != null && w >= ab;
}

const TERMIN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const terminText = (t: string) => {
  if (!TERMIN_RE.test(t)) return t;
  const d = new Date(t + ":00");
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d) + " Uhr";
};
export function wunschTermine(roh: unknown): string[] {
  const l = (Array.isArray(roh) ? roh : []).map((x) => String(x || "").trim()).filter((x) => TERMIN_RE.test(x));
  return [...new Set(l)].slice(0, 3);
}

// Betrieb fragt eine Besichtigung an (oder ändert seine Wunschtermine)
export async function anfragen(sql: any, r: { id: number; nr: number; kontakt_id: number; firma: string; leistung?: string; ort?: string; kunde_id?: number | null }, termine: string[], nachricht: string | null) {
  const b = (await sql`INSERT INTO besichtigungen (vermittlung_id, vb_id, wunsch, nachricht, status, bedingungen_am)
      VALUES (${r.nr}, ${r.id}, ${termine}, ${nachricht}, 'angefragt', now())
      ON CONFLICT (vb_id) DO UPDATE SET wunsch = EXCLUDED.wunsch, nachricht = EXCLUDED.nachricht, status = 'angefragt', termin = NULL, bestaetigt_am = NULL, updated_at = now()
      RETURNING id`)[0];
  await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r.kontakt_id}, 'vermittlung', ${"Besichtigung angefragt zu Anfrage #" + r.nr + ": " + termine.map(terminText).join(", ") + " (Gebühr und Kundenschutz bestätigt)"})`;
  const zeilen: [string, string | null][] = [["Anfrage", `#${r.nr} ${r.leistung || ""}${r.ort ? ", " + r.ort : ""}`], ["Betrieb", r.firma], ["Wunschtermine", termine.map(terminText).join("\n")], ["Nachricht", nachricht]];
  await sendeMail(adminMail(), "Samuel", `Besichtigung gewünscht #${r.nr}: ${r.firma}`, mailLayout(
    absatz(`<b>${esc(r.firma)}</b> möchte das Objekt vor dem Angebot ansehen. Gebühr und Kundenschutz hat der Betrieb bestätigt.`) + tabelle(zeilen) +
    absatz(r.kunde_id ? "Der Auftraggeber ist fester Partner und kann den Termin selbst im Portal bestätigen. Du kannst es auch im Büro machen." : "Bitte den Termin mit dem Auftraggeber abstimmen und in der Vermittlung bestätigen.") +
    knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
  if (r.kunde_id) {
    const an = await sql`SELECT email, name FROM kunden_zugaenge WHERE kunde_id = ${r.kunde_id} AND aktiv AND pw_hash IS NOT NULL`;
    for (const z of an) await sendeMail(z.email, z.name, `Besichtigung gewünscht: ${r.leistung || "Anfrage #" + r.nr}`, mailLayout(
      absatz(`Guten Tag${z.name ? " " + esc(z.name) : ""},`) +
      absatz(`ein Betrieb möchte sich das Objekt für Ihre Anfrage „${esc(r.leistung || "")}“ vor seinem Angebot ansehen. Wunschtermine:`) +
      tabelle(termine.map((t, i) => [`Termin ${i + 1}`, terminText(t)])) +
      absatz("Bestätigen Sie einen Termin im Portal oder schlagen Sie einen anderen vor. Erst nach Ihrer Bestätigung bekommt der Betrieb die Adresse und den Ansprechpartner vor Ort.") +
      knopf(`${seite()}/portal`, "Im Portal öffnen") + gruss));
  }
  return b.id;
}

// Termin bestätigen, ablehnen oder einen anderen vorschlagen (Büro oder Portal; einen Vorschlag kann der Betrieb annehmen). Bei Bestätigung bekommt der Betrieb Adresse und Ansprechpartner vor Ort.
export async function setzen(sql: any, bid: number, status: "bestaetigt" | "abgelehnt" | "vorschlag", termin: string | null, von: string, nachricht?: string | null) {
  const b = (await sql`SELECT b.*, vb.token, vb.kontakt_id, k.firma, k.ansprechpartner, k.email, v.leistung, v.ort, v.objekt_adresse, v.vor_ort, v.id AS vid
      FROM besichtigungen b JOIN vermittlung_betriebe vb ON vb.id = b.vb_id JOIN crm_kontakte k ON k.id = vb.kontakt_id JOIN vermittlungen v ON v.id = b.vermittlung_id
      WHERE b.id = ${bid}`)[0];
  if (!b) return { ok: false, fehler: "Besichtigung nicht gefunden." };
  const t = termin && termin.trim() ? termin.trim().slice(0, 120) : status === "bestaetigt" ? (b.wunsch?.[0] || null) : null;
  if ((status === "bestaetigt" || status === "vorschlag") && !t) return { ok: false, fehler: "Bitte einen Termin wählen." };
  if (status === "bestaetigt" && !(b.objekt_adresse || "").trim()) return { ok: false, fehler: "Bitte zuerst die Adresse des Objekts in der Anfrage eintragen, damit der Betrieb weiß, wohin." };
  await sql`UPDATE besichtigungen SET status = ${status}, termin = ${t}, bestaetigt_am = CASE WHEN ${status}::text = 'bestaetigt' THEN now() ELSE NULL END,
      bestaetigt_von = ${von}, nachricht = COALESCE(${nachricht ?? null}, nachricht), updated_at = now() WHERE id = ${bid}`;
  await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${b.kontakt_id}, 'vermittlung', ${"Besichtigung zu Anfrage #" + b.vid + " " + (status === "bestaetigt" ? "bestätigt: " + terminText(t!) : status === "abgelehnt" ? "abgelehnt" : "neuer Vorschlag: " + (t ? terminText(t) : "")) + " (" + von + ")"})`;
  if (b.email) {
    const link = `${seite()}/angebot?t=${b.token}`;
    const inhalt = status === "bestaetigt"
      ? absatz(`Ihre Besichtigung für „${esc(b.leistung || "")}“ ist bestätigt:`) +
        tabelle([["Termin", terminText(t!)], ["Adresse", b.objekt_adresse], ["Vor Ort", b.vor_ort]]) +
        absatz("Bitte geben Sie danach Ihr Angebot über den Knopf ab. Name und Kontaktdaten des Auftraggebers bekommen Sie, sobald er Ihr Angebot annimmt. Es gilt der Kundenschutz aus den Bedingungen.")
      : status === "abgelehnt"
      ? absatz(`Für „${esc(b.leistung || "")}“ ist eine Besichtigung leider nicht möglich.${nachricht ? " " + esc(nachricht) : ""} Sie können Ihr Angebot trotzdem nach den Angaben und Fotos abgeben, gern auch als Preisspanne.`)
      : absatz(`Für die Besichtigung zu „${esc(b.leistung || "")}“ gibt es einen anderen Terminvorschlag: <b>${esc(t ? terminText(t) : "")}</b>.${nachricht ? " " + esc(nachricht) : ""} Passt er, geben Sie das bitte auf der Anfrage-Seite an.`);
    await sendeMail(b.email, b.ansprechpartner || b.firma, `Besichtigung ${status === "bestaetigt" ? "bestätigt" : status === "abgelehnt" ? "nicht möglich" : "neuer Vorschlag"}: ${b.leistung || "Anfrage #" + b.vid}`, mailLayout(
      absatz(`Guten Tag${b.ansprechpartner ? " " + esc(b.ansprechpartner) : ""},`) + inhalt + knopf(link, "Zur Anfrage") + gruss));
  }
  if (von !== "Büro") await sendeMail(adminMail(), "Samuel", `Besichtigung ${status === "bestaetigt" ? "bestätigt" : status === "abgelehnt" ? "abgelehnt" : "neuer Vorschlag"} #${b.vid}: ${b.firma}`, mailLayout(
    absatz(`${esc(von)}: Besichtigung zu Anfrage #${b.vid} (${esc(b.leistung || "")}) mit <b>${esc(b.firma)}</b> ${status === "bestaetigt" ? "bestätigt für " + esc(terminText(t!)) : status === "abgelehnt" ? "abgelehnt" : "neuer Vorschlag: " + esc(t ? terminText(t) : "")}.`) +
    knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
  return { ok: true };
}
