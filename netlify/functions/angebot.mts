import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";
import { gebuehr, auftragswert, SATZ, DECKEL_EINZEL, DAUER_MIN, DAUER_MAX } from "../lib/gebuehr.ts";
import { seite, adminMail, esc, mailLayout, knopf, absatz, gruss, tabelle, sendeMail, ohneKontakt, mailAus } from "../lib/post.ts";

// Öffentliche Angebotsseite ohne Login, nur über persönlichen Link:
//   b_… = Link für einen angefragten Betrieb (Anfrage anonym ansehen, Angebot abgeben oder absagen)
//   k_… = Link für den Auftraggeber (Angebote anonym vergleichen, eines annehmen)
// Kontaktdaten beider Seiten gibt es erst nach der Annahme.

const TOKEN_RE = /^[bk]_[0-9a-f]{32}$/;
const ZU = ["abgemacht", "erledigt", "verloren"];
const ART: Record<string, string> = { einmalig: "Einmalig", projekt: "Projekt", langzeit: "Regelmäßig / langfristig" };

const antwort = (d: unknown, status = 200) => Response.json(d, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const fehler = (msg: string, status = 400) => antwort({ ok: false, error: msg }, status);
const clip = (v: unknown, n = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};
const zahl = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
};
const euro = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
const preisText = (betrag: number, art: string) => euro(betrag) + (art === "langzeit" ? " pro Monat" : "");
const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

async function gebuehrenStand(sql: any) {
  const r = await sql`SELECT wert FROM einstellungen WHERE schluessel = 'gebuehren_ab'`;
  const ab = r[0]?.wert || null;
  return { ab, aktiv: !!ab && ab <= heute() };
}

function anfrageZeilen(v: any, anonym: boolean): [string, string | null][] {
  return [["Leistung", v.leistung], ["Ort", v.ort], ["Wann", v.zeitraum], ["Art", ART[v.art] + (v.laufzeit ? ", " + v.laufzeit : "")], ["Budget", v.budget],
    ["Details", anonym ? ohneKontakt(v.beschreibung) : v.beschreibung]];
}

