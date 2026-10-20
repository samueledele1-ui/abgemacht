import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";
import { rechnungPdf, datumDE, euro, type Absender } from "../lib/rechnung.ts";
import { auftragswert, freischaltung } from "../lib/gebuehr.ts";
import { freigeben } from "../lib/freischalten.ts";
import { bewerte, analysiere } from "../lib/passend.ts";
import { empfehlCode, empfehlLink, EMPFEHL_ANTEIL } from "../lib/empfehlung.ts";
import { seite, esc as escP, mailLayout, knopf, absatz, gruss, tabelle, sendeMail, ohneKontakt, mailAus } from "../lib/post.ts";

// Vermittlung von Hand (Startphase): Anfragen von Auftraggebern, Partner-Betriebe, Angebote, „Abgemacht“.
// Geschützt mit demselben ADMIN_PASSWORT wie /crm. Alles über POST /api/vermittlung mit {pw, aktion, ...}.

const STATUS = ["neu", "angefragt", "angebote", "abgemacht", "erledigt", "verloren"];
const VB_STATUS = ["angefragt", "angebot", "abgesagt", "keine_antwort", "gewaehlt", "nicht_gewaehlt"];
const ARTEN = ["einmalig", "projekt", "langzeit"];
const KANAELE = ["whatsapp", "telefon", "email", "web", "persoenlich"];
const FELDER = ["auftraggeber", "kontakt", "kanal", "leistung", "ort", "zeitraum", "budget", "art", "laufzeit", "beschreibung", "notizen"] as const;

const fehler = (msg: string, status = 400) =>
  Response.json({ ok: false, error: msg }, { status, headers: { "Cache-Control": "no-store" } });
const clip = (v: unknown, n = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};
const zahl = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};


