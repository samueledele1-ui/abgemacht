// Ein Angebot annehmen: gemeinsam für die Angebotsseite des Auftraggebers (k_-Link) und das Portal fester Partner.
import { freischaltung } from "./gebuehr.ts";
import { gebuehrenStand, stripeAktiv, freigeben, euro } from "./freischalten.ts";
import { istGeprueft } from "./nachweis.ts";
import { seite, adminMail, esc, mailLayout, knopf, absatz, gruss, tabelle, sendeMail, ohneKontakt, mailAus } from "./post.ts";

export const ZU = ["abgemacht", "erledigt", "verloren"];
export const oben = (x: any): number | null => x.preis_bis != null ? Number(x.preis_bis) : x.preis_betrag != null ? Number(x.preis_betrag) : null;

export const ladeAngebote = (sql: any, vid: number) => sql`SELECT vb.id, vb.status, vb.preis_betrag, vb.preis_bis, vb.preis, vb.angebot, vb.geantwortet_am, vb.kontakt_id, vb.dauer_modell,
      k.kategorie, k.ort AS k_ort, k.firma, k.ansprechpartner, k.email, k.gruender_nr, k.gewerbe_geprueft_am, k.hwk_status,
      (SELECT round(avg(x.bewertung)::numeric, 1) FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.bewertung IS NOT NULL) AS sterne,
      (SELECT count(*)::int FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.bewertung IS NOT NULL) AS bewertungen,
      (SELECT count(*)::int FROM vermittlungen x WHERE x.gewaehlt_id = k.id AND x.status IN ('abgemacht', 'erledigt')) AS auftraege,
      (SELECT b.status FROM besichtigungen b WHERE b.vb_id = vb.id) AS besichtigung
    FROM vermittlung_betriebe vb JOIN crm_kontakte k ON k.id = vb.kontakt_id
    WHERE vb.vermittlung_id = ${vid} AND vb.status IN ('angebot', 'gewaehlt', 'nicht_gewaehlt')
    ORDER BY vb.geantwortet_am NULLS LAST, vb.id`;

// Angebote für den Auftraggeber: anonym bis zur Freischaltung
export function angeboteAnonym(liste: any[], freigeschaltet: boolean) {
  return liste.map((a: any, i: number) => ({
    id: a.id, label: "Angebot " + String.fromCharCode(65 + i), status: a.status, kategorie: a.kategorie, ort: a.k_ort,
    betrag: a.preis_betrag === null ? null : Number(a.preis_betrag), bis: a.preis_bis === null ? null : Number(a.preis_bis), preis: a.preis, nachricht: ohneKontakt(a.angebot), am: a.geantwortet_am,
    sterne: a.sterne === null ? null : Number(a.sterne), bewertungen: a.bewertungen, auftraege: a.auftraege, gruender: !!a.gruender_nr, geprueft: istGeprueft(a),
    besichtigung: a.besichtigung || null,
    ...(a.status === "gewaehlt" && freigeschaltet ? { firma: a.firma } : {}),
  }));
}

