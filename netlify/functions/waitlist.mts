import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";

// Eine Funktion für alles rund um die Warteliste:
//   GET  /api/waitlist     -> Anzahl bestätigter Anmeldungen
//   POST /api/waitlist     -> Anmeldung speichern, Bestätigungs-Mail schicken
//   POST /api/bestaetigen  -> Klick aus der Bestätigungs-Mail (Double-Opt-in)
//   POST /api/abmelden     -> Abmeldung aus jeder Mail

const TYPEN = ["firma", "selbststaendig", "mitarbeiter", "privat"];
const QUELLEN = ["direkt", "umfrage", "ig", "tt", "li", "wa"];
const TOKEN_RE = /^[a-f0-9]{64}$/;

const clip = (v: unknown, n = 120): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fehler = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status });
const neuerToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
const seite = () => (Netlify.env.get("PUBLIC_URL") || "https://abgemacht.netlify.app").replace(/\/$/, "");

/* ---------- E-Mail über Brevo (nur aktiv, wenn BREVO_API_KEY gesetzt ist) ---------- */

async function brevo(path: string, method: string, body?: unknown) {
  const key = Netlify.env.get("BREVO_API_KEY");
  if (!key) return null;
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) console.error("Brevo", path, res.status, await res.text());
  return res;
}

function mailLayout(inhalt: string, abmeldeLink?: string) {
  const fuss = `Abgemacht · Samuel Edele · Fliederweg 15 · 89250 Senden<br>` +
    (abmeldeLink ? `<a href="${abmeldeLink}" style="color:#5B6B65">Von der Warteliste abmelden</a>` : "");
  return `<!doctype html><html lang="de"><body style="margin:0;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#14231E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E2E8E5;border-radius:16px">
<tr><td style="padding:24px 28px 0;font-size:20px;font-weight:bold">🤝 Abgemacht</td></tr>
<tr><td style="padding:16px 28px 28px;font-size:16px;line-height:1.55">${inhalt}</td></tr>
</table>
<p style="max-width:520px;font-size:12px;line-height:1.5;color:#5B6B65;margin:16px auto 0">${fuss}</p>
</td></tr></table></body></html>`;
}

