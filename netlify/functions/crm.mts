import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";

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
  eintrag: "Start-Eintrag angeboten",
  eintrag_frei: "Start-Eintrag freigegeben",
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
    return Response.json({ ok: true, kontakte, jetzt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  if (aktion === "verlauf") {
    const log = await sql`SELECT art, text, created_at FROM crm_log WHERE kontakt_id = ${id} ORDER BY created_at DESC LIMIT 100`;
    return Response.json({ ok: true, log });
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
      case "eintrag":
        eintragNeu = "angeboten"; naechster = werktag(2, 10, 0); hinweis = "Text zur Freigabe mailen, in 2 Werktagen nachfassen.";
        break;
      case "eintrag_frei":
        eintragNeu = "freigegeben"; naechster = null; hinweis = "Freigegeben: Eintrag zum Start einstellen.";
        break;
    }

    await sql`
      UPDATE crm_kontakte SET status=${status}, versuche=${versuche}, naechster_kontakt=${naechster ? naechster.toISOString() : null},
        letzter_kontakt=now(), warteliste_email=COALESCE(${wlEmail}, warteliste_email), eintrag=COALESCE(${eintragNeu}, eintrag), updated_at=now()
      WHERE id=${id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${id}, ${erg}, ${[ERGEBNISSE[erg], wlEmail, notiz].filter(Boolean).join(" · ")})`;
    return Response.json({ ok: true, status, versuche, naechster_kontakt: naechster, hinweis });
  }

  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: "/api/crm" };