/* ---------- Rechnungen ---------- */
const EIN_FELDER = ["name", "firma", "strasse", "plz_ort", "email", "telefon", "steuernummer", "iban", "bic", "bank", "kleinunternehmer", "zahlungsziel", "gebuehren_ab"];
async function einstellungen(sql: any): Promise<Record<string, string>> {
  const rows = await sql`SELECT schluessel, wert FROM einstellungen`;
  return Object.fromEntries(rows.map((r: any) => [r.schluessel, r.wert ?? ""]));
}
function fehlendeDaten(e: Record<string, string>) {
  const namen: Record<string, string> = { name: "Name", strasse: "Straße", plz_ort: "PLZ und Ort", steuernummer: "Steuernummer", gebuehren_ab: "Gebühren ab" };
  return Object.keys(namen).filter((k) => !String(e[k] || "").trim()).map((k) => namen[k]);
}
function absenderAus(e: Record<string, string>): Absender {
  return { name: e.name, firma: e.firma || undefined, strasse: e.strasse, plz_ort: e.plz_ort, email: e.email || undefined, telefon: e.telefon || undefined,
    steuernummer: e.steuernummer, iban: e.iban || undefined, bic: e.bic || undefined, bank: e.bank || undefined,
    kleinunternehmer: e.kleinunternehmer !== "nein", zahlungsziel: Math.max(0, Math.min(60, Number(e.zahlungsziel) || 14)) };
}
const berlinHeute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const monatsName = (m: string) => new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-15T12:00:00Z"));
function monatsGrenzen(monat: string) {
  const [jj, mm] = monat.split("-").map(Number);
  return { von: `${monat}-01 00:00 Europe/Berlin`, bis: `${mm === 12 ? jj + 1 : jj}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}-01 00:00 Europe/Berlin` };
}
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(u: Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", u))); }
async function neueNummer(sql: any, jahr: number) {
  const r = await sql`INSERT INTO rechnung_zaehler (jahr, lfd) VALUES (${jahr}, 1) ON CONFLICT (jahr) DO UPDATE SET lfd = rechnung_zaehler.lfd + 1 RETURNING lfd`;
  return `AB-${jahr}-${String(r[0].lfd).padStart(4, "0")}`;
}
async function rechnungsMail(an: string, name: string | null, betreff: string, html: string, anhang: { name: string; b64: string }) {
  const key = Netlify.env.get("BREVO_API_KEY");
  if (!key) throw new Error("E-Mail-Versand ist nicht eingerichtet (BREVO_API_KEY fehlt).");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Abgemacht", email: Netlify.env.get("MAIL_FROM") || "hallo@ab-gemacht.info" },
      replyTo: { email: Netlify.env.get("MAIL_REPLY_TO") || "samuel.edele1@gmail.com", name: "Abgemacht" },
      to: [name ? { email: an, name } : { email: an }], subject: betreff, htmlContent: html,
      attachment: [{ name: anhang.name, content: anhang.b64 }],
    }),
  });
  if (!res.ok) throw new Error("Mail konnte nicht gesendet werden (" + res.status + ").");
}
const escH = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function gleich(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

const ARTNAME: Record<string, string> = { einmalig: "Einmalig", projekt: "Projekt", langzeit: "Regelmäßig / langfristig" };
async function gebuehrenAktiv(sql: any) {
  const r = await sql`SELECT wert FROM einstellungen WHERE schluessel = 'gebuehren_ab'`;
  return !!r[0]?.wert && r[0].wert <= berlinHeute();
}
// Mail an einen angefragten Betrieb mit anonymer Anfrage und persönlichem „Angebot abgeben“-Link
async function anfrageMail(v: any, b: any, aktiv: boolean) {
  return sendeMail(b.email, b.ansprechpartner || b.firma, `Neue Anfrage: ${v.leistung || "Auftrag"}${v.ort ? " in " + v.ort : ""}`, mailLayout(
    absatz(`Guten Tag${b.ansprechpartner ? " " + escP(b.ansprechpartner) : ""},`) +
    absatz(`es gibt eine neue Anfrage, die zu ${escP(b.firma)} passen könnte:`) +
    tabelle([["Leistung", v.leistung], ["Ort", v.ort], ["Wann", v.zeitraum], ["Art", ARTNAME[v.art || "einmalig"] + (v.laufzeit ? ", " + v.laufzeit : "")], ["Budget", v.budget], ["Details", ohneKontakt(v.beschreibung)]]) +
    (v.fotos ? absatz(`📷 Zur Anfrage gibt es ${v.fotos} ${v.fotos === 1 ? "Foto" : "Fotos"}. Sie sehen ${v.fotos === 1 ? "es" : "sie"} auf der Angebotsseite.`) : "") +
    absatz("Wenn Sie Interesse haben, geben Sie Ihr Angebot über den Knopf ab. Das dauert eine Minute. Name und Kontaktdaten des Auftraggebers bekommen Sie, sobald er Ihr Angebot annimmt" + (aktiv ? " und Sie die Kontaktdaten freigeschaltet haben." : ".")) +
    knopf(`${seite()}/angebot?t=${b.token}`, "Angebot abgeben") +
    absatz(`<span style="font-size:14px;color:#5B6B65">Kein Interesse oder keine Zeit? Dann sagen Sie auf derselben Seite kurz ab. ${aktiv ? "Kosten entstehen nur, wenn der Auftraggeber Ihr Angebot annimmt: dann einmalig die Freischaltgebühr nach Budget, bei einer Spanne nach dem oberen Wert (siehe Bedingungen)." : "In der Startphase ist das für Sie kostenlos."}</span>`) + gruss));
}

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
    // Empfehlungslinks für Partner ohne Code anlegen
    for (const o of await sql`SELECT id FROM crm_kontakte WHERE partner IN ('aktiv', 'pausiert') AND empfehl_code IS NULL LIMIT 50`) await empfehlCode(sql, o.id);
    const [vermittlungen, betriebe, partner] = await Promise.all([
      sql`SELECT v.*, k.firma AS gewaehlt_firma, (SELECT e.firma FROM crm_kontakte e WHERE e.id = v.empfohlen_von) AS empfohlen_firma, (SELECT count(*)::int FROM anfrage_fotos f WHERE f.vermittlung_id = v.id) AS fotos FROM vermittlungen v LEFT JOIN crm_kontakte k ON k.id = v.gewaehlt_id ORDER BY
            CASE v.status WHEN 'neu' THEN 0 WHEN 'angefragt' THEN 1 WHEN 'angebote' THEN 2 WHEN 'abgemacht' THEN 3 ELSE 4 END, v.created_at DESC`,
      sql`SELECT vb.*, k.firma, k.ansprechpartner, k.telefon, k.email, k.kategorie, k.ort AS k_ort, k.wa_ok_am, k.gruender_nr
            FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id ORDER BY vb.angefragt_am`,
      sql`SELECT k.id, k.firma, k.kategorie, k.leistungen, k.ansprechpartner, k.telefon, k.email, k.website, k.ort, k.region,
                 k.partner, k.partner_seit, k.wa_ok_am, k.notizen, k.quelle, k.created_at, k.gruender_nr, k.empfehl_code,
                 (SELECT count(*)::int FROM vermittlungen e WHERE e.empfohlen_von = k.id) AS empfehlungen,
                 count(vb.id)::int AS angefragt,
                 count(vb.id) FILTER (WHERE vb.status IN ('angebot','gewaehlt','nicht_gewaehlt'))::int AS angebote,
                 count(vb.id) FILTER (WHERE vb.status = 'gewaehlt')::int AS zusagen,
                 round(avg(EXTRACT(EPOCH FROM (vb.geantwortet_am - vb.angefragt_am)) / 3600)::numeric, 1) AS antwort_h
            FROM crm_kontakte k LEFT JOIN vermittlung_betriebe vb ON vb.kontakt_id = k.id
           WHERE k.partner IS NOT NULL GROUP BY k.id ORDER BY k.partner, k.kategorie NULLS LAST, k.firma`,
    ]);
    for (const p of partner as any[]) p.empfehl_link = p.empfehl_code ? empfehlLink(p.empfehl_code) : null;
    return Response.json({ ok: true, vermittlungen, betriebe, partner }, { headers: { "Cache-Control": "no-store" } });
  }

  if (aktion === "neu" || aktion === "aendern") {
    const w: Record<string, string | null> = {};
    for (const f of FELDER) w[f] = clip(body[f], f === "beschreibung" || f === "notizen" ? 3000 : 200);
    if (w.art && !ARTEN.includes(w.art)) w.art = "einmalig";
    if (w.kanal && !KANAELE.includes(w.kanal)) w.kanal = null;
    if (aktion === "neu") {
      if (!w.leistung && !w.beschreibung) return fehler("Bitte mindestens Leistung oder Beschreibung angeben.");
      const r = await sql`INSERT INTO vermittlungen (auftraggeber, kontakt, kanal, leistung, ort, zeitraum, budget, art, laufzeit, beschreibung, notizen)
        VALUES (${w.auftraggeber}, ${w.kontakt}, ${w.kanal}, ${w.leistung}, ${w.ort}, ${w.zeitraum}, ${w.budget}, ${w.art || "einmalig"}, ${w.laufzeit}, ${w.beschreibung}, ${w.notizen})
        RETURNING id`;
      return Response.json({ ok: true, id: r[0].id });
    }
    const alt = (await sql`SELECT status, auftragswert, bewertung, bezahlt_am, gebuehr, freischalt_stufe, gewaehlt_id FROM vermittlungen WHERE id = ${id}`)[0];
    if (!alt) return fehler("Nicht gefunden.", 404);
    const status = STATUS.includes(String(body.status)) ? String(body.status) : alt.status;
    const wert = body.auftragswert !== undefined ? zahl(body.auftragswert) : (alt.auftragswert === null ? null : Number(alt.auftragswert));
    const b = Number(body.bewertung);
    const bew = body.bewertung !== undefined ? (Number.isInteger(b) && b >= 1 && b <= 5 ? b : null) : alt.bewertung;
    await sql`UPDATE vermittlungen SET auftraggeber = ${w.auftraggeber}, kontakt = ${w.kontakt}, kanal = ${w.kanal}, leistung = ${w.leistung},
        ort = ${w.ort}, zeitraum = ${w.zeitraum}, budget = ${w.budget}, art = ${w.art || "einmalig"}, laufzeit = ${w.laufzeit},
        beschreibung = ${w.beschreibung}, notizen = ${w.notizen}, status = ${status},
        auftragswert = ${wert}, bewertung = ${bew}, gebuehr = ${alt.bezahlt_am ? alt.gebuehr : freischaltung({ art: w.art || "einmalig", budget: w.budget, wert, stufe: alt.freischalt_stufe, gruender: !!(await sql`SELECT gruender_nr FROM crm_kontakte WHERE id = ${alt.gewaehlt_id ?? 0}`)[0]?.gruender_nr }).preis}, updated_at = now(),
        abgemacht_am = CASE WHEN ${status}::text IN ('abgemacht', 'erledigt') THEN COALESCE(abgemacht_am, now()) ELSE abgemacht_am END
      WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (aktion === "status") {
    const status = String(body.status);
    if (!STATUS.includes(status)) return fehler("Unbekannter Status.");
    await sql`UPDATE vermittlungen SET status = ${status}, updated_at = now() WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  // Freischaltung im Büro: von Hand freigeben (z. B. per Überweisung bezahlt oder Kulanz), zurücksetzen, Stufe festlegen
  if (aktion === "freigeben") {
    const ok = await freigeben(sql, id, { hand: true });
    return ok ? Response.json({ ok: true }) : fehler("Schon freigeschaltet oder noch nicht angenommen.", 409);
  }
  if (aktion === "zuruecksetzen") {
    const r = await sql`UPDATE vermittlungen SET status = 'angebote', gewaehlt_id = NULL, angenommen_am = NULL, gebuehr = NULL, zahlung_ref = NULL, updated_at = now()
      WHERE id = ${id} AND freigeschaltet_am IS NULL AND status = 'abgemacht' RETURNING id`;
    if (!r.length) return fehler("Zurücksetzen geht nur, solange noch nicht freigeschaltet ist.", 409);
    await sql`UPDATE vermittlung_betriebe SET status = 'angebot' WHERE vermittlung_id = ${id} AND status IN ('gewaehlt', 'nicht_gewaehlt') AND preis IS NOT NULL`;
    return Response.json({ ok: true });
  }
  if (aktion === "stufe") {
    const st = Number(body.stufe);
    await sql`UPDATE vermittlungen SET freischalt_stufe = ${st >= 1 && st <= 4 ? st : null}, updated_at = now() WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (aktion === "fotos") {
    const fs = await sql`SELECT nr, mime, daten FROM anfrage_fotos WHERE vermittlung_id = ${id} ORDER BY nr`;
    return Response.json({ ok: true, fotos: fs.map((f: any) => ({ nr: f.nr, src: `data:${f.mime};base64,${f.daten}` })) });
  }

  if (aktion === "kandidaten") {
    // Breite Suche: Wörter + Branchen-Gruppen (z. B. „Rechtsschutzberatung“ → alle Finanz-/Versicherungsbetriebe)
    // Suche nach Branche (q) und/oder Ort; die Sortierung nach Entfernung macht das Büro im Browser
    const q = clip(body.q, 200) || "";
    const ort = clip(body.ort, 80) || "";
    if (!q && !ort) return Response.json({ ok: true, kandidaten: [], gruppen: [] });
    const alle = (await sql`SELECT id, firma, kategorie, leistungen, ort, region, telefon, email, partner, wa_ok_am, status, gruender_nr FROM crm_kontakte
      WHERE (status IS NULL OR status NOT IN ('kein_interesse', 'keine_anrufe'))
        AND coalesce(kategorie, '') NOT ILIKE 'Auftraggeber%'`) as any[];
    const treffer = q ? bewerte(alle, q, ort) : alle.map((k) => ({ ...k, punkte: 0, grund: "" }));
    return Response.json({ ok: true, kandidaten: treffer.slice(0, 400), gruppen: q ? analysiere(q).gruppen : [] });
  }

  if (aktion === "anfragen") {
    const emp = (await sql`SELECT empfohlen_von FROM vermittlungen WHERE id = ${id}`)[0]?.empfohlen_von ?? null;
    const ids = (Array.isArray(body.kontakte) ? body.kontakte : []).map(Number).filter((n) => n > 0 && n !== emp).slice(0, 10);
    if (!ids.length) return fehler(emp ? "Der empfehlende Betrieb kann für seine eigene Empfehlung nicht angefragt werden." : "Keine Betriebe ausgewählt.");
    for (const k of ids) await sql`INSERT INTO vermittlung_betriebe (vermittlung_id, kontakt_id) VALUES (${id}, ${k}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE vermittlungen SET status = 'angefragt', updated_at = now() WHERE id = ${id} AND status = 'neu'`;
    for (const k of ids) await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${k}, 'vermittlung', ${"Anfrage #" + id + " geschickt"})`;
    // Automatisch per Mail an alle angefragten Betriebe mit E-Mail-Adresse (Link „Angebot abgeben“)
    const v = (await sql`SELECT v.*, (SELECT count(*)::int FROM anfrage_fotos f WHERE f.vermittlung_id = v.id) AS fotos FROM vermittlungen v WHERE v.id = ${id}`)[0];
    // Nur an Partner-Betriebe (haben den Bedingungen zugestimmt), nie an kalte Kontakte
    const bs = await sql`SELECT vb.id, vb.token, k.firma, k.ansprechpartner, CASE WHEN k.partner IN ('aktiv', 'interessiert') THEN k.email END AS email
      FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id
      WHERE vb.vermittlung_id = ${id} AND vb.kontakt_id = ANY(${ids}::int[]) AND vb.gemailt_am IS NULL`;
    const aktiv = await gebuehrenAktiv(sql);
    const ohneMail: string[] = [];
    let gemailt = 0;
    for (const b of bs) {
      if (b.email && body.mail !== false && (await anfrageMail(v, b, aktiv))) {
        gemailt++;
        await sql`UPDATE vermittlung_betriebe SET gemailt_am = now() WHERE id = ${b.id}`;
      } else ohneMail.push(b.firma);
    }
    return Response.json({ ok: true, gemailt, ohneMail });
  }

  if (aktion === "vb") {
    const vbid = Number(body.vb) || 0;
    const status = String(body.status);
    if (!VB_STATUS.includes(status)) return fehler("Unbekannter Status.");
    const r = await sql`UPDATE vermittlung_betriebe SET status = ${status}, angebot = COALESCE(${clip(body.angebot, 2000)}, angebot),
        preis = COALESCE(${clip(body.preis, 80)}, preis),
        geantwortet_am = CASE WHEN geantwortet_am IS NULL AND ${status}::text IN ('angebot', 'abgesagt') THEN now() ELSE geantwortet_am END
      WHERE id = ${vbid} RETURNING vermittlung_id, kontakt_id`;
    if (!r.length) return fehler("Nicht gefunden.", 404);
    if (status === "angebot") await sql`UPDATE vermittlungen SET status = 'angebote', updated_at = now() WHERE id = ${r[0].vermittlung_id} AND status IN ('neu', 'angefragt')`;
    return Response.json({ ok: true });
  }

  /* Monatsabrechnung: alle abgemachten Vermittlungen eines Monats, gruppiert nach Betrieb */
  if (aktion === "abrechnung" || aktion === "abgerechnet") {
    const monat = /^\d{4}-\d{2}$/.test(String(body.monat)) ? String(body.monat) : new Date().toISOString().slice(0, 7);
    const von = `${monat}-01 00:00 Europe/Berlin`;
    const [jj, mm] = monat.split("-").map(Number);
    const bis = `${mm === 12 ? jj + 1 : jj}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}-01 00:00 Europe/Berlin`;
    if (aktion === "abgerechnet") {
      const kid = Number(body.kontakt) || 0;
      const an = body.wert !== false;
      await sql`UPDATE vermittlungen SET abgerechnet_am = CASE WHEN ${an} THEN now() ELSE NULL END, updated_at = now()
        WHERE gewaehlt_id = ${kid} AND status IN ('abgemacht', 'erledigt')
          AND abgemacht_am >= ${von}::timestamptz AND abgemacht_am < ${bis}::timestamptz`;
      await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${kid}, 'abrechnung', ${(an ? "Abgerechnet: " : "Abrechnung zurückgenommen: ") + monat})`;
      return Response.json({ ok: true });
    }
    const posten = await sql`SELECT v.id, v.leistung, v.ort, v.art, v.laufzeit, v.auftragswert, v.gebuehr, v.abgemacht_am, v.abgerechnet_am, v.status, v.auftraggeber,
        v.rechnung_id, r.nummer AS rechnung_nummer, r.status AS rechnung_status,
        k.id AS kontakt_id, k.firma, k.ansprechpartner, k.email, k.telefon, k.ort AS k_ort, k.website, k.rechnungsadresse, k.gebuehren_ok_am
      FROM vermittlungen v JOIN crm_kontakte k ON k.id = v.gewaehlt_id LEFT JOIN rechnungen r ON r.id = v.rechnung_id
      WHERE v.status IN ('abgemacht', 'erledigt') AND v.bezahlt_am IS NULL
        AND v.abgemacht_am >= ${von}::timestamptz AND v.abgemacht_am < ${bis}::timestamptz
      ORDER BY k.firma, v.abgemacht_am`;
    const ein = await einstellungen(sql);
    return Response.json({ ok: true, monat, posten, gebuehren_ab: ein.gebuehren_ab || null, rechnungsdaten_ok: !fehlendeDaten(ein).length }, { headers: { "Cache-Control": "no-store" } });
  }

  /* Empfehlungen: Partner haben Kunden weitergeleitet, die Hälfte der bezahlten Freischaltgebühr geht an sie */
  if (aktion === "empfehlungen") {
    const liste = await sql`SELECT v.id, v.leistung, v.ort, v.status, v.created_at, v.gebuehr, v.bezahlt_am, v.empfehlung_ausgezahlt_am, v.gewaehlt_id,
        e.id AS empfehler_id, e.firma AS empfehler, e.ansprechpartner, e.email, e.telefon, g.firma AS gewaehlt_firma, r.status AS rechnung_status,
        (v.gebuehr > 0 AND v.gewaehlt_id IS DISTINCT FROM v.empfohlen_von AND (v.bezahlt_am IS NOT NULL OR r.status = 'bezahlt')) AS verdient,
        round(coalesce(v.gebuehr, 0) * ${EMPFEHL_ANTEIL}, 2)::float AS anteil
      FROM vermittlungen v JOIN crm_kontakte e ON e.id = v.empfohlen_von LEFT JOIN crm_kontakte g ON g.id = v.gewaehlt_id LEFT JOIN rechnungen r ON r.id = v.rechnung_id
      ORDER BY (v.empfehlung_ausgezahlt_am IS NULL) DESC, v.created_at DESC`;
    return Response.json({ ok: true, liste, anteil: EMPFEHL_ANTEIL }, { headers: { "Cache-Control": "no-store" } });
  }
  if (aktion === "empfehlung_ausgezahlt") {
    const an = body.wert !== false;
    const r = await sql`UPDATE vermittlungen SET empfehlung_ausgezahlt_am = CASE WHEN ${an} THEN now() ELSE NULL END, updated_at = now()
      WHERE id = ${id} AND empfohlen_von IS NOT NULL RETURNING empfohlen_von, round(coalesce(gebuehr, 0) * ${EMPFEHL_ANTEIL}, 2)::float AS anteil`;
    if (!r.length) return fehler("Nicht gefunden.", 404);
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r[0].empfohlen_von}, 'empfehlung', ${(an ? "Empfehlungsanteil ausgezahlt: " : "Auszahlung zurückgenommen: ") + euro(r[0].anteil) + " zu Anfrage #" + id})`;
    return Response.json({ ok: true });
  }

  if (aktion === "waehlen") {
    const vbid = Number(body.vb) || 0;
    const r = await sql`SELECT vb.vermittlung_id, vb.kontakt_id, vb.preis, vb.preis_betrag, v.art, v.budget, v.freischalt_stufe, k.gruender_nr
      FROM vermittlung_betriebe vb JOIN vermittlungen v ON v.id = vb.vermittlung_id JOIN crm_kontakte k ON k.id = vb.kontakt_id WHERE vb.id = ${vbid}`;
    if (!r.length) return fehler("Nicht gefunden.", 404);
    const { vermittlung_id, kontakt_id, preis, preis_betrag, art, budget, freischalt_stufe, gruender_nr } = r[0];
    // Bei regelmäßigen Aufträgen zählt der Wert des ersten Vertragsjahres (Monatspreis × 12)
    const roh = zahl(body.auftragswert) ?? zahl(preis) ?? (preis_betrag === null ? null : Number(preis_betrag));
    const proMonat = art === "langzeit" && (preis_betrag !== null || /monat|mtl|monatl/i.test(String(body.auftragswert || preis || "")));
    const wert = proMonat ? auftragswert("langzeit", roh) : roh;
    await sql`UPDATE vermittlung_betriebe SET status = CASE WHEN id = ${vbid} THEN 'gewaehlt' WHEN status = 'angebot' THEN 'nicht_gewaehlt' ELSE status END
      WHERE vermittlung_id = ${vermittlung_id}`;
    const geb = freischaltung({ art, budget, wert, stufe: freischalt_stufe, gruender: !!gruender_nr }).preis;
    await sql`UPDATE vermittlungen SET status = 'abgemacht', gewaehlt_id = ${kontakt_id}, auftragswert = ${wert}, gebuehr = ${geb}, updated_at = now(), abgemacht_am = COALESCE(abgemacht_am, now()),
        freigeschaltet_am = COALESCE(freigeschaltet_am, now())
      WHERE id = ${vermittlung_id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${kontakt_id}, 'vermittlung', ${"Abgemacht: Anfrage #" + vermittlung_id})`;
    return Response.json({ ok: true, gebuehr: geb });
  }

  if (aktion === "partner") {
    const kid = Number(body.kontakt) || 0;
    const partner = ["aktiv", "pausiert", "interessiert"].includes(String(body.partner)) ? String(body.partner) : null;
    const wa = body.wa_ok === true ? "ja" : body.wa_ok === false ? "nein" : "gleich";
    await sql`UPDATE crm_kontakte SET partner = ${partner}, partner_seit = CASE WHEN ${partner}::text IS NULL OR ${partner}::text = 'interessiert' THEN NULL ELSE COALESCE(partner_seit, now()) END,
        wa_ok_am = CASE WHEN ${wa}::text = 'ja' THEN COALESCE(wa_ok_am, now()) WHEN ${wa}::text = 'nein' THEN NULL ELSE wa_ok_am END,
        leistungen = COALESCE(${clip(body.leistungen, 300)}, leistungen), updated_at = now()
      WHERE id = ${kid}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${kid}, 'partner', ${partner ? "Partner: " + partner + (wa === "ja" ? ", WhatsApp-Okay" : "") : "Kein Partner mehr"})`;
    return Response.json({ ok: true });
  }

  if (aktion === "partner_neu") {
    const firma = clip(body.firma, 120);
    if (!firma) return fehler("Bitte den Firmennamen angeben.");
    const r = await sql`INSERT INTO crm_kontakte (firma, kategorie, ansprechpartner, telefon, email, website, ort, region, leistungen, status, quelle, partner, partner_seit, wa_ok_am, notizen)
      VALUES (${firma}, ${clip(body.kategorie, 80)}, ${clip(body.ansprechpartner, 120)}, ${clip(body.telefon, 60)}, ${clip(body.email, 160)},
              ${clip(body.website, 200)}, ${clip(body.ort, 80)}, ${clip(body.region, 80)}, ${clip(body.leistungen, 300)}, 'warteliste', 'partner', 'aktiv', now(),
              ${body.wa_ok === true ? new Date().toISOString() : null}, ${clip(body.notizen, 2000)})
      RETURNING id`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r[0].id}, 'partner', 'Als Partner angelegt')`;
    return Response.json({ ok: true, id: r[0].id });
  }


  /* ---------- Rechnungsdaten (Absender, Steuernummer, Bank) ---------- */
  if (aktion === "einstellungen") {
    const e = await einstellungen(sql);
    return Response.json({ ok: true, einstellungen: e, fehlt: fehlendeDaten(e) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (aktion === "einstellungen_speichern") {
    const w = (body.werte || {}) as Record<string, unknown>;
    for (const k of EIN_FELDER) {
      if (!(k in w)) continue;
      let v = clip(w[k], 200) ?? "";
      if (k === "kleinunternehmer") v = v === "nein" ? "nein" : "ja";
      if (k === "zahlungsziel") v = String(Math.max(0, Math.min(60, Number(v) || 14)));
      if (k === "gebuehren_ab" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fehler("Bitte ein gültiges Datum für „Gebühren ab“ wählen.");
      if (k === "iban") v = v.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
      await sql`INSERT INTO einstellungen (schluessel, wert) VALUES (${k}, ${v}) ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert, updated_at = now()`;
    }
    return Response.json({ ok: true });
  }

  /* ---------- Rechnung erstellen (Sammelrechnung pro Betrieb und Monat) ---------- */
  if (aktion === "rechnung_erstellen") {
    const kid = Number(body.kontakt) || 0;
    const monat = /^\d{4}-\d{2}$/.test(String(body.monat)) ? String(body.monat) : "";
    if (!kid || !monat) return fehler("Betrieb oder Monat fehlt.");
    const ein = await einstellungen(sql);
    const fehlt = fehlendeDaten(ein);
    if (fehlt.length) return fehler("Bitte zuerst die Rechnungsdaten ergänzen: " + fehlt.join(", ") + ".");
    const k = (await sql`SELECT id, firma, ansprechpartner, email, rechnungsadresse, gebuehren_ok_am FROM crm_kontakte WHERE id = ${kid}`)[0];
    if (!k) return fehler("Betrieb nicht gefunden.", 404);
    const adresse = clip(body.adresse, 300) || k.rechnungsadresse;
    if (!adresse || !/\d{5}/.test(adresse)) return fehler("Bitte die Rechnungsadresse des Betriebs mit Straße, PLZ und Ort eintragen.");
    if (!k.gebuehren_ok_am && body.zugestimmt !== true) return fehler("Der Betrieb muss den Gebühren vorher zugestimmt haben (Bedingungen, Abschnitt 3). Bitte bestätigen.");
    const { von, bis } = monatsGrenzen(monat);
    const ab = `${ein.gebuehren_ab} 00:00 Europe/Berlin`;
    const vs = await sql`SELECT id, leistung, ort, art, laufzeit, auftragswert, gebuehr, abgemacht_am FROM vermittlungen
      WHERE gewaehlt_id = ${kid} AND status IN ('abgemacht', 'erledigt') AND rechnung_id IS NULL AND gebuehr > 0
        AND abgemacht_am >= ${von}::timestamptz AND abgemacht_am < ${bis}::timestamptz AND abgemacht_am >= ${ab}::timestamptz
      ORDER BY abgemacht_am, id`;
    if (!vs.length) return fehler("Für diesen Betrieb gibt es in diesem Monat keine offenen, gebührenpflichtigen Vermittlungen (Gebühren gelten ab " + datumDE(new Date(ein.gebuehren_ab + "T12:00:00Z")) + ").");
    const positionen = vs.map((v: any) => ({
      vermittlung_id: v.id, datum: v.abgemacht_am,
      text: `Vermittlungsgebühr – Auftrag #${v.id} vom ${datumDE(new Date(v.abgemacht_am))}: ${v.leistung || "Auftrag"}${v.ort ? ", " + v.ort : ""}` +
        (v.art === "langzeit" ? ` (Langzeitauftrag${v.laufzeit ? ", " + v.laufzeit : ""})` : v.auftragswert ? ` (Auftragswert ${euro(Number(v.auftragswert))})` : ""),
      betrag: Number(v.gebuehr),
    }));
    const summe = Math.round(positionen.reduce((a: number, p: any) => a + p.betrag, 0) * 100) / 100;
    const absender = absenderAus(ein);
    const empfaenger = { firma: k.firma, ansprechpartner: k.ansprechpartner || null, adresse, email: k.email || null };
    if (adresse !== k.rechnungsadresse || (!k.gebuehren_ok_am && body.zugestimmt === true))
      await sql`UPDATE crm_kontakte SET rechnungsadresse = ${adresse}, gebuehren_ok_am = COALESCE(gebuehren_ok_am, ${body.zugestimmt === true ? new Date().toISOString() : null}::timestamptz), updated_at = now() WHERE id = ${kid}`;
    const heute = berlinHeute();
    const nummer = await neueNummer(sql, Number(heute.slice(0, 4)));
    const pdf = await rechnungPdf({ art: "rechnung", nummer, datum: new Date(heute + "T12:00:00Z"), leistungszeitraum: monatsName(monat), absender, empfaenger, positionen, summe });
    const rid = (await sql`SELECT nextval('rechnungen_id_seq')::int AS id`)[0].id;
    const ids = vs.map((v: any) => v.id);
    await sql.transaction([
      sql`INSERT INTO rechnungen (id, nummer, art, datum, leistungszeitraum, kontakt_id, empfaenger, absender, positionen, summe, pdf, pdf_sha256, status)
        VALUES (${rid}, ${nummer}, 'rechnung', ${heute}::date, ${monatsName(monat)}, ${kid}, ${JSON.stringify(empfaenger)}::jsonb, ${JSON.stringify(absender)}::jsonb,
                ${JSON.stringify(positionen)}::jsonb, ${summe}, decode(${hex(pdf)}, 'hex'), ${await sha256(pdf)}, 'offen')`,
      sql`UPDATE vermittlungen SET rechnung_id = ${rid}, abgerechnet_am = now(), updated_at = now() WHERE id = ANY(${ids}::int[])`,
      sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${kid}, 'abrechnung', ${"Rechnung " + nummer + " über " + euro(summe) + " erstellt"})`,
    ]);
    return Response.json({ ok: true, id: rid, nummer, summe });
  }

  if (aktion === "rechnungen") {
    const rows = await sql`SELECT r.id, r.nummer, r.art, r.datum, r.leistungszeitraum, r.kontakt_id, r.empfaenger, r.summe, r.status, r.bezahlt_am,
        r.storno_zu, r.storniert_durch, r.versendet_an, r.versendet_am, r.created_at, s.nummer AS storno_zu_nummer, d.nummer AS storniert_durch_nummer
      FROM rechnungen r LEFT JOIN rechnungen s ON s.id = r.storno_zu LEFT JOIN rechnungen d ON d.id = r.storniert_durch ORDER BY r.id DESC`;
    return Response.json({ ok: true, rechnungen: rows }, { headers: { "Cache-Control": "no-store" } });
  }

  if (aktion === "rechnung_pdf") {
    const r = (await sql`SELECT nummer, art, encode(pdf, 'base64') AS b64 FROM rechnungen WHERE id = ${id}`)[0];
    if (!r) return fehler("Rechnung nicht gefunden.", 404);
    return Response.json({ ok: true, nummer: r.nummer, art: r.art, b64: r.b64.replace(/\s+/g, "") }, { headers: { "Cache-Control": "no-store" } });
  }

  if (aktion === "rechnung_senden") {
    const r = (await sql`SELECT r.id, r.nummer, r.art, r.summe, r.datum, r.leistungszeitraum, r.empfaenger, r.kontakt_id, r.absender, encode(r.pdf, 'base64') AS b64,
        s.nummer AS storno_zu_nummer FROM rechnungen r LEFT JOIN rechnungen s ON s.id = r.storno_zu WHERE r.id = ${id}`)[0];
    if (!r) return fehler("Rechnung nicht gefunden.", 404);
    const an = (clip(body.an, 254) || r.empfaenger?.email || "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(an)) return fehler("Für diesen Betrieb ist keine gültige E-Mail-Adresse hinterlegt.");
    const ziel = Number(r.absender?.zahlungsziel) || 14;
    const faellig = datumDE(new Date(new Date(r.datum).getTime() + ziel * 864e5));
    const istStorno = r.art === "storno";
    const html = `<!doctype html><html lang="de"><body style="font-family:Arial,Helvetica,sans-serif;color:#14231E;font-size:15px;line-height:1.55">
<p>Guten Tag${r.empfaenger?.ansprechpartner ? " " + escH(r.empfaenger.ansprechpartner) : ""},</p>
<p>${istStorno ? `anbei erhalten Sie die Stornorechnung ${escH(r.nummer)} zu unserer Rechnung ${escH(r.storno_zu_nummer || "")}.` :
      `anbei erhalten Sie unsere Rechnung ${escH(r.nummer)} über die Vermittlungsgebühren für ${escH(r.leistungszeitraum || "")} in Höhe von <b>${euro(Number(r.summe))}</b>. Bitte überweisen Sie den Betrag bis zum ${faellig}${r.absender?.iban ? " auf das Konto " + escH(r.absender.iban) : ""} mit dem Verwendungszweck ${escH(r.nummer)}.`}</p>
<p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
<p>Viele Grüße<br>${escH(r.absender?.firma || "Abgemacht")}${r.absender?.name ? " · " + escH(r.absender.name) : ""}</p></body></html>`;
    try {
      await rechnungsMail(an, r.empfaenger?.ansprechpartner || r.empfaenger?.firma || null, `${istStorno ? "Stornorechnung" : "Rechnung"} ${r.nummer} – Abgemacht`, html,
        { name: `${istStorno ? "Stornorechnung" : "Rechnung"}-${r.nummer}.pdf`, b64: String(r.b64).replace(/\s+/g, "") });
    } catch (e) { return fehler((e as Error).message, 502); }
    await sql`UPDATE rechnungen SET versendet_an = ${an}, versendet_am = now() WHERE id = ${id}`;
    if (r.kontakt_id) await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r.kontakt_id}, 'abrechnung', ${(istStorno ? "Stornorechnung " : "Rechnung ") + r.nummer + " per Mail an " + an})`;
    return Response.json({ ok: true, an });
  }

  if (aktion === "rechnung_bezahlt") {
    const an = body.wert !== false;
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(body.datum)) ? String(body.datum) : berlinHeute();
    const r = await sql`UPDATE rechnungen SET status = CASE WHEN ${an} THEN 'bezahlt' ELSE 'offen' END, bezahlt_am = CASE WHEN ${an} THEN ${datum}::date ELSE NULL END
      WHERE id = ${id} AND art = 'rechnung' AND status IN ('offen', 'bezahlt') RETURNING id`;
    if (!r.length) return fehler("Diese Rechnung kann nicht geändert werden (storniert?).");
    return Response.json({ ok: true });
  }

  if (aktion === "rechnung_storno") {
    const o = (await sql`SELECT * FROM rechnungen WHERE id = ${id}`)[0];
    if (!o) return fehler("Rechnung nicht gefunden.", 404);
    if (o.art !== "rechnung" || o.status === "storniert") return fehler("Diese Rechnung ist bereits storniert.");
    const ein = await einstellungen(sql);
    const absender = { ...o.absender, ...(ein.steuernummer ? { steuernummer: ein.steuernummer } : {}) };
    const positionen = (o.positionen as any[]).map((p) => ({ ...p, betrag: -Number(p.betrag) }));
    const summe = -Number(o.summe);
    const heute = berlinHeute();
    const nummer = await neueNummer(sql, Number(heute.slice(0, 4)));
    const pdf = await rechnungPdf({ art: "storno", nummer, datum: new Date(heute + "T12:00:00Z"), leistungszeitraum: o.leistungszeitraum || "", absender, empfaenger: o.empfaenger,
      positionen, summe, storno_zu_nummer: o.nummer });
    const sid = (await sql`SELECT nextval('rechnungen_id_seq')::int AS id`)[0].id;
    await sql.transaction([
      sql`INSERT INTO rechnungen (id, nummer, art, datum, leistungszeitraum, kontakt_id, empfaenger, absender, positionen, summe, storno_zu, pdf, pdf_sha256, status)
        VALUES (${sid}, ${nummer}, 'storno', ${heute}::date, ${o.leistungszeitraum}, ${o.kontakt_id}, ${JSON.stringify(o.empfaenger)}::jsonb, ${JSON.stringify(absender)}::jsonb,
                ${JSON.stringify(positionen)}::jsonb, ${summe}, ${o.id}, decode(${hex(pdf)}, 'hex'), ${await sha256(pdf)}, 'storno')`,
      sql`UPDATE rechnungen SET status = 'storniert', storniert_durch = ${sid} WHERE id = ${o.id}`,
      sql`UPDATE vermittlungen SET rechnung_id = NULL, abgerechnet_am = NULL, updated_at = now() WHERE rechnung_id = ${o.id}`,
      sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${o.kontakt_id}, 'abrechnung', ${"Rechnung " + o.nummer + " storniert (" + nummer + ")"})`,
    ]);
    return Response.json({ ok: true, id: sid, nummer });
  }

  if (aktion === "kunde_link_senden") {
    const v = (await sql`SELECT id, leistung, ort, kontakt, kunde_token FROM vermittlungen WHERE id = ${id}`)[0];
    if (!v) return fehler("Nicht gefunden.", 404);
    const an = mailAus(clip(body.an, 254) || v.kontakt);
    if (!an) return fehler("Beim Auftraggeber ist keine E-Mail-Adresse hinterlegt.");
    const ok = await sendeMail(an, null, `Ihre Angebote: ${v.leistung || "Ihre Anfrage"}`, mailLayout(
      absatz("Guten Tag,") +
      absatz(`über den Knopf sehen Sie alle Angebote zu Ihrer Anfrage „${escP(v.leistung || "")}“${v.ort ? " in " + escP(v.ort) : ""} und nehmen das passende mit einem Klick an. Erst dann bekommen Sie und der Betrieb gegenseitig die Kontaktdaten.`) +
      knopf(`${seite()}/angebot?t=${v.kunde_token}`, "Angebote ansehen") + gruss));
    if (!ok) return fehler("Mail konnte nicht gesendet werden (Brevo nicht eingerichtet?).", 502);
    await sql`UPDATE vermittlungen SET kunde_mail_am = now() WHERE id = ${id}`;
    return Response.json({ ok: true, an });
  }

  if (aktion === "loeschen") {
    const v = (await sql`SELECT rechnung_id FROM vermittlungen WHERE id = ${id}`)[0];
    if (v?.rechnung_id) return fehler("Diese Vermittlung steht auf einer Rechnung und kann nicht gelöscht werden. Bitte zuerst die Rechnung stornieren.");
    await sql`DELETE FROM vermittlungen WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: "/api/vermittlung" };
