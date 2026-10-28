import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";
import { angemeldet, pwHash, pwPruefen, pwRegel, sitzungStarten, cookieSetzen, cookieLoeschen, sha256, ART_NAME } from "../lib/portal.ts";
import { annehmen, ladeAngebote, angeboteAnonym, ZU } from "../lib/annehmen.ts";
import * as Besichtigung from "../lib/besichtigung.ts";
import { seite, adminMail, esc, mailLayout, knopf, absatz, gruss, tabelle, sendeMail, ohneKontakt } from "../lib/post.ts";

// Portal für feste Partner (Hausverwaltungen, Makler, Gewerbe) unter /portal und Mieter-Meldung per QR-Code unter /melden.
//   POST /api/portal  {aktion, …}   mit Sitzungs-Cookie (außer login, einladung_*)
//   GET  /api/melden?o=o_…          Objektname für das Mieter-Formular
//   POST /api/melden  {o, …}         Mieter meldet einen Schaden

const antwort = (d: unknown, status = 200, kopf: Record<string, string> = {}) =>
  Response.json(d, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...kopf } });
const fehler = (msg: string, status = 400) => antwort({ ok: false, error: msg }, status);
const clip = (v: unknown, n = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};
const OBJ_ARTEN = ["wohnen", "gewerbe", "gemischt"];
const MELD_STATUS = ["neu", "frei", "selbst", "kein", "erledigt"];
const ARTEN = ["einmalig", "projekt", "langzeit"];
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fotos: im Browser verkleinert, hier geprüft (echte JPEG/PNG/WebP, höchstens etwa 1,5 MB)
function fotos(roh: unknown, max = 3) {
  const out: { mime: string; daten: string; bytes: number }[] = [];
  for (const f of (Array.isArray(roh) ? roh : []).slice(0, max)) {
    const m = String(f || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!m || m[2].length > 2_000_000) continue;
    const k = Buffer.from(m[2].slice(0, 24), "base64");
    const echt = m[1] === "jpeg" ? k[0] === 0xff && k[1] === 0xd8 : m[1] === "png" ? k.toString("latin1", 1, 4) === "PNG" : k.toString("latin1", 8, 12) === "WEBP";
    if (echt) out.push({ mime: "image/" + m[1], daten: m[2], bytes: Math.floor(m[2].length * 3 / 4) });
  }
  return out;
}
async function fotosSpeichern(sql: any, meldungId: number, liste: { mime: string; daten: string; bytes: number }[]) {
  let nr = 0;
  for (const f of liste) { nr++; await sql`INSERT INTO meldung_fotos (meldung_id, nr, mime, daten, bytes) VALUES (${meldungId}, ${nr}, ${f.mime}, ${f.daten}, ${f.bytes})`; }
  return nr;
}
const ortAus = (adresse: string | null) => {
  const m = String(adresse || "").match(/\b\d{5}\s+([^,\n]+)/);
  return m ? m[1].trim() : (String(adresse || "").split(",").pop() || "").trim() || null;
};

