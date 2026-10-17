import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";

// Übersicht für Samuel: Warteliste und Umfrage, geschützt mit ADMIN_PASSWORT (Netlify-Umgebungsvariable)

const fehler = (msg: string, status = 400) =>
  Response.json({ ok: false, error: msg }, { status, headers: { "Cache-Control": "no-store" } });

async function gleich(a: string, b: string) {
  // Vergleich über Hashes, damit die Laufzeit nichts über das Passwort verrät
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);
  const soll = Netlify.env.get("ADMIN_PASSWORT");
  if (!soll || soll.length < 8) return fehler("ADMIN_PASSWORT ist in Netlify noch nicht gesetzt.", 503);
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fehler("Ungültige Anfrage.");
  }
  if (!(await gleich(String(body.pw || ""), soll))) {
    await new Promise((r) => setTimeout(r, 1200)); // bremst Rateversuche
    return fehler("Falsches Passwort.", 401);
  }

  const sql = neon(dbUrl);
  const [warteliste, umfrage] = await Promise.all([
    sql`SELECT id, email, name, typ, branche, ort, quelle, status, created_at, confirmed_at
        FROM waitlist ORDER BY created_at DESC`,
    sql`SELECT id, created_at, typ, branche, ort, kanaele, zufriedenheit, nervt, versucht, funktionen,
               zahlen, preis_fair, nutzung, kontakt_ok, kontakt, quelle, termin, termin_telefon, termin_mail_at, version, auslastung, langzeit, kanal, suche, arten
        FROM umfrage ORDER BY created_at DESC`,
  ]);
  return Response.json({ ok: true, warteliste, umfrage }, { headers: { "Cache-Control": "no-store" } });
};

export const config: Config = { path: "/api/admin" };
