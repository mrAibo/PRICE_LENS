import fs from "node:fs";
import path from "node:path";

const sourceDir = path.resolve("site");
const outputDir = path.resolve(".pages");

const required = [
  "PAGES_OPERATOR_NAME",
  "PAGES_OPERATOR_STREET",
  "PAGES_OPERATOR_CITY",
  "PAGES_OPERATOR_COUNTRY",
  "PAGES_PUBLIC_EMAIL"
];

const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`Missing required site publication variables: ${missing.join(", ")}`);
  process.exit(1);
}

const values = {
  name: process.env.PAGES_OPERATOR_NAME.trim(),
  street: process.env.PAGES_OPERATOR_STREET.trim(),
  city: process.env.PAGES_OPERATOR_CITY.trim(),
  country: process.env.PAGES_OPERATOR_COUNTRY.trim(),
  email: process.env.PAGES_PUBLIC_EMAIL.trim(),
  phone: process.env.PAGES_PUBLIC_PHONE?.trim() ?? "",
  vatId: process.env.PAGES_VAT_ID?.trim() ?? "",
  editorialName: process.env.PAGES_EDITORIAL_RESPONSIBLE_NAME?.trim() ?? "",
  editorialAddress: process.env.PAGES_EDITORIAL_RESPONSIBLE_ADDRESS?.trim() ?? ""
};

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) {
  console.error("PAGES_PUBLIC_EMAIL does not look like a valid email address.");
  process.exit(1);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const e = Object.fromEntries(
  Object.entries(values).map(([key, value]) => [key, escapeHtml(value)])
);

fs.rmSync(outputDir, {recursive: true, force: true});
fs.cpSync(sourceDir, outputDir, {recursive: true});
fs.writeFileSync(path.join(outputDir, ".nojekyll"), "");

function shell(title, description, body) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · PriceLens</title><meta name="description" content="${description}"><link rel="stylesheet" href="styles.css"></head><body><header><div class="wrap"><nav><a class="brand" href="index.html">PriceLens</a><a href="about.html">About</a><a href="provider-status.html">Provider status</a><a href="privacy.html">Privacy</a></nav></div></header>${body}<footer><div class="wrap"><div class="footer-links"><a href="about.html">About</a><a href="privacy.html">Privacy</a><a href="provider-status.html">Provider status</a><a href="launch-readiness.html">Launch readiness</a><a href="impressum.html">Impressum</a><a href="datenschutz.html">Datenschutz</a></div><p>PriceLens is an independent software project. It is not affiliated with or endorsed by eBay, Amazon, idealo or Geizhals. Provider integrations are enabled only after the applicable access and display terms are approved.</p></div></footer></body></html>`;
}

const contactLines = [
  `<p><strong>${e.name}</strong><br>${e.street}<br>${e.city}<br>${e.country}</p>`,
  `<p>E-Mail: <a href="mailto:${e.email}">${e.email}</a>${e.phone ? `<br>Telefon: ${e.phone}` : ""}</p>`
].join("");

const vatBlock = e.vatId
  ? `<h2>Umsatzsteuer-ID</h2><p>Umsatzsteuer-Identifikationsnummer: ${e.vatId}</p>`
  : "";

const editorialBlock =
  e.editorialName && e.editorialAddress
    ? `<h2>Verantwortlich für journalistisch-redaktionelle Inhalte</h2><p>Soweit § 18 Abs. 2 MStV auf einzelne Inhalte Anwendung findet:</p><p><strong>${e.editorialName}</strong><br>${e.editorialAddress}</p>`
    : "";

const impressum = shell(
  "Impressum",
  "Anbieterkennzeichnung für das PriceLens-Projekt.",
  `<main><div class="wrap"><article class="article"><h1>Impressum</h1><p>Angaben gemäß § 5 DDG sowie § 18 Abs. 1 MStV.</p>${contactLines}${vatBlock}${editorialBlock}<h2>Projektstatus</h2><p>PriceLens ist ein unabhängiges Softwareprojekt in einer frühen Entwicklungsphase. Es besteht keine gesellschaftsrechtliche Verbindung zu eBay, Amazon, idealo oder Geizhals.</p><h2>Hinweis zu externen Links</h2><p>Für Inhalte externer Webseiten sind deren jeweilige Betreiber verantwortlich. Affiliate- oder Werbelinks werden nur aktiviert, wenn die erforderlichen Provider-Freigaben und Kennzeichnungspflichten geklärt sind.</p></article></div></main>`
);

const datenschutz = shell(
  "Datenschutz",
  "Datenschutzhinweise für die PriceLens-Projektwebsite.",
  `<main><div class="wrap"><article class="article"><h1>Datenschutzhinweise</h1><h2>1. Verantwortlicher</h2>${contactLines}<h2>2. Hosting dieser Website</h2><p>Diese Projektwebsite wird über GitHub Pages bereitgestellt. GitHub weist darauf hin, dass beim Besuch einer GitHub-Pages-Website die IP-Adresse des Besuchers zu Sicherheitszwecken protokolliert und gespeichert wird. Weitere Informationen stehen in der GitHub-Datenschutzerklärung.</p><p><a href="https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages">GitHub Pages: What is GitHub Pages?</a><br><a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub General Privacy Statement</a></p><h2>3. Keine eigenen Analyse- oder Tracking-Skripte</h2><p>Der von PriceLens veröffentlichte Quellcode dieser Website setzt keine eigenen Analytics-, Werbe- oder Tracking-Skripte ein und setzt selbst keine eigenen Cookies. Technisch notwendige Verarbeitung durch den Hosting-Anbieter bleibt davon unberührt.</p><h2>4. Kontaktaufnahme per E-Mail</h2><p>Wenn Sie per E-Mail Kontakt aufnehmen, werden die von Ihnen übermittelten Kontaktdaten und Nachrichteninhalte verarbeitet, soweit dies zur Bearbeitung der Anfrage erforderlich ist. Je nach Inhalt der Anfrage kann die Verarbeitung der Durchführung vorvertraglicher Maßnahmen oder der allgemeinen Kommunikation über das Projekt dienen. Die Daten werden gelöscht, sobald sie für die Bearbeitung nicht mehr erforderlich sind und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p><h2>5. PriceLens Browser-Erweiterung</h2><p>Diese Seite beschreibt die Projektwebsite. Die Browser-Erweiterung befindet sich noch vor dem öffentlichen Release. Vor einer öffentlichen Veröffentlichung werden die Datenschutzhinweise für die Erweiterung und das Backend anhand der tatsächlich aktivierten Provider, Hosting-Komponenten und Datenflüsse nochmals abschließend geprüft.</p><h2>6. Betroffenenrechte</h2><p>Nach Maßgabe der DSGVO können betroffene Personen insbesondere Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und – soweit anwendbar – Widerspruch oder Datenübertragbarkeit verlangen. Außerdem besteht das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren.</p><h2>7. Stand</h2><p>Stand: Oktober 2026.</p></article></div></main>`
);

fs.writeFileSync(path.join(outputDir, "impressum.html"), impressum);
fs.writeFileSync(path.join(outputDir, "datenschutz.html"), datenschutz);

function listHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtml(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

for (const file of listHtml(outputDir)) {
  if (file.endsWith("impressum.html") || file.endsWith("datenschutz.html")) continue;
  let html = fs.readFileSync(file, "utf8");
  const relRoot = path.relative(path.dirname(file), outputDir).replaceAll("\\", "/");
  const prefix = relRoot ? `${relRoot}/` : "";
  const marker = '<div class="footer-links">';
  if (!html.includes(marker)) {
    console.error(`Missing footer link container in ${path.relative(outputDir, file)}`);
    process.exit(1);
  }
  html = html.replace(
    marker,
    `${marker}<a href="${prefix}impressum.html">Impressum</a><a href="${prefix}datenschutz.html">Datenschutz</a>`
  );
  fs.writeFileSync(file, html);
}

console.log(`Prepared GitHub Pages artifact with ${listHtml(outputDir).length} HTML pages.`);
console.log("Public operator details were injected into the build artifact only.");
