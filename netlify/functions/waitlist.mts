import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";
import ical from "node-ical";
import { empfehlerZuCode } from "../lib/empfehlung.ts";
import { nachweisPruefen } from "../lib/nachweis.ts";
import { alsText } from "../lib/post.ts";

// Eine Funktion für alles rund um die Warteliste:
//   GET  /api/waitlist     -> Anzahl bestätigter Anmeldungen
//   POST /api/waitlist     -> Anmeldung speichern, Bestätigungs-Mail schicken
//   POST /api/bestaetigen  -> Klick aus der Bestätigungs-Mail (Double-Opt-in)
//   POST /api/abmelden     -> Abmeldung aus jeder Mail
//   POST /api/umfrage      -> Antworten der Umfrage auf /umfrage (+ Benachrichtigung an Samuel, Terminvorschläge an Teilnehmer)
//   POST /api/termin       -> Terminvorschläge abrufen bzw. Termin festmachen (Seite /termin)

const TYPEN = ["auftraggeber", "anbieter", "beides", "firma", "selbststaendig", "mitarbeiter", "privat"];
const QUELLEN = ["direkt", "umfrage", "ig", "tt", "li", "wa", "telefon", "seo", "karte", "flyer"];
const TOKEN_RE = /^[a-f0-9]{64}$/;

const clip = (v: unknown, n = 120): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fehler = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status });
const neuerToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
const seite = () => (Netlify.env.get("PUBLIC_URL") || "https://ab-gemacht.info").replace(/\/$/, "");

/* ---------- E-Mail über Brevo (nur aktiv, wenn BREVO_API_KEY gesetzt ist) ---------- */

async function brevo(path: string, method: string, body?: unknown) {
  const key = Netlify.env.get("BREVO_API_KEY");
  if (!key) return null;
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) console.error("Brevo", path, res.status, await res.text());
  return res;
}

function mailLayout(inhalt: string, abmeldeLink?: string) {
  const fuss = `Abgemacht · Samuel Edele · Fliederweg 15 · 89250 Senden<br>` +
    (abmeldeLink ? `<a href="${abmeldeLink}" style="color:#5B6B65">Von der Warteliste abmelden</a>` : "");
  return `<!doctype html><html lang="de"><body style="margin:0;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#14231E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E2E8E5;border-radius:16px">
<tr><td style="padding:24px 28px 0;font-size:20px;font-weight:bold"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;background:#0D4F3E;color:#F2B33D;border-radius:9px;font-size:19px;font-weight:bold;vertical-align:middle;margin-right:8px">&#10003;</span>Abgemacht</td></tr>
<tr><td style="padding:16px 28px 28px;font-size:16px;line-height:1.55">${inhalt}</td></tr>
</table>
<p style="max-width:520px;font-size:12px;line-height:1.5;color:#5B6B65;margin:16px auto 0">${fuss}</p>
</td></tr></table></body></html>`;
}

const knopf = (href: string, text: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#138A6B;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:999px">${text}</a></p>`;

async function sendeMail(an: string, name: string | null, betreff: string, html: string, abmeldeLink?: string, anhang?: { name: string; text: string }) {
  // Kopien an MAIL_ADMIN_KOPIE als eigene Mail (nicht Bcc, das landet bei web.de eher im Spam)
  const ok = await sendeEinzeln(an, name, betreff, html, abmeldeLink, anhang);
  for (const k of adminKopie(an)) await sendeEinzeln(k.email, null, betreff, html, undefined, anhang);
  return ok;
}

async function sendeEinzeln(an: string, name: string | null, betreff: string, html: string, abmeldeLink?: string, anhang?: { name: string; text: string }) {
  const res = await brevo("/smtp/email", "POST", {
    ...(anhang ? { attachment: [{ name: anhang.name, content: Buffer.from(anhang.text, "utf-8").toString("base64") }] } : {}),
    sender: { name: "Abgemacht", email: Netlify.env.get("MAIL_FROM") || "hallo@abgemacht.de" },
    replyTo: { email: Netlify.env.get("MAIL_REPLY_TO") || "samuel.edele1@gmail.com", name: "Samuel von Abgemacht" },
    to: [name ? { email: an, name } : { email: an }],
    subject: betreff,
    htmlContent: html,
    textContent: alsText(html),
    ...(abmeldeLink ? { headers: { "List-Unsubscribe": `<${abmeldeLink}>` } } : {}),
  });
  return !!res && res.ok;
}

function bestaetigungsMail(name: string | null, token: string) {
  const link = `${seite()}/bestaetigen?t=${token}`;
  return mailLayout(
    `<p style="margin:0 0 12px">Hallo${name ? " " + esc(name) : ""},</p>
<p style="margin:0 0 12px">vielen Dank für Ihr Interesse an Abgemacht! Bitte bestätigen Sie Ihre Anmeldung mit einem Klick.</p>
${knopf(link, "Anmeldung bestätigen")}
<p style="margin:0;font-size:14px;color:#5B6B65">Sie haben sich nicht eingetragen? Dann ignorieren Sie diese E-Mail einfach. Ohne Bestätigung löschen wir Ihre Adresse nach 30 Tagen.</p>`
  );
}

function willkommensMail(name: string | null, token: string) {
  const abmelden = `${seite()}/abmelden?t=${token}`;
  return mailLayout(
    `<p style="margin:0 0 12px">Hallo${name ? " " + esc(name) : ""},</p>
<p style="margin:0 0 12px"><b>Abgemacht!</b> Ihre Anmeldung ist bestätigt.</p>
<p style="margin:0 0 12px">So funktioniert Abgemacht: Sie schreiben in einem Satz, was Sie brauchen, wir fragen passende Betriebe an, und Sie sagen beim besten Angebot einfach „Abgemacht“. Einmalig, als Projekt oder langfristig, für alle Branchen.</p>
<p style="margin:0 0 12px">Sie bieten selbst Leistungen an? Dann bekommen Sie passende Anfragen und zahlen nur, wenn ein Auftrag zustande kommt. In der Startphase ist alles kostenlos.</p>
<p style="margin:0 0 12px">Je mehr Betriebe und Auftraggeber dabei sind, desto mehr bringt Ihnen Abgemacht. Leiten Sie diesen Link gern weiter:</p>
${knopf(`${seite()}/wa`, "Abgemacht weiterempfehlen")}
<p style="margin:0">Bis bald<br>Samuel von Abgemacht</p>`,
    abmelden
  );
}


/* ---------- Interessierte Betriebe automatisch ins CRM (Vermittlung → Partner-Betriebe → Interessenten) ---------- */
async function crmInteressent(sql: any, d: { email?: string | null; telefon?: string | null; name?: string | null; firma?: string | null; leistungen?: string | null; branche?: string | null; ort?: string | null; typ?: string | null; quelle: string; notiz: string }): Promise<number | null> {
  if (!["anbieter", "beides"].includes(String(d.typ))) return null;
  try {
    const email = d.email ? d.email.toLowerCase() : null;
    const ziffern = d.telefon ? d.telefon.replace(/\D/g, "") : null;
    if (!email && !ziffern) return null;
    const vorh = await sql`SELECT id FROM crm_kontakte
      WHERE (${email}::text IS NOT NULL AND (lower(email) = ${email}::text OR lower(warteliste_email) = ${email}::text))
         OR (${ziffern}::text IS NOT NULL AND length(${ziffern}::text) >= 6 AND regexp_replace(coalesce(telefon, ''), '\D', '', 'g') = ${ziffern}::text)
      ORDER BY id LIMIT 1`;
    const notiz = `${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }).format(new Date())}: ${d.notiz}`;
    if (vorh.length) {
      const id = vorh[0].id;
      await sql`UPDATE crm_kontakte SET partner = COALESCE(partner, 'interessiert'), kategorie = COALESCE(kategorie, ${d.branche ?? null}),
        ort = COALESCE(ort, ${d.ort ?? null}), warteliste_email = COALESCE(warteliste_email, ${email}),
        leistungen = COALESCE(leistungen, ${d.leistungen ?? null}), ansprechpartner = COALESCE(ansprechpartner, ${d.firma ? d.name ?? null : null}),
        notizen = CASE WHEN notizen IS NULL OR notizen = '' THEN ${notiz} ELSE notizen || E'\n' || ${notiz} END, updated_at = now() WHERE id = ${id}`;
      await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${id}, 'partner', ${d.notiz})`;
      return id;
    } else {
      const r = await sql`INSERT INTO crm_kontakte (firma, kategorie, ansprechpartner, telefon, email, ort, notizen, warteliste_email, quelle, status, partner, naechster_kontakt, leistungen)
        VALUES (${d.firma || d.name || email || d.telefon}, ${d.branche ?? null}, ${d.name ?? null}, ${d.telefon ?? null}, ${email}, ${d.ort ?? null}, ${notiz}, ${email},
                ${d.quelle}, 'neu', 'interessiert', now(), ${d.leistungen ?? null}) RETURNING id`;
      await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r[0].id}, 'partner', ${d.notiz})`;
      return r[0].id;
    }
  } catch (e) {
    console.error("crmInteressent", e);
  }
  return null;
}

