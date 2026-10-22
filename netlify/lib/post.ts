// Gemeinsame Helfer für automatische Vermittlungs-Mails (Brevo) und den Kontaktdaten-Filter

export const seite = () => (Netlify.env.get("PUBLIC_URL") || "https://ab-gemacht.info").replace(/\/$/, "");
export const adminMail = () => Netlify.env.get("MAIL_ADMIN") || "hallo@ab-gemacht.info";
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function mailLayout(inhalt: string) {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#F6F8F7;font-family:Arial,Helvetica,sans-serif;color:#14231E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8F7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E2E8E5;border-radius:16px">
<tr><td style="padding:24px 28px 0;font-size:20px;font-weight:bold"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;background:#0D4F3E;color:#F2B33D;border-radius:9px;font-size:19px;font-weight:bold;vertical-align:middle;margin-right:8px">&#10003;</span>Abgemacht</td></tr>
<tr><td style="padding:16px 28px 28px;font-size:16px;line-height:1.55">${inhalt}</td></tr>
</table>
<p style="max-width:520px;font-size:12px;line-height:1.5;color:#5B6B65;margin:16px auto 0">Abgemacht · Samuel Edele · Fliederweg 15 · 89250 Senden</p>
</td></tr></table></body></html>`;
}

// Knopf plus sichtbarer Link darunter (falls ein Mail-Programm den Knopf nicht öffnet)
export const knopf = (href: string, text: string) =>
  `<p style="margin:24px 0 8px"><a href="${href}" target="_blank" style="display:inline-block;background:#138A6B;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:999px">${text}</a></p>` +
  `<p style="margin:0 0 20px;font-size:13px;line-height:1.4;color:#5B6B65;word-break:break-all">Falls der Knopf nicht reagiert: <a href="${href}" target="_blank" style="color:#138A6B">${href}</a></p>`;

export const absatz = (html: string) => `<p style="margin:0 0 12px">${html}</p>`;
export const gruss = `<p style="margin:0">Viele Grüße<br>Ihr Team von Abgemacht</p>`;

export function tabelle(zeilen: [string, string | null | undefined][]) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.45;margin:0 0 12px">${zeilen
    .filter(([, w]) => w)
    .map(([k, w]) => `<tr><td style="padding:5px 12px 5px 0;color:#5B6B65;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:5px 0">${esc(w)}</td></tr>`)
    .join("")}</table>`;
}

// Klartext-Fassung einer HTML-Mail (Mails nur mit HTML landen öfter im Spam)
export function alsText(html: string): string {
  return html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => {
      const txt = t.replace(/<[^>]+>/g, "").trim();
      return href.startsWith("mailto:") || txt === href ? txt : `${txt}: ${href}`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, "\n\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Sendet eine Mail über Brevo. Gibt false zurück, wenn kein Schlüssel gesetzt ist oder Brevo ablehnt (wirft nie).
export async function sendeMail(an: string, name: string | null, betreff: string, html: string): Promise<boolean> {
  const key = Netlify.env.get("BREVO_API_KEY");
  if (!key || !EMAIL_RE.test(an)) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Abgemacht", email: Netlify.env.get("MAIL_FROM") || "hallo@ab-gemacht.info" },
        replyTo: { email: Netlify.env.get("MAIL_REPLY_TO") || "samuel.edele1@gmail.com", name: "Abgemacht" },
        to: [name ? { email: an, name } : { email: an }],
        subject: betreff,
        htmlContent: html,
        textContent: alsText(html),
      }),
    });
    if (!res.ok) console.error("Brevo", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error("Brevo", e);
    return false;
  }
}

// Entfernt Telefonnummern, E-Mail-Adressen und Web-Adressen aus freiem Text, solange noch nicht „abgemacht“ ist
const ERSATZ = "[Kontaktdaten entfernt]";
export function ohneKontakt(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, ERSATZ)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ERSATZ)
    .replace(/\b[a-z0-9-]{2,}\.(?:de|com|net|org|eu|info|biz|io|shop|online|at|ch)\b\S*/gi, ERSATZ)
    // Telefonnummern: beginnen mit +, 00 oder 0 und haben mindestens 7 Ziffern (Daten und Preise mit Punkt/Komma bleiben)
    .replace(/(?:\+\s?\d|\b0)[\d \/()-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? ERSATZ : m));
}

// Erste E-Mail-Adresse aus einem Kontaktfeld wie "0731 123456 · max@firma.de"
export const mailAus = (s: string | null | undefined) => (String(s || "").match(/[^\s@·,;]+@[^\s@·,;]+\.[a-z]{2,}/i) || [""])[0].toLowerCase() || null;
