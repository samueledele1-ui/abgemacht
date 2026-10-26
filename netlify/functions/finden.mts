import type { Config } from "@netlify/functions";

// Seiten für Google: /finden (Übersicht), /finden/<branche>-<ort> und /sitemap.xml.
// Jede Seite ist echte Information zu Branche und Ort plus direkter Weg zur Anfrage (bzw. Partner-Formular für Betriebe).

type Branche = {
  slug: string; wer: string; name: string; plural: string; kat: string; meister?: boolean; privat: boolean;
  auftraege: string[]; tipp: string; anbieter: string; ich?: string; ratgeber?: string;
};
type Ort = { slug: string; name: string; land: string; teile: string[]; nachbarn: string[]; start: boolean };

const BRANCHEN: Branche[] = [
  { slug: "elektriker", wer: "Elektriker", name: "Elektriker", plural: "Elektriker", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Steckdosen und Leitungen erweitern", "Sicherungskasten erneuern", "Wallbox für das E-Auto installieren", "Smart Home einrichten", "E-Check für Büro und Werkstatt"],
    tipp: "Arbeiten am Stromnetz dürfen nur Betriebe ausführen, die bei der Handwerkskammer und beim Netzbetreiber eingetragen sind. Eine Wallbox muss beim Netzbetreiber angemeldet werden, das übernimmt in der Regel der Elektriker.",
    anbieter: "Sie sind Elektriker und haben noch Kapazität? Auf Abgemacht sehen Sie Aufträge aus Ihrer Umgebung, bevor sie im Bekanntenkreis versanden." },
  { slug: "installateur", wer: "Installateur", name: "Installateur", plural: "Installateure für Sanitär und Heizung", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Bad sanieren", "Heizung warten lassen", "Wärmepumpe planen und einbauen", "Tropfenden Wasserhahn oder Rohrbruch reparieren", "Durchlauferhitzer tauschen"],
    tipp: "Bei einer neuen Heizung lohnt es sich, Förderanträge zu stellen, bevor der Auftrag unterschrieben ist. Viele Programme zahlen nicht mehr, wenn schon begonnen wurde.",
    anbieter: "Sanitär- und Heizungsbetriebe bekommen auf Abgemacht Anfragen direkt aus der Region, ohne Gebühr pro Kontakt." },
  { slug: "maler", wer: "Maler", name: "Maler", plural: "Maler und Lackierer", kat: "Handwerk", meister: true, privat: true, ratgeber: "wohnung-streichen-kosten",
    auftraege: ["Wohnung vor dem Auszug streichen", "Fassade erneuern", "Tapezieren", "Türen und Heizkörper lackieren", "Büroräume renovieren"],
    tipp: "Vergleichen Sie Angebote am besten pro Quadratmeter und fragen Sie nach, ob Abkleben, Abdecken und Material im Preis enthalten sind.",
    anbieter: "Malerbetriebe mit Lücken im Kalender finden auf Abgemacht kurzfristige Aufträge aus der Nachbarschaft." },
  { slug: "fliesenleger", wer: "Fliesenleger", name: "Fliesenleger", plural: "Fliesenleger", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Badezimmer fliesen", "Küchenspiegel verlegen", "Terrasse mit Platten belegen", "Fugen erneuern", "Balkon abdichten und fliesen"],
    tipp: "Seit 2020 ist das Fliesenlegerhandwerk wieder meisterpflichtig. Fragen Sie nach der Eintragung in die Handwerksrolle, wenn Sie einen Betrieb beauftragen.",
    anbieter: "Fliesenleger erreichen über Abgemacht Bauherren, Sanierer und Betriebe, die einen Partner für Bäder suchen." },
  { slug: "schreiner", wer: "Schreiner", name: "Schreiner", plural: "Schreiner und Tischler", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Einbauschrank nach Maß", "Küche anpassen oder montieren", "Innentüren tauschen", "Treppe sanieren", "Ladeneinrichtung bauen"],
    tipp: "Bei Möbeln nach Maß lohnt sich ein Aufmaß vor Ort. Ein seriöser Schreiner nennt Ihnen Holzart, Oberfläche und Lieferzeit schriftlich.",
    anbieter: "Schreinereien zeigen auf Abgemacht ihre Arbeiten und bekommen Anfragen von Privatleuten und Firmen aus der Gegend." },
  { slug: "dachdecker", wer: "Dachdecker", name: "Dachdecker", plural: "Dachdecker", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Undichtes Dach reparieren", "Dachfenster einbauen", "Dach dämmen", "Dachrinne erneuern", "Sturmschaden beheben"],
    tipp: "Nach einem Sturm zuerst Fotos machen und die Versicherung informieren. Dann ein Angebot vom Dachdecker holen und erst danach beauftragen.",
    anbieter: "Dachdecker finden auf Abgemacht Aufträge und Partner für größere Projekte, etwa mit Zimmerern oder Solarteuren." },
  { slug: "gartenhilfe", wer: "Gartenhelfer", name: "Gartenhilfe", plural: "Gartenhelfer und Gartenpfleger", kat: "Sonstiges", privat: true,
    auftraege: ["Rasen mähen", "Hecke schneiden", "Laub entfernen", "Beete anlegen und pflegen", "Grünschnitt abtransportieren"],
    tipp: "Arbeitskosten für Gartenpflege können Sie als haushaltsnahe Dienstleistung anteilig von der Steuer absetzen (§ 35a EStG), wenn Sie per Überweisung bezahlen und eine Rechnung haben.",
    anbieter: "Sie helfen nebenbei im Garten oder haben einen Gartenbaubetrieb? Auf Abgemacht finden Sie Aufträge direkt bei Ihnen um die Ecke." },
  { slug: "reinigung", wer: "Reinigungskraft", name: "Reinigungskraft", plural: "Reinigungskräfte und Reinigungsfirmen", kat: "Sonstiges", privat: true, ratgeber: "treppenhausreinigung-kosten",
    auftraege: ["Büro regelmäßig reinigen", "Fenster putzen", "Grundreinigung nach Umzug", "Treppenhaus reinigen", "Praxisreinigung"],
    tipp: "Wer privat eine Haushaltshilfe beschäftigt, meldet sie am einfachsten als Minijob über das Haushaltsscheckverfahren der Minijob-Zentrale an.",
    anbieter: "Reinigungsfirmen und Selbstständige bekommen auf Abgemacht feste Aufträge von Betrieben und Privatleuten aus der Region." },
  { slug: "umzugshelfer", wer: "Umzugshelfer", name: "Umzugshelfer", plural: "Umzugshelfer und Umzugsfirmen", kat: "Sonstiges", privat: true,
    auftraege: ["Tragehilfe für ein paar Stunden", "Umzug mit Transporter", "Möbel ab- und aufbauen", "Keller entrümpeln", "Büroumzug am Wochenende"],
    tipp: "Klären Sie vorher, wer für Schäden haftet. Umzugsfirmen sind versichert, private Helfer meist nicht.",
    anbieter: "Umzugsfirmen und Helfer finden auf Abgemacht kurzfristige Einsätze in der Nähe." },
  { slug: "hausmeisterservice", wer: "Hausmeister", name: "Hausmeisterservice", plural: "Hausmeisterdienste", kat: "Sonstiges", privat: true, ratgeber: "treppenhausreinigung-kosten",
    auftraege: ["Winterdienst übernehmen", "Treppenhaus und Außenanlagen pflegen", "Kleine Reparaturen", "Mülltonnen raus- und reinstellen", "Objektbetreuung für Vermieter"],
    tipp: "Beim Winterdienst schriftlich festhalten, wer wann räumt und streut. Im Schadensfall zählt, wer die Pflicht übernommen hat.",
    anbieter: "Hausmeisterdienste erreichen auf Abgemacht Vermieter, Hausverwaltungen und Gewerbe aus der Region." },
  { slug: "fotograf", wer: "Fotograf", name: "Fotograf", plural: "Fotografen", kat: "Sonstiges", privat: true,
    auftraege: ["Business-Porträts fürs Team", "Produktfotos für den Shop", "Immobilienfotos", "Hochzeit oder Feier", "Fotos für Social Media"],
    tipp: "Klären Sie vorher, wofür Sie die Bilder nutzen dürfen: nur Website, auch Werbung, auch Druck. Diese Nutzungsrechte stehen im Angebot.",
    anbieter: "Fotografen zeigen auf Abgemacht ihr Portfolio und bekommen Anfragen von Firmen und Privatleuten aus der Gegend." },
  { slug: "webdesigner", wer: "Webdesigner", name: "Webdesigner", plural: "Webdesigner und Webagenturen", kat: "Marketing & Social Media", privat: false,
    auftraege: ["Neue Firmenwebsite", "Onlineshop aufbauen", "Bestehende Seite modernisieren", "Bei Google besser gefunden werden", "Website-Pflege im Monatspaket"],
    tipp: "Lassen Sie die Domain immer auf Ihren eigenen Namen registrieren und holen Sie sich die Zugänge. Impressum und Datenschutzerklärung gehören zur fertigen Website dazu.",
    anbieter: "Webdesigner und Agenturen finden auf Abgemacht Betriebe aus der Region, die gerade eine neue Website brauchen." },
  { slug: "social-media", wer: "Social-Media-Manager", name: "Social-Media-Manager", plural: "Social-Media-Manager und Agenturen", kat: "Marketing & Social Media", privat: false,
    auftraege: ["Instagram und TikTok betreuen", "Reels drehen und schneiden", "Redaktionsplan erstellen", "Werbeanzeigen schalten", "Recruiting-Kampagne"],
    tipp: "Achten Sie darauf, dass die Konten auf Ihre Firma laufen und Sie die Zugänge behalten, auch wenn die Zusammenarbeit endet.",
    anbieter: "Freelancer und Agenturen für Social Media treffen auf Abgemacht Firmen, die sichtbarer werden wollen." },
  { slug: "grafikdesigner", wer: "Grafikdesigner", name: "Grafikdesigner", plural: "Grafikdesigner", kat: "Marketing & Social Media", privat: false,
    auftraege: ["Logo entwickeln", "Flyer und Plakate", "Visitenkarten", "Fahrzeugbeschriftung", "Präsentationen gestalten"],
    tipp: "Lassen Sie sich beim Logo die Nutzungsrechte ausdrücklich übertragen und die Dateien in allen Formaten geben, auch als Vektor.",
    anbieter: "Grafikdesigner finden auf Abgemacht Aufträge von Gründern und Betrieben aus der Region." },
  { slug: "it-service", wer: "IT-Dienstleister", name: "IT-Service", plural: "IT-Dienstleister", kat: "IT & Software", privat: true,
    auftraege: ["PC oder Laptop einrichten", "Netzwerk und WLAN im Büro", "Datensicherung aufsetzen", "Microsoft 365 einrichten", "Telefonanlage umstellen"],
    tipp: "Das Wichtigste zuerst: eine automatische Datensicherung, die regelmäßig geprüft wird. Ohne Backup kostet ein Festplattenschaden oft mehr als jede IT-Betreuung.",
    anbieter: "IT-Dienstleister bekommen auf Abgemacht Anfragen von kleinen Betrieben, die niemanden für die Technik haben." },
  { slug: "buchhaltung", wer: "Buchhalter", name: "Buchhaltung", plural: "Buchhalter und Büroservices", kat: "Finanzen & Steuern", privat: false,
    auftraege: ["Belege monatlich buchen", "Rechnungen schreiben und Mahnwesen", "Ablage digitalisieren", "Lohnabrechnung vorbereiten", "Büroorganisation"],
    tipp: "Laufende Buchungen darf ein Buchhalter übernehmen, Steuererklärungen und Jahresabschlüsse macht der Steuerberater. Gut ist, wenn beide mit derselben Software arbeiten.",
    anbieter: "Selbstständige Buchhalter und Büroservices finden auf Abgemacht Betriebe, denen der Papierkram über den Kopf wächst." },
  { slug: "sicherheitsdienst", wer: "Sicherheitsdienst", name: "Sicherheitsdienst", plural: "Sicherheitsdienste", kat: "Sonstiges", privat: true, ich: "Ich habe einen Sicherheitsdienst", ratgeber: "sicherheitsdienst-kosten",
    auftraege: ["Einlass und Ordnerdienst für Feste und Märkte", "Security für Firmenfeier oder Hochzeit", "Baustelle oder leerstehendes Gebäude bewachen", "Werkschutz und Empfang", "Kontrollfahrten in der Nacht"],
    tipp: "Wer Bewachung gewerbsmäßig anbietet, braucht eine Erlaubnis nach § 34a der Gewerbeordnung, und jede eingesetzte Kraft muss mindestens die Unterrichtung bei der IHK nachweisen. Für manche Aufgaben, etwa den Einlass in Diskotheken oder leitende Aufgaben bei großen Veranstaltungen, ist zusätzlich die Sachkundeprüfung vorgeschrieben. Lassen Sie sich die Nachweise zeigen.",
    anbieter: "Sicherheitsdienste bekommen auf Abgemacht Anfragen von Veranstaltern, Vereinen, Baufirmen und Gewerbe aus der Region." },
  { slug: "entruempelung", wer: "Entrümpelungsdienst", name: "Entrümpelung", plural: "Entrümpelungsfirmen", kat: "Sonstiges", privat: true, ich: "Ich biete Entrümpelungen an", ratgeber: "entruempelung-kosten",
    auftraege: ["Keller oder Dachboden entrümpeln", "Wohnungsauflösung", "Haushaltsauflösung nach einem Todesfall", "Garage oder Lager räumen", "Sperrmüll abholen lassen"],
    tipp: "Fragen Sie, ob Entsorgung und Anfahrt im Festpreis enthalten sind und ob gut erhaltene Möbel angerechnet werden. Seriöse Firmen schauen sich die Räume vorher an oder lassen sich Fotos schicken.",
    anbieter: "Entrümpelungsfirmen finden auf Abgemacht Aufträge von Privatleuten, Erben, Vermietern und Hausverwaltungen aus der Gegend." },
  { slug: "fensterreinigung", wer: "Fensterputzer", name: "Fensterreinigung", plural: "Fensterputzer und Glasreiniger", kat: "Sonstiges", privat: true, ich: "Ich reinige Fenster und Glas",
    auftraege: ["Fenster im Haus oder in der Wohnung putzen", "Schaufenster regelmäßig reinigen", "Wintergarten und Glasdach", "Rahmen und Fensterbänke mitreinigen", "Glasfassade am Bürogebäude"],
    tipp: "Preise werden meist pro Fensterflügel oder pro Quadratmeter Glas berechnet. Fragen Sie, ob Rahmen und Falze dabei sind und wie Arbeiten in der Höhe abgesichert werden.",
    anbieter: "Glasreiniger bekommen auf Abgemacht regelmäßige Aufträge von Läden, Praxen, Büros und Privathaushalten in der Nähe." },
  { slug: "winterdienst", wer: "Winterdienst", name: "Winterdienst", plural: "Winterdienste", kat: "Sonstiges", privat: true, ich: "Ich biete Winterdienst an",
    auftraege: ["Gehweg räumen und streuen", "Parkplatz für das Gewerbe räumen", "Einfahrt und Zugänge frei halten", "Einsatz frühmorgens vor Geschäftsbeginn", "Saisonvertrag von November bis März"],
    tipp: "Ab wann und wie oft geräumt werden muss, regelt die Satzung Ihrer Gemeinde. Schließen Sie den Vertrag vor dem ersten Schnee ab und halten Sie schriftlich fest, wer die Räum- und Streupflicht übernimmt.",
    anbieter: "Winterdienste und Hausmeister finden auf Abgemacht Saisonverträge von Vermietern, Hausverwaltungen und Gewerbe aus der Region." },
];