export default async (req: Request, _context: Context) => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);
  let body: Record<string, unknown> = {};
  let t = "";
  if (req.method === "GET") t = new URL(req.url).searchParams.get("t") || "";
  else if (req.method === "POST") {
    try { body = await req.json(); } catch { return fehler("Ungültige Anfrage."); }
    t = String(body.t || "");
  } else return fehler("Methode nicht erlaubt.", 405);
  if (!TOKEN_RE.test(t)) return fehler("Dieser Link ist ungültig.", 404);
  const sql = neon(dbUrl);
  const aktion = req.method === "GET" ? "ansehen" : String(body.aktion || "");
  const modell = { satz: SATZ, deckel_einzel: DECKEL_EINZEL, dauer_min: DAUER_MIN, dauer_max: DAUER_MAX };

  /* ================= Betrieb ================= */
  if (t.startsWith("b_")) {
    const r = (await sql`SELECT vb.*, k.firma, k.ansprechpartner, k.email AS k_email, k.gebuehren_ok_am,
        v.id AS nr, v.leistung, v.ort, v.zeitraum, v.budget, v.art, v.laufzeit, v.beschreibung, v.status AS v_status, v.created_at AS v_created,
        v.auftraggeber, v.kontakt, v.kunde_token, v.kunde_mail_am
      FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id JOIN vermittlungen v ON v.id = vb.vermittlung_id
      WHERE vb.token = ${t}`)[0];
    if (!r) return fehler("Diesen Link gibt es nicht (mehr).", 404);
    const offen = !ZU.includes(r.v_status) && !["abgesagt", "gewaehlt", "nicht_gewaehlt"].includes(r.status);
    const geb = await gebuehrenStand(sql);

    if (aktion === "ansehen") {
      if (!r.gesehen_am) await sql`UPDATE vermittlung_betriebe SET gesehen_am = now() WHERE id = ${r.id}`;
      const gewaehlt = r.status === "gewaehlt";
      return antwort({
        ok: true, rolle: "betrieb", firma: r.firma, status: r.status, offen,
        entschieden: ZU.includes(r.v_status) && !gewaehlt,
        anfrage: { nr: r.nr, leistung: r.leistung, ort: r.ort, zeitraum: r.zeitraum, budget: r.budget, art: r.art, laufzeit: r.laufzeit,
          beschreibung: gewaehlt ? r.beschreibung : ohneKontakt(r.beschreibung), erstellt: r.v_created },
        angebot: r.preis_betrag ? { betrag: Number(r.preis_betrag), nachricht: r.angebot } : null,
        kunde: gewaehlt ? { name: r.auftraggeber, kontakt: r.kontakt } : null,
        gebuehren: { aktiv: geb.aktiv, ab: geb.ab, zugestimmt: !!r.gebuehren_ok_am }, modell,
      });
    }

    if (aktion === "angebot") {
      if (!offen) return fehler(r.status === "abgesagt" ? "Sie haben diese Anfrage bereits abgesagt." : "Für diese Anfrage ist bereits entschieden.", 409);
      const betrag = zahl(body.betrag);
      if (!betrag) return fehler(r.art === "langzeit" ? "Bitte geben Sie Ihren Preis pro Monat an." : "Bitte geben Sie Ihren Preis an.");
      const nachricht = ohneKontakt(clip(body.nachricht, 2000));
      if (body.bedingungen !== true) return fehler("Bitte bestätigen Sie die Bedingungen.");
      const neu = !r.preis_betrag;
      await sql`UPDATE vermittlung_betriebe SET status = 'angebot', preis_betrag = ${betrag}, preis = ${preisText(betrag, r.art)},
          angebot = ${nachricht || null}, geantwortet_am = COALESCE(geantwortet_am, now()) WHERE id = ${r.id}`;
      await sql`UPDATE vermittlungen SET status = 'angebote', updated_at = now() WHERE id = ${r.nr} AND status IN ('neu', 'angefragt')`;
      if (geb.aktiv) await sql`UPDATE crm_kontakte SET gebuehren_ok_am = COALESCE(gebuehren_ok_am, now()) WHERE id = ${r.kontakt_id}`;
      await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r.kontakt_id}, 'vermittlung', ${(neu ? "Angebot abgegeben" : "Angebot geändert") + " zu Anfrage #" + r.nr + ": " + preisText(betrag, r.art)})`;
      // Auftraggeber beim ersten Angebot automatisch benachrichtigen
      const kmail = mailAus(r.kontakt);
      if (kmail && !r.kunde_mail_am) {
        const ok = await sendeMail(kmail, null, `Ihr erstes Angebot ist da: ${r.leistung || "Ihre Anfrage"}`, mailLayout(
          absatz("Guten Tag,") +
          absatz(`für Ihre Anfrage „${esc(r.leistung || "")}“${r.ort ? " in " + esc(r.ort) : ""} ist das erste Angebot eingegangen. Weitere können noch folgen.`) +
          absatz("Über den Knopf sehen Sie jederzeit alle Angebote auf einen Blick und nehmen das passende mit einem Klick an. Erst dann bekommen Sie und der Betrieb gegenseitig die Kontaktdaten.") +
          knopf(`${seite()}/angebot?t=${r.kunde_token}`, "Angebote ansehen") + gruss));
        if (ok) await sql`UPDATE vermittlungen SET kunde_mail_am = now() WHERE id = ${r.nr} AND kunde_mail_am IS NULL`;
      }
      if (neu) await sendeMail(adminMail(), "Samuel", `Angebot zu #${r.nr}: ${r.firma} – ${preisText(betrag, r.art)}`, mailLayout(
        absatz(`<b>${esc(r.firma)}</b> hat ein Angebot zu Anfrage #${r.nr} (${esc(r.leistung || "")}, ${esc(r.ort || "")}) abgegeben: <b>${esc(preisText(betrag, r.art))}</b>`) +
        (nachricht ? absatz(esc(nachricht)) : "") + absatz(kmail ? (r.kunde_mail_am ? "Der Auftraggeber sieht es auf seiner Angebotsseite." : "Der Auftraggeber wurde per Mail benachrichtigt.") : "Der Auftraggeber hat keine E-Mail-Adresse hinterlegt: bitte den Kunden-Link selbst schicken.") +
        knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
      return antwort({ ok: true });
    }

    if (aktion === "absagen") {
      if (!offen) return fehler("Für diese Anfrage ist bereits entschieden.", 409);
      await sql`UPDATE vermittlung_betriebe SET status = 'abgesagt', geantwortet_am = COALESCE(geantwortet_am, now()) WHERE id = ${r.id}`;
      await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r.kontakt_id}, 'vermittlung', ${"Anfrage #" + r.nr + " abgesagt" + (clip(body.grund, 200) ? ": " + clip(body.grund, 200) : "")})`;
      return antwort({ ok: true });
    }
    return fehler("Unbekannte Aktion.");
  }

  /* ================= Auftraggeber ================= */
  const v = (await sql`SELECT v.*, k.firma AS g_firma, k.ansprechpartner AS g_ansprech, k.telefon AS g_tel, k.email AS g_mail, k.website AS g_web
      FROM vermittlungen v LEFT JOIN crm_kontakte k ON k.id = v.gewaehlt_id WHERE v.kunde_token = ${t}`)[0];
  if (!v) return fehler("Diesen Link gibt es nicht (mehr).", 404);

  const ladeAngebote = () => sql`SELECT vb.id, vb.status, vb.preis_betrag, vb.preis, vb.angebot, vb.geantwortet_am, vb.kontakt_id,
        k.kategorie, k.ort AS k_ort, k.firma, k.ansprechpartner, k.email,
        (SELECT round(avg(x.bewertung)::numeric, 1) FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.bewertung IS NOT NULL) AS sterne,
        (SELECT count(*)::int FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.bewertung IS NOT NULL) AS bewertungen,
        (SELECT count(*)::int FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.status IN ('abgemacht', 'erledigt')) AS auftraege
      FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id
      WHERE vb.vermittlung_id = ${v.id} AND vb.status IN ('angebot', 'gewaehlt', 'nicht_gewaehlt')
      ORDER BY vb.geantwortet_am NULLS LAST, vb.id`;

  if (aktion === "ansehen") {
    const liste = await ladeAngebote();
    const angefragt = (await sql`SELECT count(*)::int AS n FROM vermittlung_betriebe WHERE vermittlung_id = ${v.id} AND status NOT IN ('abgesagt')`)[0].n;
    const gew = ["abgemacht", "erledigt"].includes(v.status) && v.gewaehlt_id;
    return antwort({
      ok: true, rolle: "kunde", status: v.status, offen: !ZU.includes(v.status), angefragt,
      anfrage: { nr: v.id, leistung: v.leistung, ort: v.ort, zeitraum: v.zeitraum, budget: v.budget, art: v.art, laufzeit: v.laufzeit, beschreibung: v.beschreibung, erstellt: v.created_at },
      angebote: liste.map((a: any, i: number) => ({
        id: a.id, label: "Angebot " + String.fromCharCode(65 + i), status: a.status, kategorie: a.kategorie, ort: a.k_ort,
        betrag: a.preis_betrag === null ? null : Number(a.preis_betrag), preis: a.preis, nachricht: ohneKontakt(a.angebot), am: a.geantwortet_am,
        sterne: a.sterne === null ? null : Number(a.sterne), bewertungen: a.bewertungen, auftraege: a.auftraege,
        ...(a.status === "gewaehlt" ? { firma: a.firma } : {}),
      })),
      betrieb: gew ? { firma: v.g_firma, ansprechpartner: v.g_ansprech, telefon: v.g_tel, email: v.g_mail, website: v.g_web } : null,
    });
  }

  if (aktion === "annehmen") {
    const vbid = Number(body.vb) || 0;
    const liste = await ladeAngebote();
    const a = liste.find((x: any) => x.id === vbid);
    if (!a || a.status !== "angebot") return fehler("Dieses Angebot ist nicht mehr verfügbar.", 409);
    const wert = auftragswert(v.art || "einmalig", a.preis_betrag === null ? null : Number(a.preis_betrag));
    const geb = gebuehr(v.art || "einmalig", wert);
    // Atomar: nur wenn noch nicht entschieden (verhindert doppeltes Annehmen)
    const ok = await sql`UPDATE vermittlungen SET status = 'abgemacht', gewaehlt_id = ${a.kontakt_id}, auftragswert = ${wert}, gebuehr = ${geb},
        angenommen_am = now(), abgemacht_am = COALESCE(abgemacht_am, now()), updated_at = now()
      WHERE id = ${v.id} AND status NOT IN ('abgemacht', 'erledigt', 'verloren') RETURNING id`;
    if (!ok.length) return fehler("Für diese Anfrage ist bereits entschieden.", 409);
    await sql`UPDATE vermittlung_betriebe SET status = CASE WHEN id = ${vbid} THEN 'gewaehlt' WHEN status = 'angebot' THEN 'nicht_gewaehlt' ELSE status END
      WHERE vermittlung_id = ${v.id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${a.kontakt_id}, 'vermittlung', ${"Abgemacht (vom Auftraggeber angenommen): Anfrage #" + v.id})`;

    const g = (await sql`SELECT firma, ansprechpartner, telefon, email, website, gebuehren_ok_am FROM crm_kontakte WHERE id = ${a.kontakt_id}`)[0];
    const stand = await gebuehrenStand(sql);
    const kmail = mailAus(v.kontakt);
    const preis = a.preis || (a.preis_betrag ? euro(Number(a.preis_betrag)) : "");
    // 1) Betrieb: Zusage mit Kontaktdaten des Auftraggebers
    if (g.email) await sendeMail(g.email, g.ansprechpartner || g.firma, `Abgemacht: Ihr Angebot für „${v.leistung || "Anfrage #" + v.id}“ wurde angenommen`, mailLayout(
      absatz(`Guten Tag${g.ansprechpartner ? " " + esc(g.ansprechpartner) : ""},`) +
      absatz(`gute Nachricht: Der Auftraggeber hat Ihr Angebot${preis ? " über <b>" + esc(preis) + "</b>" : ""} angenommen. Bitte melden Sie sich innerhalb von 24 Stunden bei ihm, um alles Weitere direkt abzustimmen.`) +
      tabelle([["Auftraggeber", v.auftraggeber], ["Kontakt", v.kontakt], ...anfrageZeilen(v, false)]) +
      absatz(stand.aktiv && g.gebuehren_ok_am && geb ? `Die Vermittlungsgebühr laut Bedingungen beträgt ${esc(euro(geb))}. Sie kommt mit der Monatsrechnung.` : "In der Startphase ist die Vermittlung für Sie kostenlos.") +
      absatz("Der Vertrag kommt direkt zwischen Ihnen und dem Auftraggeber zustande.") + gruss));
    // 2) Auftraggeber: Kontaktdaten des Betriebs
    if (kmail) await sendeMail(kmail, null, `Abgemacht mit ${g.firma}`, mailLayout(
      absatz("Guten Tag,") +
      absatz(`Sie haben das Angebot von <b>${esc(g.firma)}</b>${preis ? " über " + esc(preis) : ""} angenommen. Der Betrieb hat Ihre Kontaktdaten bekommen und meldet sich bei Ihnen. Sie können sich auch direkt melden:`) +
      tabelle([["Betrieb", g.firma], ["Ansprechpartner", g.ansprechpartner], ["Telefon", g.telefon], ["E-Mail", g.email], ["Website", g.website]]) +
      absatz("Den Vertrag schließen Sie direkt mit dem Betrieb. Nach dem Auftrag fragen wir kurz, ob alles gepasst hat.") +
      knopf(`${seite()}/angebot?t=${v.kunde_token}`, "Zur Übersicht") + gruss));
    // 3) Nicht gewählte Betriebe
    for (const x of liste.filter((x: any) => x.id !== vbid && x.status === "angebot" && x.email))
      await sendeMail(x.email, x.ansprechpartner || x.firma, `Anfrage „${v.leistung || "#" + v.id}“: Entscheidung gefallen`, mailLayout(
        absatz(`Guten Tag${x.ansprechpartner ? " " + esc(x.ansprechpartner) : ""},`) +
        absatz(`danke für Ihr Angebot zur Anfrage „${esc(v.leistung || "")}“${v.ort ? " in " + esc(v.ort) : ""}. Diesmal hat sich der Auftraggeber für ein anderes Angebot entschieden. Bei der nächsten passenden Anfrage melden wir uns wieder.`) + gruss));
    // 4) Info an Samuel
    await sendeMail(adminMail(), "Samuel", `Abgemacht #${v.id}: ${g.firma}${preis ? " – " + preis : ""}`, mailLayout(
      absatz(`Der Auftraggeber hat das Angebot von <b>${esc(g.firma)}</b> selbst angenommen.`) +
      tabelle([["Anfrage", `#${v.id} ${v.leistung || ""}`], ["Auftraggeber", v.auftraggeber], ["Preis", preis], ["Auftragswert", wert ? euro(wert) + (v.art === "langzeit" ? " (erstes Jahr)" : "") : null], ["Gebühr nach Modell", geb ? euro(geb) : null]]) +
      knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
    return antwort({ ok: true, betrieb: { firma: g.firma, ansprechpartner: g.ansprechpartner, telefon: g.telefon, email: g.email, website: g.website } });
  }
  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: "/api/angebot" };