/* ---------- Termine (Zeitzone Berlin) ---------- */

const TZ = "Europe/Berlin";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const adminMail = () => Netlify.env.get("MAIL_ADMIN") || "hallo@ab-gemacht.info";
// Weitere Empfänger für jede Büro-Mail (Netlify-Variable MAIL_ADMIN_KOPIE, mehrere mit Komma)
const adminKopie = (an: string) => an.toLowerCase() !== adminMail().toLowerCase() ? [] :
  (Netlify.env.get("MAIL_ADMIN_KOPIE") || "").split(",").map((e) => e.trim()).filter((e) => EMAIL_RE.test(e) && e.toLowerCase() !== an.toLowerCase()).map((email) => ({ email }));

function berlinTeile(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
// Uhrzeit in Berlin -> echter Zeitpunkt (beachtet Sommer- und Winterzeit)
function berlinZeit(y: number, m: number, d: number, h: number, min: number) {
  const roh = Date.UTC(y, m - 1, d, h, min);
  const t = berlinTeile(new Date(roh));
  const versatz = Date.UTC(t.y, t.m - 1, t.d, t.h, t.min) - roh;
  return new Date(roh - versatz);
}
const terminText = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d) + " Uhr";

/* Belegte Zeiten aus dem Google Kalender (geheime iCal-Adresse in KALENDER_ICS, mehrere durch Komma getrennt).
   Gibt null zurück, wenn kein Kalender eingerichtet oder einer nicht erreichbar ist. */
type Zeitraum = [number, number];
async function belegteZeiten(von: Date, bis: Date): Promise<Zeitraum[] | null> {
  const urls = (Netlify.env.get("KALENDER_ICS") || "").split(/[\s,]+/).filter((u) => /^https:\/\//.test(u));
  if (!urls.length) return null;
  const out: Zeitraum[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const daten = await ical.async.parseICS(await res.text());
      for (const e of Object.values(daten) as any[]) {
        if (!e || e.type !== "VEVENT" || e.transparency === "TRANSPARENT" || e.status === "CANCELLED") continue;
        for (const i of ical.expandRecurringEvent(e, { from: von, to: bis, expandOngoing: true }) as any[]) {
          const s = new Date(i.start).getTime();
          out.push([s, i.end ? new Date(i.end).getTime() : s + 3600e3]);
        }
      }
    } catch (err) {
      console.error("Kalender nicht lesbar", String(err));
      return null;
    }
  }
  return out;
}

const DAUER = 15 * 60e3; // Länge des Gesprächs
const PUFFER = 15 * 60e3; // Abstand zu anderen Terminen

function istFrei(start: number, belegt: Zeitraum[] | null, gebucht: number[]) {
  if (gebucht.some((g) => Math.abs(g - start) < DAUER + PUFFER)) return false;
  if (!belegt) return true;
  return !belegt.some(([s, e]) => s < start + DAUER + PUFFER && e > start - PUFFER);
}

// 4 Vorschläge an verschiedenen Tagen, frühestens 18 Stunden ab jetzt, nur in freien Lücken des Kalenders.
// Arbeitszeit (ARBEITSZEIT, Standard 09:00-18:30 als letzter Beginn) und Tage (TERMIN_TAGE, Standard 1-5 = Mo-Fr) einstellbar.
function terminVorschlaege(belegt: Zeitraum[] | null, gebucht: number[], jetzt = new Date()) {
  const [ab, bis] = (Netlify.env.get("ARBEITSZEIT") || "09:00-18:30").split("-").map((z) => {
    const [h, m] = z.trim().split(":").map(Number);
    return h * 60 + (m || 0);
  });
  const tage = (Netlify.env.get("TERMIN_TAGE") || "1,2,3,4,5").split(",").map(Number);
  const ziele = [10 * 60, 14 * 60, 11 * 60 + 30, 16 * 60 + 30, 9 * 60 + 30, 17 * 60 + 30];
  const heute = berlinTeile(jetzt);
  const out: Date[] = [];
  let n = 0;
  for (let tag = 1; tag <= 28 && out.length < 4; tag++) {
    const basis = new Date(Date.UTC(heute.y, heute.m - 1, heute.d + tag, 12));
    if (!tage.includes(basis.getUTCDay() === 0 ? 7 : basis.getUTCDay())) continue;
    const ziel = ziele[n % ziele.length];
    let beste: Date | null = null, abstand = Infinity;
    for (let min = ab; min <= bis; min += 30) {
      const slot = berlinZeit(basis.getUTCFullYear(), basis.getUTCMonth() + 1, basis.getUTCDate(), Math.floor(min / 60), min % 60);
      if (slot.getTime() - jetzt.getTime() < 18 * 3600e3 || !istFrei(slot.getTime(), belegt, gebucht)) continue;
      if (Math.abs(min - ziel) < abstand) { beste = slot; abstand = Math.abs(min - ziel); }
    }
    if (beste) { out.push(beste); n++; }
  }
  return out;
}

