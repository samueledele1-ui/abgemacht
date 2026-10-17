import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";

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

async function gleich(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

// Gebühr nach Preismodell: bis 500 € 9 €, bis 2.000 € 29 €, darüber 59 €, Langzeit einmalig 199 €
function gebuehr(art: string, wert: number | null) {
  if (art === "langzeit") return 199;
  if (!wert) return null;
  return wert > 2000 ? 59 : wert > 500 ? 29 : 9;
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
    const [vermittlungen, betriebe, partner] = await Promise.all([
      sql`SELECT v.*, k.firma AS gewaehlt_firma FROM vermittlungen v LEFT JOIN crm_kontakte k ON k.id = v.gewaehlt_id ORDER BY
            CASE v.status WHEN 'neu' THEN 0 WHEN 'angefragt' THEN 1 WHEN 'angebote' THEN 2 WHEN 'abgemacht' THEN 3 ELSE 4 END, v.created_at DESC`,
      sql`SELECT vb.*, k.firma, k.ansprechpartner, k.telefon, k.email, k.kategorie, k.ort AS k_ort, k.wa_ok_am
            FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id ORDER BY vb.angefragt_am`,
      sql`SELECT k.id, k.firma, k.kategorie, k.leistungen, k.ansprechpartner, k.telefon, k.email, k.website, k.ort, k.region,
                 k.partner, k.partner_seit, k.wa_ok_am, k.notizen, k.quelle, k.created_at,
                 count(vb.id)::int AS angefragt,
                 count(vb.id) FILTER (WHERE vb.status IN ('angebot','gewaehlt','nicht_gewaehlt'))::int AS angebote,
                 count(vb.id) FILTER (WHERE vb.status = 'gewaehlt')::int AS zusagen,
                 round(avg(EXTRACT(EPOCH FROM (vb.geantwortet_am - vb.angefragt_am)) / 3600)::numeric, 1) AS antwort_h
            FROM crm_kontakte k LEFT JOIN vermittlung_betriebe vb ON vb.kontakt_id = k.id
           WHERE k.partner IS NOT NULL GROUP BY k.id ORDER BY k.partner, k.kategorie NULLS LAST, k.firma`,
    ]);
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
    const alt = (await sql`SELECT status, auftragswert, bewertung FROM vermittlungen WHERE id = ${id}`)[0];
    if (!alt) return fehler("Nicht gefunden.", 404);
    const status = STATUS.includes(String(body.status)) ? String(body.status) : alt.status;
    const wert = body.auftragswert !== undefined ? zahl(body.auftragswert) : (alt.auftragswert === null ? null : Number(alt.auftragswert));
    const b = Number(body.bewertung);
    const bew = body.bewertung !== undefined ? (Number.isInteger(b) && b >= 1 && b <= 5 ? b : null) : alt.bewertung;
    await sql`UPDATE vermittlungen SET auftraggeber = ${w.auftraggeber}, kontakt = ${w.kontakt}, kanal = ${w.kanal}, leistung = ${w.leistung},
        ort = ${w.ort}, zeitraum = ${w.zeitraum}, budget = ${w.budget}, art = ${w.art || "einmalig"}, laufzeit = ${w.laufzeit},
        beschreibung = ${w.beschreibung}, notizen = ${w.notizen}, status = ${status},
        auftragswert = ${wert}, bewertung = ${bew}, gebuehr = ${gebuehr(w.art || "einmalig", wert)}, updated_at = now()
      WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (aktion === "status") {
    const status = String(body.status);
    if (!STATUS.includes(status)) return fehler("Unbekannter Status.");
    await sql`UPDATE vermittlungen SET status = ${status}, updated_at = now() WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  if (aktion === "kandidaten") {
    const q = `%${(clip(body.q, 60) || "").replace(/[%_]/g, "")}%`;
    const rows = await sql`SELECT id, firma, kategorie, leistungen, ort, region, telefon, partner, wa_ok_am, status FROM crm_kontakte
      WHERE (firma ILIKE ${q} OR kategorie ILIKE ${q} OR leistungen ILIKE ${q} OR ort ILIKE ${q})
        AND status NOT IN ('kein_interesse', 'keine_anrufe')
      ORDER BY (partner = 'aktiv') DESC NULLS LAST, (wa_ok_am IS NOT NULL) DESC, firma LIMIT 25`;
    return Response.json({ ok: true, kandidaten: rows });
  }

  if (aktion === "anfragen") {
    const ids = (Array.isArray(body.kontakte) ? body.kontakte : []).map(Number).filter((n) => n > 0).slice(0, 10);
    if (!ids.length) return fehler("Keine Betriebe ausgewählt.");
    for (const k of ids) await sql`INSERT INTO vermittlung_betriebe (vermittlung_id, kontakt_id) VALUES (${id}, ${k}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE vermittlungen SET status = 'angefragt', updated_at = now() WHERE id = ${id} AND status = 'neu'`;
    for (const k of ids) await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${k}, 'vermittlung', ${"Anfrage #" + id + " geschickt"})`;
    return Response.json({ ok: true });
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

  if (aktion === "waehlen") {
    const vbid = Number(body.vb) || 0;
    const r = await sql`SELECT vb.vermittlung_id, vb.kontakt_id, vb.preis, v.art FROM vermittlung_betriebe vb JOIN vermittlungen v ON v.id = vb.vermittlung_id WHERE vb.id = ${vbid}`;
    if (!r.length) return fehler("Nicht gefunden.", 404);
    const { vermittlung_id, kontakt_id, preis, art } = r[0];
    const wert = zahl(body.auftragswert) ?? zahl(preis);
    await sql`UPDATE vermittlung_betriebe SET status = CASE WHEN id = ${vbid} THEN 'gewaehlt' WHEN status = 'angebot' THEN 'nicht_gewaehlt' ELSE status END
      WHERE vermittlung_id = ${vermittlung_id}`;
    await sql`UPDATE vermittlungen SET status = 'abgemacht', gewaehlt_id = ${kontakt_id}, auftragswert = ${wert}, gebuehr = ${gebuehr(art, wert)}, updated_at = now()
      WHERE id = ${vermittlung_id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${kontakt_id}, 'vermittlung', ${"Abgemacht: Anfrage #" + vermittlung_id})`;
    return Response.json({ ok: true, gebuehr: gebuehr(art, wert) });
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

  if (aktion === "loeschen") {
    await sql`DELETE FROM vermittlungen WHERE id = ${id}`;
    return Response.json({ ok: true });
  }

  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: "/api/vermittlung" };
