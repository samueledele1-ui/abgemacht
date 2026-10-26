import { neon } from "@neondatabase/serverless";
import type { Config } from "@netlify/functions";
import { seite, esc, mailLayout, knopf, absatz, gruss, tabelle, sendeMail, EMAIL_RE } from "../lib/post.ts";

// Stündlich: Betriebe, die eine Anfrage vor mindestens 2 Tagen per Mail bekommen und noch nicht reagiert haben,
// bekommen einmal eine freundliche Erinnerung. Nur werktags zwischen 8 und 18 Uhr (Berlin), nur an Partner-Betriebe
// mit Einverständnis (aktiv oder interessiert), nur solange die Anfrage noch offen ist.

const TZ = "Europe/Berlin";
const ARTNAME: Record<string, string> = { einmalig: "Einmalig", projekt: "Projekt", langzeit: "Regelmäßig / langfristig" };

function berlinJetzt() {
  const teile = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { tag: teile.weekday as string, stunde: Number(teile.hour) };
}

export default async () => {
  const { tag, stunde } = berlinJetzt();
  if (tag === "Sat" || tag === "Sun" || stunde < 8 || stunde >= 18) return;
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl || !Netlify.env.get("BREVO_API_KEY")) return;
  const sql = neon(dbUrl);

  const offen = await sql`
    SELECT vb.id, vb.token, vb.kontakt_id, vb.vermittlung_id, k.firma, k.ansprechpartner, k.email,
           v.leistung, v.ort, v.zeitraum, v.art, v.laufzeit
    FROM vermittlung_betriebe vb
    JOIN crm_kontakte k ON k.id = vb.kontakt_id
    JOIN vermittlungen v ON v.id = vb.vermittlung_id
    WHERE vb.status = 'angefragt'
      AND vb.gemailt_am IS NOT NULL AND vb.gemailt_am <= now() - interval '48 hours'
      AND vb.erinnert_am IS NULL
      AND vb.preis_betrag IS NULL
      AND v.status IN ('angefragt', 'angebote')
      AND k.partner IN ('aktiv', 'interessiert')
      AND k.email IS NOT NULL
    ORDER BY vb.gemailt_am
    LIMIT 20`;

  for (const b of offen as any[]) {
    if (!EMAIL_RE.test(String(b.email))) continue;
    const betreff = `Kurze Erinnerung: Anfrage ${b.leistung || "Auftrag"}${b.ort ? " in " + b.ort : ""}`;
    const html = mailLayout(
      absatz(`Guten Tag${b.ansprechpartner ? " " + esc(b.ansprechpartner) : ""},`) +
      absatz("vor zwei Tagen haben wir Ihnen eine Anfrage geschickt. Wir wollten nur kurz sichergehen, dass sie bei Ihnen angekommen ist:") +
      tabelle([["Leistung", b.leistung], ["Ort", b.ort], ["Wann", b.zeitraum], ["Art", (ARTNAME[b.art || "einmalig"] || "") + (b.laufzeit ? ", " + b.laufzeit : "")]]) +
      absatz("Wenn Sie Interesse haben, können Sie Ihr Angebot weiterhin über den Knopf abgeben. Passt es gerade nicht, sagen Sie auf derselben Seite einfach kurz ab, dann wissen wir Bescheid.") +
      knopf(`${seite()}/angebot?t=${b.token}`, "Zur Anfrage") +
      absatz(`<span style="font-size:14px;color:#5B6B65">Fragen? Antworten Sie einfach auf diese Mail oder rufen Sie uns an: 0177 2385499.</span>`) +
      gruss);
    const ok = await sendeMail(b.email, b.ansprechpartner || b.firma, betreff, html);
    if (!ok) { console.error("Erinnerung nicht gesendet", b.id); continue; }
    await sql`UPDATE vermittlung_betriebe SET erinnert_am = now() WHERE id = ${b.id}`;
    await sql`INSERT INTO crm_log (kontakt_id, art, text) VALUES (${b.kontakt_id}, 'vermittlung', ${"Erinnerung zu Anfrage #" + b.vermittlung_id + " gesendet"})`;
  }
};

export const config: Config = { schedule: "20 * * * *" };
