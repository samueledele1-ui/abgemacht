// Empfehlungen: Partner-Betriebe leiten Kunden, die sie selbst nicht bedienen können, über ihren
// persönlichen Link (/?empfohlen=CODE) weiter. Kommt daraus ein Auftrag zustande und ist die
// Freischaltgebühr bezahlt, bekommt der empfehlende Betrieb die Hälfte davon.
import { seite } from "./post.ts";

export const EMPFEHL_ANTEIL = 0.5;
export const CODE_RE = /^[a-z0-9-]{4,40}$/;

const slug = (s: string) => s.toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/\b(gmbh|ug|gbr|ohg|kg|e\.?\s?k\.?|inh\.?|haftungsbeschraenkt|und|co)\b/g, " ")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22).replace(/-+$/, "") || "partner";
const zufall = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

export const empfehlLink = (code: string) => `${seite()}/?empfohlen=${code}#anfrage`;

// Vorhandenen Code holen oder neu anlegen
export async function empfehlCode(sql: any, kid: number): Promise<string | null> {
  const r = (await sql`SELECT firma, empfehl_code FROM crm_kontakte WHERE id = ${kid}`)[0];
  if (!r) return null;
  if (r.empfehl_code) return r.empfehl_code;
  for (let i = 0; i < 5; i++) {
    const code = slug(String(r.firma || "")) + "-" + zufall();
    const u = await sql`UPDATE crm_kontakte SET empfehl_code = ${code} WHERE id = ${kid} AND empfehl_code IS NULL
      AND NOT EXISTS (SELECT 1 FROM crm_kontakte WHERE empfehl_code = ${code}) RETURNING empfehl_code`;
    if (u.length) return u[0].empfehl_code;
    const n = (await sql`SELECT empfehl_code FROM crm_kontakte WHERE id = ${kid}`)[0]?.empfehl_code;
    if (n) return n;
  }
  return null;
}

// Code → Partner-Betrieb (nur Betriebe mit Partner-Status)
export async function empfehlerZuCode(sql: any, code: unknown) {
  const c = String(code || "").toLowerCase().trim();
  if (!CODE_RE.test(c)) return null;
  return (await sql`SELECT id, firma, ansprechpartner, email FROM crm_kontakte WHERE empfehl_code = ${c} AND partner IS NOT NULL`)[0] || null;
}

// Stand der Empfehlungen eines Betriebs (für Angebotsseite und Büro)
export async function empfehlStand(sql: any, kid: number) {
  const r = (await sql`SELECT count(*)::int AS anzahl,
      count(*) FILTER (WHERE v.status IN ('abgemacht', 'erledigt'))::int AS abgemacht,
      coalesce(sum(round(v.gebuehr * ${EMPFEHL_ANTEIL}, 2)) FILTER (WHERE v.gewaehlt_id <> v.empfohlen_von AND v.gebuehr > 0
        AND (v.bezahlt_am IS NOT NULL OR r.status = 'bezahlt')), 0)::float AS verdient,
      coalesce(sum(round(v.gebuehr * ${EMPFEHL_ANTEIL}, 2)) FILTER (WHERE v.gewaehlt_id <> v.empfohlen_von AND v.gebuehr > 0
        AND (v.bezahlt_am IS NOT NULL OR r.status = 'bezahlt') AND v.empfehlung_ausgezahlt_am IS NOT NULL), 0)::float AS ausgezahlt
    FROM vermittlungen v LEFT JOIN rechnungen r ON r.id = v.rechnung_id WHERE v.empfohlen_von = ${kid}`)[0];
  return r as { anzahl: number; abgemacht: number; verdient: number; ausgezahlt: number };
}