function googleKalenderLink(start: Date, titel: string, beschreibung: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ende = new Date(start.getTime() + 15 * 60000);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titel)}&dates=${f(start)}/${f(ende)}&details=${encodeURIComponent(beschreibung)}&ctz=Europe/Berlin`;
}

const kalenderMail = () => Netlify.env.get("KALENDER_MAIL") || Netlify.env.get("MAIL_REPLY_TO") || "samuel.edele1@gmail.com";

// Einladung (METHOD:REQUEST) an Samuels Google-Konto: Gmail trägt sie automatisch in den Google Kalender ein
function kalenderEinladung(start: Date, uid: string, titel: string, beschreibung: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ende = new Date(start.getTime() + 15 * 60000);
  const zeile = (s: string) => s.replace(/[\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const von = Netlify.env.get("MAIL_FROM") || "hallo@abgemacht.de";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Abgemacht//Termin//DE", "CALSCALE:GREGORIAN", "METHOD:REQUEST", "BEGIN:VEVENT",
    `UID:${uid}@ab-gemacht.info`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(ende)}`,
    `SUMMARY:${zeile(titel)}`, `DESCRIPTION:${zeile(beschreibung)}`,
    `ORGANIZER;CN=Abgemacht:mailto:${von}`,
    `ATTENDEE;CN=Samuel;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${kalenderMail()}`,
    "SEQUENCE:0", "STATUS:CONFIRMED", "TRANSP:OPAQUE",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Gespräch Abgemacht", "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function kalenderDatei(start: Date, uid: string, beschreibung: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ende = new Date(start.getTime() + 15 * 60000);
  const zeile = (s: string) => s.replace(/[\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Abgemacht//Termin//DE", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${uid}@ab-gemacht.info`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(ende)}`,
    `SUMMARY:${zeile("Abgemacht – kurzes Gespräch mit Samuel")}`, `DESCRIPTION:${zeile(beschreibung)}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function terminMail(token: string, vorschlaege: Date[]) {
  const links = vorschlaege
    .map((d) => `<p style="margin:0 0 10px"><a href="${seite()}/termin?t=${token}&s=${d.getTime()}" style="display:block;border:1px solid #138A6B;color:#0E6E55;text-decoration:none;font-weight:bold;padding:12px 16px;border-radius:12px">📅 ${terminText(d)}</a></p>`)
    .join("");
  return mailLayout(
    `<p style="margin:0 0 12px">Hallo,</p>
<p style="margin:0 0 12px">vielen Dank, dass Sie sich die Zeit für die Umfrage genommen haben! Sie haben angegeben, dass Sie für ein kurzes Gespräch offen sind. Das freut mich sehr.</p>
<p style="margin:0 0 16px">Es dauert etwa 15 Minuten, am Telefon oder per Video. Suchen Sie sich einfach einen Termin aus:</p>
${links}
<p style="margin:16px 0 12px;font-size:14px;color:#5B6B65">Keiner passt? Antworten Sie einfach auf diese E-Mail mit zwei, drei Zeiten, die Ihnen besser passen.</p>
<p style="margin:0">Viele Grüße<br>Samuel von Abgemacht</p>`
  );
}

const LABEL: Record<string, Record<string, string>> = {
  typ: { auftraggeber: "Vergibt Aufträge", anbieter: "Bietet Leistungen an", beides: "Beides", firma: "Firma", selbststaendig: "Selbstständig", mitarbeiter: "Mitarbeiter", privat: "Privat" },
  zahlen: { ja: "Ja", vielleicht: "Vielleicht", nein: "Nein" },
  nutzung: { woechentlich: "Wöchentlich", monatlich: "Monatlich", quartal: "Paar Mal im Jahr", selten: "Selten", taeglich: "Täglich" },
  auslastung: { voll: "Ausgebucht", gut: "Gut ausgelastet", luecken: "Regelmäßig Lücken", mehr: "Braucht mehr Aufträge" },
};

function adminUmfrageMail(a: Record<string, unknown>, mailGeschickt: boolean, ohneKalender = false) {
  const v = (x: unknown) => (x === null || x === undefined || x === "" ? "–" : esc(Array.isArray(x) ? x.join(", ") : String(x)));
  const reihe = (k: string, w: unknown) => `<tr><td style="padding:6px 12px 6px 0;color:#5B6B65;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0">${v(w)}</td></tr>`;
  const kontakt = a.kontakt
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#E3F4EE;border-radius:12px"><b>Will ein Gespräch:</b> ${esc(String(a.kontakt))}${mailGeschickt ? "<br>Terminvorschläge wurden automatisch per Mail geschickt." + (ohneKalender ? "<br><b>Achtung:</b> Dein Kalender war nicht erreichbar, die Vorschläge sind ungeprüft." : "") : "<br>Bitte selbst melden (Telefon oder keine Mail möglich)."}</p>`
    : "";
  return mailLayout(
    `<p style="margin:0 0 12px"><b>Neue Antwort in der Umfrage</b></p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.45">
${reihe("Typ", LABEL.typ[String(a.typ)] || a.typ)}${reihe("Branche", a.branche)}${reihe("Ort", a.ort)}
${reihe("Aufträge heute über", a.kanaele)}${reihe("Auslastung", LABEL.auslastung[String(a.auslastung)] || a.auslastung)}
${reihe("9 € pro Auftrag", LABEL.zahlen[String(a.zahlen)] || a.zahlen)}${reihe("Fairer Preis", a.preis_fair)}${reihe("Langzeitaufträge", LABEL.zahlen[String(a.langzeit)] || a.langzeit)}${reihe("Anfragen per", a.kanal)}
${reihe("Findet Betriebe über", a.suche)}${reihe("Zufriedenheit", a.zufriedenheit ? a.zufriedenheit + " von 5" : null)}${reihe("Braucht Betriebe", LABEL.nutzung[String(a.nutzung)] || a.nutzung)}${reihe("Auftragsarten", a.arten)}
${reihe("Was nervt", a.nervt)}${reihe("Am wichtigsten", a.funktionen)}
</table>${kontakt}
${knopf(`${seite()}/admin`, "Zur Übersicht")}`
  );
}

/* ---------- Handler ---------- */

export default async (req: Request, _context: Context) => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);
  const sql = neon(dbUrl);
  const pfad = new URL(req.url).pathname;

  if (pfad === "/api/waitlist" && req.method === "GET") {
    const rows = await sql`SELECT count(*)::int AS n FROM waitlist WHERE status = 'bestaetigt'`;
    return Response.json({ count: rows[0].n }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fehler("Ungültige Anfrage.");
  }

  /* Bestätigung (Double-Opt-in) */
  if (pfad === "/api/bestaetigen") {
    const t = String(body.t || "");
    if (!TOKEN_RE.test(t)) return fehler("Der Link ist ungültig.");
    const vorher = await sql`SELECT email, name, status FROM waitlist WHERE token = ${t}`;
    if (!vorher.length) return fehler("Der Link ist ungültig oder abgelaufen.", 404);
    if (vorher[0].status === "bestaetigt") return Response.json({ ok: true, schon: true });
    await sql`UPDATE waitlist SET status = 'bestaetigt', confirmed_at = now(), unsubscribed_at = NULL WHERE token = ${t}`;
    const { email, name } = vorher[0];
    const liste = Number(Netlify.env.get("BREVO_LIST_ID") || 0);
    if (liste) await brevo("/contacts", "POST", { email, listIds: [liste], updateEnabled: true });
    await sendeMail(email, name, "Sie sind dabei ✓", willkommensMail(name, t), `${seite()}/abmelden?t=${t}`);
    return Response.json({ ok: true });
  }

  /* Abmeldung */
  if (pfad === "/api/abmelden") {
    const t = String(body.t || "");
    if (!TOKEN_RE.test(t)) return fehler("Der Link ist ungültig.");
    const rows = await sql`UPDATE waitlist SET status = 'abgemeldet', unsubscribed_at = now() WHERE token = ${t} RETURNING email`;
    if (!rows.length) return fehler("Der Link ist ungültig oder abgelaufen.", 404);
    await brevo(`/contacts/${encodeURIComponent(rows[0].email)}`, "DELETE");
    return Response.json({ ok: true });
  }

  /* Umfrage */
  if (pfad === "/api/umfrage") {
    if (clip(body.website)) return Response.json({ ok: true });
    const liste = (v: unknown, erlaubt: string[]) =>
      Array.isArray(v) ? [...new Set(v.map(String).filter((x) => erlaubt.includes(x)))] : [];
    const eins = (v: unknown, erlaubt: string[]) => (erlaubt.includes(String(v)) ? String(v) : null);
    const z = Number(body.zufriedenheit);
    const kontakt = body.kontakt_ok === true ? clip(body.kontakt, 120) : null;
    const kontaktOk = !!kontakt;
    const istMail = !!kontakt && EMAIL_RE.test(kontakt);
    const token = istMail ? neuerToken() : null;
    let vorschlaege: Date[] = [];
    let kalenderOk = true;
    if (istMail) {
      const gebucht = (await sql`SELECT termin FROM umfrage WHERE termin > now()`).map((r) => new Date(r.termin).getTime());
      const belegt = await belegteZeiten(new Date(), new Date(Date.now() + 30 * 864e5));
      kalenderOk = belegt !== null;
      vorschlaege = terminVorschlaege(belegt, gebucht);
    }
    const a = {
      typ: eins(body.typ, TYPEN), branche: clip(body.branche, 60), ort: clip(body.ort, 80),
      kanaele: liste(body.kanaele, ["empfehlung", "linkedin", "netzwerktreffen", "social", "google", "kaltakquise", "portale", "sonstiges"]),
      zufriedenheit: Number.isInteger(z) && z >= 1 && z <= 5 ? z : null,
      nervt: clip(body.nervt, 1000), versucht: clip(body.versucht, 1000),
      funktionen: liste(body.funktionen, ["schnell", "geprueft", "whatsapp", "sprache", "langzeit", "luecken", "kostenlos", "personen", "auftraege", "suche", "chats", "verifizierung", "team"]),
      zahlen: eins(body.zahlen, ["ja", "vielleicht", "nein"]), preis_fair: clip(body.preis_fair, 60),
      nutzung: eins(body.nutzung, ["woechentlich", "monatlich", "quartal", "selten", "taeglich"]),
      auslastung: eins(body.auslastung, ["voll", "gut", "luecken", "mehr"]),
      langzeit: eins(body.langzeit, ["ja", "vielleicht", "nein"]),
      kanal: liste(body.kanal, ["whatsapp", "app", "email", "telefon"]),
      suche: liste(body.suche, ["empfehlung", "google", "portale", "social", "bekannte", "sonstiges"]),
      arten: liste(body.arten, ["einmalig", "projekt", "langzeit"]),
      kontakt: kontaktOk ? kontakt : null,
    };
    const rows = await sql`
      INSERT INTO umfrage (typ, branche, ort, kanaele, zufriedenheit, nervt, versucht, funktionen, zahlen, preis_fair, nutzung, kontakt_ok, kontakt,
        version, auslastung, langzeit, kanal, suche, arten, quelle, token, termin_vorschlaege)
      VALUES (
        ${a.typ}, ${a.branche}, ${a.ort}, ${a.kanaele}, ${a.zufriedenheit}, ${a.nervt}, ${a.versucht}, ${a.funktionen},
        ${a.zahlen}, ${a.preis_fair}, ${a.nutzung}, ${kontaktOk}, ${a.kontakt},
        2, ${a.auslastung}, ${a.langzeit}, ${a.kanal}, ${a.suche}, ${a.arten},
        ${QUELLEN.includes(String(body.quelle)) ? String(body.quelle) : "umfrage"},
        ${token}, ${vorschlaege.length ? vorschlaege.map((d) => d.toISOString()) : null}
      ) RETURNING id`;
    let mailGeschickt = false;
    if (istMail && vorschlaege.length) {
      mailGeschickt = await sendeMail(kontakt!, null, "Danke für Ihre Antworten – wann passt ein kurzes Gespräch?", terminMail(token!, vorschlaege));
      if (mailGeschickt) await sql`UPDATE umfrage SET termin_mail_at = now() WHERE id = ${rows[0].id}`;
    }
    if (kontaktOk) {
      const infos = [a.auslastung && "Auslastung: " + (LABEL.auslastung[a.auslastung] || a.auslastung), a.zahlen && "9 € okay: " + a.zahlen,
        a.langzeit && "Langzeit: " + a.langzeit].filter(Boolean).join(", ");
      await crmInteressent(sql, { email: istMail ? kontakt : null, telefon: istMail ? null : kontakt, branche: a.branche, ort: a.ort, typ: a.typ,
        quelle: "umfrage", notiz: "Umfrage ausgefüllt" + (infos ? " (" + infos + ")" : "") + (vorschlaege.length ? ", Terminvorschläge geschickt" : "") });
    }
    const kurz = [LABEL.typ[String(a.typ)], a.branche, a.ort].filter(Boolean).join(", ");
    await sendeMail(adminMail(), "Samuel", `Neue Umfrage${kontaktOk ? " + Gesprächswunsch" : ""}${kurz ? ": " + kurz : ""}`, adminUmfrageMail(a, mailGeschickt, istMail && !kalenderOk));
    return Response.json({ ok: true });
  }

  /* Termin auswählen und festmachen */
  if (pfad === "/api/termin") {
    const t = String(body.t || "");
    if (!TOKEN_RE.test(t)) return fehler("Der Link ist ungültig.");
    const r = (await sql`SELECT id, kontakt, termin, termin_vorschlaege, branche, ort, typ FROM umfrage WHERE token = ${t}`)[0];
    if (!r) return fehler("Der Link ist ungültig oder abgelaufen.", 404);
    if (r.termin) return Response.json({ ok: true, gebucht: true, termin: new Date(r.termin).getTime(), text: terminText(new Date(r.termin)) });
    const gebucht = (await sql`SELECT termin FROM umfrage WHERE termin > now()`).map((x) => new Date(x.termin).getTime());
    const belegt = await belegteZeiten(new Date(), new Date(Date.now() + 30 * 864e5));
    const vorschlaege = ((r.termin_vorschlaege || []) as (string | Date)[])
      .map((d) => new Date(d))
      .filter((d) => d.getTime() > Date.now() + 2 * 3600e3)
      .map((d) => ({ zeit: d.getTime(), text: terminText(d), frei: istFrei(d.getTime(), belegt, gebucht) }));
    if (body.aktion !== "buchen") return Response.json({ ok: true, gebucht: false, vorschlaege });

    const s = Number(body.s);
    const wahl = vorschlaege.find((v) => v.zeit === s);
    if (!wahl) return fehler("Dieser Termin ist nicht mehr verfügbar. Bitte wählen Sie einen anderen.");
    if (!wahl.frei) return fehler("Dieser Termin ist leider gerade vergeben. Bitte wählen Sie einen anderen.", 409);
    const telefon = clip(body.telefon, 40);
    try {
      const upd = await sql`UPDATE umfrage SET termin = ${new Date(s).toISOString()}, termin_gebucht_at = now(), termin_telefon = ${telefon}
        WHERE token = ${t} AND termin IS NULL RETURNING id`;
      if (!upd.length) return fehler("Für diesen Link ist schon ein Termin eingetragen.", 409);
    } catch {
      return fehler("Dieser Termin ist leider gerade vergeben. Bitte wählen Sie einen anderen.", 409);
    }
    const start = new Date(s);
    const wie = telefon ? `Samuel ruft Sie unter ${telefon} an.` : "Samuel meldet sich vorher kurz mit einem Link für den Videocall oder ruft Sie an.";
    await sendeMail(String(r.kontakt), null, `Abgemacht! Unser Gespräch am ${terminText(start)}`, mailLayout(
      `<p style="margin:0 0 12px">Hallo,</p>
<p style="margin:0 0 12px"><b>Abgemacht!</b> Wir sprechen am <b>${terminText(start)}</b>, etwa 15 Minuten.</p>
<p style="margin:0 0 12px">${esc(wie)}</p>
<p style="margin:0 0 12px">Den Termin finden Sie im Anhang für Ihren Kalender. Falls etwas dazwischenkommt, antworten Sie einfach auf diese E-Mail.</p>
<p style="margin:0">Bis dann<br>Samuel von Abgemacht</p>`),
      undefined, { name: "abgemacht-termin.ics", text: kalenderDatei(start, `u${r.id}`, `Kurzes Gespräch zu Abgemacht. ${wie}`) });
    await crmInteressent(sql, { email: String(r.kontakt), telefon: telefon || null, branche: r.branche, ort: r.ort, typ: r.typ, quelle: "umfrage",
      notiz: `Gesprächstermin gebucht: ${terminText(start)}` });
    const wer = [LABEL.typ[String(r.typ)], r.branche, r.ort].filter(Boolean).join(", ");
    await sendeMail(adminMail(), "Samuel", `Neuer Termin: ${terminText(start)}${wer ? " – " + wer : ""}`, mailLayout(
      `<p style="margin:0 0 12px"><b>Neuer Gesprächstermin</b></p>
<p style="margin:0 0 6px"><b>Wann:</b> ${terminText(start)} (15 Minuten)</p>
<p style="margin:0 0 6px"><b>E-Mail:</b> ${esc(String(r.kontakt))}</p>
<p style="margin:0 0 6px"><b>Telefon:</b> ${telefon ? esc(telefon) : "nicht angegeben – bitte Videolink schicken"}</p>
<p style="margin:0 0 6px"><b>Wer:</b> ${esc(wer || "–")}</p>
${knopf(googleKalenderLink(start, `Abgemacht: Gespräch mit ${r.kontakt}`, `${wer ? wer + "\n" : ""}E-Mail: ${r.kontakt}${telefon ? "\nTelefon: " + telefon : ""}`), "In Google Kalender eintragen")}
<p style="margin:0 0 6px;font-size:14px;color:#5B6B65">Gmail bekommt zusätzlich eine Kalendereinladung und trägt sie normalerweise automatisch ein. Falls nicht, reicht der Knopf oben.</p>
${knopf(`${seite()}/admin`, "Antworten in der Übersicht ansehen")}`));
    // Eigene Einladungs-Mail an das Google-Konto, damit der Termin direkt im Kalender landet
    await sendeMail(kalenderMail(), "Samuel", `Einladung: Abgemacht-Gespräch ${terminText(start)}`, mailLayout(
      `<p style="margin:0 0 12px"><b>Kalendereinladung</b> für das Gespräch am ${terminText(start)} mit ${esc(String(r.kontakt))}.</p>`),
      undefined, { name: "invite.ics", text: kalenderEinladung(start, `s${r.id}`, `Abgemacht: Gespräch mit ${r.kontakt}`, `${wer ? wer + "\n" : ""}E-Mail: ${r.kontakt}${telefon ? "\nTelefon: " + telefon : ""}`) });
    return Response.json({ ok: true, gebucht: true, termin: s, text: terminText(start) });
  }

  /* Anfrage von der Website -> direkt ins Vermittlungssystem (/vermittlung, Status „neu“) */
  if (pfad === "/api/anfrage") {
    if (clip(body.website)) return Response.json({ ok: true });
    const leistung = clip(body.leistung, 200);
    const ort = clip(body.ort, 80);
    const name = clip(body.name, 80);
    const firma = body.typ === "firma" ? clip(body.firma, 120) : null;
    const telefon = clip(body.telefon, 40);
    const email = (clip(body.email, 254) || "").toLowerCase() || null;
    if (!leistung) return fehler("Bitte schreiben Sie kurz, was Sie brauchen.");
    if (!ort) return fehler("Bitte geben Sie den Ort oder die PLZ an.");
    if (!name) return fehler("Bitte geben Sie Ihren Namen an.");
    if (!email) return fehler("Bitte geben Sie Ihre E-Mail-Adresse an. Dorthin schicken wir die Angebote.");
    if (!EMAIL_RE.test(email)) return fehler("Bitte prüfen Sie die E-Mail-Adresse.");
    if (telefon && telefon.replace(/\D/g, "").length < 6) return fehler("Bitte prüfen Sie die Telefonnummer.");
    if (body.wa === true && !telefon) return fehler("Für die Benachrichtigung per WhatsApp brauchen wir Ihre Handynummer.");
    const kundeWa = body.wa === true && !!telefon;
    if (body.consent !== true) return fehler("Bitte bestätigen Sie kurz die Datenschutzhinweise.");
    const kontakt = [telefon, email].filter(Boolean).join(" · ");
    const kurz = await sql`SELECT count(*)::int AS n FROM vermittlungen WHERE kanal = 'web' AND kontakt = ${kontakt} AND created_at > now() - interval '1 hour'`;
    if (kurz[0].n >= 3) return fehler("Ihre Anfrage ist schon bei uns. Wir melden uns in Kürze.", 429);
    const art = ["einmalig", "projekt", "langzeit"].includes(String(body.art)) ? String(body.art) : "einmalig";
    const zeitraum = clip(body.zeitraum, 80);
    const budget = clip(body.budget, 60);
    // Antworten auf die Zusatzfragen je Bereich kommen vorn in die Beschreibung (sehen Betriebe, Büro und Mails)
    const zusatz = (Array.isArray(body.details) ? body.details : []).slice(0, 10)
      .map((d: any) => Array.isArray(d) ? [clip(d[0], 80), clip(d[1], 200)] : [null, null])
      .filter(([f, a]) => f && a).map(([f, a]) => `${f}: ${a}`);
    const bereich = clip(body.bereich, 60);
    const kopf = [bereich && bereich !== "Etwas anderes" ? `Bereich: ${bereich}` : null, ...zusatz].filter(Boolean).join("\n");
    const beschreibung = clip([kopf, clip(body.beschreibung, 3000)].filter(Boolean).join("\n\n"), 3600);
    const quelle = QUELLEN.includes(String(body.quelle)) ? String(body.quelle) : "direkt";
    const auftraggeber = firma ? `${firma} (${name})` : name;
    const empfehler = await empfehlerZuCode(sql, body.empfohlen);
    const r = await sql`INSERT INTO vermittlungen (auftraggeber, kontakt, kanal, leistung, ort, zeitraum, budget, art, beschreibung, notizen, empfohlen_von, wa_ok_am)
      VALUES (${auftraggeber}, ${kontakt}, 'web', ${leistung}, ${ort}, ${zeitraum}, ${budget}, ${art}, ${beschreibung},
              ${"Über die Website · " + (firma ? "Firma" : "Privat") + (quelle !== "direkt" ? " · Quelle: " + quelle : "") + (empfehler ? " · Empfohlen von " + empfehler.firma : "")},
              ${empfehler ? empfehler.id : null}, ${kundeWa ? new Date().toISOString() : null})
      RETURNING id, kunde_token`;
    if (empfehler) await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${empfehler.id}, 'empfehlung', ${"Kunde empfohlen: Anfrage #" + r[0].id + " (" + leistung + ")"})`;
    const nr = r[0].id;
    // Fotos (optional, bis 5): im Browser verkleinert, hier geprüft und gespeichert
    let fotoAnzahl = 0;
    for (const f of (Array.isArray(body.fotos) ? body.fotos : []).slice(0, 5)) {
      const m = String(f || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!m || m[2].length > 2_000_000) continue;
      const kopf = Buffer.from(m[2].slice(0, 24), "base64");
      const echt = m[1] === "jpeg" ? kopf[0] === 0xff && kopf[1] === 0xd8 : m[1] === "png" ? kopf.toString("latin1", 1, 4) === "PNG" : kopf.toString("latin1", 8, 12) === "WEBP";
      if (!echt) continue;
      fotoAnzahl++;
      await sql`INSERT INTO anfrage_fotos (vermittlung_id, nr, mime, daten, bytes) VALUES (${nr}, ${fotoAnzahl}, ${"image/" + m[1]}, ${m[2]}, ${Math.floor(m[2].length * 3 / 4)})`;
    }
    const angebotsLink = `${seite()}/angebot?t=${r[0].kunde_token}`;
    const bestaetigLink = `${angebotsLink}&bestaetigen=1`;
    const ART: Record<string, string> = { einmalig: "Einmalig", projekt: "Projekt", langzeit: "Regelmäßig / langfristig" };
    const zeile = (k: string, w: string | null) => w ? `<tr><td style="padding:5px 12px 5px 0;color:#5B6B65;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:5px 0">${esc(w).replace(/\n/g, "<br>")}</td></tr>` : "";
    const tabelle = `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.45">${zeile("Leistung", leistung)}${zeile("Ort", ort)}${zeile("Wann", zeitraum)}${zeile("Art", ART[art])}${zeile("Budget", budget)}${zeile("Details", beschreibung)}${zeile("Fotos", fotoAnzahl ? fotoAnzahl + " angehängt" : null)}</table>`;
    await sendeMail(adminMail(), "Samuel", `Neue Anfrage #${nr}: ${leistung} in ${ort}`, mailLayout(
      `<p style="margin:0 0 12px"><b>Neue Anfrage über die Website</b> <span style="color:#A3480A">(noch nicht per E-Mail bestätigt, du bekommst Bescheid, sobald der Kunde bestätigt)</span></p>${tabelle}
<p style="margin:14px 0 0;padding:12px 14px;background:#E3F4EE;border-radius:12px"><b>${esc(auftraggeber)}</b>${firma ? "" : " (privat)"}<br>${esc(kontakt)}${kundeWa ? "<br>Möchte zusätzlich per WhatsApp Bescheid bekommen" : ""}</p>${empfehler ? `<p style="margin:12px 0 0"><b>Empfohlen von ${esc(empfehler.firma)}</b>: Diesen Betrieb nicht für die Anfrage anfragen. Bezahlt der gewählte Betrieb die Freischaltung, bekommt ${esc(empfehler.firma)} die Hälfte.</p>` : ""}
${knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")}`));
    if (email) await sendeMail(email, name, `Bitte bestätigen: Ihre Anfrage „${leistung}“`, mailLayout(
      `<p style="margin:0 0 12px">Hallo ${esc(name)},</p>
<p style="margin:0 0 12px">vielen Dank, Ihre Anfrage ist bei uns angekommen:</p>${tabelle}
<p style="margin:14px 0 12px"><b>Bitte bestätigen Sie kurz Ihre Anfrage.</b> Erst dann geben wir sie an Betriebe weiter. So stellen wir sicher, dass nur echte Anfragen bei den Betrieben landen.</p>
${knopf(bestaetigLink, "Anfrage bestätigen")}
<p style="margin:-14px 0 20px;font-size:13px;line-height:1.4;color:#5B6B65;word-break:break-all">Falls der Knopf nicht reagiert: <a href="${bestaetigLink}" style="color:#138A6B">${bestaetigLink}</a></p>
<p style="margin:0 0 12px">So geht es weiter: Spätestens am nächsten Werktag nach Ihrer Bestätigung geht Ihre Anfrage ohne Ihren Namen und Ihre Kontaktdaten an passende, von uns geprüfte Betriebe aus der Region. Sobald das erste Angebot da ist, bekommen Sie eine E-Mail. Über denselben Link sehen Sie alle Angebote und nehmen das passende mit einem Klick an. Erst dann bekommen Sie und der Betrieb gegenseitig die Kontaktdaten.</p>
<p style="margin:0 0 12px;font-size:14px;color:#5B6B65">Bewahren Sie diese E-Mail auf: Der Link ist nur für Sie.</p>
<p style="margin:0 0 12px">Für Sie ist das kostenlos. Falls Sie noch etwas ergänzen möchten, antworten Sie einfach auf diese E-Mail.</p>
<p style="margin:0">Viele Grüße<br>Ihr Team von Abgemacht</p>`));
    if (empfehler?.email) await sendeMail(empfehler.email, empfehler.ansprechpartner || empfehler.firma, `Danke für Ihre Empfehlung: ${leistung}`, mailLayout(
      `<p style="margin:0 0 12px">Guten Tag${empfehler.ansprechpartner ? " " + esc(empfehler.ansprechpartner) : ""},</p>
<p style="margin:0 0 12px">über Ihren Empfehlungslink ist gerade eine Anfrage bei uns eingegangen: <b>${esc(leistung)}</b> in ${esc(ort)}. Vielen Dank!</p>
<p style="margin:0 0 12px">Wir kümmern uns jetzt darum, passende Betriebe zu finden. Kommt der Auftrag zustande und ist die Freischaltgebühr bezahlt, bekommen Sie die Hälfte davon. Aus Datenschutzgründen nennen wir Ihnen keine Kundendaten; den Stand sehen Sie auf jeder Ihrer Angebotsseiten.</p>
<p style="margin:0">Viele Grüße<br>Samuel Edele von Abgemacht</p>`));
    return Response.json({ ok: true, nr, mail: !!email });
  }

  /* Betrieb möchte Partner werden -> CRM (Vermittlung → Partner → Interessenten) */
  if (pfad === "/api/partner") {
    if (clip(body.website)) return Response.json({ ok: true });
    const firma = clip(body.firma, 120);
    const leistungen = clip(body.leistungen, 300);
    const telefon = clip(body.telefon, 40);
    const email = (clip(body.email, 254) || "").toLowerCase() || null;
    if (!firma) return fehler("Bitte geben Sie den Namen Ihres Betriebs an.");
    if (!leistungen) return fehler("Bitte schreiben Sie kurz, was Sie anbieten.");
    if (!telefon && !email) return fehler("Bitte geben Sie eine Telefonnummer oder E-Mail-Adresse an.");
    if (email && !EMAIL_RE.test(email)) return fehler("Bitte prüfen Sie die E-Mail-Adresse.");
    if (email && body.mailok !== true) return fehler("Bitte setzen Sie den Haken, dass wir Ihnen Anfragen per E-Mail schicken dürfen.");
    if (body.wa === true && !telefon) return fehler("Für Anfragen per WhatsApp brauchen wir Ihre Handynummer.");
    if (body.consent !== true) return fehler("Bitte bestätigen Sie kurz die Bedingungen und Datenschutzhinweise.");
    if (body.taetig !== true) return fehler("Bitte bestätigen Sie kurz, dass Sie gewerblich oder freiberuflich tätig sind.");
    // Nachweis ist freiwillig; wenn einer mitkommt, muss er gültig sein
    const nachweis = body.nachweis ? nachweisPruefen(body.nachweis) : null;
    if (body.nachweis && !nachweis) return fehler("Der Nachweis konnte nicht gelesen werden. Bitte ein Foto oder eine PDF bis 4 MB wählen, oder ihn später schicken.");
    const name = clip(body.name, 80);
    const gebiet = clip(body.ort, 120);
    const wa = body.wa === true && !!telefon;
    const mailok = body.mailok === true && !!email;
    const anruf = body.anruf === true;
    const quelle = QUELLEN.includes(String(body.quelle)) ? String(body.quelle) : "direkt";
    const kid = await crmInteressent(sql, { email, telefon, name, firma, leistungen, ort: gebiet, branche: clip(body.branche, 60), typ: "anbieter", quelle: "website",
      notiz: `Partner-Anfrage über die Website: ${leistungen}${gebiet ? ", Gebiet: " + gebiet : ""}${mailok ? ", E-Mail-Okay" : ""}${wa ? ", WhatsApp-Okay" : ""}${anruf ? ", Anruf-Okay (auch KI-Assistent, geplant)" : ""}${nachweis ? "" : ", noch kein Nachweis"}${quelle !== "direkt" ? " (Quelle: " + quelle + ")" : ""}` });
    // Einwilligung für Anrufe (auch durch den späteren KI-Assistenten) mit Zeitpunkt festhalten
    if (kid && anruf) await sql`UPDATE crm_kontakte SET anruf_ok_am = COALESCE(anruf_ok_am, now()) WHERE id = ${kid}`;
    // Einwilligungen für Anfragen per E-Mail und WhatsApp direkt aus der Anmeldung (mit Zeitpunkt als Nachweis)
    if (kid && (mailok || wa)) await sql`UPDATE crm_kontakte SET
        mail_ok_am = CASE WHEN ${mailok} THEN COALESCE(mail_ok_am, now()) ELSE mail_ok_am END,
        wa_ok_am = CASE WHEN ${wa} THEN COALESCE(wa_ok_am, now()) ELSE wa_ok_am END WHERE id = ${kid}`;
    if (kid && nachweis) await sql`INSERT INTO betrieb_nachweise (kontakt_id, art, dateiname, mime, daten, bytes) VALUES (${kid}, 'gewerbe', ${clip(body.nachweis_name, 120)}, ${nachweis.mime}, ${nachweis.daten}, ${nachweis.bytes})`;
    await sendeMail(adminMail(), "Samuel", `Neuer Partner-Interessent: ${firma}`, mailLayout(
      `<p style="margin:0 0 12px"><b>Ein Betrieb möchte Partner werden</b></p>
<p style="margin:0 0 6px"><b>${esc(firma)}</b>${name ? " · " + esc(name) : ""}</p>
<p style="margin:0 0 6px">Leistungen: ${esc(leistungen)}</p>
${gebiet ? `<p style="margin:0 0 6px">Gebiet: ${esc(gebiet)}</p>` : ""}
<p style="margin:0 0 6px">${esc([telefon, email].filter(Boolean).join(" · "))}</p>
<p style="margin:0 0 6px">Anfragen per E-Mail: ${mailok ? "erlaubt" : "nein"} · per WhatsApp: ${wa ? "erlaubt (WhatsApp ✓ ist schon gesetzt)" : "nein"}</p>
<p style="margin:0 0 6px">Anrufe, auch durch den KI-Assistenten (für später geplant): ${anruf ? "erlaubt" : "nein"}</p>
<p style="margin:0 0 6px">Nachweis: ${nachweis ? `hochgeladen (${nachweis.mime === "application/pdf" ? "PDF" : "Foto"}), bitte im Büro prüfen` : "noch keiner (Gewerbeanmeldung oder Steuernummer-Schreiben nachfordern)"}. Bei zulassungspflichtigem Handwerk vor der ersten Anfrage die Handwerksrolle prüfen.</p>
${knopf(`${seite()}/vermittlung`, "In Vermittlung → Partner öffnen")}`));
    if (email) await sendeMail(email, name, "Danke für Ihr Interesse an Abgemacht", mailLayout(
      `<p style="margin:0 0 12px">Hallo${name ? " " + esc(name) : ""},</p>
<p style="margin:0 0 12px">vielen Dank für Ihr Interesse, mit ${esc(firma)} Partner-Betrieb bei Abgemacht zu werden.</p>
${nachweis ? `<p style="margin:0 0 12px">Ihr Nachweis ist angekommen, wir prüfen ihn kurz. Bei Handwerksbetrieben schauen wir zusätzlich, ob Sie bei der Handwerkskammer eingetragen sind. Danach erscheinen Ihre Angebote bei Auftraggebern mit dem Hinweis „Geprüfter Betrieb“.</p>` : `<p style="margin:0 0 12px">Tipp: Antworten Sie einfach auf diese E-Mail mit einem Foto Ihrer Gewerbeanmeldung oder, wenn Sie freiberuflich arbeiten, einem Schreiben des Finanzamts mit Ihrer Steuernummer. Dann erscheinen Ihre Angebote mit dem Hinweis „Geprüfter Betrieb“ und Sie werden bevorzugt angefragt.</p>`}
<p style="margin:0 0 12px">Wir melden uns in den nächsten Tagen, um Leistungen und Einsatzgebiet abzustimmen. Danach bekommen Sie passende Anfragen aus der Region. In der Startphase ist das für Sie kostenlos, die Bedingungen finden Sie unter <a href="${seite()}/bedingungen">${seite().replace(/^https?:\/\//, "")}/bedingungen</a>.</p>
<p style="margin:0">Viele Grüße<br>Ihr Team von Abgemacht</p>`));
    return Response.json({ ok: true });
  }

  /* Neue Anmeldung */
  if (pfad !== "/api/waitlist") return fehler("Nicht gefunden.", 404);

  // Honeypot: echte Menschen füllen dieses Feld nie aus
  if (clip(body.website)) return Response.json({ ok: true, neu: true, mail: true });

  const email = (clip(body.email, 254) || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fehler("Bitte geben Sie eine gültige E-Mail-Adresse ein.");
  if (body.consent !== true) return fehler("Bitte stimme der Datenschutzerklärung zu.");

  const typ = TYPEN.includes(String(body.typ)) ? String(body.typ) : null;
  const quelle = QUELLEN.includes(String(body.quelle)) ? String(body.quelle) : "direkt";
  const name = clip(body.name, 80);

  // Unbestätigte Anmeldungen nach 30 Tagen löschen (wie in der Datenschutzerklärung zugesagt)
  await sql`DELETE FROM waitlist WHERE status = 'offen' AND created_at < now() - interval '30 days'`;

  const rows = await sql`
    INSERT INTO waitlist (email, name, typ, branche, ort, quelle, token, status)
    VALUES (${email}, ${name}, ${typ}, ${clip(body.branche, 60)}, ${clip(body.ort, 80)}, ${quelle}, ${neuerToken()}, 'offen')
    ON CONFLICT (email) DO UPDATE SET token = COALESCE(waitlist.token, EXCLUDED.token)
    RETURNING id, token, status, name, mail_sent_at, (xmax = 0) AS neu`;
  const r = rows[0];
  if (r.neu) await crmInteressent(sql, { email, name, branche: clip(body.branche, 60), ort: clip(body.ort, 80), typ, quelle: "warteliste",
    notiz: `Auf der Website angemeldet als „${LABEL.typ[String(typ)] || typ}“` });

  if (r.status === "bestaetigt") return Response.json({ ok: true, neu: false, status: "bestaetigt" });

  if (r.status === "abgemeldet") {
    await sql`UPDATE waitlist SET status = 'offen' WHERE id = ${r.id}`;
  }

  // Bestätigungs-Mail höchstens alle 10 Minuten an dieselbe Adresse
  const zuletzt = r.mail_sent_at ? new Date(r.mail_sent_at).getTime() : 0;
  let mail = false;
  if (Date.now() - zuletzt > 10 * 60 * 1000) {
    mail = await sendeMail(email, r.name, "Bitte bestätigen Sie Ihre Anmeldung bei Abgemacht", bestaetigungsMail(r.name, r.token));
    if (mail) await sql`UPDATE waitlist SET mail_sent_at = now() WHERE id = ${r.id}`;
  } else {
    mail = true;
  }

  return Response.json({ ok: true, neu: r.neu, mail });
};

export const config: Config = { path: ["/api/waitlist", "/api/bestaetigen", "/api/abmelden", "/api/umfrage", "/api/termin", "/api/anfrage", "/api/partner"] };
