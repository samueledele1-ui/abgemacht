import type { Config } from "@netlify/functions";

// Seiten für Google: /finden (Übersicht), /finden/<branche>-<ort> und /sitemap.xml.
// Jede Seite ist echte Information zu Branche und Ort plus Weg auf die Warteliste.

type Branche = {
  slug: string; wer: string; name: string; plural: string; kat: string; meister?: boolean; privat: boolean;
  auftraege: string[]; tipp: string; anbieter: string;
};
type Ort = { slug: string; name: string; land: string; teile: string[]; nachbarn: string[]; start: boolean };

const BRANCHEN: Branche[] = [
  { slug: "elektriker", wer: "Elektriker", name: "Elektriker", plural: "Elektriker", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Steckdosen und Leitungen erweitern", "Sicherungskasten erneuern", "Wallbox für das E-Auto installieren", "Smart Home einrichten", "E-Check für Büro und Werkstatt"],
    tipp: "Arbeiten am Stromnetz dürfen nur Betriebe ausführen, die bei der Handwerkskammer und beim Netzbetreiber eingetragen sind. Eine Wallbox muss beim Netzbetreiber angemeldet werden, das übernimmt in der Regel der Elektriker.",
    anbieter: "Du bist Elektriker und hast noch Kapazität? Auf Abgemacht siehst du Aufträge aus deiner Umgebung, bevor sie im Bekanntenkreis versanden." },
  { slug: "installateur", wer: "Installateur", name: "Installateur", plural: "Installateure für Sanitär und Heizung", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Bad sanieren", "Heizung warten lassen", "Wärmepumpe planen und einbauen", "Tropfenden Wasserhahn oder Rohrbruch reparieren", "Durchlauferhitzer tauschen"],
    tipp: "Bei einer neuen Heizung lohnt es sich, Förderanträge zu stellen, bevor der Auftrag unterschrieben ist. Viele Programme zahlen nicht mehr, wenn schon begonnen wurde.",
    anbieter: "Sanitär- und Heizungsbetriebe bekommen auf Abgemacht Anfragen direkt aus der Region, ohne Gebühr pro Kontakt." },
  { slug: "maler", wer: "Maler", name: "Maler", plural: "Maler und Lackierer", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Wohnung vor dem Auszug streichen", "Fassade erneuern", "Tapezieren", "Türen und Heizkörper lackieren", "Büroräume renovieren"],
    tipp: "Vergleiche Angebote am besten pro Quadratmeter und frag nach, ob Abkleben, Abdecken und Material im Preis enthalten sind.",
    anbieter: "Malerbetriebe mit Lücken im Kalender finden auf Abgemacht kurzfristige Aufträge aus der Nachbarschaft." },
  { slug: "fliesenleger", wer: "Fliesenleger", name: "Fliesenleger", plural: "Fliesenleger", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Badezimmer fliesen", "Küchenspiegel verlegen", "Terrasse mit Platten belegen", "Fugen erneuern", "Balkon abdichten und fliesen"],
    tipp: "Seit 2020 ist das Fliesenlegerhandwerk wieder meisterpflichtig. Frag nach der Eintragung in die Handwerksrolle, wenn du einen Betrieb beauftragst.",
    anbieter: "Fliesenleger erreichen über Abgemacht Bauherren, Sanierer und Betriebe, die einen Partner für Bäder suchen." },
  { slug: "schreiner", wer: "Schreiner", name: "Schreiner", plural: "Schreiner und Tischler", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Einbauschrank nach Maß", "Küche anpassen oder montieren", "Innentüren tauschen", "Treppe sanieren", "Ladeneinrichtung bauen"],
    tipp: "Bei Möbeln nach Maß lohnt sich ein Aufmaß vor Ort. Ein seriöser Schreiner nennt dir Holzart, Oberfläche und Lieferzeit schriftlich.",
    anbieter: "Schreinereien zeigen auf Abgemacht ihre Arbeiten und bekommen Anfragen von Privatleuten und Firmen aus der Gegend." },
  { slug: "dachdecker", wer: "Dachdecker", name: "Dachdecker", plural: "Dachdecker", kat: "Handwerk", meister: true, privat: true,
    auftraege: ["Undichtes Dach reparieren", "Dachfenster einbauen", "Dach dämmen", "Dachrinne erneuern", "Sturmschaden beheben"],
    tipp: "Nach einem Sturm zuerst Fotos machen und die Versicherung informieren. Dann ein Angebot vom Dachdecker holen und erst danach beauftragen.",
    anbieter: "Dachdecker finden auf Abgemacht Aufträge und Partner für größere Projekte, etwa mit Zimmerern oder Solarteuren." },
  { slug: "gartenhilfe", wer: "Gartenhelfer", name: "Gartenhilfe", plural: "Gartenhelfer und Gartenpfleger", kat: "Sonstiges", privat: true,
    auftraege: ["Rasen mähen", "Hecke schneiden", "Laub entfernen", "Beete anlegen und pflegen", "Grünschnitt abtransportieren"],
    tipp: "Arbeitskosten für Gartenpflege kannst du als haushaltsnahe Dienstleistung anteilig von der Steuer absetzen (§ 35a EStG), wenn du per Überweisung bezahlst und eine Rechnung hast.",
    anbieter: "Du hilfst nebenbei im Garten oder hast einen Gartenbaubetrieb? Auf Abgemacht findest du Aufträge direkt bei dir um die Ecke." },
  { slug: "reinigung", wer: "Reinigungskraft", name: "Reinigungskraft", plural: "Reinigungskräfte und Reinigungsfirmen", kat: "Sonstiges", privat: true,
    auftraege: ["Büro regelmäßig reinigen", "Fenster putzen", "Grundreinigung nach Umzug", "Treppenhaus reinigen", "Praxisreinigung"],
    tipp: "Wer privat eine Haushaltshilfe beschäftigt, meldet sie am einfachsten als Minijob über das Haushaltsscheckverfahren der Minijob-Zentrale an.",
    anbieter: "Reinigungsfirmen und Selbstständige bekommen auf Abgemacht feste Aufträge von Betrieben und Privatleuten aus der Region." },
  { slug: "umzugshelfer", wer: "Umzugshelfer", name: "Umzugshelfer", plural: "Umzugshelfer und Umzugsfirmen", kat: "Sonstiges", privat: true,
    auftraege: ["Tragehilfe für ein paar Stunden", "Umzug mit Transporter", "Möbel ab- und aufbauen", "Keller entrümpeln", "Büroumzug am Wochenende"],
    tipp: "Kläre vorher, wer für Schäden haftet. Umzugsfirmen sind versichert, private Helfer meist nicht.",
    anbieter: "Umzugsfirmen und Helfer finden auf Abgemacht kurzfristige Einsätze in der Nähe." },
  { slug: "hausmeisterservice", wer: "Hausmeister", name: "Hausmeisterservice", plural: "Hausmeisterdienste", kat: "Sonstiges", privat: true,
    auftraege: ["Winterdienst übernehmen", "Treppenhaus und Außenanlagen pflegen", "Kleine Reparaturen", "Mülltonnen raus- und reinstellen", "Objektbetreuung für Vermieter"],
    tipp: "Beim Winterdienst schriftlich festhalten, wer wann räumt und streut. Im Schadensfall zählt, wer die Pflicht übernommen hat.",
    anbieter: "Hausmeisterdienste erreichen auf Abgemacht Vermieter, Hausverwaltungen und Gewerbe aus der Region." },
  { slug: "fotograf", wer: "Fotograf", name: "Fotograf", plural: "Fotografen", kat: "Sonstiges", privat: true,
    auftraege: ["Business-Porträts fürs Team", "Produktfotos für den Shop", "Immobilienfotos", "Hochzeit oder Feier", "Fotos für Social Media"],
    tipp: "Kläre vorher, wofür du die Bilder nutzen darfst: nur Website, auch Werbung, auch Druck. Diese Nutzungsrechte stehen im Angebot.",
    anbieter: "Fotografen zeigen auf Abgemacht ihr Portfolio und bekommen Anfragen von Firmen und Privatleuten aus der Gegend." },
  { slug: "webdesigner", wer: "Webdesigner", name: "Webdesigner", plural: "Webdesigner und Webagenturen", kat: "Marketing & Social Media", privat: false,
    auftraege: ["Neue Firmenwebsite", "Onlineshop aufbauen", "Bestehende Seite modernisieren", "Bei Google besser gefunden werden", "Website-Pflege im Monatspaket"],
    tipp: "Lass die Domain immer auf deinen eigenen Namen registrieren und hol dir die Zugänge. Impressum und Datenschutzerklärung gehören zur fertigen Website dazu.",
    anbieter: "Webdesigner und Agenturen finden auf Abgemacht Betriebe aus der Region, die gerade eine neue Website brauchen." },
  { slug: "social-media", wer: "Social-Media-Manager", name: "Social-Media-Manager", plural: "Social-Media-Manager und Agenturen", kat: "Marketing & Social Media", privat: false,
    auftraege: ["Instagram und TikTok betreuen", "Reels drehen und schneiden", "Redaktionsplan erstellen", "Werbeanzeigen schalten", "Recruiting-Kampagne"],
    tipp: "Achte darauf, dass die Konten auf deine Firma laufen und du die Zugänge behältst, auch wenn die Zusammenarbeit endet.",
    anbieter: "Freelancer und Agenturen für Social Media treffen auf Abgemacht Firmen, die sichtbarer werden wollen." },
  { slug: "grafikdesigner", wer: "Grafikdesigner", name: "Grafikdesigner", plural: "Grafikdesigner", kat: "Marketing & Social Media", privat: false,
    auftraege: ["Logo entwickeln", "Flyer und Plakate", "Visitenkarten", "Fahrzeugbeschriftung", "Präsentationen gestalten"],
    tipp: "Lass dir beim Logo die Nutzungsrechte ausdrücklich übertragen und die Dateien in allen Formaten geben, auch als Vektor.",
    anbieter: "Grafikdesigner finden auf Abgemacht Aufträge von Gründern und Betrieben aus der Region." },
  { slug: "it-service", wer: "IT-Dienstleister", name: "IT-Service", plural: "IT-Dienstleister", kat: "IT & Software", privat: true,
    auftraege: ["PC oder Laptop einrichten", "Netzwerk und WLAN im Büro", "Datensicherung aufsetzen", "Microsoft 365 einrichten", "Telefonanlage umstellen"],
    tipp: "Das Wichtigste zuerst: eine automatische Datensicherung, die regelmäßig geprüft wird. Ohne Backup kostet ein Festplattenschaden oft mehr als jede IT-Betreuung.",
    anbieter: "IT-Dienstleister bekommen auf Abgemacht Anfragen von kleinen Betrieben, die niemanden für die Technik haben." },
  { slug: "buchhaltung", wer: "Buchhalter", name: "Buchhaltung", plural: "Buchhalter und Büroservices", kat: "Finanzen & Steuern", privat: false,
    auftraege: ["Belege monatlich buchen", "Rechnungen schreiben und Mahnwesen", "Ablage digitalisieren", "Lohnabrechnung vorbereiten", "Büroorganisation"],
    tipp: "Laufende Buchungen darf ein Buchhalter übernehmen, Steuererklärungen und Jahresabschlüsse macht der Steuerberater. Gut ist, wenn beide mit derselben Software arbeiten.",
    anbieter: "Selbstständige Buchhalter und Büroservices finden auf Abgemacht Betriebe, denen der Papierkram über den Kopf wächst." },
];

