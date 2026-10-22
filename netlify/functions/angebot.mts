import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";
import { auftragswert, freischaltung, budgetWert, STUFEN, GRUENDER_RABATT } from "../lib/gebuehr.ts";
import { gebuehrenStand, stripeAktiv, zahlungStarten, zahlungPruefen, webhookPruefen, freigeben } from "../lib/freischalten.ts";
import { istGeprueft } from "../lib/nachweis.ts";
import { empfehlCode, empfehlLink, empfehlStand, EMPFEHL_ANTEIL } from "../lib/empfehlung.ts";
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
// Festpreis („2.400 €“) oder Preisspanne („2.400 – 2.900 €“), bei regelmäßigen Aufträgen pro Monat
const preisText = (betrag: number, art: string, bis?: number | null) =>
  (bis ? euro(betrag).replace(" €", "") + " – " + euro(bis) : euro(betrag)) + (art === "langzeit" ? " pro Monat" : "");
// Für Gebühr und Auftragswert zählt bei einer Spanne der obere Wert (wie beim Budget des Auftraggebers)
const oben = (x: any): number | null => x.preis_bis != null ? Number(x.preis_bis) : x.preis_betrag != null ? Number(x.preis_betrag) : null;


function anfrageZeilen(v: any, anonym: boolean): [string, string | null][] {
  return [["Leistung", v.leistung], ["Ort", v.ort], ["Wann", v.zeitraum], ["Art", ART[v.art] + (v.laufzeit ? ", " + v.laufzeit : "")], ["Budget", v.budget],
    ["Details", anonym ? ohneKontakt(v.beschreibung) : v.beschreibung]];
}

