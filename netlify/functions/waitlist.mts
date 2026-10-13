import { neon } from "@neondatabase/serverless";
import type { Config, Context } from "@netlify/functions";

const TYPEN = ["firma", "selbststaendig", "mitarbeiter", "privat"];
const QUELLEN = ["direkt", "umfrage", "ig", "tt", "li", "wa"];

const clip = (v: unknown, n = 120): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, n);
  return s.length ? s : null;
};

const fehler = (msg: string, status = 400) => Response.json({ ok: false, error: msg }, { status });

export default async (req: Request, _context: Context) => {
  const dbUrl = Netlify.env.get("DATABASE_URL");
  if (!dbUrl) return fehler("Server ist noch nicht eingerichtet.", 500);
  const sql = neon(dbUrl);

  if (req.method === "GET") {
    const rows = await sql`SELECT count(*)::int AS n FROM waitlist`;
    return Response.json({ count: rows[0].n }, { headers: { "Cache-Control": "public, max-age=60" } });
  }

  if (req.method !== "POST") return fehler("Methode nicht erlaubt.", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fehler("Ungültige Anfrage.");
  }

  // Honeypot: echte Menschen füllen dieses Feld nie aus
  if (clip(body.website)) return Response.json({ ok: true, neu: true });

  const email = (clip(body.email, 254) || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fehler("Bitte gib eine gültige E-Mail-Adresse ein.");
  if (body.consent !== true) return fehler("Bitte stimme der Datenschutzerklärung zu.");

  const typ = TYPEN.includes(String(body.typ)) ? String(body.typ) : null;
  const quelle = QUELLEN.includes(String(body.quelle)) ? String(body.quelle) : "direkt";

  const rows = await sql`
    INSERT INTO waitlist (email, name, typ, branche, ort, quelle)
    VALUES (${email}, ${clip(body.name, 80)}, ${typ}, ${clip(body.branche, 60)}, ${clip(body.ort, 80)}, ${quelle})
    ON CONFLICT (email) DO NOTHING
    RETURNING id`;

  return Response.json({ ok: true, neu: rows.length > 0 });
};

export const config: Config = { path: "/api/waitlist" };