const knopf = (href: string, text: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#138A6B;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:999px">${text}</a></p>`;

async function sendeMail(an: string, name: string | null, betreff: string, html: string, abmeldeLink?: string) {
  const res = await brevo("/smtp/email", "POST", {
    sender: { name: "Abgemacht", email: Netlify.env.get("MAIL_FROM") || "hallo@abgemacht.de" },
    replyTo: { email: Netlify.env.get("MAIL_REPLY_TO") || "samuel.edele1@gmail.com", name: "Samuel von Abgemacht" },
    to: [name ? { email: an, name } : { email: an }],
    subject: betreff,
    htmlContent: html,
    ...(abmeldeLink ? { headers: { "List-Unsubscribe": `<${abmeldeLink}>` } } : {}),
  });
  return !!res && res.ok;
}

function bestaetigungsMail(name: string | null, token: string) {
  const link = `${seite()}/bestaetigen?t=${token}`;
  return mailLayout(
    `<p style="margin:0 0 12px">Hallo${name ? " " + esc(name) : ""},</p>
<p style="margin:0 0 12px">danke für dein Interesse an Abgemacht! Bitte bestätige mit einem Klick, dass du auf die Warteliste möchtest.</p>
${knopf(link, "Anmeldung bestätigen")}
<p style="margin:0;font-size:14px;color:#5B6B65">Du hast dich nicht eingetragen? Dann ignoriere diese E-Mail einfach. Ohne Bestätigung löschen wir deine Adresse nach 30 Tagen.</p>`
  );
}

function willkommensMail(name: string | null, token: string) {
  const abmelden = `${seite()}/abmelden?t=${token}`;
  return mailLayout(
    `<p style="margin:0 0 12px">Hallo${name ? " " + esc(name) : ""},</p>
<p style="margin:0 0 12px"><b>Abgemacht!</b> Du stehst jetzt auf der Warteliste.</p>
<p style="margin:0 0 12px">Sobald Abgemacht in deiner Region startet, bekommst du als Erstes Bescheid. Dann kannst du Unternehmer aus deiner Nähe per Swipe kennenlernen, Aufträge und Jobs finden und in den Branchen-Chats mitreden.</p>
<p style="margin:0 0 12px">Je mehr Betriebe aus deiner Gegend dabei sind, desto mehr bringt dir die App. Leite diesen Link gern an Kollegen weiter:</p>
${knopf(`${seite()}/wa`, "Abgemacht weiterempfehlen")}
<p style="margin:0">Bis bald<br>Samuel von Abgemacht</p>`,
    abmelden
  );
}

/* ---------- Handler ---------- */

export default async (req: Request, _context: Context) => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);
  const sql = neon(dbUrl);
  const pfad = new URL(req.url).pathname;

  if (pfad === "/api/waitlist" && req.method === "GET") {
    const rows = await sql`SELECT count(*)::int AS n FROM waitlist WHERE status = 'bestaetigt'`;
    return Response.json({ count: rows[0].n }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fehler("Ungültige Anfrage.");
  }

  /* Bestätigung (Double-Opt-in) */
  if (pfad === "/api/bestaetigen") {
    const t = String(body.t || "");
    if (!TOKEN_RE.test(t)) return fehler("Der Link ist ungültig.");
    const vorher = await sql`SELECT email, name, status FROM waitlist WHERE token = ${t}`;
    if (!vorher.length) return fehler("Der Link ist ungültig oder abgelaufen.", 404);
    if (vorher[0].status === "bestaetigt") return Response.json({ ok: true, schon: true });
    await sql`UPDATE waitlist SET status = 'bestaetigt', confirmed_at = now(), unsubscribed_at = NULL WHERE token = ${t}`;
    const { email, name } = vorher[0];
    const liste = Number(Netlify.env.get("BREVO_LIST_ID") || 0);
    if (liste) await brevo("/contacts", "POST", { email, listIds: [liste], updateEnabled: true });
    await sendeMail(email, name, "Du bist dabei 🤝", willkommensMail(name, t), `${seite()}/abmelden?t=${t}`);
    return Response.json({ ok: true });
  }

  /* Abmeldung */
  if (pfad === "/api/abmelden") {
    const t = String(body.t || "");
    if (!TOKEN_RE.test(t)) return fehler("Der Link ist ungültig.");
    const rows = await sql`UPDATE waitlist SET status = 'abgemeldet', unsubscribed_at = now() WHERE token = ${t} RETURNING email`;
    if (!rows.length) return fehler("Der Link ist ungültig oder abgelaufen.", 404);
    await brevo(`/contacts/${encodeURIComponent(rows[0].email)}`, "DELETE");
    return Response.json({ ok: true });
  }

  /* Neue Anmeldung */
  if (pfad !== "/api/waitlist") return fehler("Nicht gefunden.", 404);

  // Honeypot: echte Menschen füllen dieses Feld nie aus
  if (clip(body.website)) return Response.json({ ok: true, neu: true, mail: true });

  const email = (clip(body.email, 254) || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fehler("Bitte gib eine gültige E-Mail-Adresse ein.");
  if (body.consent !== true) return fehler("Bitte stimme der Datenschutzerklärung zu.");

  const typ = TYPEN.includes(String(body.typ)) ? String(body.typ) : null;
  const quelle = QUELLEN.includes(String(body.quelle)) ? String(body.quelle) : "direkt";
  const name = clip(body.name, 80);

  // Unbestätigte Anmeldungen nach 30 Tagen löschen (wie in der Datenschutzerklärung zugesagt)
  await sql`DELETE FROM waitlist WHERE status = 'offen' AND created_at < now() - interval '30 days'`;

  const rows = await sql`
    INSERT INTO waitlist (email, name, typ, branche, ort, quelle, token, status)
    VALUES (${email}, ${name}, ${typ}, ${clip(body.branche, 60)}, ${clip(body.ort, 80)}, ${quelle}, ${neuerToken()}, 'offen')
    ON CONFLICT (email) DO UPDATE SET token = COALESCE(waitlist.token, EXCLUDED.token)
    RETURNING id, token, status, name, mail_sent_at, (xmax = 0) AS neu`;
  const r = rows[0];

  if (r.status === "bestaetigt") return Response.json({ ok: true, neu: false, status: "bestaetigt" });

  if (r.status === "abgemeldet") {
    await sql`UPDATE waitlist SET status = 'offen' WHERE id = ${r.id}`;
  }

  // Bestätigungs-Mail höchstens alle 10 Minuten an dieselbe Adresse
  const zuletzt = r.mail_sent_at ? new Date(r.mail_sent_at).getTime() : 0;
  let mail = false;
  if (Date.now() - zuletzt > 10 * 60 * 1000) {
    mail = await sendeMail(email, r.name, "Bitte bestätige deine Anmeldung bei Abgemacht", bestaetigungsMail(r.name, r.token));
    if (mail) await sql`UPDATE waitlist SET mail_sent_at = now() WHERE id = ${r.id}`;
  } else {
    mail = true;
  }

  return Response.json({ ok: true, neu: r.neu, mail });
};

export const config: Config = { path: ["/api/waitlist", "/api/bestaetigen", "/api/abmelden"] };
