// Findet passende Betriebe zu einer Anfrage: nicht nur wörtlich, sondern über Branchen-Gruppen.
// Beispiel: „Altersvorsorgeberatung“ oder „Rechtsschutz“ → Gruppe Finanzen/Versicherung → alle Betriebe mit
// Finanzen, Geldanlage, Versicherung, Altersvorsorge … in Branche oder Leistungen.

export const BRANCHEN: Record<string, string[]> = {
  finanzen: ["finanz", "versicherung", "versichern", "rechtsschutz", "altersvorsorge", "vorsorge", "rente", "geldanlage", "kapitalanlage", "investment", "invest",
    "vermögen", "fonds", " etf", "bauspar", "baufinanzierung", "finanzierung", "kredit", "darlehen", "berufsunfähig", " bu ", "haftpflicht",
    "krankenversicherung", "krankenzusatz", "zahnzusatz", "pflegeversicherung", "lebensversicherung", "hausrat", "wohngebäude", "kfz-versicherung",
    "makler", "vermittler", "finanzberat", "praelux"],
  maler: ["maler", "streichen", "anstreich", "anstrich", "tapez", "tapete", "lackier", "fassade", "spachtel", "farbe"],
  reinigung: ["reinig", "putz", "sauber", "treppenhausreinig", "fensterputz", "fensterreinig", "glas", "unterhalt", "grundreinig", "büroreinig", "praxisreinig", "hausmeister", "gebäudeservice", "facility"],
  hausmeister: ["hausmeister", "winterdienst", "räumdienst", "objektbetreu", "facility", "gebäudeservice", "reinig"],
  elektro: ["elektr", "steckdose", "lampe", "licht", "beleuchtung", "e-check", "echeck", "wallbox", "sicherung", "verkabel", "kabel", "smart home"],
  sanitaer: ["sanitär", "sanitaer", "heizung", " bad ", "badsanier", "badezimmer", "klempner", "installat", "rohr", "abfluss", "wasser", "wärmepumpe", "therme", "kessel", "shk"],
  solar: ["photovoltaik", "solar", "pv-", "pv ", "speicher", "wärmepumpe", "energie"],
  garten: ["garten", "rasen", "hecke", "baum", "gehölz", "landschaft", "grünpflege", "grünanlage", "pflaster", "zaun", "mähen"],
  umzug: ["umzug", "umzieh", "transport", "entrümpel", "entsorg", "möbeltransport", "spedition", "lagerung"],
  dach: ["dach", "dachdeck", "dachrinne", "rinne", "spengler", "flaschner", "ziegel"],
  schreiner: ["schreiner", "tischler", "möbel", "küche", "einbau", "holz", "treppenbau", "innentür", "fenstereinbau"],
  boden: ["boden", "parkett", "laminat", "fliese", "fliesen", "estrich", "teppich", "vinyl"],
  bau: ["bau", "maurer", "trockenbau", "renovier", "sanier", "umbau", "abriss", "beton", "putz", "innenausbau"],
  schluessel: ["schlüssel", "schloss", "aufsperr", "tresor"],
  kfz: ["kfz", "auto", "werkstatt", "reifen", "pkw", "fahrzeug", "lack"],
  it: ["it-", "it ", "edv", "computer", "pc", "laptop", "netzwerk", "server", "software", "drucker", "wlan", "backup", "datensicher", "it-support"],
  ki: ["ki", "künstliche intelligenz", "ki-", "automatisier", "chatbot", "prompt", "ai "],
  web: ["website", "webseite", "homepage", "webdesign", "online-shop", "onlineshop", "shop", "marketing", "seo", "social media", "werbung", "google", "instagram", "anzeige", "flyer", "grafik", "logo"],
  foto: ["foto", "fotograf", "video", "film", "drohne", "bewerbungsbild", "hochzeit", "shooting"],
  sport: ["sport", "training", "trainer", "fitness", "personal training", "personaltrain", "yoga", "fitnesskurs", "gesundheitskurs", "betriebssport", "kampfsport"],
  sicherheit: ["sicherheit", "security", "bewach", "objektschutz", "werkschutz", "veranstaltungsschutz", "ordner", "einlass", "doorman", "sicherheitsdienst"],
  catering: ["catering", "essen", "buffet", "koch", "küche", "verpflegung", "getränke", "food", "grill"],
  buero: ["buchhaltung", "buchführung", "büro", "sekretariat", "lohn", "verwaltung", "ablage", "rechnung", "steuer", "belege", "bürodienst", "assistenz"],
  event: ["event", "veranstaltung", "dj", "musik", "feier", "party", "hochzeit", "technik", "bühne"],
  beauty: ["beauty", "kosmetik", "friseur", "nagel", "nägel", "massage", "wimpern"],
};

