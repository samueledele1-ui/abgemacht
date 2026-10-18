import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";
import { tagesplanSenden } from "../lib/tagesplan.ts";

// CRM für Telefon-Akquise: Kontakte, Anruf-Ergebnisse, Wiedervorlagen.
// Geschützt mit demselben ADMIN_PASSWORT wie /admin. Alles läuft über POST /api/crm mit {pw, aktion, ...}.

const STATUS = ["neu", "wiedervorlage", "mailbox", "mail_gewuenscht", "warteliste", "kein_interesse", "keine_anrufe", "nicht_erreichbar"];
const FELDER = ["firma", "kategorie", "ansprechpartner", "telefon", "email", "website", "ort", "region", "notizen", "quelle"] as const;
const TZ = "Europe/Berlin";

const fehler = (msg: string, status = 400) =>
  Response.json({ ok: false, error: msg }, { status, headers: { "Cache-Control": "no-store" } });
const clip = (v: unknown, n = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};

async function gleich(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

/* ---------- Zeit in Berlin ---------- */
function berlinTeile(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: p.weekday as string };
}
function berlinZeit(y: number, m: number, d: number, h: number, min: number) {
  const roh = Date.UTC(y, m - 1, d, h, min);
  const t = berlinTeile(new Date(roh));
  return new Date(roh - (Date.UTC(t.y, t.m - 1, t.d, t.h, t.min) - roh));
}
// n Werktage nach heute (Mo–Fr), zur Uhrzeit h:min Berliner Zeit
function werktag(n: number, h: number, min: number) {
  const jetzt = berlinTeile(new Date());
  let tag = new Date(Date.UTC(jetzt.y, jetzt.m - 1, jetzt.d, 12));
  let rest = n;
  while (rest > 0) {
    tag = new Date(tag.getTime() + 86400000);
    const wd = tag.getUTCDay();
    if (wd !== 0 && wd !== 6) rest--;
  }
  return berlinZeit(tag.getUTCFullYear(), tag.getUTCMonth() + 1, tag.getUTCDate(), h, min);
}
// Nächster Versuch zu einer anderen Tageszeit: vormittags angerufen -> nachmittags, sonst früh morgens
function andereTageszeit() {
  const h = berlinTeile(new Date()).h;
  return h < 12 ? werktag(1, 16, 0) : werktag(1, 7, 30);
}