const ORTE: Ort[] = [
  { slug: "ulm", name: "Ulm", land: "Baden-Württemberg", teile: ["Söflingen", "Wiblingen", "Böfingen", "Eselsberg", "Weststadt"], nachbarn: ["Neu-Ulm", "Blaustein", "Dornstadt", "Erbach"], start: true },
  { slug: "neu-ulm", name: "Neu-Ulm", land: "Bayern", teile: ["Pfuhl", "Offenhausen", "Ludwigsfeld", "Burlafingen", "Reutti"], nachbarn: ["Ulm", "Senden", "Elchingen", "Weißenhorn"], start: true },
  { slug: "augsburg", name: "Augsburg", land: "Bayern", teile: ["Göggingen", "Haunstetten", "Lechhausen", "Oberhausen", "Pfersee"], nachbarn: ["Friedberg", "Gersthofen", "Königsbrunn", "Stadtbergen"], start: false },
  { slug: "memmingen", name: "Memmingen", land: "Bayern", teile: ["Amendingen", "Steinheim", "Eisenburg", "Dickenreishausen"], nachbarn: ["Memmingerberg", "Buxheim", "Ottobeuren", "Bad Grönenbach"], start: false },
  { slug: "kempten", name: "Kempten", land: "Bayern", teile: ["Sankt Mang", "Thingers", "Lenzfried", "Leubas"], nachbarn: ["Durach", "Waltenhofen", "Sulzberg", "Buchenberg"], start: false },
  { slug: "senden", name: "Senden", land: "Bayern", teile: ["Ay", "Wullenstetten", "Witzighausen", "Aufheim", "Freudenegg"], nachbarn: ["Neu-Ulm", "Vöhringen", "Weißenhorn", "Illertissen"], start: true },
  { slug: "guenzburg", name: "Günzburg", land: "Bayern", teile: ["Deffingen", "Denzingen", "Leinheim", "Reisensburg", "Wasserburg"], nachbarn: ["Leipheim", "Ichenhausen", "Burgau", "Offingen"], start: false },
  { slug: "biberach", name: "Biberach", land: "Baden-Württemberg", teile: ["Mettenberg", "Rißegg", "Ringschnait", "Stafflangen"], nachbarn: ["Warthausen", "Ummendorf", "Maselheim", "Mittelbiberach"], start: false },
  { slug: "laupheim", name: "Laupheim", land: "Baden-Württemberg", teile: ["Baustetten", "Bihlafingen", "Obersulmetingen", "Untersulmetingen"], nachbarn: ["Schwendi", "Achstetten", "Burgrieden", "Mietingen"], start: false },
  { slug: "ehingen", name: "Ehingen", land: "Baden-Württemberg", teile: ["Berg", "Kirchen", "Nasgenstadt", "Rißtissen", "Dächingen"], nachbarn: ["Munderkingen", "Allmendingen", "Schelklingen", "Oberdischingen"], start: false },
  { slug: "stuttgart", name: "Stuttgart", land: "Baden-Württemberg", teile: ["Bad Cannstatt", "Vaihingen", "Degerloch", "Feuerbach", "Zuffenhausen"], nachbarn: ["Esslingen", "Ludwigsburg", "Fellbach", "Leinfelden-Echterdingen"], start: false },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const liste = (a: string[]) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " und " + a[a.length - 1];
const basis = () => (Netlify.env.get("PUBLIC_URL") || "https://ab-gemacht.info").replace(/\/$/, "");

const CSS = `
.seo{max-width:820px;margin:0 auto;padding:10px 0 40px}
.seo h1{font-size:clamp(30px,6vw,46px);line-height:1.1;margin:14px 0 14px}
.seo h2{font-size:22px;margin:34px 0 10px}
.seo p,.seo li{color:var(--ink);font-size:17px}
.seo ul{padding-left:20px}
.seo .box{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:22px;margin:26px 0}
.seo .box.gruen{background:var(--gruen-l);border-color:transparent}
.seo .schritte{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:10px}
.seo .schritte div{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px}
.seo .schritte b{display:block;margin-bottom:4px}
.seo .links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.seo .links a{display:inline-block;padding:7px 13px;border-radius:999px;background:#fff;border:1px solid var(--line);text-decoration:none;font-size:14px;color:var(--ink)}
.seo .links a:hover{border-color:var(--gruen)}
.seo details{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:8px 0}
.seo summary{font-weight:700;cursor:pointer}
.seo .krumen{font-size:14px;color:var(--muted)}
.seo .krumen a{color:var(--muted)}
.seo table{border-collapse:collapse;width:100%;font-size:15px;background:#fff;border-radius:14px;overflow:hidden}
.seo td,.seo th{border-bottom:1px solid var(--line);padding:9px 12px;text-align:left}
.seo td+td{white-space:nowrap}
`;

function rahmen(o: { titel: string; beschreibung: string; pfad: string; inhalt: string; jsonld?: unknown[]; noindex?: boolean; typ?: string }) {
  const url = basis() + o.pfad;
  const ld = (o.jsonld || []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.titel)}</title>
<meta name="description" content="${esc(o.beschreibung)}">
${o.noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(o.titel)}">
<meta property="og:description" content="${esc(o.beschreibung)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="${o.typ || "website"}">
<meta property="og:locale" content="de_DE">
<meta property="og:site_name" content="Abgemacht">
<meta property="og:image" content="${basis()}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
<style>${CSS}</style>
${ld}
</head>
<body>
<div class="wrap">
  <header>
    <a class="logo" href="/"><span class="mark"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.8" fill="none" stroke="#F2B33D" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Abgemacht</a>
    <a class="btn" href="/?quelle=seo#anfrage">Anfrage stellen</a>
  </header>
  <main class="seo">${o.inhalt}</main>
  <footer>
    <span>© 2026 Abgemacht · <a href="/finden">Branchen und Orte</a> · <a href="/ratgeber">Ratgeber</a></span>
    <span><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a> · <a href="/bedingungen">Bedingungen</a></span>
  </footer>
</div>
</body>
</html>`;
}

function anmeldeLink(b?: Branche, o?: Ort) {
  const p = new URLSearchParams({ quelle: "seo" });
  if (b) p.set("leistung", b.name);
  if (o) p.set("ort", o.name);
  return `/?${p.toString()}#anfrage`;
}
const partnerLink = () => "/betriebe?quelle=seo#partner";