const ENDUNGEN = ["beratungen", "beratung", "arbeiten", "arbeit", "dienstleistung", "dienstleistungen", "leistungen", "leistung", "service", "dienst",
  "betrieb", "firma", "angebot", "angebote", "ungen", "ung", "en", "er", "e", "n", "s"];
const STOPP = new Set(["und", "oder", "für", "fuer", "mit", "bei", "der", "die", "das", "ein", "eine", "einen", "von", "zum", "zur", "suche", "brauche", "gesucht",
  "bitte", "neue", "neu", "ich", "wir", "uns", "mein", "meine", "unser", "unsere", "haus", "wohnung", "firma", "betrieb", "ulm", "neu-ulm", "senden"]);

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/ß/g, "ss");
const normK = (s: string) => s.toLowerCase().replace(/ß/g, "ss");

function stamm(w: string) {
  for (const e of ENDUNGEN) if (w.length - e.length >= 4 && w.endsWith(e)) return w.slice(0, -e.length);
  return w;
}

export type Treffer = { gruppen: string[]; woerter: string[] };

// Zerlegt eine Anfrage in Suchwörter und erkannte Branchen-Gruppen
export function analysiere(text: string): Treffer {
  const t = " " + norm(text) + " ";
  const woerter = [...new Set(t.split(/[^a-zäöü0-9-]+/).filter((w) => w.length >= 3 && !STOPP.has(w)))];
  const gruppen = Object.entries(BRANCHEN).filter(([g, keys]) =>
    t.includes(" " + g) || keys.some((k) => {
      const kk = normK(k);
      // kurze Schlüssel (ki, it, pv) nur als ganzes Wort, sonst als Wortanfang/-teil
      if (kk.trim().length <= 2) return new RegExp(`(^|[^a-zäöü])${kk.trim()}([^a-zäöü]|$)`).test(t);
      return t.includes(kk);
    })).map(([g]) => g);
  return { gruppen, woerter: woerter.map(stamm).filter((w) => w.length >= 3) };
}

export type Kontakt = { id: number; firma: string | null; kategorie: string | null; leistungen: string | null; ort: string | null; region: string | null;
  partner: string | null; wa_ok_am: unknown; notizen?: string | null; [k: string]: unknown };

// Bewertet Kontakte nach Passung; gibt nur passende (Punkte > 0) sortiert zurück, mit Begründung
export function bewerte<T extends Kontakt>(kontakte: T[], anfrage: string, ort?: string | null): (T & { punkte: number; grund: string })[] {
  const { gruppen, woerter } = analysiere(anfrage);
  const ortN = norm(ort).trim();
  const plz = (ortN.match(/\b\d{5}\b/) || [""])[0];
  const out: (T & { punkte: number; grund: string })[] = [];
  for (const k of kontakte) {
    const text = " " + norm([k.firma, k.kategorie, k.leistungen].filter(Boolean).join(" · ")).replace(/[^\s@]+@[^\s@]+/g, " ") + " ";
    let p = 0;
    const gruende: string[] = [];
    for (const w of woerter) if (text.includes(w)) { p += 4; gruende.push(w); }
    for (const g of gruppen) {
      const keys = [...(g.length >= 5 ? [g] : []), ...BRANCHEN[g]].map(normK);
      const hit = keys.find((kk) => kk.trim().length <= 2 ? new RegExp(`(^|[^a-zäöü])${kk.trim()}([^a-zäöü]|$)`).test(text) : text.includes(kk));
      if (hit) { p += 3; gruende.push(g); }
    }
    if (!p) continue;
    if (k.partner === "aktiv") p += 2; else if (k.partner === "interessiert") p += 1;
    if (k.wa_ok_am) p += 0.5;
    const kOrt = norm([k.ort, k.region].filter(Boolean).join(" "));
    if (ortN && kOrt && (kOrt.includes(ortN) || ortN.includes(kOrt.trim()) || (plz && kOrt.includes(plz)))) p += 1;
    out.push({ ...k, punkte: p, grund: [...new Set(gruende)].join(", ") });
  }
  return out.sort((a, b) => b.punkte - a.punkte || String(a.firma).localeCompare(String(b.firma)));
}
