// Nachweise der Partner-Betriebe (Gewerbeanmeldung): Foto oder PDF, als Base64 in der Datenbank
export const NACHWEIS_MAX = 5_600_000; // Base64-Zeichen, entspricht etwa 4 MB

export function nachweisPruefen(v: unknown): { mime: string; daten: string; bytes: number } | null {
  const m = String(v || "").match(/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m || m[2].length > NACHWEIS_MAX) return null;
  const kopf = Buffer.from(m[2].slice(0, 24), "base64");
  const echt = m[1] === "image/jpeg" ? kopf[0] === 0xff && kopf[1] === 0xd8
    : m[1] === "image/png" ? kopf.toString("latin1", 1, 4) === "PNG"
    : m[1] === "image/webp" ? kopf.toString("latin1", 8, 12) === "WEBP"
    : kopf.toString("latin1", 0, 5) === "%PDF-";
  if (!echt) return null;
  return { mime: m[1], daten: m[2], bytes: Math.floor(m[2].length * 3 / 4) };
}

// Gilt als „geprüfter Betrieb“, wenn die Gewerbeanmeldung geprüft ist und die Handwerkskammer
// geprüft oder für das Gewerk nicht nötig ist
export const istGeprueft = (k: { gewerbe_geprueft_am?: unknown; hwk_status?: unknown }) =>
  !!k.gewerbe_geprueft_am && (k.hwk_status === "eingetragen" || k.hwk_status === "nicht_noetig");