function seiteFuer(b: Branche, o: Ort) {
  const titel = `${b.name} in ${o.name} finden | Abgemacht`;
  const beschreibung = `${b.plural} in ${o.name} und Umgebung finden oder als ${b.name} Aufträge aus ${o.name} bekommen. Einmal Anfrage schicken, passende Angebote bekommen. Für Auftraggeber kostenlos.`;
  const status = o.start
    ? `Abgemacht vermittelt in ${o.name} und Umgebung. Schicken Sie uns Ihre Anfrage, wir melden uns innerhalb eines Werktags und fragen passende Betriebe an.`
    : `Unser Netz an Partnerbetrieben in ${o.name} wächst gerade. Schicken Sie uns Ihre Anfrage trotzdem, wir suchen passende Betriebe für Sie.`;
  const rg = RATGEBER.find((x) => x.slug === b.ratgeber);
  const andereOrte = ORTE.filter((x) => x.slug !== o.slug).map((x) => `<a href="/finden/${b.slug}-${x.slug}">${esc(b.name)} in ${esc(x.name)}</a>`).join("");
  const andereBranchen = BRANCHEN.filter((x) => x.slug !== b.slug).map((x) => `<a href="/finden/${x.slug}-${o.slug}">${esc(x.name)} in ${esc(o.name)}</a>`).join("");
  const faq: [string, string][] = [
    [`Wie finde ich ${b.wer === "Reinigungskraft" ? "eine" : "einen"} ${b.wer} in ${o.name}?`, `Schicken Sie uns über das Anfrage-Formular kurz, was zu tun ist, zum Beispiel „${b.auftraege[0]}“. Wir fragen passende ${b.plural} aus ${o.name}, ${liste(o.nachbarn.slice(0, 2))} an und schicken Ihnen die Angebote.`],
    ["Was kostet Abgemacht?", "Für Auftraggeber nichts. Betriebe zahlen in der Startphase ebenfalls nichts, später nur eine kleine Freischaltgebühr für die Kontaktdaten, wenn ein Auftraggeber ihr Angebot angenommen hat."],
    ["Mit wem schließe ich den Vertrag?", `Direkt mit ${b.wer === "Reinigungskraft" ? "der Reinigungskraft" : "dem " + b.wer}. Abgemacht stellt nur den Kontakt her, Preis und Termin vereinbaren Sie direkt miteinander.`],
    [`${b.ich || "Ich bin " + b.wer}. Wie bekomme ich Aufträge aus ${o.name}?`, `${b.anbieter} Tragen Sie sich als Partner-Betrieb ein, wir rufen kurz an und schicken Ihnen danach passende Anfragen aus Ihrem Gebiet.`],
  ];
  if (b.meister) faq.push([`Muss ein ${b.name} einen Meisterbrief haben?`, `${b.name}-Betriebe gehören zu den zulassungspflichtigen Handwerken. Wer den Betrieb führt, muss in die Handwerksrolle eingetragen sein, meist mit Meisterbrief oder einer gleichwertigen Qualifikation. Wir fragen bei der Aufnahme als Partner-Betrieb danach.`]);

  const inhalt = `
<p class="krumen"><a href="/">Abgemacht</a> › <a href="/finden">Branchen und Orte</a> › ${esc(b.name)} in ${esc(o.name)}</p>
<span class="pill">${o.start ? "Aktiv in " + esc(o.name) : "Im Aufbau: " + esc(o.name)}</span>
<h1>${esc(b.name)} in ${esc(o.name)} finden</h1>
<p class="lead">Ob privat oder für die Firma: Sie schicken uns einmal Ihre Anfrage, wir fragen passende ${esc(b.plural)} aus ${esc(o.name)} und Umgebung an und schicken Ihnen die Angebote. Kein Rumtelefonieren, kein Warten auf Rückrufe.</p>
<p><a class="btn" href="${anmeldeLink(b, o)}">Kostenlos anfragen</a></p>

<h2>Typische Aufträge für ${esc(b.plural)} in ${esc(o.name)}</h2>
<ul>${b.auftraege.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
<p>Gesucht wird in ganz ${esc(o.name)}, von ${esc(liste(o.teile.slice(0, 3)))} bis ${esc(o.teile[o.teile.length - 1])}, und in den Nachbarorten ${esc(liste(o.nachbarn))}.</p>

<div class="box"><b>Gut zu wissen</b><p style="margin:6px 0 0">${esc(b.tipp)}</p></div>
${rg ? `<p>Mit welchen Preisen Sie rechnen können, steht in unserem Ratgeber: <a href="/ratgeber/${rg.slug}">${esc(rg.h1)}</a></p>` : ""}

<h2>So funktioniert Abgemacht</h2>
<div class="schritte">
  <div><b>1. Anfrage schicken</b>Kurz beschreiben, was zu tun ist und bis wann. Dauert eine Minute.</div>
  <div><b>2. Wir fragen Betriebe an</b>Passende ${esc(b.plural)} aus der Nähe bekommen Ihre Anfrage, zunächst ohne Ihren Namen und Ihre Kontaktdaten.</div>
  <div><b>3. Abgemacht</b>Sie vergleichen die Angebote und entscheiden. Den Vertrag schließen Sie direkt mit dem Betrieb.</div>
</div>

<h2>Für ${esc(b.plural)} aus ${esc(o.name)}</h2>
<p>${esc(b.anbieter)} Als Partner-Betrieb bekommen Sie passende Anfragen mit Ort, Zeitraum und Budget und entscheiden selbst, ob Sie ein Angebot machen. <a href="${partnerLink()}">Partner-Betrieb werden</a></p>

<div class="box gruen">
  <b>${esc(b.name)} in ${esc(o.name)} gesucht?</b>
  <p style="margin:6px 0 14px">${esc(status)}</p>
  <a class="btn" href="${anmeldeLink(b, o)}">Anfrage stellen</a>
</div>

<h2>Häufige Fragen</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}

<h2>${esc(b.name)} in anderen Städten</h2>
<div class="links">${andereOrte}</div>
<h2>Weitere Branchen in ${esc(o.name)}</h2>
<div class="links">${andereBranchen}</div>`;

  const jsonld = [
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Abgemacht", item: basis() + "/" },
      { "@type": "ListItem", position: 2, name: "Branchen und Orte", item: basis() + "/finden" },
      { "@type": "ListItem", position: 3, name: `${b.name} in ${o.name}`, item: `${basis()}/finden/${b.slug}-${o.slug}` },
    ] },
  ];
  return rahmen({ titel, beschreibung, pfad: `/finden/${b.slug}-${o.slug}`, inhalt, jsonld });
}