const ERGEBNISSE: Record<string, string> = {
  nicht_erreicht: "Nicht erreicht",
  mailbox: "Mailbox besprochen",
  rueckruf: "Rückruf vereinbart",
  mail_gewuenscht: "Will Infos per Mail",
  warteliste: "Ja zur Warteliste",
  kein_interesse: "Kein Interesse",
  keine_anrufe: "Will keine Anrufe",
  gespraech: "Gespräch geführt",
  eintrag: "Partner angeboten (Freigabe offen)",
  eintrag_frei: "Als Partner freigegeben",
};

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);
  const soll = Netlify.env.get("ADMIN_PASSWORT");
  if (!soll || soll.length < 8) return fehler("ADMIN_PASSWORT ist in Netlify noch nicht gesetzt.", 503);
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fehler("Ungültige Anfrage."); }
  if (!(await gleich(String(body.pw || ""), soll))) {
    await new Promise((r) => setTimeout(r, 1200));
    return fehler("Falsches Passwort.", 401);
  }

  const sql = neon(dbUrl);
  const aktion = String(body.aktion || "liste");
  const id = Number(body.id) || 0;

  if (aktion === "liste") {
    const kontakte = await sql`
      SELECT k.*, w.status AS wl_status,
             (SELECT count(*) FROM crm_log l WHERE l.kontakt_id = k.id)::int AS log_anzahl
      FROM crm_kontakte k
      LEFT JOIN waitlist w ON k.warteliste_email IS NOT NULL AND lower(w.email) = lower(k.warteliste_email)
      ORDER BY k.naechster_kontakt NULLS LAST, k.id`;
    const eintraege = await sql`
      SELECT e.id, e.kontakt_id, e.art, e.titel, e.text, e.ort, e.kontakt, e.status, e.freigabe_am, e.created_at, k.firma, k.region
      FROM crm_eintraege e JOIN crm_kontakte k ON k.id = e.kontakt_id ORDER BY e.created_at DESC`;
    const fahrplan = await sql`SELECT id, to_char(von, 'YYYY-MM-DD') AS von, to_char(bis, 'YYYY-MM-DD') AS bis, phase, text, typ, erledigt FROM fahrplan_aufgaben ORDER BY von, id`;
    return Response.json({ ok: true, kontakte, eintraege, fahrplan, jetzt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  if (aktion === "verlauf") {
    const log = await sql`SELECT art, text, created_at FROM crm_log WHERE kontakt_id = ${id} ORDER BY created_at DESC LIMIT 100`;
    const eintraege = await sql`SELECT id, art, titel, text, ort, kontakt, status, freigabe_am, created_at FROM crm_eintraege WHERE kontakt_id = ${id} ORDER BY created_at DESC`;
    return Response.json({ ok: true, log, eintraege });
  }

  if (aktion === "speichern") {
    const d = (body.daten || {}) as Record<string, unknown>;
    const v = Object.fromEntries(FELDER.map((f) => [f, clip(d[f], f === "notizen" ? 4000 : 300)]));
    if (!v.firma) return fehler("Bitte gib einen Namen oder eine Firma ein.");
    const status = STATUS.includes(String(d.status)) ? String(d.status) : null;
    const naechster = d.naechster_kontakt ? new Date(String(d.naechster_kontakt)) : null;
    const nk = naechster && !isNaN(naechster.getTime()) ? naechster.toISOString() : null;
    if (id) {
      const r = await sql`
        UPDATE crm_kontakte SET firma=${v.firma}, kategorie=${v.kategorie}, ansprechpartner=${v.ansprechpartner}, telefon=${v.telefon},
          email=${v.email}, website=${v.website}, ort=${v.ort}, region=${v.region}, notizen=${v.notizen},
          status=COALESCE(${status}, status), naechster_kontakt=${nk}, updated_at=now()
        WHERE id=${id} RETURNING id`;
      if (!r.length) return fehler("Kontakt nicht gefunden.", 404);
      return Response.json({ ok: true, id });
    }
    const r = await sql`
      INSERT INTO crm_kontakte (firma, kategorie, ansprechpartner, telefon, email, website, ort, region, notizen, quelle, status, naechster_kontakt)
      VALUES (${v.firma}, ${v.kategorie}, ${v.ansprechpartner}, ${v.telefon}, ${v.email}, ${v.website}, ${v.ort}, ${v.region}, ${v.notizen},
              ${v.quelle || "manuell"}, ${status || "neu"}, ${nk})
      RETURNING id`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r[0].id}, 'angelegt', null)`;
    return Response.json({ ok: true, id: r[0].id });
  }

  if (aktion === "fahrplan_erledigt") {
    const fid = Number(body.fid) || 0, e = !!body.erledigt;
    await sql`UPDATE fahrplan_aufgaben SET erledigt = ${e}, erledigt_am = CASE WHEN ${e} THEN now() END WHERE id = ${fid}`;
    return Response.json({ ok: true });
  }

  if (aktion === "fahrplan_neu") {
    const text = clip(body.text, 300), von = clip(body.von, 10), bis = clip(body.bis, 10) || von;
    if (!text || !von || !/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis!)) return fehler("Bitte Text und Datum angeben.");
    await sql`INSERT INTO fahrplan_aufgaben (von, bis, phase, text) VALUES (${von}::date, ${bis}::date, ${clip(body.phase, 80) || "Eigene Aufgabe"}, ${text})`;
    return Response.json({ ok: true });
  }

  if (aktion === "tagesplan") {
    try { return Response.json({ ok: true, betreff: await tagesplanSenden() }); }
    catch (e) { return fehler("Tagesplan nicht gesendet: " + String(e).slice(0, 200), 500); }
  }

  if (aktion === "eintrag_aendern") {
    const eid = Number(body.eid) || 0;
    const rows = await sql`SELECT kontakt_id, status FROM crm_eintraege WHERE id = ${eid}`;
    if (!rows.length) return fehler("Freigabe nicht gefunden.", 404);
    const st = String(body.status || rows[0].status);
    if (!["angeboten", "freigegeben", "zurueckgezogen"].includes(st)) return fehler("Unbekannter Status.");
    const titel = clip(body.titel, 160);
    if (body.titel !== undefined && !titel) return fehler("Bitte einen Titel eintragen.");
    await sql`UPDATE crm_eintraege SET
        art = COALESCE(${clip(body.art, 30)}, art), titel = COALESCE(${titel}, titel),
        text = CASE WHEN ${body.text !== undefined} THEN ${clip(body.text, 1000)} ELSE text END,
        kontakt = CASE WHEN ${body.kontakt !== undefined} THEN ${clip(body.kontakt, 200)} ELSE kontakt END,
        status = ${st}, freigabe_am = CASE WHEN ${st} = 'freigegeben' THEN COALESCE(freigabe_am, now()) ELSE freigabe_am END
      WHERE id = ${eid}`;
    const kid = rows[0].kontakt_id;
    const ES: Record<string, string> = { angeboten: "Freigabe offen", freigegeben: "freigegeben", zurueckgezogen: "zurückgezogen" };
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${kid}, 'eintrag_geaendert', ${"Partner-Freigabe " + (titel || "") + " geändert: " + ES[st]})`;
    await sql`UPDATE crm_kontakte SET eintrag = (
        SELECT CASE WHEN bool_or(status = 'freigegeben') THEN 'freigegeben' WHEN bool_or(status = 'angeboten') THEN 'angeboten' END
        FROM crm_eintraege WHERE kontakt_id = ${kid}), updated_at = now() WHERE id = ${kid}`;
    return Response.json({ ok: true });
  }

  if (aktion === "loeschen") {
    await sql`DELETE FROM crm_kontakte WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (aktion === "notiz") {
    const text = clip(body.text, 2000);
    if (!text) return fehler("Leere Notiz.");
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${id}, 'notiz', ${text})`;
    await sql`UPDATE crm_kontakte SET updated_at = now() WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (aktion === "ergebnis") {
    const erg = String(body.ergebnis || "");
    if (!ERGEBNISSE[erg]) return fehler("Unbekanntes Ergebnis.");
    const rows = await sql`SELECT versuche, status FROM crm_kontakte WHERE id = ${id}`;
    if (!rows.length) return fehler("Kontakt nicht gefunden.", 404);
    const notiz = clip(body.notiz, 2000);
    let status = rows[0].status as string;
    let versuche = Number(rows[0].versuche) || 0;
    let naechster: Date | null = null;
    let wlEmail: string | null = null;
    let hinweis = "";
    let eintragNeu: string | null = null;

    switch (erg) {
      case "nicht_erreicht":
        versuche++;
        if (versuche <= 2) { status = "wiedervorlage"; naechster = andereTageszeit(); hinweis = "Nächster Versuch zu einer anderen Tageszeit."; }
        else if (versuche === 3) { status = "mailbox"; naechster = werktag(5, 10, 0); hinweis = "3. Versuch: Beim nächsten Mal Mailbox-Spruch nutzen. Wieder in einer Woche."; }
        else { status = "nicht_erreichbar"; naechster = null; hinweis = "4 Versuche ohne Erfolg: Kontakt pausiert."; }
        break;
      case "mailbox":
        versuche++; status = "mailbox"; naechster = werktag(3, 10, 0); hinweis = "Mailbox besprochen, in 3 Werktagen nochmal.";
        break;
      case "rueckruf": {
        const t = body.wann ? new Date(String(body.wann)) : null;
        status = "wiedervorlage"; naechster = t && !isNaN(t.getTime()) ? t : werktag(1, 10, 0);
        break;
      }
      case "mail_gewuenscht":
        status = "mail_gewuenscht"; naechster = werktag(3, 10, 0); hinweis = "Infos per Mail schicken, nach 3 Werktagen nachfassen.";
        break;
      case "warteliste":
        wlEmail = clip(body.email, 254)?.toLowerCase() || null;
        if (!wlEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(wlEmail)) return fehler("Bitte eine gültige E-Mail-Adresse eingeben.");
        status = "warteliste"; naechster = werktag(2, 10, 0); hinweis = "In 2 Werktagen prüfen, ob die Anmeldung bestätigt ist.";
        break;
      case "kein_interesse": status = "kein_interesse"; naechster = null; break;
      case "keine_anrufe": status = "keine_anrufe"; naechster = null; break;
      case "gespraech": naechster = body.wann ? new Date(String(body.wann)) : null; break;
      case "eintrag": {
        // Freigabe-Mail direkt über Brevo senden: Absender und Antwort immer hallo@ab-gemacht.info
        const m = body.mail as Record<string, unknown> | undefined;
        if (m) {
          const an = clip(m.an, 254)?.toLowerCase() || "";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(an)) return fehler("Bitte eine gültige E-Mail für die Freigabe eingeben.");
          const key = Netlify.env.get("BREVO_API_KEY");
          if (!key) return fehler("BREVO_API_KEY fehlt in Netlify, Mail nicht gesendet.", 503);
          const absender = Netlify.env.get("MAIL_FROM") || "hallo@ab-gemacht.info";
          const antwort = Netlify.env.get("CRM_REPLY_TO") || "hallo@ab-gemacht.info";
          const res = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              sender: { name: "Samuel Edele | Abgemacht", email: absender },
              to: [{ email: an }],
              bcc: [{ email: antwort }],
              replyTo: { email: antwort, name: "Samuel Edele | Abgemacht" },
              subject: clip(m.betreff, 200) || "Abgemacht – Ihre Freigabe als Partner-Betrieb",
              textContent: clip(m.text, 5000) || "",
            }),
          });
          if (!res.ok) { console.error("Brevo", res.status, await res.text()); return fehler("Mail konnte nicht gesendet werden (Brevo " + res.status + "). Nichts gespeichert.", 502); }
          hinweis = `Freigabe-Mail an ${an} gesendet. `;
          await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${id}, 'mail', ${"Freigabe-Mail gesendet an " + an})`;
        }
        eintragNeu = "angeboten"; naechster = werktag(2, 10, 0); hinweis += "In 2 Werktagen nachfassen.";
        break;
      }
      case "eintrag_frei":
        eintragNeu = "freigegeben"; naechster = null; hinweis = "Freigegeben: Eintrag zum Start einstellen.";
        break;
    }

    await sql`
      UPDATE crm_kontakte SET status=${status}, versuche=${versuche}, naechster_kontakt=${naechster ? naechster.toISOString() : null},
        letzter_kontakt=now(), warteliste_email=COALESCE(${wlEmail}, warteliste_email), eintrag=COALESCE(${eintragNeu}, eintrag), updated_at=now()
      WHERE id=${id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${id}, ${erg}, ${[ERGEBNISSE[erg], wlEmail, notiz].filter(Boolean).join(" · ")})`;
    // Start-Einträge strukturiert speichern, damit sie zum Start automatisch in die App übernommen werden
    if (erg === "eintrag") {
      const e = (body.eintrag || {}) as Record<string, unknown>;
      const titel = clip(e.titel, 160);
      if (titel) await sql`INSERT INTO crm_eintraege (kontakt_id, art, titel, text, ort, kontakt) VALUES (${id}, ${clip(e.art, 30) || "Stelle"}, ${titel}, ${clip(e.text, 1000)}, ${clip(e.ort, 120)}, ${clip(e.kontakt, 200)})`;
      if (titel && e.art === "Partner") await sql`UPDATE crm_kontakte SET leistungen = ${clip(titel, 300)}, partner = COALESCE(partner, 'interessiert'), updated_at = now() WHERE id = ${id}`;
    }
    if (erg === "eintrag_frei") {
      await sql`UPDATE crm_eintraege SET status = 'freigegeben', freigabe_am = now() WHERE kontakt_id = ${id} AND status = 'angeboten'`;
      // Freigabe = aktiver Partner in /vermittlung (mit WhatsApp-Okay, wenn zugestimmt)
      const wa = body.wa === true;
      await sql`UPDATE crm_kontakte SET partner = 'aktiv', partner_seit = COALESCE(partner_seit, now()),
          wa_ok_am = CASE WHEN ${wa} THEN COALESCE(wa_ok_am, now()) ELSE wa_ok_am END,
          leistungen = COALESCE(leistungen, (SELECT titel FROM crm_eintraege WHERE kontakt_id = ${id} AND art = 'Partner' ORDER BY created_at DESC LIMIT 1)),
          updated_at = now() WHERE id = ${id}`;
    }
    return Response.json({ ok: true, status, versuche, naechster_kontakt: naechster, hinweis });
  }

  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: "/api/crm" };