const ORTE: Ort[] = [
  { slug: "ulm", name: "Ulm", land: "Baden-Württemberg", teile: ["Söflingen", "Wiblingen", "Böfingen", "Eselsberg", "Weststadt"], nachbarn: ["Neu-Ulm", "Blaustein", "Dornstadt", "Erbach"], start: true },
  { slug: "neu-ulm", name: "Neu-Ulm", land: "Bayern", teile: ["Pfuhl", "Offenhausen", "Ludwigsfeld", "Burlafingen", "Reutti"], nachbarn: ["Ulm", "Senden", "Elchingen", "Weißenhorn"], start: true },
  { slug: "augsburg", name: "Augsburg", land: "Bayern", teile: ["Göggingen", "Haunstetten", "Lechhausen", "Oberhausen", "Pfersee"], nachbarn: ["Friedberg", "Gersthofen", "Königsbrunn", "Stadtbergen"], start: false },
  { slug: "memmingen", name: "Memmingen", land: "Bayern", teile: ["Amendingen", "Steinheim", "Eisenburg", "Dickenreishausen"], nachbarn: ["Memmingerberg", "Buxheim", "Ottobeuren", "Bad Grönenbach"], start: false },
  { slug: "kempten", name: "Kempten", land: "Bayern", teile: ["Sankt Mang", "Thingers", "Lenzfried", "Leubas"], nachbarn: ["Durach", "Waltenhofen", "Sulzberg", "Buchenberg"], start: false },
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
`;

function rahmen(o: { titel: string; beschreibung: string; pfad: string; inhalt: string; jsonld?: unknown[]; noindex?: boolean }) {
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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='28' fill='%23138A6B'/%3E%3Ctext x='50' y='68' font-size='56' text-anchor='middle'%3E🤝%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css">
<style>${CSS}</style>
${ld}
</head>
<body>
<div class="wrap">
  <header>
    <a class="logo" href="/"><span class="mark">🤝</span>Abgemacht</a>
    <a class="btn" href="/?quelle=seo#warteliste">Auf die Warteliste</a>
  </header>
  <main class="seo">${o.inhalt}</main>
  <footer>
    <span>© 2026 Abgemacht · <a href="/finden">Branchen und Orte</a></span>
    <span><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></span>
  </footer>
</div>
</body>
</html>`;
}