// Ratgeber: Preisseiten mit recherchierten Richtwerten (Stand Oktober 2026). Quellen stehen auf jeder Seite.
type Tabelle = { titel?: string; kopf: string[]; zeilen: string[][]; fuss?: string };
type Ratgeber = {
  slug: string; titel: string; h1: string; beschreibung: string; leistung: string; branche: string;
  kurz: string; intro: string; tabellen: Tabelle[]; beispiel?: string; faktoren: string[]; tipps: string[];
  faq: [string, string][]; quellen: [string, string][];
};
const STAND = "Oktober 2026";
const RATGEBER: Ratgeber[] = [
  { slug: "treppenhausreinigung-kosten", leistung: "Treppenhausreinigung", branche: "reinigung",
    titel: "Treppenhausreinigung Kosten 2026: pro Monat, Etage und Partei | Abgemacht",
    h1: "Was kostet eine Treppenhausreinigung?",
    kurz: "Preise pro Etage, Stunde und Mietpartei",
    beschreibung: "Eine Treppenhausreinigung kostet meist 30 bis 50 € pro Reinigung, im Mehrfamilienhaus 115 bis 200 € im Monat. Richtwerte pro Etage, Stunde und Partei plus Tipps für Vermieter.",
    intro: "Für ein Mehrfamilienhaus mit vier bis sechs Parteien zahlen Sie bei wöchentlicher Reinigung meist 115 bis 200 Euro im Monat, also etwa 19 bis 33 Euro pro Wohnung. Ein einzelner Reinigungsgang kostet in der Regel 30 bis 50 Euro.",
    tabellen: [{ kopf: ["Abrechnung", "Richtwert"], zeilen: [
      ["Pro Reinigungsgang (4 bis 6 Parteien)", "30 bis 50 €"],
      ["Pro Etage und Reinigung", "10 bis 30 €"],
      ["Pro Mietpartei und Reinigung", "5 bis 25 €"],
      ["Stundensatz regionaler Betrieb", "25 bis 38 €"],
      ["Stundensatz große Gebäudereinigung", "35 bis 55 €"],
      ["Fenster im Treppenhaus, pro Einsatz", "30 bis 100 €"],
      ["Pro Monat bei wöchentlicher Reinigung", "115 bis 200 €"],
    ], fuss: "Richtwerte ohne Mehrwertsteuer." }],
    beispiel: "Haus mit drei Etagen und sechs Parteien, wöchentliche Reinigung von Stufen, Podesten, Geländer und Eingang. Ein Durchgang kostet etwa 35 bis 45 Euro. Bei gut vier Reinigungen im Monat sind das rund 150 bis 195 Euro, pro Partei also 25 bis 33 Euro.",
    faktoren: [
      "Wie oft gereinigt wird: Wöchentlich ist üblich. Alle zwei Wochen kostet fast nur die Hälfte, reicht bei viel Betrieb im Haus aber oft nicht.",
      "Größe und Höhe des Hauses: Ab der fünften Etage verlangen viele Betriebe 5 bis 10 Euro Zuschlag je weiterer Etage, vor allem ohne Aufzug.",
      "Was dazugehört: Üblich sind Stufen, Podeste, Handläufe und Eingang. Kellerflure, Aufzug, Waschküche und Fenster kosten meist extra.",
      "Region: In Stuttgart, München und Hamburg liegen die Preise etwa 10 bis 20 Prozent über dem Durchschnitt.",
    ],
    tipps: [
      "Legen Sie schriftlich fest, was wie oft gereinigt wird. So lassen sich Angebote vergleichen und später kontrollieren.",
      "Prüfen Sie sehr günstige Angebote genau. Der Mindestlohn in der Gebäudereinigung liegt 2026 bei 15 Euro brutto pro Stunde, darunter sind seriöse Stundensätze kaum möglich.",
      "Vermieter dürfen die Kosten als Betriebskosten auf die Mieter umlegen (§ 2 Nr. 9 Betriebskostenverordnung), wenn das im Mietvertrag vereinbart ist.",
    ],
    faq: [
      ["Was kostet eine Treppenhausreinigung pro Monat?", "Bei wöchentlicher Reinigung in einem Haus mit vier bis sechs Parteien meist 115 bis 200 Euro im Monat, je Wohnung etwa 19 bis 33 Euro."],
      ["Darf der Vermieter die Treppenhausreinigung auf die Mieter umlegen?", "Ja, wenn die Umlage der Betriebskosten im Mietvertrag vereinbart ist. Die Gebäudereinigung zählt zu den umlagefähigen Betriebskosten."],
      ["Kann ich die Kosten von der Steuer absetzen?", "Als haushaltsnahe Dienstleistung können Sie 20 Prozent der Arbeitskosten von der Steuer abziehen, höchstens 4.000 Euro im Jahr. Das gilt auch für Mieter, wenn der Anteil in der Nebenkostenabrechnung ausgewiesen ist."],
      ["Wie finde ich eine Reinigungsfirma für das Treppenhaus?", "Schicken Sie uns über Abgemacht eine kurze Anfrage mit Ort, Anzahl der Etagen und gewünschtem Rhythmus. Wir fragen passende Reinigungsfirmen aus der Region an und schicken Ihnen die Angebote."],
    ],
    quellen: [["meister-job.de: Was kostet eine professionelle Treppenhausreinigung?", "https://meister-job.de/was-kosten-treppenhaus-reinigen/"]] },

  { slug: "sicherheitsdienst-kosten", leistung: "Sicherheitsdienst", branche: "sicherheitsdienst",
    titel: "Sicherheitsdienst Kosten 2026: Preise pro Stunde und Veranstaltung | Abgemacht",
    h1: "Was kostet ein Sicherheitsdienst?",
    kurz: "Stundensätze für Veranstaltung, Objektschutz und Doorman",
    beschreibung: "Ein Sicherheitsdienst kostet meist 30 bis 50 € pro Stunde und Kraft. Richtwerte für Veranstaltungen, Objektschutz und Werkschutz plus Zuschläge für Nacht und Wochenende.",
    intro: "Eine Sicherheitskraft kostet meist 30 bis 50 Euro pro Stunde. Für einen Abend bei einer Veranstaltung mit sechs bis acht Stunden rechnen Sie je Kraft mit 150 bis 800 Euro, je nach Größe des Events, Uhrzeit und Qualifikation.",
    tabellen: [
      { titel: "Pro Stunde und Kraft", kopf: ["Einsatz", "Richtwert"], zeilen: [
        ["Einfacher Objektschutz", "30 bis 35 €"],
        ["Werkschutz mit Qualifikation", "30 bis 50 €"],
        ["Brandwache bei Veranstaltungen", "30 bis 60 €"],
        ["Hochsicherheitsbereiche", "45 bis 80 €"],
      ] },
      { titel: "Veranstaltungen: pro Kraft und Abend (6 bis 8 Stunden)", kopf: ["Veranstaltung", "Richtwert"], zeilen: [
        ["Private Feier bis 100 Gäste", "150 bis 400 €"],
        ["Firmenevent mit 100 bis 500 Gästen", "200 bis 600 €"],
        ["Großveranstaltung ab 1.000 Gästen", "300 bis 800 €"],
      ] },
      { titel: "Übliche Zuschläge", kopf: ["Wann", "Aufschlag"], zeilen: [
        ["Nachts (20 bis 6 Uhr)", "15 bis 25 %"],
        ["Wochenende und Feiertage", "25 bis 50 %"],
        ["Buchung weniger als 48 Stunden vorher", "25 bis 100 %"],
      ], fuss: "Richtwerte ohne Mehrwertsteuer, zzgl. Anfahrt." },
    ],
    beispiel: "Firmenfeier mit 200 Gästen, drei bis vier Sicherheitskräfte für acht Stunden: insgesamt etwa 1.200 bis 2.400 Euro. Findet sie an einem Samstagabend statt, kommen die Zuschläge für Wochenende und Nacht dazu.",
    faktoren: [
      "Anzahl der Kräfte: Sie hängt von Besucherzahl, Gelände, Ausschank und den Auflagen der Gemeinde ab.",
      "Uhrzeit und Tag: Nacht, Wochenende und Feiertage sind deutlich teurer als ein Einsatz unter der Woche.",
      "Qualifikation: Kräfte mit Sachkundeprüfung, Erste-Hilfe- oder Brandschutzausbildung kosten mehr.",
      "Vorlauf: Wer kurzfristig bucht, zahlt oft einen hohen Aufschlag. In der Advents- und Festsaison sind gute Firmen früh ausgebucht.",
      "Region: In Ballungsräumen wie München oder Frankfurt liegen die Preise höher, auf dem Land eher darunter.",
    ],
    tipps: [
      "Lassen Sie sich die Erlaubnis nach § 34a Gewerbeordnung und die Nachweise der eingesetzten Kräfte zeigen. Jede Kraft muss mindestens die Unterrichtung bei der IHK haben.",
      "Fragen Sie bei der Gemeinde nach, ob für Ihre Veranstaltung eine Mindestzahl an Ordnern oder Sicherheitskräften vorgeschrieben ist.",
      "Klären Sie im Angebot, ob Einsatzleitung, Funkgeräte, Dienstkleidung und Anfahrt enthalten sind.",
    ],
    faq: [
      ["Was kostet ein Sicherheitsdienst pro Stunde?", "Meist 30 bis 50 Euro pro Kraft und Stunde. Nachts, am Wochenende oder bei kurzfristiger Buchung kommen Zuschläge dazu."],
      ["Was kostet Security für eine Feier?", "Für eine private Feier bis 100 Gäste rechnen Sie je Kraft mit 150 bis 400 Euro pro Abend, für Firmenevents mit 200 bis 600 Euro."],
      ["Was muss ein Sicherheitsdienst nachweisen?", "Das Unternehmen braucht eine Erlaubnis nach § 34a Gewerbeordnung, die Kräfte mindestens die Unterrichtung bei der IHK. Für bestimmte Aufgaben wie den Einlass in Diskotheken ist die Sachkundeprüfung Pflicht."],
      ["Wie finde ich einen Sicherheitsdienst für meine Veranstaltung?", "Schicken Sie uns über Abgemacht Datum, Ort, Uhrzeit und ungefähre Besucherzahl. Wir fragen passende Sicherheitsdienste aus der Region an und schicken Ihnen die Angebote."],
    ],
    quellen: [["trustlocal.de: Sicherheitsdienst Kosten in Deutschland 2026", "https://trustlocal.de/kosten/sicherheitsdienst-kosten/"]] },

  { slug: "wohnung-streichen-kosten", leistung: "Wohnung streichen", branche: "maler",
    titel: "Wohnung streichen lassen: Kosten 2026 pro m² und Wohnungsgröße | Abgemacht",
    h1: "Was kostet es, eine Wohnung streichen zu lassen?",
    kurz: "Preise pro m² und nach Wohnungsgröße",
    beschreibung: "Maler kosten meist 7 bis 15 € pro m² Wandfläche. Eine 80-m²-Wohnung mit Decken streichen lassen kostet etwa 2.200 bis 3.600 €. Richtwerte, Beispiel und Spartipps.",
    intro: "Für einen weißen Anstrich in zwei Schichten zahlen Sie meist 7 bis 15 Euro pro Quadratmeter Wandfläche. Die Wandfläche ist etwa zweieinhalb- bis dreimal so groß wie die Wohnfläche. Eine 80-m²-Wohnung kostet mit Wänden und Decken etwa 2.200 bis 3.600 Euro.",
    tabellen: [
      { titel: "Nach Wohnungsgröße (weiß, zwei Anstriche)", kopf: ["Wohnfläche", "Nur Wände", "Wände und Decken"], zeilen: [
        ["40 m²", "700 bis 1.200 €", "1.100 bis 1.900 €"],
        ["60 m²", "1.000 bis 1.800 €", "1.600 bis 2.800 €"],
        ["80 m²", "1.400 bis 2.400 €", "2.200 bis 3.600 €"],
        ["100 m²", "1.700 bis 3.000 €", "2.700 bis 4.500 €"],
        ["120 m²", "2.000 bis 3.600 €", "3.200 bis 5.200 €"],
      ], fuss: "Richtwerte inklusive Mehrwertsteuer, ohne Vorarbeiten." },
      { titel: "Einzelpreise", kopf: ["Leistung", "Richtwert"], zeilen: [
        ["Wände weiß, pro m²", "7 bis 15 €"],
        ["Decke, pro m²", "9 bis 18 €"],
        ["Farbiger Anstrich, pro m²", "11 bis 20 €"],
        ["Alte Tapete entfernen, pro m²", "5 bis 15 €"],
        ["Spachteln und Grundieren, pro m²", "8 bis 20 €"],
        ["Tür mit Zarge lackieren, pro Stück", "130 bis 250 €"],
        ["Heizkörper lackieren, pro Stück", "60 bis 120 €"],
      ] },
    ],
    beispiel: "80-m²-Wohnung, Wände und Decken weiß, dazu fünf Türen und sieben Fensterrahmen: rund 200 m² Wand zu 10 Euro, 80 m² Decke zu 14 Euro, Türen und Rahmen gut 1.000 Euro, dazu Abdecken und Anfahrt. Zusammen etwa 4.300 Euro.",
    faktoren: [
      "Bewohnt oder leer: In einer bewohnten Wohnung kostet es durch Abdecken und Möbelrücken 15 bis 25 Prozent mehr, eine leere Wohnung ist entsprechend günstiger.",
      "Zustand der Wände: Risse, alte Tapeten oder Nikotin brauchen Vorarbeiten, die extra berechnet werden.",
      "Farbe: Dunkle oder kräftige Farben brauchen oft einen dritten Anstrich. Abwaschbare Latexfarbe für Küche und Bad ist teurer.",
      "Region: In Stuttgart, München und Frankfurt liegen die Preise etwa 20 bis 30 Prozent über dem Durchschnitt.",
    ],
    tipps: [
      "Vergleichen Sie Angebote pro Quadratmeter und fragen Sie, ob Abkleben, Abdecken und Material im Preis enthalten sind.",
      "20 Prozent der Arbeitskosten können Sie als Handwerkerleistung von der Steuer absetzen, höchstens 1.200 Euro im Jahr. Dafür brauchen Sie eine Rechnung und müssen überweisen.",
      "Ob Sie beim Auszug streichen müssen, hängt von der Klausel im Mietvertrag ab. Viele ältere Klauseln sind unwirksam, im Zweifel hilft der Mieterverein.",
    ],
    faq: [
      ["Was kostet ein Maler pro Quadratmeter?", "Für Wände in Weiß meist 7 bis 15 Euro pro Quadratmeter Wandfläche, für Decken 9 bis 18 Euro."],
      ["Was kostet es, eine 3-Zimmer-Wohnung streichen zu lassen?", "Bei rund 80 m² Wohnfläche etwa 1.400 bis 2.400 Euro für die Wände und 2.200 bis 3.600 Euro mit Decken. Türen und Heizkörper kommen extra dazu."],
      ["Wie berechne ich die Wandfläche?", "Als Faustregel nehmen Sie die Wohnfläche mal 2,5 bis 3. Eine 80-m²-Wohnung hat also etwa 200 bis 240 m² Wandfläche."],
      ["Wie finde ich einen Maler in meiner Nähe?", "Schicken Sie uns über Abgemacht Wohnfläche, Räume und Wunschtermin. Wir fragen Malerbetriebe aus der Region an und schicken Ihnen die Angebote."],
    ],
    quellen: [["clean-invoice.com: Wohnung streichen lassen, Kosten 2026", "https://www.clean-invoice.com/wissen/allgemein/wohnung-streichen-kosten"]] },

  { slug: "entruempelung-kosten", leistung: "Entrümpelung", branche: "entruempelung",
    titel: "Entrümpelung Kosten 2026: Preise pro m² und Wohnung | Abgemacht",
    h1: "Was kostet eine Entrümpelung?",
    kurz: "Preise pro m², Container und Beispielrechnung",
    beschreibung: "Eine Wohnungsentrümpelung kostet meist 20 bis 50 € pro m², im Schnitt rund 1.600 €. Richtwerte, Beispielrechnung, Containerpreise und Steuertipp.",
    intro: "Für eine normal möblierte Wohnung zahlen Sie im Komplettservice meist 20 bis 50 Euro pro Quadratmeter. Im Schnitt kostet eine Entrümpelung etwa 1.600 Euro, die meisten liegen zwischen 600 und 2.900 Euro.",
    tabellen: [{ kopf: ["Leistung", "Richtwert"], zeilen: [
      ["Komplettservice, normal möbliert, pro m²", "20 bis 50 €"],
      ["Stark vermüllte Wohnung, pro m²", "38 bis 55 €"],
      ["Stundensatz Fachbetrieb", "25 bis 65 €"],
      ["Container 5 m³ (bei Eigenleistung)", "300 bis 750 €"],
      ["Container 10 m³", "bis etwa 1.050 €"],
      ["Durchschnitt pro Entrümpelung", "etwa 1.600 €"],
    ] }],
    beispiel: "3-Zimmer-Wohnung mit 80 m² im dritten Stock ohne Aufzug: Arbeit und Transport 2.000 Euro, Zuschlag für die Etage 150 Euro, Halteverbotszone 100 Euro. Gut erhaltene Möbel werden mit 250 Euro angerechnet. Am Ende stehen 2.000 Euro.",
    faktoren: [
      "Menge und Art: Wie viel raus muss und ob Sondermüll wie Farben oder Elektrogeräte dabei ist.",
      "Zugang: Etage, Aufzug, Laufwege und ob eine Halteverbotszone nötig ist.",
      "Wertanrechnung: Verwertbare Möbel oder Antiquitäten können den Preis senken.",
      "Besenrein oder mehr: Ob danach auch gereinigt, Tapeten entfernt oder Böden herausgenommen werden.",
    ],
    tipps: [
      "Holen Sie einen Festpreis nach Besichtigung oder anhand von Fotos. So gibt es am Ende keine Überraschung.",
      "Sichern Sie vorher Unterlagen, Fotos und Wertsachen, vor allem bei einer Haushaltsauflösung.",
      "20 Prozent der Arbeits- und Fahrtkosten können Sie als haushaltsnahe Dienstleistung absetzen, höchstens 4.000 Euro im Jahr.",
    ],
    faq: [
      ["Was kostet es, eine Wohnung entrümpeln zu lassen?", "Meist 20 bis 50 Euro pro Quadratmeter. Eine 80-m²-Wohnung kostet oft um die 1.600 Euro, bei schwierigem Zugang oder viel Inhalt auch über 3.000 Euro."],
      ["Ist Entrümpeln selbst günstiger?", "Ein Container für Sperrmüll kostet etwa 400 bis 700 Euro. Dazu kommen Ihre Zeit, Helfer und gegebenenfalls ein Transporter."],
      ["Kann ich die Entrümpelung von der Steuer absetzen?", "Ja, 20 Prozent der Arbeits- und Fahrtkosten als haushaltsnahe Dienstleistung, höchstens 4.000 Euro im Jahr. Sie brauchen eine Rechnung und müssen überweisen."],
      ["Wie finde ich eine Entrümpelungsfirma?", "Schicken Sie uns über Abgemacht Ort, Größe und am besten ein paar Fotos. Wir fragen Entrümpelungsfirmen aus der Region an und schicken Ihnen die Angebote."],
    ],
    quellen: [["meister-job.de: Kosten für die Wohnungsentrümpelung", "https://meister-job.de/was-kostet-wohnung-entruempeln/"]] },
];

