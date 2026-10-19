// Freischaltung der Kontaktdaten nach einer Annahme, Zahlung über Stripe Checkout.
// Ablauf: Auftraggeber nimmt an → (Gebühren aktiv + Stripe eingerichtet) Betrieb zahlt die Freischaltgebühr →
// erst dann bekommen beide gegenseitig die Kontaktdaten. In der Startphase oder ohne Stripe sofortige Freigabe.
import { seite, adminMail, esc, mailLayout, knopf, absatz, gruss, tabelle, sendeMail, mailAus } from "./post.ts";

const ART: Record<string, string> = { einmalig: "Einmalig", projekt: "Projekt", langzeit: "Regelmäßig / langfristig" };
export const euro = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

export async function gebuehrenStand(sql: any) {
  const r = await sql`SELECT wert FROM einstellungen WHERE schluessel = 'gebuehren_ab'`;
  const ab = r[0]?.wert || null;
  return { ab, aktiv: !!ab && ab <= heute() };
}

export const stripeAktiv = () => !!Netlify.env.get("STRIPE_SECRET_KEY");

async function stripe(pfad: string, form?: Record<string, string>) {
  const res = await fetch("https://api.stripe.com/v1/" + pfad, {
    method: form ? "POST" : "GET",
    headers: { Authorization: "Bearer " + Netlify.env.get("STRIPE_SECRET_KEY"), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((d as any)?.error?.message || "Zahlung konnte nicht gestartet werden.");
  return d as any;
}

// Bezahlseite für die Freischaltung anlegen
export async function zahlungStarten(o: { betrag: number; vid: number; vbid: number; token: string; email?: string | null; titel: string; kleinunternehmer: boolean }) {
  const zurueck = `${seite()}/angebot?t=${o.token}`;
  const form: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(Math.round(o.betrag * 100)),
    "line_items[0][price_data][product_data][name]": `Freischaltung Auftrag #${o.vid}`,
    "line_items[0][price_data][product_data][description]": o.titel.slice(0, 200),
    success_url: zurueck + "&zahlung={CHECKOUT_SESSION_ID}",
    cancel_url: zurueck + "&abgebrochen=1",
    client_reference_id: String(o.vbid),
    "metadata[vermittlung]": String(o.vid),
    "metadata[vb]": String(o.vbid),
    "payment_intent_data[metadata][vermittlung]": String(o.vid),
    "invoice_creation[enabled]": "true",
    "invoice_creation[invoice_data][description]": `Freischaltung der Kontaktdaten zu Auftrag #${o.vid} über Abgemacht`,
    locale: "de",
  };
  if (o.kleinunternehmer) form["invoice_creation[invoice_data][footer]"] = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";
  if (o.email) form.customer_email = o.email;
  const s = await stripe("checkout/sessions", form);
  return { url: s.url as string, id: s.id as string };
}

// Prüft eine abgeschlossene Bezahlseite (Rückkehr oder Webhook)
export async function zahlungPruefen(sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  const s = await stripe("checkout/sessions/" + sessionId);
  if (s.payment_status !== "paid") return null;
  return { vid: Number(s.metadata?.vermittlung) || 0, vbid: Number(s.metadata?.vb) || 0, betrag: (s.amount_total || 0) / 100, ref: String(s.payment_intent || s.id) };
}

// Stripe-Webhook-Signatur prüfen (Header „Stripe-Signature: t=…,v1=…“)
export async function webhookPruefen(roh: string, header: string | null): Promise<boolean> {
  const secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const teile = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = teile.t, v1 = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${roh}`)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.includes(hex);
}

// Kontaktdaten freigeben (einmalig, atomar) und beiden Seiten per Mail schicken
export async function freigeben(sql: any, vid: number, wie: { bezahlt?: number | null; ref?: string | null; hand?: boolean }) {
  const ok = await sql`UPDATE vermittlungen SET freigeschaltet_am = now(),
      bezahlt_am = CASE WHEN ${wie.bezahlt ?? null}::numeric IS NOT NULL THEN now() ELSE bezahlt_am END,
      zahlung_ref = COALESCE(${wie.ref ?? null}, zahlung_ref),
      gebuehr = CASE WHEN ${wie.bezahlt ?? null}::numeric IS NOT NULL THEN ${wie.bezahlt ?? null}::numeric ELSE gebuehr END, updated_at = now()
    WHERE id = ${vid} AND status IN ('abgemacht', 'erledigt') AND freigeschaltet_am IS NULL RETURNING *`;
  if (!ok.length) return false;
  const v = ok[0];
  const g = (await sql`SELECT k.firma, k.ansprechpartner, k.telefon, k.email, k.website, vb.preis, vb.preis_betrag
    FROM crm_kontakte k JOIN vermittlung_betriebe vb ON vb.kontakt_id = k.id AND vb.vermittlung_id = ${vid} WHERE k.id = ${v.gewaehlt_id}`)[0];
  if (!g) return true;
  const stand = await gebuehrenStand(sql);
  const preis = g.preis || (g.preis_betrag ? euro(Number(g.preis_betrag)) : "");
  const zeilen: [string, string | null][] = [["Leistung", v.leistung], ["Ort", v.ort], ["Wann", v.zeitraum], ["Art", ART[v.art] + (v.laufzeit ? ", " + v.laufzeit : "")], ["Budget", v.budget], ["Details", v.beschreibung]];
  const kostenText = wie.bezahlt ? `Die Freischaltgebühr von ${esc(euro(wie.bezahlt))} ist bezahlt. Die Rechnung kommt separat per E-Mail.`
    : stand.aktiv && !wie.hand && v.gebuehr ? `Die Freischaltgebühr von ${esc(euro(Number(v.gebuehr)))} kommt mit der Monatsrechnung.`
    : stand.aktiv ? "" : "In der Startphase ist die Vermittlung für Sie kostenlos.";
  if (g.email) await sendeMail(g.email, g.ansprechpartner || g.firma, `Kontaktdaten: ${v.leistung || "Anfrage #" + vid}`, mailLayout(
    absatz(`Guten Tag${g.ansprechpartner ? " " + esc(g.ansprechpartner) : ""},`) +
    absatz(`hier sind die Kontaktdaten des Auftraggebers zu Ihrem angenommenen Angebot${preis ? " über <b>" + esc(preis) + "</b>" : ""}. Bitte melden Sie sich innerhalb von 24 Stunden, um alles Weitere direkt abzustimmen.`) +
    tabelle([["Auftraggeber", v.auftraggeber], ["Kontakt", v.kontakt], ...zeilen]) +
    (kostenText ? absatz(kostenText) : "") +
    absatz("Der Vertrag kommt direkt zwischen Ihnen und dem Auftraggeber zustande.") + gruss));
  const kmail = mailAus(v.kontakt);
  if (kmail) await sendeMail(kmail, null, `Abgemacht mit ${g.firma}`, mailLayout(
    absatz("Guten Tag,") +
    absatz(`der Betrieb <b>${esc(g.firma)}</b> hat Ihre Annahme bestätigt${preis ? " (Angebot über " + esc(preis) + ")" : ""} und meldet sich bei Ihnen. Sie können sich auch direkt melden:`) +
    tabelle([["Betrieb", g.firma], ["Ansprechpartner", g.ansprechpartner], ["Telefon", g.telefon], ["E-Mail", g.email], ["Website", g.website]]) +
    absatz("Den Vertrag schließen Sie direkt mit dem Betrieb. Nach dem Auftrag fragen wir kurz, ob alles gepasst hat.") +
    knopf(`${seite()}/angebot?t=${v.kunde_token}`, "Zur Übersicht") + gruss));
  if (wie.bezahlt || wie.hand) await sendeMail(adminMail(), "Samuel", `Freigeschaltet #${vid}: ${g.firma}${wie.bezahlt ? " – " + euro(wie.bezahlt) + " bezahlt" : " (von Hand)"}`, mailLayout(
    absatz(`Die Kontaktdaten zu Anfrage #${vid} (${esc(v.leistung || "")}) sind an <b>${esc(g.firma)}</b> und den Auftraggeber gegangen.`) +
    (wie.bezahlt ? absatz(`Bezahlt über Stripe: <b>${esc(euro(wie.bezahlt))}</b>${wie.ref ? " · " + esc(wie.ref) : ""}`) : absatz("Freigabe von Hand im Büro, ohne Online-Zahlung.")) +
    knopf(`${seite()}/vermittlung`, "In der Vermittlung öffnen")));
  return true;
}