// v = Zeile aus vermittlungen, vbid = gewähltes Angebot. Gibt { ok, fehler?, status?, wartet?, betrieb? } zurück.
export async function annehmen(sql: any, v: any, vbid: number, wer = "Der Auftraggeber") {
  const liste = await ladeAngebote(sql, v.id);
  const a = liste.find((x: any) => x.id === vbid);
  if (!a || a.status !== "angebot") return { ok: false, fehler: "Dieses Angebot ist nicht mehr verfügbar.", status: 409 };
  const gk = (await sql`SELECT firma, ansprechpartner, email, gruender_nr FROM crm_kontakte WHERE id = ${a.kontakt_id}`)[0];
  const f = freischaltung({ art: v.art || "einmalig", budget: v.budget, betrag: oben(a), hand: v.gebuehr_hand == null ? null : Number(v.gebuehr_hand), gruender: !!gk.gruender_nr, dauer_modell: a.dauer_modell });
  const stand = await gebuehrenStand(sql);
  const zahlen = stand.aktiv && stripeAktiv() && f.preis > 0;
  // Atomar: nur wenn noch nicht entschieden (verhindert doppeltes Annehmen)
  const ok = await sql`UPDATE vermittlungen SET status = 'abgemacht', gewaehlt_id = ${a.kontakt_id}, auftragswert = ${f.wert}, gebuehr = ${f.preis},
      dauer_modell = ${f.modell}, angenommen_am = now(), abgemacht_am = COALESCE(abgemacht_am, now()), updated_at = now()
    WHERE id = ${v.id} AND status NOT IN ('abgemacht', 'erledigt', 'verloren') RETURNING id`;
  if (!ok.length) return { ok: false, fehler: "Für diese Anfrage ist bereits entschieden.", status: 409 };
  await sql`UPDATE vermittlung_betriebe SET status = CASE WHEN id = ${vbid} THEN 'gewaehlt' WHEN status = 'angebot' THEN 'nicht_gewaehlt' ELSE status END
    WHERE vermittlung_id = ${v.id}`;
  await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${a.kontakt_id}, 'vermittlung', ${wer + " hat angenommen: Anfrage #" + v.id + (zahlen ? " (wartet auf Freischaltung)" : "")})`;
  const preis = a.preis || (a.preis_betrag ? euro(Number(a.preis_betrag)) : "");
  const kmail = mailAus(v.kontakt);
  const tok = (await sql`SELECT token FROM vermittlung_betriebe WHERE id = ${vbid}`)[0].token;
  const gebText = f.modell === "monatlich" ? `${euro(f.preis)} als erste Monatsrate (8 % vom Monatspreis, monatlich für höchstens 24 Monate)` : euro(f.preis);
  if (zahlen) {
    if (gk.email) await sendeMail(gk.email, gk.ansprechpartner || gk.firma, `Ihr Angebot wurde angenommen: ${v.leistung || "Anfrage #" + v.id}`, mailLayout(
      absatz(`Guten Tag${gk.ansprechpartner ? " " + esc(gk.ansprechpartner) : ""},`) +
      absatz(`gute Nachricht: Der Auftraggeber hat sich für Ihr Angebot${preis ? " über <b>" + esc(preis) + "</b>" : ""} entschieden.`) +
      absatz(`Schalten Sie jetzt seine Kontaktdaten frei. Die Vermittlungsgebühr beträgt <b>${esc(gebText)}</b>${f.rabatt ? " (Gründungspartner-Preis, statt " + esc(euro(f.grundpreis)) + ")" : ""}. Sie bezahlen online per Karte oder Lastschrift und bekommen die Kontaktdaten sofort.`) +
      knopf(`${seite()}/angebot?t=${tok}`, "Kontaktdaten freischalten") +
      absatz(`<span style="font-size:14px;color:#5B6B65">Der Auftraggeber wartet auf Ihre Rückmeldung. Bitte schalten Sie innerhalb von 48 Stunden frei, sonst kann er ein anderes Angebot wählen.</span>`) + gruss));
    if (kmail) await sendeMail(kmail, null, `Angebot angenommen: ${v.leistung || "Ihre Anfrage"}`, mailLayout(
      absatz("Guten Tag,") +
      absatz(`Sie haben ein Angebot${preis ? " über " + esc(preis) : ""} angenommen. Der Betrieb wurde benachrichtigt und bestätigt in Kürze. Danach bekommen Sie seine Kontaktdaten per E-Mail, und er meldet sich bei Ihnen.`) +
      (v.kunde_token ? knopf(`${seite()}/angebot?t=${v.kunde_token}`, "Zur Übersicht") : "") + gruss));
  } else {
    await freigeben(sql, v.id, {});
  }
  for (const x of liste.filter((x: any) => x.id !== vbid && x.status === "angebot" && x.email))
    await sendeMail(x.email, x.ansprechpartner || x.firma, `Anfrage „${v.leistung || "#" + v.id}“: Entscheidung gefallen`, mailLayout(
      absatz(`Guten Tag${x.ansprechpartner ? " " + esc(x.ansprechpartner) : ""},`) +
      absatz(`danke für Ihr Angebot zur Anfrage „${esc(v.leistung || "")}“${v.ort ? " in " + esc(v.ort) : ""}. Diesmal hat sich der Auftraggeber für ein anderes Angebot entschieden. Bei der nächsten passenden Anfrage melden wir uns wieder.`) + gruss));
  await sendeMail(adminMail(), "Samuel", `Angenommen #${v.id}: ${gk.firma}${preis ? " – " + preis : ""}`, mailLayout(
    absatz(`${esc(wer)} hat das Angebot von <b>${esc(gk.firma)}</b> angenommen.${zahlen ? " Kontaktdaten gehen raus, sobald der Betrieb die Freischaltung bezahlt hat." : " Die Kontaktdaten sind an beide gegangen."}`) +
    tabelle([["Anfrage", `#${v.id} ${v.leistung || ""}`], ["Auftraggeber", v.auftraggeber], ["Preis", preis], ["Budget", v.budget], ["Gebühr", gebText + (f.rabatt ? " (Gründungspartner)" : "") + (stand.aktiv ? "" : " – Startphase: kostenlos")]]) +
    knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
  if (zahlen) return { ok: true, wartet: true };
  const g = (await sql`SELECT firma, ansprechpartner, telefon, email, website FROM crm_kontakte WHERE id = ${a.kontakt_id}`)[0];
  return { ok: true, betrieb: { firma: g.firma, ansprechpartner: g.ansprechpartner, telefon: g.telefon, email: g.email, website: g.website } };
}