function ratgeberLink(r: Ratgeber) { return `/?${new URLSearchParams({ quelle: "ratgeber", leistung: r.leistung }).toString()}#anfrage`; }

function ratgeberSeite(r: Ratgeber) {
  const tab = (t: Tabelle) => `${t.titel ? `<h3 style="margin:22px 0 8px">${esc(t.titel)}</h3>` : ""}<table><thead><tr>${t.kopf.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${t.zeilen.map((z) => `<tr>${z.map((w) => `<td>${esc(w)}</td>`).join("")}</tr>`).join("")}</tbody></table>${t.fuss ? `<p class="krumen" style="margin-top:6px">${esc(t.fuss)}</p>` : ""}`;
  const b = BRANCHEN.find((x) => x.slug === r.branche);
  const orte = b ? ORTE.map((o) => `<a href="/finden/${b.slug}-${o.slug}">${esc(b.name)} in ${esc(o.name)}</a>`).join("") : "";
  const andere = RATGEBER.filter((x) => x.slug !== r.slug).map((x) => `<a href="/ratgeber/${x.slug}">${esc(x.h1)}</a>`).join("");
  const inhalt = `
<p class="krumen"><a href="/">Abgemacht</a> › <a href="/ratgeber">Ratgeber</a> › ${esc(r.leistung)}</p>
<span class="pill">Richtwerte, Stand ${STAND}</span>
<h1>${esc(r.h1)}</h1>
<p class="lead">${esc(r.intro)}</p>
<p><a class="btn" href="${ratgeberLink(r)}">Angebote kostenlos vergleichen</a></p>
<h2>Preise im Überblick</h2>
${r.tabellen.map(tab).join("")}
${r.beispiel ? `<div class="box"><b>Rechenbeispiel</b><p style="margin:6px 0 0">${esc(r.beispiel)}</p></div>` : ""}
<h2>Was den Preis beeinflusst</h2>
<ul>${r.faktoren.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>Tipps vor der Beauftragung</h2>
<ul>${r.tipps.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<div class="box gruen">
  <b>Echte Preise statt Richtwerte</b>
  <p style="margin:6px 0 14px">Beschreiben Sie einmal, was zu tun ist. Wir fragen passende Betriebe aus Ihrer Region an und Sie vergleichen die Angebote. Für Auftraggeber kostenlos.</p>
  <a class="btn" href="${ratgeberLink(r)}">Anfrage stellen</a>
</div>
<h2>Häufige Fragen</h2>
${r.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
${orte ? `<h2>${esc(b!.plural)} in Ihrer Nähe</h2><div class="links">${orte}</div>` : ""}
<h2>Weitere Ratgeber</h2>
<div class="links">${andere}</div>
<p class="krumen" style="margin-top:30px">Die Preise sind Richtwerte aus Branchenübersichten und ersetzen kein Angebot. Quellen: ${r.quellen.map(([n, u]) => `<a href="${esc(u)}" rel="nofollow noopener" target="_blank">${esc(n)}</a>`).join(", ")}.</p>`;
  const url = `${basis()}/ratgeber/${r.slug}`;
  const jsonld = [
    { "@context": "https://schema.org", "@type": "Article", headline: r.h1, description: r.beschreibung, inLanguage: "de-DE", dateModified: "2026-10-25", mainEntityOfPage: url, image: basis() + "/og.jpg",
      author: { "@type": "Organization", name: "Abgemacht", url: basis() + "/" }, publisher: { "@type": "Organization", name: "Abgemacht", url: basis() + "/" } },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: r.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Abgemacht", item: basis() + "/" },
      { "@type": "ListItem", position: 2, name: "Ratgeber", item: basis() + "/ratgeber" },
      { "@type": "ListItem", position: 3, name: r.h1, item: url },
    ] },
  ];
  return rahmen({ titel: r.titel, beschreibung: r.beschreibung, pfad: `/ratgeber/${r.slug}`, inhalt, jsonld, typ: "article" });
}