export default async (req: Request, _context: Context) => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);
  /* Foto einer Anfrage: nur mit gültigem Link (Betrieb oder Kunde dieser Anfrage) */
  const url = new URL(req.url);
  /* Stripe meldet eine bezahlte Freischaltung (falls der Betrieb nicht auf die Seite zurückkehrt) */
  if (url.pathname === "/api/stripe") {
    if (req.method !== "POST") return new Response("Methode nicht erlaubt", { status: 405 });
    const roh = await req.text();
    if (!(await webhookPruefen(roh, req.headers.get("stripe-signature")))) return new Response("Signatur ungültig", { status: 400 });
    let ev: any = {}; try { ev = JSON.parse(roh); } catch { return new Response("ok"); }
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      try {
        const z = await zahlungPruefen(String(ev.data?.object?.id || ""));
        if (z && z.vid) await freigeben(neon(dbUrl), z.vid, { bezahlt: z.betrag, ref: z.ref });
      } catch (err) { console.error("Stripe-Webhook", err); return new Response("Fehler", { status: 500 }); }
    }
    return new Response("ok");
  }
  if (url.pathname === "/api/foto") {
    const ft = url.searchParams.get("t") || "", n = Number(url.searchParams.get("n")) || 0;
    if (!TOKEN_RE.test(ft) || n < 1 || n > 5) return new Response("Nicht gefunden", { status: 404 });
    const sqlF = neon(dbUrl);
    const f = (await (ft.startsWith("b_")
      ? sqlF`SELECT f.mime, f.daten FROM anfrage_fotos f JOIN vermittlung_betriebe vb ON vb.vermittlung_id = f.vermittlung_id WHERE vb.token = ${ft} AND f.nr = ${n}`
      : sqlF`SELECT f.mime, f.daten FROM anfrage_fotos f JOIN vermittlungen v ON v.id = f.vermittlung_id WHERE v.kunde_token = ${ft} AND f.nr = ${n}`))[0];
    if (!f) return new Response("Nicht gefunden", { status: 404 });
    return new Response(Buffer.from(f.daten, "base64"), { headers: { "content-type": f.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" } });
  }
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
  const fotoZahl = async (vid: number) => (await sql`SELECT count(*)::int AS n FROM anfrage_fotos WHERE vermittlung_id = ${vid}`)[0].n;
  const ein = async () => Object.fromEntries((await sql`SELECT schluessel, wert FROM einstellungen`).map((e: any) => [e.schluessel, e.wert]));

  /* ================= Betrieb ================= */
  if (t.startsWith("b_")) {
    const r = (await sql`SELECT vb.*, k.firma, k.partner AS k_partner, k.ansprechpartner, k.email AS k_email, k.gebuehren_ok_am, k.gruender_nr,
        v.freischalt_stufe, v.freigeschaltet_am, v.gebuehr AS v_gebuehr, v.id AS nr, v.leistung, v.ort, v.zeitraum, v.budget, v.art, v.laufzeit, v.beschreibung, v.status AS v_status, v.created_at AS v_created,
        v.auftraggeber, v.kontakt, v.kunde_token, v.kunde_mail_am
      FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id JOIN vermittlungen v ON v.id = vb.vermittlung_id
      WHERE vb.token = ${t}`)[0];
    if (!r) return fehler("Diesen Link gibt es nicht (mehr).", 404);
    const offen = !ZU.includes(r.v_status) && !["abgesagt", "gewaehlt", "nicht_gewaehlt"].includes(r.status);
    const geb = await gebuehrenStand(sql);

    const gewaehlt = r.status === "gewaehlt";
    const frei = gewaehlt && !!r.freigeschaltet_am;
    const fs = () => freischaltung({ art: r.art || "einmalig", budget: r.budget, betrag: oben(r), stufe: r.freischalt_stufe, gruender: !!r.gruender_nr });

    if (aktion === "ansehen") {
      if (!r.gesehen_am) await sql`UPDATE vermittlung_betriebe SET gesehen_am = now() WHERE id = ${r.id}`;
      const f = fs();
      const code = r.k_partner && r.k_partner !== "interessiert" ? await empfehlCode(sql, r.kontakt_id) : null;
      const empfehlung = code ? { link: empfehlLink(code), anteil: EMPFEHL_ANTEIL, ...(await empfehlStand(sql, r.kontakt_id)) } : null;
      return antwort({
        empfehlung,
        ok: true, rolle: "betrieb", firma: r.firma, status: r.status, offen,
        entschieden: ZU.includes(r.v_status) && !gewaehlt,
        anfrage: { nr: r.nr, leistung: r.leistung, ort: r.ort, zeitraum: r.zeitraum, budget: r.budget, art: r.art, laufzeit: r.laufzeit,
          beschreibung: frei ? r.beschreibung : ohneKontakt(r.beschreibung), erstellt: r.v_created, fotos: await fotoZahl(r.nr) },
        angebot: r.preis_betrag ? { betrag: Number(r.preis_betrag), bis: r.preis_bis != null ? Number(r.preis_bis) : null, nachricht: r.angebot } : null,
        kunde: frei ? { name: r.auftraggeber, kontakt: r.kontakt } : null,
        freischalten: gewaehlt && !frei ? { preis: geb.aktiv ? (r.v_gebuehr !== null ? Number(r.v_gebuehr) : f.preis) : 0, grundpreis: f.grundpreis, rabatt: f.rabatt, online: geb.aktiv && stripeAktiv() } : null,
        gruender: r.gruender_nr || null,
        gebuehren: { aktiv: geb.aktiv, ab: geb.ab, zugestimmt: !!r.gebuehren_ok_am },
        modell: { stufen: STUFEN.map((x) => ({ bis: Number.isFinite(x.bis) ? x.bis : null, preis: x.preis, text: x.text })), rabatt: GRUENDER_RABATT, budgetwert: budgetWert(r.budget, r.art || "einmalig"), stufe: r.freischalt_stufe || null },
      });
    }

    // Freischaltung bezahlen (oder in der Startphase direkt freigeben)
    if (aktion === "bezahlen") {
      if (!gewaehlt) return fehler("Dieses Angebot wurde nicht angenommen.", 409);
      if (frei) return antwort({ ok: true, frei: true });
      const betrag = r.v_gebuehr !== null ? Number(r.v_gebuehr) : fs().preis;
      if (!geb.aktiv || !stripeAktiv() || !betrag) { await freigeben(sql, r.nr, {}); return antwort({ ok: true, frei: true }); }
      const e = await ein();
      try {
        const z = await zahlungStarten({ betrag, vid: r.nr, vbid: r.id, token: t, email: r.k_email, titel: `${r.leistung || "Auftrag"}${r.ort ? ", " + r.ort : ""}`, kleinunternehmer: e.kleinunternehmer !== "nein" });
        await sql`UPDATE vermittlungen SET zahlung_ref = ${z.id} WHERE id = ${r.nr} AND freigeschaltet_am IS NULL`;
        return antwort({ ok: true, url: z.url });
      } catch (err) { return fehler((err as Error).message, 502); }
    }
    if (aktion === "zahlung_pruefen") {
      if (frei) return antwort({ ok: true, frei: true });
      try {
        const z = await zahlungPruefen(String(body.zahlung || ""));
        if (!z || z.vbid !== r.id) return fehler("Die Zahlung ist noch nicht bestätigt. Bitte laden Sie die Seite in einer Minute neu.", 409);
        await freigeben(sql, r.nr, { bezahlt: z.betrag, ref: z.ref });
        return antwort({ ok: true, frei: true });
      } catch (err) { return fehler((err as Error).message, 502); }
    }

    if (aktion === "angebot") {
      if (!offen) return fehler(r.status === "abgesagt" ? "Sie haben diese Anfrage bereits abgesagt." : "Für diese Anfrage ist bereits entschieden.", 409);
      let betrag = zahl(body.betrag), bis = zahl(body.bis);
      if (!betrag) return fehler(r.art === "langzeit" ? "Bitte geben Sie Ihren Preis pro Monat an." : "Bitte geben Sie Ihren Preis an.");
      if (bis !== null && bis < betrag) [betrag, bis] = [bis, betrag];
      if (bis === betrag) bis = null;
      const ptext = preisText(betrag, r.art, bis);
      const nachricht = ohneKontakt(clip(body.nachricht, 2000));
      if (body.bedingungen !== true) return fehler("Bitte bestätigen Sie die Bedingungen.");
      const neu = !r.preis_betrag;
      await sql`UPDATE vermittlung_betriebe SET status = 'angebot', preis_betrag = ${betrag}, preis_bis = ${bis}, preis = ${ptext},
          angebot = ${nachricht || null}, geantwortet_am = COALESCE(geantwortet_am, now()) WHERE id = ${r.id}`;
      await sql`UPDATE vermittlungen SET status = 'angebote', updated_at = now() WHERE id = ${r.nr} AND status IN ('neu', 'angefragt')`;
      if (geb.aktiv) await sql`UPDATE crm_kontakte SET gebuehren_ok_am = COALESCE(gebuehren_ok_am, now()) WHERE id = ${r.kontakt_id}`;
      await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${r.kontakt_id}, 'vermittlung', ${(neu ? "Angebot abgegeben" : "Angebot geändert") + " zu Anfrage #" + r.nr + ": " + ptext})`;
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
      if (neu) await sendeMail(adminMail(), "Samuel", `Angebot zu #${r.nr}: ${r.firma} – ${ptext}`, mailLayout(
        absatz(`<b>${esc(r.firma)}</b> hat ein Angebot zu Anfrage #${r.nr} (${esc(r.leistung || "")}, ${esc(r.ort || "")}) abgegeben: <b>${esc(ptext)}</b>`) +
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

  const ladeAngebote = () => sql`SELECT vb.id, vb.status, vb.preis_betrag, vb.preis_bis, vb.preis, vb.angebot, vb.geantwortet_am, vb.kontakt_id,
        k.kategorie, k.ort AS k_ort, k.firma, k.ansprechpartner, k.email, k.gruender_nr, k.gewerbe_geprueft_am, k.hwk_status,
        (SELECT round(avg(x.bewertung)::numeric, 1) FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.bewertung IS NOT NULL) AS sterne,
        (SELECT count(*)::int FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.bewertung IS NOT NULL) AS bewertungen,
        (SELECT count(*)::int FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.status IN ('abgemacht', 'erledigt')) AS auftraege
      FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id
      WHERE vb.vermittlung_id = ${v.id} AND vb.status IN ('angebot', 'gewaehlt', 'nicht_gewaehlt')
      ORDER BY vb.geantwortet_am NULLS LAST, vb.id`;

  if (aktion === "ansehen") {
    // Erster Aufruf über den Link aus der E-Mail bestätigt die Anfrage (E-Mail-Adresse ist damit echt)
    let gerade = false;
    if (!v.bestaetigt_am) {
      const b = await sql`UPDATE vermittlungen SET bestaetigt_am = now(), updated_at = now() WHERE id = ${v.id} AND bestaetigt_am IS NULL RETURNING id`;
      gerade = b.length > 0;
      if (gerade) await sendeMail(adminMail(), "Samuel", `Bestätigt: Anfrage #${v.id} ${v.leistung || ""}`, mailLayout(
        absatz(`Der Auftraggeber hat Anfrage #${v.id} (${esc(v.leistung || "")}${v.ort ? ", " + esc(v.ort) : ""}) per E-Mail bestätigt. Sie kann jetzt an Betriebe gehen.`) +
        knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
    }
    const liste = await ladeAngebote();
    const angefragt = (await sql`SELECT count(*)::int AS n FROM vermittlung_betriebe WHERE vermittlung_id = ${v.id} AND status NOT IN ('abgesagt')`)[0].n;
    const gew = ["abgemacht", "erledigt"].includes(v.status) && v.gewaehlt_id && v.freigeschaltet_am;
    const wartet = ["abgemacht", "erledigt"].includes(v.status) && v.gewaehlt_id && !v.freigeschaltet_am;
    return antwort({
      ok: true, rolle: "kunde", status: v.status, gerade_bestaetigt: gerade, offen: !ZU.includes(v.status), angefragt, wartet: !!wartet,
      anfrage: { nr: v.id, leistung: v.leistung, ort: v.ort, zeitraum: v.zeitraum, budget: v.budget, art: v.art, laufzeit: v.laufzeit, beschreibung: v.beschreibung, erstellt: v.created_at, fotos: await fotoZahl(v.id) },
      angebote: liste.map((a: any, i: number) => ({
        id: a.id, label: "Angebot " + String.fromCharCode(65 + i), status: a.status, kategorie: a.kategorie, ort: a.k_ort,
        betrag: a.preis_betrag === null ? null : Number(a.preis_betrag), bis: a.preis_bis === null ? null : Number(a.preis_bis), preis: a.preis, nachricht: ohneKontakt(a.angebot), am: a.geantwortet_am,
        sterne: a.sterne === null ? null : Number(a.sterne), bewertungen: a.bewertungen, auftraege: a.auftraege, gruender: !!a.gruender_nr, geprueft: istGeprueft(a),
        ...(a.status === "gewaehlt" && gew ? { firma: a.firma } : {}),
      })),
      betrieb: gew ? { firma: v.g_firma, ansprechpartner: v.g_ansprech, telefon: v.g_tel, email: v.g_mail, website: v.g_web } : null,
    });
  }

  if (aktion === "annehmen") {
    const vbid = Number(body.vb) || 0;
    const liste = await ladeAngebote();
    const a = liste.find((x: any) => x.id === vbid);
    if (!a || a.status !== "angebot") return fehler("Dieses Angebot ist nicht mehr verfügbar.", 409);
    const wert = auftragswert(v.art || "einmalig", oben(a));
    const gk = (await sql`SELECT firma, ansprechpartner, email, gruender_nr FROM crm_kontakte WHERE id = ${a.kontakt_id}`)[0];
    const f = freischaltung({ art: v.art || "einmalig", budget: v.budget, betrag: oben(a), stufe: v.freischalt_stufe, gruender: !!gk.gruender_nr });
    const stand = await gebuehrenStand(sql);
    const zahlen = stand.aktiv && stripeAktiv();
    // Atomar: nur wenn noch nicht entschieden (verhindert doppeltes Annehmen)
    const ok = await sql`UPDATE vermittlungen SET status = 'abgemacht', gewaehlt_id = ${a.kontakt_id}, auftragswert = ${wert}, gebuehr = ${f.preis},
        angenommen_am = now(), abgemacht_am = COALESCE(abgemacht_am, now()), updated_at = now()
      WHERE id = ${v.id} AND status NOT IN ('abgemacht', 'erledigt', 'verloren') RETURNING id`;
    if (!ok.length) return fehler("Für diese Anfrage ist bereits entschieden.", 409);
    await sql`UPDATE vermittlung_betriebe SET status = CASE WHEN id = ${vbid} THEN 'gewaehlt' WHEN status = 'angebot' THEN 'nicht_gewaehlt' ELSE status END
      WHERE vermittlung_id = ${v.id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${a.kontakt_id}, 'vermittlung', ${"Vom Auftraggeber angenommen: Anfrage #" + v.id + (zahlen ? " (wartet auf Freischaltung)" : "")})`;
    const preis = a.preis || (a.preis_betrag ? euro(Number(a.preis_betrag)) : "");
    const kmail = mailAus(v.kontakt);
    const tok = (await sql`SELECT token FROM vermittlung_betriebe WHERE id = ${vbid}`)[0].token;
    if (zahlen) {
      // Betrieb: angenommen, Kontaktdaten nach Freischaltung
      if (gk.email) await sendeMail(gk.email, gk.ansprechpartner || gk.firma, `Ihr Angebot wurde angenommen: ${v.leistung || "Anfrage #" + v.id}`, mailLayout(
        absatz(`Guten Tag${gk.ansprechpartner ? " " + esc(gk.ansprechpartner) : ""},`) +
        absatz(`gute Nachricht: Der Auftraggeber hat sich für Ihr Angebot${preis ? " über <b>" + esc(preis) + "</b>" : ""} entschieden.`) +
        absatz(`Schalten Sie jetzt seine Kontaktdaten frei. Die Freischaltung kostet einmalig <b>${esc(euro(f.preis))}</b>${f.rabatt ? " (Gründungspartner-Preis, statt " + esc(euro(f.grundpreis)) + ")" : ""}. Sie bezahlen online per Karte oder Lastschrift und bekommen die Kontaktdaten sofort.`) +
        knopf(`${seite()}/angebot?t=${tok}`, "Kontaktdaten freischalten") +
        absatz(`<span style="font-size:14px;color:#5B6B65">Der Auftraggeber wartet auf Ihre Rückmeldung. Bitte schalten Sie innerhalb von 48 Stunden frei, sonst kann er ein anderes Angebot wählen.</span>`) + gruss));
      // Auftraggeber: Bestätigung, Kontaktdaten folgen
      if (kmail) await sendeMail(kmail, null, `Angebot angenommen: ${v.leistung || "Ihre Anfrage"}`, mailLayout(
        absatz("Guten Tag,") +
        absatz(`Sie haben ein Angebot${preis ? " über " + esc(preis) : ""} angenommen. Der Betrieb wurde benachrichtigt und bestätigt in Kürze. Danach bekommen Sie seine Kontaktdaten per E-Mail, und er meldet sich bei Ihnen.`) +
        knopf(`${seite()}/angebot?t=${v.kunde_token}`, "Zur Übersicht") + gruss));
    } else {
      await freigeben(sql, v.id, {});
    }
    // Nicht gewählte Betriebe
    for (const x of liste.filter((x: any) => x.id !== vbid && x.status === "angebot" && x.email))
      await sendeMail(x.email, x.ansprechpartner || x.firma, `Anfrage „${v.leistung || "#" + v.id}“: Entscheidung gefallen`, mailLayout(
        absatz(`Guten Tag${x.ansprechpartner ? " " + esc(x.ansprechpartner) : ""},`) +
        absatz(`danke für Ihr Angebot zur Anfrage „${esc(v.leistung || "")}“${v.ort ? " in " + esc(v.ort) : ""}. Diesmal hat sich der Auftraggeber für ein anderes Angebot entschieden. Bei der nächsten passenden Anfrage melden wir uns wieder.`) + gruss));
    // Info an Samuel
    await sendeMail(adminMail(), "Samuel", `Angenommen #${v.id}: ${gk.firma}${preis ? " – " + preis : ""}`, mailLayout(
      absatz(`Der Auftraggeber hat das Angebot von <b>${esc(gk.firma)}</b> selbst angenommen.${zahlen ? " Kontaktdaten gehen raus, sobald der Betrieb die Freischaltung bezahlt hat." : " Die Kontaktdaten sind an beide gegangen."}`) +
      tabelle([["Anfrage", `#${v.id} ${v.leistung || ""}`], ["Auftraggeber", v.auftraggeber], ["Preis", preis], ["Budget", v.budget], ["Freischaltung", euro(f.preis) + (f.rabatt ? " (Gründungspartner)" : "") + (stand.aktiv ? "" : " – Startphase: gratis")]]) +
      knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
    if (zahlen) return antwort({ ok: true, wartet: true });
    const g = (await sql`SELECT firma, ansprechpartner, telefon, email, website FROM crm_kontakte WHERE id = ${a.kontakt_id}`)[0];
    return antwort({ ok: true, betrieb: { firma: g.firma, ansprechpartner: g.ansprechpartner, telefon: g.telefon, email: g.email, website: g.website } });
  }
  return fehler("Unbekannte Aktion.");
};

export const config: Config = { path: ["/api/angebot", "/api/foto", "/api/stripe"] };