export default async (req: Request, _context: Context) => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);
  const sql = neon(dbUrl);
  const url = new URL(req.url);

  /* ================= Mieter-Meldung per QR-Code ================= */
  if (url.pathname === "/api/melden") {
    if (req.method === "GET") {
      const o = url.searchParams.get("o") || "";
      if (!/^o_[0-9a-f]{32}$/.test(o)) return fehler("Dieser QR-Code ist ungültig.", 404);
      const r = (await sql`SELECT o.name, o.adresse, k.name AS kunde FROM objekte o JOIN kunden k ON k.id = o.kunde_id WHERE o.qr_token = ${o} AND o.aktiv`)[0];
      return r ? antwort({ ok: true, objekt: r.name, adresse: r.adresse, verwaltung: r.kunde }) : fehler("Diesen QR-Code gibt es nicht (mehr). Bitte melden Sie sich direkt bei Ihrer Verwaltung.", 404);
    }
    if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);
    let b: any = {}; try { b = await req.json(); } catch { return fehler("Ungültige Anfrage."); }
    if (b.website) return antwort({ ok: true }); // Honigtopf gegen Bots
    const o = (await sql`SELECT o.id, o.name, o.kunde_id, k.name AS kunde FROM objekte o JOIN kunden k ON k.id = o.kunde_id WHERE o.qr_token = ${String(b.o || "")} AND o.aktiv`)[0];
    if (!o) return fehler("Diesen QR-Code gibt es nicht (mehr).", 404);
    const text = clip(b.text, 3000), name = clip(b.name, 120), kontakt = clip(b.kontakt, 160);
    if (!text || text.length < 5) return fehler("Bitte beschreiben Sie kurz, was kaputt ist.");
    if (!name || !kontakt) return fehler("Bitte geben Sie Ihren Namen und eine Telefonnummer oder E-Mail an, damit sich die Verwaltung melden kann.");
    if (b.einwilligung !== true) return fehler("Bitte bestätigen Sie den Hinweis zum Datenschutz.");
    const zuletzt = (await sql`SELECT count(*)::int AS n FROM meldungen WHERE objekt_id = ${o.id} AND quelle = 'mieter' AND created_at > now() - interval '1 hour'`)[0].n;
    if (zuletzt >= 10) return fehler("Gerade kommen sehr viele Meldungen für dieses Haus. Bitte versuchen Sie es später noch einmal oder melden Sie sich direkt bei der Verwaltung.", 429);
    const titel = clip(b.titel, 120) || text.split(/[.\n]/)[0].slice(0, 80);
    const m = (await sql`INSERT INTO meldungen (kunde_id, objekt_id, quelle, name, einheit, kontakt, titel, text, dringend)
      VALUES (${o.kunde_id}, ${o.id}, 'mieter', ${name}, ${clip(b.einheit, 60)}, ${kontakt}, ${titel}, ${text}, ${b.dringend === true}) RETURNING id`)[0];
    const n = await fotosSpeichern(sql, m.id, fotos(b.fotos));
    const an = await sql`SELECT email, name FROM kunden_zugaenge WHERE kunde_id = ${o.kunde_id} AND aktiv AND pw_hash IS NOT NULL`;
    for (const z of an) await sendeMail(z.email, z.name, `${b.dringend === true ? "DRINGEND: " : ""}Neue Mieter-Meldung: ${titel}`, mailLayout(
      absatz(`Guten Tag${z.name ? " " + esc(z.name) : ""},`) + absatz(`für <b>${esc(o.name)}</b> ist eine neue Meldung eingegangen:`) +
      tabelle([["Was", titel], ["Beschreibung", text], ["Wohnung", clip(b.einheit, 60)], ["Gemeldet von", name], ["Kontakt", kontakt], ["Fotos", n ? n + " angehängt" : null]]) +
      absatz("Im Portal entscheiden Sie mit einem Klick: Angebote holen, selbst erledigen oder kein Handlungsbedarf.") + knopf(`${seite()}/portal`, "Im Portal öffnen") + gruss));
    if (!an.length) await sendeMail(adminMail(), "Samuel", `Mieter-Meldung ohne Portal-Zugang: ${o.kunde}`, mailLayout(absatz(`Für ${esc(o.name)} (${esc(o.kunde)}) ist eine Meldung eingegangen, aber dort hat noch niemand einen eingerichteten Zugang.`) + tabelle([["Was", titel], ["Beschreibung", text]])));
    return antwort({ ok: true });
  }

  /* ================= Portal ================= */
  if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);
  // Schutz gegen fremde Seiten (CSRF): eigener Kopf, den nur unser Portal mitschickt
  if (req.headers.get("x-abgemacht") !== "1") return fehler("Ungültige Anfrage.", 403);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return fehler("Ungültige Anfrage."); }
  const aktion = String(body.aktion || "");

  if (aktion === "login") {
    const mail = String(body.email || "").trim().toLowerCase(), pw = String(body.pw || "");
    const z = (await sql`SELECT id, pw_hash, aktiv FROM kunden_zugaenge WHERE lower(email) = ${mail}`)[0];
    if (!z || !z.aktiv || !(await pwPruefen(pw, z.pw_hash))) { await warte(1200); return fehler("E-Mail oder Passwort stimmt nicht.", 401); }
    const token = await sitzungStarten(sql, z.id);
    return antwort({ ok: true }, 200, { "Set-Cookie": cookieSetzen(token) });
  }
  if (aktion === "einladung_pruefen" || aktion === "passwort_setzen") {
    const t = String(body.token || "");
    if (!/^e_[0-9a-f]{48}$/.test(t)) return fehler("Dieser Link ist ungültig.", 404);
    const z = (await sql`SELECT z.id, z.email, z.name, k.name AS kunde FROM kunden_zugaenge z JOIN kunden k ON k.id = z.kunde_id WHERE z.einlade_token = ${t} AND z.einlade_bis > now()`)[0];
    if (!z) return fehler("Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte fordern Sie bei Abgemacht einen neuen an.", 404);
    if (aktion === "einladung_pruefen") return antwort({ ok: true, email: z.email, name: z.name, kunde: z.kunde });
    const pw = String(body.pw || "");
    const regel = pwRegel(pw);
    if (regel) return fehler(regel);
    if (body.zustimmung !== true) return fehler("Bitte bestätigen Sie die Nutzungsbedingungen.");
    await sql`UPDATE kunden_zugaenge SET pw_hash = ${await pwHash(pw)}, einlade_token = NULL, einlade_bis = NULL, aktiv = true WHERE id = ${z.id}`;
    await sql`UPDATE kunden SET vereinbarung_am = COALESCE(vereinbarung_am, now()) WHERE id = (SELECT kunde_id FROM kunden_zugaenge WHERE id = ${z.id})`;
    await sql`DELETE FROM kunden_sitzungen WHERE zugang_id = ${z.id}`;
    const token = await sitzungStarten(sql, z.id);
    return antwort({ ok: true }, 200, { "Set-Cookie": cookieSetzen(token) });
  }

  const ich = await angemeldet(sql, req);
  if (aktion === "logout") {
    if (ich) await sql`DELETE FROM kunden_sitzungen WHERE token_hash = ${await sha256(ich.token)}`;
    return antwort({ ok: true }, 200, { "Set-Cookie": cookieLoeschen() });
  }
  if (!ich) return fehler("Bitte melden Sie sich an.", 401);
  const kid = ich.kunde_id;
  const meinObjekt = async (oid: number) => (await sql`SELECT * FROM objekte WHERE id = ${oid} AND kunde_id = ${kid}`)[0] || null;
  const meineMeldung = async (mid: number) => (await sql`SELECT * FROM meldungen WHERE id = ${mid} AND kunde_id = ${kid}`)[0] || null;

  if (aktion === "start") {
    const [objekte, meldungen, fristen] = await Promise.all([
      sql`SELECT id, name, adresse, art, einheiten, vor_ort, notizen, qr_token, aktiv FROM objekte WHERE kunde_id = ${kid} ORDER BY aktiv DESC, name`,
      sql`SELECT m.id, m.objekt_id, m.quelle, m.name, m.einheit, m.kontakt, m.titel, m.text, m.dringend, m.status, m.vermittlung_id, m.notiz, m.created_at, m.updated_at,
            (SELECT count(*)::int FROM meldung_fotos f WHERE f.meldung_id = m.id) AS fotos,
            v.status AS v_status, v.freigeschaltet_am, g.firma AS gewaehlt_firma,
            (SELECT count(*)::int FROM vermittlung_betriebe vb WHERE vb.vermittlung_id = v.id AND vb.status NOT IN ('abgesagt')) AS angefragt,
            (SELECT count(*)::int FROM vermittlung_betriebe vb WHERE vb.vermittlung_id = v.id AND vb.status IN ('angebot', 'gewaehlt', 'nicht_gewaehlt')) AS angebote,
            (SELECT count(*)::int FROM besichtigungen b WHERE b.vermittlung_id = v.id AND b.status = 'angefragt') AS besichtigung_offen,
            (SELECT min(b.termin) FROM besichtigungen b WHERE b.vermittlung_id = v.id AND b.status = 'bestaetigt') AS besichtigung_termin
          FROM meldungen m LEFT JOIN vermittlungen v ON v.id = m.vermittlung_id LEFT JOIN crm_kontakte g ON g.id = v.gewaehlt_id AND v.freigeschaltet_am IS NOT NULL
          WHERE m.kunde_id = ${kid} AND (m.status NOT IN ('erledigt', 'kein') OR m.updated_at > now() - interval '60 days')
          ORDER BY m.created_at DESC LIMIT 300`,
      sql`SELECT id, objekt_id, art, intervall_monate, letzter, notiz FROM fristen WHERE kunde_id = ${kid} ORDER BY id`,
    ]);
    for (const m of meldungen as any[]) if (m.besichtigung_termin) m.besichtigung_text = Besichtigung.terminText(m.besichtigung_termin);
    return antwort({ ok: true, ich: { name: ich.name, email: ich.email, kunde: ich.kunde, art: ich.art, art_name: ART_NAME[ich.art] || "" }, objekte, meldungen, fristen });
  }

  /* ---------- Objekte ---------- */
  if (aktion === "objekt_speichern") {
    const w = { name: clip(body.name, 120), adresse: clip(body.adresse, 200), art: OBJ_ARTEN.includes(String(body.art)) ? String(body.art) : "wohnen",
      einheiten: Number.isInteger(Number(body.einheiten)) && Number(body.einheiten) > 0 && Number(body.einheiten) < 10000 ? Number(body.einheiten) : null,
      vor_ort: clip(body.vor_ort, 200), notizen: clip(body.notizen, 1000) };
    if (!w.name) return fehler("Bitte einen Namen für das Objekt angeben, z. B. „Hirschstraße 12“.");
    const oid = Number(body.id) || 0;
    if (oid) {
      if (!(await meinObjekt(oid))) return fehler("Objekt nicht gefunden.", 404);
      await sql`UPDATE objekte SET name = ${w.name}, adresse = ${w.adresse}, art = ${w.art}, einheiten = ${w.einheiten}, vor_ort = ${w.vor_ort}, notizen = ${w.notizen}, aktiv = ${body.aktiv !== false} WHERE id = ${oid}`;
      return antwort({ ok: true, id: oid });
    }
    const r = await sql`INSERT INTO objekte (kunde_id, name, adresse, art, einheiten, vor_ort, notizen) VALUES (${kid}, ${w.name}, ${w.adresse}, ${w.art}, ${w.einheiten}, ${w.vor_ort}, ${w.notizen}) RETURNING id`;
    return antwort({ ok: true, id: r[0].id });
  }
  if (aktion === "qr_neu") {
    const o = await meinObjekt(Number(body.id) || 0);
    if (!o) return fehler("Objekt nicht gefunden.", 404);
    await sql`UPDATE objekte SET qr_token = 'o_' || replace(gen_random_uuid()::text, '-', '') WHERE id = ${o.id}`;
    return antwort({ ok: true });
  }

  /* ---------- Meldungen ---------- */
  if (aktion === "meldung_neu") {
    const o = body.objekt_id ? await meinObjekt(Number(body.objekt_id)) : null;
    if (body.objekt_id && !o) return fehler("Objekt nicht gefunden.", 404);
    const titel = clip(body.titel, 120), text = clip(body.text, 3000);
    if (!titel) return fehler("Bitte kurz angeben, worum es geht.");
    const m = (await sql`INSERT INTO meldungen (kunde_id, objekt_id, quelle, name, einheit, kontakt, titel, text, dringend)
      VALUES (${kid}, ${o ? o.id : null}, ${body.quelle === "telefon" ? "telefon" : "portal"}, ${clip(body.name, 120)}, ${clip(body.einheit, 60)}, ${clip(body.kontakt, 160)}, ${titel}, ${text}, ${body.dringend === true})
      RETURNING id`)[0];
    await fotosSpeichern(sql, m.id, fotos(body.fotos));
    return antwort({ ok: true, id: m.id });
  }
  if (aktion === "meldung_fotos") {
    const m = await meineMeldung(Number(body.id) || 0);
    if (!m) return fehler("Meldung nicht gefunden.", 404);
    const fs = await sql`SELECT nr, mime, daten FROM meldung_fotos WHERE meldung_id = ${m.id} ORDER BY nr`;
    return antwort({ ok: true, fotos: fs.map((f: any) => ({ nr: f.nr, src: `data:${f.mime};base64,${f.daten}` })) });
  }
  if (aktion === "meldung_status") {
    const m = await meineMeldung(Number(body.id) || 0);
    if (!m) return fehler("Meldung nicht gefunden.", 404);
    const st = String(body.status);
    if (!MELD_STATUS.includes(st) || st === "frei") return fehler("Unbekannter Status.");
    if (m.vermittlung_id && st === "neu") return fehler("Für diese Meldung holt Abgemacht schon Angebote.");
    await sql`UPDATE meldungen SET status = ${st}, notiz = COALESCE(${clip(body.notiz, 1000)}, notiz), updated_at = now() WHERE id = ${m.id}`;
    return antwort({ ok: true });
  }
  // „Angebote holen“: aus der Meldung wird eine Anfrage in der Vermittlung (bestätigt, weil von einem festen Partner)
  if (aktion === "angebote_holen") {
    const m = await meineMeldung(Number(body.id) || 0);
    if (!m) return fehler("Meldung nicht gefunden.", 404);
    if (m.vermittlung_id) return fehler("Für diese Meldung holt Abgemacht schon Angebote.", 409);
    const o = m.objekt_id ? await meinObjekt(m.objekt_id) : null;
    const art = ARTEN.includes(String(body.art)) ? String(body.art) : "einmalig";
    const leistung = clip(body.leistung, 200) || m.titel;
    const beschreibung = clip([m.text, m.einheit ? "Wohnung/Einheit: " + m.einheit : null, clip(body.hinweis, 1500)].filter(Boolean).join("\n\n"), 3600);
    const adresse = o?.adresse || null;
    const vorOrt = clip(body.vor_ort, 200) || o?.vor_ort || (m.name && m.kontakt ? `${m.name} (${m.einheit || "Mieter"}), ${m.kontakt}` : null);
    const kontakt = [ich.email, ich.kunde_tel].filter(Boolean).join(" · ");
    const v = (await sql`INSERT INTO vermittlungen (auftraggeber, kontakt, kanal, leistung, ort, zeitraum, budget, art, laufzeit, beschreibung, notizen,
          objekt_adresse, vor_ort, kunde_id, objekt_id, bestaetigt_am)
      VALUES (${ich.kunde + (ich.name ? " (" + ich.name + ")" : "")}, ${kontakt}, 'portal', ${leistung}, ${ortAus(adresse)}, ${clip(body.zeitraum, 200) || (m.dringend ? "dringend" : null)},
              ${clip(body.budget, 60)}, ${art}, ${clip(body.laufzeit, 100)}, ${beschreibung}, ${"Aus dem Portal · " + (ART_NAME[ich.art] || "") + (o ? " · Objekt: " + o.name : "")},
              ${adresse}, ${vorOrt}, ${kid}, ${o ? o.id : null}, now())
      RETURNING id`)[0];
    const fs = await sql`SELECT nr, mime, daten, bytes FROM meldung_fotos WHERE meldung_id = ${m.id} ORDER BY nr LIMIT 5`;
    for (const f of fs) await sql`INSERT INTO anfrage_fotos (vermittlung_id, nr, mime, daten, bytes) VALUES (${v.id}, ${f.nr}, ${f.mime}, ${f.daten}, ${f.bytes})`;
    await sql`UPDATE meldungen SET status = 'frei', vermittlung_id = ${v.id}, updated_at = now() WHERE id = ${m.id}`;
    await sendeMail(adminMail(), "Samuel", `Neue Anfrage aus dem Portal #${v.id}: ${leistung}`, mailLayout(
      absatz(`<b>${esc(ich.kunde)}</b> (fester Partner) möchte Angebote:`) +
      tabelle([["Leistung", leistung], ["Objekt", o ? o.name + (adresse ? ", " + adresse : "") : null], ["Wann", clip(body.zeitraum, 200) || (m.dringend ? "dringend" : null)], ["Budget", clip(body.budget, 60)], ["Details", beschreibung], ["Fotos", fs.length ? fs.length + " angehängt" : null]]) +
      absatz("Die Anfrage ist schon bestätigt. Jetzt passende Betriebe anfragen, persönlich oder automatisch.") + knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
    return antwort({ ok: true, vermittlung: v.id });
  }

  /* ---------- Angebote und Besichtigungen zu einer Meldung ---------- */
  const vermittlungZu = async () => {
    const m = await meineMeldung(Number(body.id) || 0);
    if (!m || !m.vermittlung_id) return null;
    const v = (await sql`SELECT v.*, k.firma AS g_firma, k.ansprechpartner AS g_ansprech, k.telefon AS g_tel, k.email AS g_mail, k.website AS g_web
        FROM vermittlungen v LEFT JOIN crm_kontakte k ON k.id = v.gewaehlt_id WHERE v.id = ${m.vermittlung_id} AND v.kunde_id = ${kid}`)[0];
    return v ? { m, v } : null;
  };
  if (aktion === "angebote") {
    const x = await vermittlungZu();
    if (!x) return fehler("Zu dieser Meldung gibt es noch keine Anfrage.", 404);
    const { v } = x;
    const liste = await ladeAngebote(sql, v.id);
    const gew = ["abgemacht", "erledigt"].includes(v.status) && v.gewaehlt_id && v.freigeschaltet_am;
    const bes = await sql`SELECT b.id, b.vb_id, b.wunsch, b.termin, b.nachricht, b.status, k.kategorie, k.ort, vb.status AS vb_status
        FROM besichtigungen b JOIN vermittlung_betriebe vb ON vb.id = b.vb_id JOIN crm_kontakte k ON k.id = vb.kontakt_id
        WHERE b.vermittlung_id = ${v.id} ORDER BY b.created_at`;
    const angefragt = (await sql`SELECT count(*)::int AS n FROM vermittlung_betriebe WHERE vermittlung_id = ${v.id} AND status NOT IN ('abgesagt')`)[0].n;
    return antwort({
      ok: true, status: v.status, offen: !ZU.includes(v.status), angefragt, wartet: ["abgemacht", "erledigt"].includes(v.status) && !v.freigeschaltet_am,
      angebote: angeboteAnonym(liste, !!gew),
      besichtigungen: bes.map((b: any, i: number) => ({ id: b.id, label: "Betrieb " + (i + 1), kategorie: b.kategorie, ort: b.ort, status: b.status,
        wunsch: (b.wunsch || []).map((t: string) => ({ wert: t, text: Besichtigung.terminText(t) })), termin: b.termin, termin_text: b.termin ? Besichtigung.terminText(b.termin) : null, nachricht: ohneKontakt(b.nachricht) })),
      objekt_adresse: v.objekt_adresse, vor_ort: v.vor_ort,
      betrieb: gew ? { firma: v.g_firma, ansprechpartner: v.g_ansprech, telefon: v.g_tel, email: v.g_mail, website: v.g_web } : null,
    });
  }
  if (aktion === "annehmen") {
    const x = await vermittlungZu();
    if (!x) return fehler("Zu dieser Meldung gibt es noch keine Anfrage.", 404);
    const e = await annehmen(sql, x.v, Number(body.vb) || 0, ich.kunde + " (Portal)");
    if (!e.ok) return fehler(e.fehler!, e.status || 409);
    return antwort(e.wartet ? { ok: true, wartet: true } : { ok: true, betrieb: e.betrieb });
  }
  if (aktion === "besichtigung") {
    const x = await vermittlungZu();
    if (!x) return fehler("Zu dieser Meldung gibt es noch keine Anfrage.", 404);
    const bid = Number(body.bid) || 0;
    if (!(await sql`SELECT id FROM besichtigungen WHERE id = ${bid} AND vermittlung_id = ${x.v.id}`).length) return fehler("Besichtigung nicht gefunden.", 404);
    const st = String(body.status);
    if (!["bestaetigt", "abgelehnt", "vorschlag"].includes(st)) return fehler("Unbekannter Status.");
    const adresse = clip(body.objekt_adresse, 200), vorOrt = clip(body.vor_ort, 200);
    if (adresse || vorOrt) await sql`UPDATE vermittlungen SET objekt_adresse = COALESCE(${adresse}, objekt_adresse), vor_ort = COALESCE(${vorOrt}, vor_ort), updated_at = now() WHERE id = ${x.v.id}`;
    const e = await Besichtigung.setzen(sql, bid, st as any, clip(body.termin, 120), ich.kunde + " (Portal)", clip(body.nachricht, 500));
    return e.ok ? antwort({ ok: true }) : fehler(e.fehler!, 409);
  }

  /* ---------- Fristen (Prüfungen und Wartungen) ---------- */
  if (aktion === "frist_speichern") {
    const art = clip(body.art, 120), iv = Number(body.intervall_monate);
    if (!art) return fehler("Bitte angeben, was geprüft oder gewartet wird.");
    if (!Number.isInteger(iv) || iv < 1 || iv > 240) return fehler("Bitte das Intervall in Monaten angeben (1 bis 240).");
    const letzter = /^\d{4}-\d{2}-\d{2}$/.test(String(body.letzter)) ? String(body.letzter) : null;
    const oid = body.objekt_id ? Number(body.objekt_id) : null;
    if (oid && !(await meinObjekt(oid))) return fehler("Objekt nicht gefunden.", 404);
    const fid = Number(body.id) || 0;
    if (fid) await sql`UPDATE fristen SET art = ${art}, intervall_monate = ${iv}, letzter = ${letzter}, objekt_id = ${oid}, notiz = ${clip(body.notiz, 500)} WHERE id = ${fid} AND kunde_id = ${kid}`;
    else await sql`INSERT INTO fristen (kunde_id, objekt_id, art, intervall_monate, letzter, notiz) VALUES (${kid}, ${oid}, ${art}, ${iv}, ${letzter}, ${clip(body.notiz, 500)})`;
    return antwort({ ok: true });
  }
  if (aktion === "frist_erledigt") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(body.datum)) ? String(body.datum) : new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    await sql`UPDATE fristen SET letzter = ${d} WHERE id = ${Number(body.id) || 0} AND kunde_id = ${kid}`;
    return antwort({ ok: true });
  }
  if (aktion === "frist_loeschen") {
    await sql`DELETE FROM fristen WHERE id = ${Number(body.id) || 0} AND kunde_id = ${kid}`;
    return antwort({ ok: true });
  }

  /* ---------- Eigenes Passwort ---------- */
  if (aktion === "passwort_aendern") {
    const z = (await sql`SELECT pw_hash FROM kunden_zugaenge WHERE id = ${ich.id}`)[0];
    if (!(await pwPruefen(String(body.alt || ""), z.pw_hash))) { await warte(800); return fehler("Das bisherige Passwort stimmt nicht.", 401); }
    const regel = pwRegel(String(body.neu || ""));
    if (regel) return fehler(regel);
    await sql`UPDATE kunden_zugaenge SET pw_hash = ${await pwHash(String(body.neu))} WHERE id = ${ich.id}`;
    await sql`DELETE FROM kunden_sitzungen WHERE zugang_id = ${ich.id} AND token_hash <> ${await sha256(ich.token)}`;
    return antwort({ ok: true });
  }

  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: ["/api/portal", "/api/melden"] };