function anmeldeLink(b?: Branche, o?: Ort) {
  const p = new URLSearchParams({ quelle: "seo" });
  if (b) p.set("branche", b.kat);
  if (o) p.set("ort", o.name);
  return `/?${p.toString()}#warteliste`;
}

function seiteFuer(b: Branche, o: Ort) {
  const titel = `${b.name} in ${o.name} finden | Abgemacht`;
  const beschreibung = `${b.plural} in ${o.name} und Umgebung finden oder als ${b.name} Aufträge aus ${o.name} bekommen. Direkt, ohne Vermittlungsgebühr. Abgemacht startet ${o.start ? "bald" : "nach Ulm und Neu-Ulm"} in ${o.name}.`;
  const status = o.start
    ? `Abgemacht startet in Kürze in Ulm und Neu-Ulm. Wer jetzt auf der Warteliste steht, ist vom ersten Tag an dabei.`
    : `Abgemacht startet zuerst in Ulm und Neu-Ulm, danach folgt ${o.name}. Mit deiner Anmeldung zeigst du, dass ${o.name} als Nächstes drankommen soll.`;
  const andereOrte = ORTE.filter((x) => x.slug !== o.slug).map((x) => `<a href="/finden/${b.slug}-${x.slug}">${esc(b.name)} in ${esc(x.name)}</a>`).join("");
  const andereBranchen = BRANCHEN.filter((x) => x.slug !== b.slug).map((x) => `<a href="/finden/${x.slug}-${o.slug}">${esc(x.name)} in ${esc(o.name)}</a>`).join("");
  const faq: [string, string][] = [
    [`Wie finde ich ${b.wer === "Reinigungskraft" ? "eine" : "einen"} ${b.wer} in ${o.name}?`, `Auf Abgemacht stellst du deinen Auftrag kurz ein, zum Beispiel „${b.auftraege[0]}“. ${b.plural} aus ${o.name}, ${liste(o.nachbarn.slice(0, 2))} sehen ihn und melden sich direkt bei dir per Chat oder Anruf.`],
    ["Was kostet Abgemacht?", "Zum Start ist Abgemacht kostenlos. Es gibt keine Gebühr pro Kontakt und keine Provision auf den Auftrag."],
    ["Mit wem schließe ich den Vertrag?", `Direkt mit ${b.wer === "Reinigungskraft" ? "der Reinigungskraft" : "dem " + b.wer}. Abgemacht stellt nur den Kontakt her, Preis und Termin vereinbart ihr untereinander.`],
    [`Ich bin ${b.wer}. Wie bekomme ich Aufträge aus ${o.name}?`, `${b.anbieter} Leg dein Profil an, wähle deine Branche und dein Gebiet, und du siehst passende Aufträge.`],
  ];
  if (b.meister) faq.push([`Muss ein ${b.name} einen Meisterbrief haben?`, `${b.name}-Betriebe gehören zu den zulassungspflichtigen Handwerken. Wer den Betrieb führt, muss in die Handwerksrolle eingetragen sein, meist mit Meisterbrief oder einer gleichwertigen Qualifikation. Auf Abgemacht kannst du nach geprüften Profilen filtern.`]);

  const inhalt = `
<p class="krumen"><a href="/">Abgemacht</a> › <a href="/finden">Branchen und Orte</a> › ${esc(b.name)} in ${esc(o.name)}</p>
<span class="pill">${o.start ? "Startet bald in " + esc(o.name) : "Bald auch in " + esc(o.name)}</span>
<h1>${esc(b.name)} in ${esc(o.name)} finden</h1>
<p class="lead">Ob privat oder für die Firma: Auf Abgemacht stellst du einen Auftrag ein und ${esc(b.plural)} aus ${esc(o.name)} und Umgebung melden sich direkt bei dir. Kein Rumtelefonieren, kein Warten auf die Empfehlung vom Nachbarn.</p>
<p><a class="btn" href="${anmeldeLink(b, o)}">Platz auf der Warteliste sichern</a></p>

<h2>Typische Aufträge für ${esc(b.plural)} in ${esc(o.name)}</h2>
<ul>${b.auftraege.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
<p>Gesucht wird in ganz ${esc(o.name)}, von ${esc(liste(o.teile.slice(0, 3)))} bis ${esc(o.teile[o.teile.length - 1])}, und in den Nachbarorten ${esc(liste(o.nachbarn))}.</p>

<div class="box"><b>Gut zu wissen</b><p style="margin:6px 0 0">${esc(b.tipp)}</p></div>

<h2>So funktioniert Abgemacht</h2>
<div class="schritte">
  <div><b>1. Auftrag einstellen</b>Kurz beschreiben, was zu tun ist und bis wann. Dauert eine Minute.</div>
  <div><b>2. Angebote bekommen</b>${esc(b.plural)} aus der Nähe sehen den Auftrag und melden sich per Chat oder Anruf.</div>
  <div><b>3. Abgemacht</b>Ihr klärt Preis und Termin direkt miteinander. Ohne Vermittlungsgebühr.</div>
</div>

<h2>Für ${esc(b.plural)} aus ${esc(o.name)}</h2>
<p>${esc(b.anbieter)} Abgemacht ist für Firmen, Selbstständige, Freelancer und Privatleute gemacht. Aufträge gehen in alle Richtungen: von privat an privat, von Firma an Selbstständige und umgekehrt.</p>

<div class="box gruen">
  <b>${o.start ? "Bald in " + esc(o.name) : esc(o.name) + " ist als Nächstes dran"}</b>
  <p style="margin:6px 0 14px">${esc(status)}</p>
  <a class="btn" href="${anmeldeLink(b, o)}">Kostenlos vormerken</a>
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

function uebersicht() {
  const zeilen = ORTE.map((o) => `<h2>${esc(o.name)}${o.start ? "" : ' <span style="font-size:14px;color:var(--muted);font-weight:600">· nach dem Start in Ulm</span>'}</h2><div class="links">${BRANCHEN.map((b) => `<a href="/finden/${b.slug}-${o.slug}">${esc(b.name)}</a>`).join("")}</div>`).join("");
  const inhalt = `
<p class="krumen"><a href="/">Abgemacht</a> › Branchen und Orte</p>
<h1>Aufträge und Betriebe aus deiner Region</h1>
<p class="lead">Abgemacht verbindet Firmen, Selbstständige, Freelancer und Privatleute. Wähle deine Stadt und die Branche, die du suchst oder anbietest.</p>
${zeilen}
<div class="box gruen"><b>Deine Branche fehlt?</b><p style="margin:6px 0 14px">Auf Abgemacht ist jede Branche willkommen. Trag dich ein und sag uns, was du suchst oder anbietest.</p><a class="btn" href="${anmeldeLink()}">Auf die Warteliste</a></div>`;
  return rahmen({ titel: "Branchen und Orte | Abgemacht", beschreibung: "Handwerker, Dienstleister und Freelancer in Ulm, Neu-Ulm, Augsburg, Memmingen und Kempten finden. Oder selbst Aufträge aus der Region bekommen.", pfad: "/finden", inhalt });
}

function sitemap() {
  const heute = new Date().toISOString().slice(0, 10);
  const urls = ["/", "/umfrage", "/finden", ...ORTE.flatMap((o) => BRANCHEN.map((b) => `/finden/${b.slug}-${o.slug}`))];
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
  const slug = pfad.replace(/^\/finden\//, "").toLowerCase();
  for (const o of ORTE) {
    if (!slug.endsWith("-" + o.slug)) continue;
    const b = BRANCHEN.find((x) => x.slug === slug.slice(0, -(o.slug.length + 1)));
    if (b) return html(seiteFuer(b, o));
  }
  return new Response(null, { status: 302, headers: { location: "/finden" } });
};

export const config: Config = { path: ["/finden", "/finden/*", "/sitemap.xml"] };