function ratgeberUebersicht() {
  const inhalt = `
<p class="krumen"><a href="/">Abgemacht</a> › Ratgeber</p>
<h1>Was kostet das? Preise und Tipps</h1>
<p class="lead">Richtwerte für häufige Aufträge, damit Sie Angebote einschätzen können. Für echte Preise aus Ihrer Region schicken Sie uns einfach eine Anfrage.</p>
${RATGEBER.map((r) => `<div class="box"><b style="font-size:19px"><a href="/ratgeber/${r.slug}" style="color:var(--ink)">${esc(r.h1)}</a></b><p style="margin:6px 0 0">${esc(r.kurz)}. ${esc(r.intro.split(". ")[0])}.</p></div>`).join("")}
<div class="box gruen"><b>Ihr Auftrag ist nicht dabei?</b><p style="margin:6px 0 14px">Schicken Sie uns Ihre Anfrage, wir holen passende Angebote ein.</p><a class="btn" href="${anmeldeLink()}">Anfrage stellen</a></div>`;
  return rahmen({ titel: "Ratgeber: Was kostet das? Preise 2026 | Abgemacht", beschreibung: "Richtwerte und Tipps für Treppenhausreinigung, Sicherheitsdienst, Malerarbeiten und Entrümpelung. Angebote aus Ihrer Region kostenlos vergleichen.", pfad: "/ratgeber", inhalt });
}

