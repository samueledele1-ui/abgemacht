import { neon } from "@neondatabase/serverless";
import ical from "node-ical";

// Abendmail um 23 Uhr: Was steht morgen an? Termine, fällige CRM-Kontakte, Fahrplan, Zahlen.

const TZ = "Europe/Berlin";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const datum = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const uhr = (d: Date | string) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const tagLang = (s: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(s + "T12:00:00Z"));
const kurz = (s: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(new Date(s + "T12:00:00Z"));
const plusTage = (s: string, n: number) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// Mitternacht in Berlin für ein Datum als UTC-Zeitpunkt
function mitternacht(s: string) {
  const mittag = new Date(s + "T12:00:00Z");
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(mittag));
  return Date.parse(s + "T00:00:00Z") - (h - 12) * 3600e3;
}

async function kalender(von: number, bis: number) {
  const urls = (Netlify.env.get("KALENDER_ICS") || "").split(/[\s,]+/).filter((u) => /^https:\/\//.test(u));
  if (!urls.length) return null;
  const out: { start: number; ende: number; titel: string; ort: string; ganztag: boolean }[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const daten = await ical.async.parseICS(await res.text());
      for (const e of Object.values(daten) as any[]) {
        if (!e || e.type !== "VEVENT" || e.status === "CANCELLED") continue;
        for (const i of ical.expandRecurringEvent(e, { from: new Date(von), to: new Date(bis), expandOngoing: true }) as any[]) {
          const s = new Date(i.start).getTime(), en = i.end ? new Date(i.end).getTime() : s + 3600e3;
          if (s >= bis || en <= von) continue;
          const titel = typeof i.summary === "string" ? i.summary : i.summary?.val || e.summary?.val || e.summary || "Termin";
          out.push({ start: s, ende: en, titel: String(titel), ort: String(e.location?.val || e.location || ""), ganztag: e.datetype === "date" });
        }
      }
    } catch (err) {
      console.error("Kalender nicht lesbar", String(err));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export async function tagesplan(jetzt = new Date()) {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) throw new Error("DATABASE_URL fehlt");
  const sql = neon(dbUrl);
  const heute = datum(jetzt), morgen = plusTage(heute, 1);
  const von = mitternacht(morgen), bis = mitternacht(plusTage(morgen, 1));

  const [termine, gespraeche, faellig, neu, eintraege, wl, umf, aufgaben, demnaechst, gate, verm, partner] = await Promise.all([
    kalender(von, bis),
    sql`SELECT termin, kontakt, termin_telefon, typ, branche FROM umfrage WHERE termin IS NOT NULL AND termin >= ${new Date(von).toISOString()} AND termin < ${new Date(bis).toISOString()} ORDER BY termin`,
    sql`SELECT firma, ansprechpartner, telefon, region, status, eintrag, naechster_kontakt FROM crm_kontakte
        WHERE naechster_kontakt IS NOT NULL AND naechster_kontakt < ${new Date(bis).toISOString()}
          AND status NOT IN ('kein_interesse', 'keine_anrufe', 'nicht_erreichbar')
        ORDER BY naechster_kontakt LIMIT 40`,
    sql`SELECT count(*)::int AS n FROM crm_kontakte WHERE status = 'neu' AND naechster_kontakt IS NULL`,
    sql`SELECT count(*) FILTER (WHERE status = 'freigegeben')::int AS frei, count(*) FILTER (WHERE status = 'angeboten')::int AS offen FROM crm_eintraege`,
    sql`SELECT count(*) FILTER (WHERE status = 'bestaetigt')::int AS best, count(*) FILTER (WHERE status = 'bestaetigt' AND confirmed_at > now() - interval '24 hours')::int AS neu FROM waitlist`,
    sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS neu, count(*) FILTER (WHERE zahlen = 'ja')::int AS ja FROM umfrage WHERE version >= 2`,
    sql`SELECT phase, text, typ, von, bis FROM fahrplan_aufgaben WHERE NOT erledigt AND von <= ${morgen}::date AND bis >= ${morgen}::date ORDER BY (von = bis) DESC, typ DESC, von, id`,
    sql`SELECT phase, text, von FROM fahrplan_aufgaben WHERE NOT erledigt AND von > ${morgen}::date AND typ <> 'gate' ORDER BY von, id LIMIT 4`,
    sql`SELECT text, von FROM fahrplan_aufgaben WHERE typ = 'gate' AND NOT erledigt AND von >= ${morgen}::date ORDER BY von LIMIT 1`,
    sql`SELECT id, leistung, ort, status, auftraggeber, created_at FROM vermittlungen WHERE status IN ('neu', 'angefragt', 'angebote', 'abgemacht') ORDER BY created_at`,
    sql`SELECT count(*) FILTER (WHERE partner = 'aktiv')::int AS aktiv, count(*) FILTER (WHERE partner = 'aktiv' AND wa_ok_am IS NOT NULL)::int AS wa FROM crm_kontakte`,
  ]);

  const H = (t: string) => `<tr><td style="padding:20px 24px 6px;font-size:16px;font-weight:bold;color:#138A6B">${t}</td></tr>`;
  const B = (inhalt: string) => `<tr><td style="padding:0 24px 4px;font-size:15px;line-height:1.5">${inhalt}</td></tr>`;
  const leer = (t: string) => `<span style="color:#5B6B65">${t}</span>`;
  const li = (s: string) => `<li style="margin:0 0 6px">${s}</li>`;
  const ul = (a: string[]) => `<ul style="margin:0;padding-left:20px">${a.join("")}</ul>`;

  // Termine
  const tz: string[] = [];
  for (const t of termine || []) tz.push(li(`<b>${t.ganztag ? "ganztägig" : uhr(new Date(t.start)) + "–" + uhr(new Date(t.ende))}</b> ${esc(t.titel)}${t.ort ? ` <span style="color:#5B6B65">· ${esc(t.ort)}</span>` : ""}`));
  for (const g of gespraeche) tz.push(li(`<b>${uhr(g.termin as string)}</b> Umfrage-Gespräch${g.kontakt ? " mit " + esc(g.kontakt) : ""}${g.termin_telefon ? " · " + esc(g.termin_telefon) : ""}${g.branche ? ` <span style="color:#5B6B65">(${esc(g.typ || "")}, ${esc(g.branche)})</span>` : ""}`));
  const termineHtml = tz.length ? ul(tz) : leer(termine === null ? "Kein Kalender verbunden (KALENDER_ICS in Netlify)." : "Keine Termine im Kalender.");

  // Kontakte
  const ueber = faellig.filter((k) => new Date(k.naechster_kontakt as string).getTime() < von);
  const zeile = (k: any) => li(`<b>${esc(k.firma)}</b>${k.ansprechpartner ? " · " + esc(k.ansprechpartner) : ""} – <a href="tel:${esc(String(k.telefon || "").replace(/[^\d+]/g, ""))}" style="color:#138A6B">${esc(k.telefon || "")}</a> <span style="color:#5B6B65">· ${new Date(k.naechster_kontakt).getTime() < von ? "überfällig seit " + kurz(datum(new Date(k.naechster_kontakt))) : uhr(k.naechster_kontakt)}${k.eintrag === "angeboten" ? " · Partner-Freigabe nachfassen" : ""}</span>`);
  const kontakteHtml = (faellig.length ? ul(faellig.map(zeile)) : leer("Keine Rückrufe fällig.")) +
    `<p style="margin:8px 0 0;color:#5B6B65;font-size:14px">${neu[0].n} Kontakte noch nie angerufen.${ueber.length ? ` Davon oben ${ueber.length} überfällig.` : ""}</p>`;

  // Fahrplan
  const tagesAufgaben = aufgaben.filter((a) => a.typ === "gate" || datum(new Date(a.von)) === morgen && datum(new Date(a.bis)) === morgen);
  const laufend = aufgaben.filter((a) => !tagesAufgaben.includes(a));
  const fp = [
    tagesAufgaben.length ? `<p style="margin:0 0 6px"><b>Speziell morgen:</b></p>` + ul(tagesAufgaben.map((a) => li((a.typ === "gate" ? "🚦 " : "") + esc(a.text)))) : "",
    laufend.length ? `<p style="margin:8px 0 6px"><b>Diese Woche offen</b> <span style="color:#5B6B65">(${esc(laufend[0].phase)})</span></p>` + ul(laufend.map((a) => li(`${esc(a.text)} <span style="color:#5B6B65">· bis ${kurz(datum(new Date(a.bis)))}</span>`))) : "",
    `<p style="margin:8px 0 0;color:#5B6B65;font-size:14px">Jeden Werktag: 2 Stunden telefonieren (9–11, 14–16 Uhr), danach CRM. 3 Posts pro Woche, täglich eine Story.</p>`,
  ].join("");
  const naechstes = [
    ...demnaechst.map((a) => li(`<b>ab ${kurz(datum(new Date(a.von)))}</b> ${esc(a.text)} <span style="color:#5B6B65">· ${esc(a.phase)}</span>`)),
    ...gate.map((g) => li(`<b>🚦 ${kurz(datum(new Date(g.von)))}</b> ${esc(g.text)}`)),
  ];

  // Zahlen
  const zahlen = `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px">
    <tr><td style="padding:2px 16px 2px 0">Warteliste bestätigt</td><td><b>${wl[0].best}</b> / 100${wl[0].neu ? ` <span style="color:#138A6B">(+${wl[0].neu} heute)</span>` : ""}</td></tr>
    <tr><td style="padding:2px 16px 2px 0">Umfrage-Antworten (neu)</td><td><b>${umf[0].n}</b> / 30${umf[0].neu ? ` <span style="color:#138A6B">(+${umf[0].neu} heute)</span>` : ""} · ${umf[0].ja} Betriebe: 9 € okay</td></tr>
    <tr><td style="padding:2px 16px 2px 0">Partner-Betriebe aktiv</td><td><b>${partner[0].aktiv}</b> / 30 · ${partner[0].wa} mit WhatsApp-Okay</td></tr>
    <tr><td style="padding:2px 16px 2px 0">Partner-Freigaben</td><td><b>${eintraege[0].frei}</b>${eintraege[0].offen ? ` · ${eintraege[0].offen} Freigabe offen` : ""}</td></tr></table>`;
  const VSL: Record<string, string> = { neu: "neu, Betriebe anfragen", angefragt: "wartet auf Angebote", angebote: "Angebote an Kunden schicken", abgemacht: "nach dem Termin bewerten lassen" };
  const vermHtml = verm.length ? ul(verm.map((v) => li(`<b>${esc(v.leistung || "Anfrage")}</b>${v.ort ? " · " + esc(v.ort) : ""}${v.auftraggeber ? ` <span style="color:#5B6B65">(${esc(v.auftraggeber)})</span>` : ""} – ${VSL[v.status] || v.status}`))) : leer("Keine offenen Vermittlungen.");

  const seite = (Netlify.env.get("PUBLIC_URL") || "https://ab-gemacht.info").replace(/\/$/, "");
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#14231E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #E2E8E5;border-radius:16px">
<tr><td style="padding:24px 24px 0;font-size:21px;font-weight:bold">🤝 Morgen: ${esc(tagLang(morgen))}</td></tr>
${H("📅 Termine")}${B(termineHtml)}
${H(`🤝 Offene Vermittlungen (${verm.length})`)}${B(vermHtml)}
${H(`📞 Fällige Kontakte (${faellig.length})`)}${B(kontakteHtml)}
${H("🗺️ Fahrplan")}${B(fp || leer("Keine offenen Aufgaben für morgen."))}
${naechstes.length ? H("⏭️ Als Nächstes") + B(ul(naechstes)) : ""}
${H("📊 Stand Gate 1")}${B(zahlen)}
<tr><td style="padding:20px 24px 24px"><a href="${seite}/vermittlung" style="display:inline-block;background:#138A6B;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Vermittlung</a> &nbsp; <a href="${seite}/crm" style="color:#138A6B">CRM</a> &nbsp; <a href="${seite}/admin" style="color:#138A6B">Übersicht</a></td></tr>
</table></td></tr></table></body></html>`;

  return { betreff: `Morgen (${kurz(morgen)}): ${tz.length} Termin${tz.length === 1 ? "" : "e"}, ${faellig.length} Anruf${faellig.length === 1 ? "" : "e"}, ${aufgaben.length} Aufgabe${aufgaben.length === 1 ? "" : "n"}`, html };
}

export async function tagesplanSenden(jetzt = new Date()) {
  const key = Netlify.env.get("BREVO_API_KEY");
  if (!key) throw new Error("BREVO_API_KEY fehlt");
  const { betreff, html } = await tagesplan(jetzt);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Abgemacht Tagesplan", email: Netlify.env.get("MAIL_FROM") || "hallo@ab-gemacht.info" },
      to: [{ email: Netlify.env.get("MAIL_TAGESPLAN") || "hallo@ab-gemacht.info" }],
      subject: betreff,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error("Brevo " + res.status + " " + (await res.text()));
  return betreff;
}
