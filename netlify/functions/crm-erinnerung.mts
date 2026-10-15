import { neon } from "@neondatabase/serverless";
import type { Config } from "@netlify/functions";

// Werktags morgens: Mail an Samuel mit allen Kontakten, die heute im CRM fällig sind.

const TZ = "Europe/Berlin";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const STATUS: Record<string, string> = {
  neu: "Neu", wiedervorlage: "Wiedervorlage", mailbox: "Mailbox", mail_gewuenscht: "Mail gewünscht", warteliste: "Warteliste prüfen",
};

export default async () => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  const key = Netlify.env.get("BREVO_API_KEY");
  if (!dbUrl || !key) return;
  const sql = neon(dbUrl);

  // Ende des heutigen Tages in Berlin
  const heute = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const rows = await sql`
    SELECT k.id, k.firma, k.ansprechpartner, k.telefon, k.region, k.status, k.naechster_kontakt, k.versuche, w.status AS wl_status
    FROM crm_kontakte k
    LEFT JOIN waitlist w ON k.warteliste_email IS NOT NULL AND lower(w.email) = lower(k.warteliste_email)
    WHERE k.naechster_kontakt IS NOT NULL
      AND (k.naechster_kontakt AT TIME ZONE 'Europe/Berlin')::date <= ${heute}::date
      AND k.status NOT IN ('kein_interesse', 'keine_anrufe', 'nicht_erreichbar')
      AND COALESCE(w.status, '') <> 'bestaetigt'
    ORDER BY k.naechster_kontakt`;
  if (!rows.length) return;

  const seite = (Netlify.env.get("PUBLIC_URL") || "https://ab-gemacht.info").replace(/\/$/, "");
  const zeit = (d: string) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
  const zeilen = rows.map((r) =>
    `<tr><td style="padding:8px 6px;border-bottom:1px solid #E2E8E5"><b>${esc(r.firma)}</b><br><span style="color:#5B6B65;font-size:13px">${esc(r.ansprechpartner || "")}${r.region ? " · " + esc(r.region) : ""}</span></td>` +
    `<td style="padding:8px 6px;border-bottom:1px solid #E2E8E5;white-space:nowrap"><a href="tel:${esc(String(r.telefon || "").replace(/[^\d+]/g, ""))}" style="color:#138A6B">${esc(r.telefon || "")}</a><br><span style="color:#5B6B65;font-size:13px">${STATUS[r.status as string] || esc(r.status)} · ${zeit(r.naechster_kontakt as string)}</span></td></tr>`
  ).join("");

  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#14231E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E2E8E5;border-radius:16px">
<tr><td style="padding:24px 24px 4px;font-size:20px;font-weight:bold">🤝 Heute anrufen: ${rows.length}</td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">${zeilen}</table>
<p style="margin:22px 0 0"><a href="${seite}/crm" style="display:inline-block;background:#138A6B;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">CRM öffnen</a></p>
</td></tr></table></td></tr></table></body></html>`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Abgemacht CRM", email: Netlify.env.get("MAIL_FROM") || "hallo@ab-gemacht.info" },
      to: [{ email: Netlify.env.get("MAIL_ADMIN") || "hallo@ab-gemacht.info" }],
      subject: `Heute anrufen: ${rows.length} Kontakt${rows.length === 1 ? "" : "e"}`,
      htmlContent: html,
    }),
  });
  if (!res.ok) console.error("Brevo", res.status, await res.text());
};

// Mo–Fr 05:15 UTC = 7:15 Uhr Sommerzeit, 6:15 Uhr Winterzeit
export const config: Config = { schedule: "15 5 * * 1-5" };