function uebersicht() {
  const zeilen = ORTE.map((o) => `<h2>${esc(o.name)}${o.start ? "" : ' <span style="font-size:14px;color:var(--muted);font-weight:600">· im Aufbau</span>'}</h2><div class="links">${BRANCHEN.map((b) => `<a href="/finden/${b.slug}-${o.slug}">${esc(b.name)}</a>`).join("")}</div>`).join("");
  const inhalt = `
<p class="krumen"><a href="/">Abgemacht</a> › Branchen und Orte</p>
<h1>Aufträge und Betriebe aus Ihrer Region</h1>
<p class="lead">Abgemacht verbindet Firmen, Selbstständige, Freelancer und Privatleute. Wählen Sie Ihre Stadt und die Branche, die Sie suchen oder anbieten.</p>
${zeilen}
<h2>Was kostet das?</h2><div class="links">${RATGEBER.map((r) => `<a href="/ratgeber/${r.slug}">${esc(r.h1)}</a>`).join("")}</div>
<div class="box gruen"><b>Ihre Branche fehlt?</b><p style="margin:6px 0 14px">Schicken Sie uns einfach Ihre Anfrage, wir schauen, wer passt. Sie bieten selbst etwas an? Dann werden Sie Partner-Betrieb.</p><a class="btn" href="${anmeldeLink()}">Anfrage stellen</a> <a class="btn ghost" href="${partnerLink()}">Partner-Betrieb werden</a></div>`;
  return rahmen({ titel: "Branchen und Orte | Abgemacht", beschreibung: "Betriebe, Dienstleister und Freelancer aller Branchen finden, vom Handwerk über IT bis Marketing. Oder selbst Aufträge aus Ihrer Region bekommen.", pfad: "/finden", inhalt });
}

