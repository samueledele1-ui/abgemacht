// Zugänge für feste Partner (Hausverwaltungen, Makler, Gewerbe): Einladung, Passwort, Sitzung.
// Passwörter nur als PBKDF2-Hash mit Salz, Sitzungen als zufälliger Token im HttpOnly-Cookie (in der Datenbank nur sein Hash).
import { seite, esc, mailLayout, knopf, absatz, gruss, sendeMail } from "./post.ts";

export const ARTEN_KUNDE = ["verwaltung", "makler", "gewerbe", "sonstige"];
export const ART_NAME: Record<string, string> = { verwaltung: "Hausverwaltung", makler: "Immobilienmakler", gewerbe: "Gewerbe", sonstige: "Sonstige" };
export const COOKIE = "abg_portal";
const TAGE = 30;
const ITER = 120_000;

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const zufall = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }

async function pbkdf2(pw: string, salz: string, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salz), iterations: iter }, key, 256);
  return hex(new Uint8Array(bits));
}
export async function pwHash(pw: string) {
  const salz = zufall(16);
  return `pbkdf2$${ITER}$${salz}$${await pbkdf2(pw, salz, ITER)}`;
}
export async function pwPruefen(pw: string, gespeichert: string | null) {
  if (!gespeichert) return false;
  const [art, it, salz, soll] = gespeichert.split("$");
  if (art !== "pbkdf2" || !soll) return false;
  const ist = await pbkdf2(pw, salz, Number(it));
  let d = ist.length ^ soll.length;
  for (let i = 0; i < Math.min(ist.length, soll.length); i++) d |= ist.charCodeAt(i) ^ soll.charCodeAt(i);
  return d === 0;
}
export function pwRegel(pw: string) {
  if (pw.length < 10) return "Bitte mindestens 10 Zeichen verwenden.";
  if (pw.length > 200) return "Das Passwort ist zu lang.";
  if (!/[a-zäöüß]/i.test(pw) || !/\d/.test(pw)) return "Bitte Buchstaben und mindestens eine Zahl verwenden.";
  return null;
}

export const einladeLink = (token: string) => `${seite()}/portal?einladung=${token}`;

// Neuen Einladungslink erzeugen (7 Tage gültig), optional per Mail schicken
export async function einladung(sql: any, zugangId: number, mailen: boolean) {
  const z = (await sql`SELECT z.id, z.name, z.email, k.name AS kunde FROM kunden_zugaenge z JOIN kunden k ON k.id = z.kunde_id WHERE z.id = ${zugangId}`)[0];
  if (!z) return null;
  const token = "e_" + zufall(24);
  await sql`UPDATE kunden_zugaenge SET einlade_token = ${token}, einlade_bis = now() + interval '7 days', aktiv = true WHERE id = ${z.id}`;
  const link = einladeLink(token);
  let gemailt = false;
  if (mailen) gemailt = await sendeMail(z.email, z.name, "Ihr Zugang zum Abgemacht-Portal", mailLayout(
    absatz(`Guten Tag${z.name ? " " + esc(z.name) : ""},`) +
    absatz(`für ${esc(z.kunde)} ist ein Zugang zum Abgemacht-Portal eingerichtet. Dort sehen Sie Schadensmeldungen Ihrer Mieter, holen mit einem Klick Angebote geprüfter Betriebe ein, bestätigen Besichtigungstermine und behalten Prüffristen im Blick. Für Sie ist das kostenlos.`) +
    absatz("Legen Sie über den Knopf Ihr Passwort fest. Der Link ist 7 Tage gültig.") +
    knopf(link, "Passwort festlegen") + gruss));
  return { link, gemailt };
}

export function cookieSetzen(token: string) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${TAGE * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const cookieLoeschen = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function sitzungStarten(sql: any, zugangId: number) {
  const token = "s_" + zufall(32);
  await sql`DELETE FROM kunden_sitzungen WHERE gueltig_bis < now()`;
  await sql`INSERT INTO kunden_sitzungen (token_hash, zugang_id, gueltig_bis) VALUES (${await sha256(token)}, ${zugangId}, now() + ${TAGE + " days"}::interval)`;
  await sql`UPDATE kunden_zugaenge SET letzter_login = now() WHERE id = ${zugangId}`;
  return token;
}

export function cookieAus(req: Request) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=(s_[0-9a-f]{64})"));
  return m ? m[1] : null;
}

// Angemeldeten Zugang laden (oder null)
export async function angemeldet(sql: any, req: Request) {
  const token = cookieAus(req);
  if (!token) return null;
  const z = (await sql`SELECT z.id, z.name, z.email, z.kunde_id, k.name AS kunde, k.art, k.telefon AS kunde_tel, k.ansprechpartner, k.adresse AS kunde_adresse
      FROM kunden_sitzungen s JOIN kunden_zugaenge z ON z.id = s.zugang_id JOIN kunden k ON k.id = z.kunde_id
      WHERE s.token_hash = ${await sha256(token)} AND s.gueltig_bis > now() AND z.aktiv`)[0];
  return z ? { ...z, token } : null;
}