function sitemap() {
  const heute = new Date().toISOString().slice(0, 10);
  const urls = ["/", "/betriebe", "/hausverwaltungen", "/finden", "/ratgeber", ...RATGEBER.map((r) => `/ratgeber/${r.slug}`), ...ORTE.flatMap((o) => BRANCHEN.map((b) => `/finden/${b.slug}-${o.slug}`))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${basis()}${u}</loc><lastmod>${heute}</lastmod></url>`).join("\n")}
</urlset>`;
}

const html = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=86400" } });

export default async (req: Request) => {
  const pfad = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  if (pfad === "/sitemap.xml") return new Response(sitemap(), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=86400" } });
  if (pfad === "/finden") return html(uebersicht());
  if (pfad === "/ratgeber") return html(ratgeberUebersicht());
  if (pfad.startsWith("/ratgeber/")) {
    const r = RATGEBER.find((x) => x.slug === pfad.slice(10).toLowerCase());
    return r ? html(ratgeberSeite(r)) : new Response(null, { status: 302, headers: { location: "/ratgeber" } });
  }
  const slug = pfad.replace(/^\/finden\//, "").toLowerCase();
  for (const o of ORTE) {
    if (!slug.endsWith("-" + o.slug)) continue;
    const b = BRANCHEN.find((x) => x.slug === slug.slice(0, -(o.slug.length + 1)));
    if (b) return html(seiteFuer(b, o));
  }
  return new Response(null, { status: 302, headers: { location: "/finden" } });
};

export const config: Config = { path: ["/finden", "/finden/*", "/ratgeber", "/ratgeber/*", "/sitemap.xml"] };
