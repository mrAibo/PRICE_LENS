import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {pathToFileURL} from "node:url";
import {JSDOM} from "jsdom";
import {build} from "esbuild";

const args = parseArgs(process.argv.slice(2));

if (!args.html || !args.url || !args.id) {
  printUsage();
  process.exitCode = 2;
} else {
  const htmlPath = path.resolve(args.html);
  const sourceHtml = await readFile(htmlPath, "utf8");
  const sourceDocument = new JSDOM(sourceHtml, {url: args.url}).window.document;
  const sanitizedHtml = buildSanitizedFixtureHtml(sourceDocument);

  const syntheticItemId = args.itemId ?? syntheticItemIdFor(args.id);
  const fixtureUrl = `https://www.ebay.de/itm/${syntheticItemId}`;
  const extractor = await loadExtractor();
  const sanitizedDocument = new JSDOM(sanitizedHtml, {url: fixtureUrl}).window.document;
  const observed = extractor.extractEbayListing(sanitizedDocument, fixtureUrl);

  const fixture = {
    schemaVersion: 1,
    id: args.id,
    description: args.description ?? "Observed anonymized eBay.de layout fixture.",
    source: {
      kind: "observed",
      marketplace: "ebay.de",
      capturedAt: new Date().toISOString(),
      sourceUrlSha256: createHash("sha256").update(args.url).digest("hex"),
      layoutClass: args.layoutClass ?? "unclassified"
    },
    reviewed: false,
    reviewNote:
      "Verify expected fields against the live page or screenshot, then set reviewed=true. Metrics ignore unreviewed fixtures.",
    url: fixtureUrl,
    html: sanitizedHtml,
    expected: listingToExpected(observed)
  };

  const outPath = path.resolve(
    args.out ??
      path.join(
        "apps",
        "extension",
        "test",
        "fixtures",
        "observed",
        `${safeFileName(args.id)}.json`
      )
  );

  await mkdir(path.dirname(outPath), {recursive: true});
  await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");

  process.stdout.write(
    [
      `Captured anonymized fixture: ${outPath}`,
      `Source URL SHA-256: ${fixture.source.sourceUrlSha256}`,
      `Synthetic item id: ${syntheticItemId}`,
      "",
      "NEXT REQUIRED STEP:",
      "1. Compare fixture.expected against the live page or a screenshot.",
      "2. Correct any expected values that the extractor got wrong.",
      "3. Set reviewed=true only after that independent verification.",
      "4. Run: npm run evidence:ebay",
      ""
    ].join("\n")
  );
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    index += 1;
  }
  return {
    html: result.html,
    url: result.url,
    id: result.id,
    out: result.out,
    itemId: result["item-id"],
    description: result.description,
    layoutClass: result["layout-class"]
  };
}

function printUsage() {
  process.stderr.write(`
Usage:
  npm run capture:ebay -- \\
    --html /path/to/saved-ebay-page.html \\
    --url "https://www.ebay.de/itm/REAL_ITEM_ID" \\
    --id "observed-laptop-buy-it-now" \\
    --layout-class "buy-it-now"

Optional:
  --description "Short fixture description"
  --item-id 900000000001
  --out /custom/output.json

The command keeps only extractor-relevant markup. It does not store the original
eBay item URL; only a SHA-256 digest is retained for provenance/deduplication.
`);
}

async function loadExtractor() {
  const extractorPath = path.resolve(
    "apps",
    "extension",
    "src",
    "ebay",
    "extract.ts"
  );
  const result = await build({
    entryPoints: [extractorPath],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node22"],
    write: false,
    logLevel: "silent"
  });

  const code = result.outputFiles?.[0]?.text;
  if (!code) throw new Error("Failed to bundle the eBay extractor.");

  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(code, "utf8").toString("base64");
  return import(dataUrl);
}

function buildSanitizedFixtureHtml(document) {
  const output = document.implementation.createHTMLDocument("PriceLens fixture");

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const clone = output.createElement("script");
    clone.type = "application/ld+json";
    clone.textContent = script.textContent ?? "";
    output.head.appendChild(clone);
  }

  copyMatches(document, output.head, [
    'meta[property="og:title"]',
    'meta[property="og:image"]',
    '[itemprop="price"][content]',
    '[property="product:price:amount"][content]',
    '[itemprop="priceCurrency"][content]',
    '[property="product:price:currency"][content]',
    '[itemprop="itemCondition"][content]'
  ]);

  copyMatches(document, output.body, [
    "h1.x-item-title__mainTitle",
    '[data-testid="x-item-title"] h1',
    '[data-testid="x-price-primary"]',
    ".x-price-primary",
    ".x-item-condition-text"
  ]);

  const copiedSpecifics = new Set();

  for (const row of document.querySelectorAll(".ux-labels-values")) {
    const label = textOf(
      row.querySelector(".ux-labels-values__labels-content") ??
        row.querySelector(".ux-labels-values__labels")
    );
    const value = textOf(
      row.querySelector(".ux-labels-values__values-content") ??
        row.querySelector(".ux-labels-values__values")
    );
    if (!label || !value || !isAllowedSpecificLabel(label)) continue;

    const key = `${normalizeLabel(label)}\u0000${value.trim()}`;
    if (copiedSpecifics.has(key)) continue;
    copiedSpecifics.add(key);
    output.body.appendChild(row.cloneNode(true));
  }

  // Newer eBay item pages can render item-specifics as direct dt/dd siblings
  // without the historical .ux-labels-values wrapper. Preserve only the same
  // allowlisted labels, and reconstruct a minimal row so the fixture remains
  // privacy-minimized and the extractor sees the real label/value semantics.
  for (const term of document.querySelectorAll("dt")) {
    const valueElement = term.nextElementSibling;
    if (!valueElement || valueElement.tagName.toLowerCase() !== "dd") continue;

    const label = textOf(term);
    const value = textOf(valueElement);
    if (!label || !value || !isAllowedSpecificLabel(label)) continue;

    const key = `${normalizeLabel(label)}\u0000${value.trim()}`;
    if (copiedSpecifics.has(key)) continue;
    copiedSpecifics.add(key);

    const row = output.createElement("dl");
    row.className = "ux-labels-values";
    row.append(term.cloneNode(true), valueElement.cloneNode(true));
    output.body.appendChild(row);
  }

  const skuSelections = output.createElement("div");
  skuSelections.setAttribute("data-testid", "x-msku-evo");
  for (const control of document.querySelectorAll(
    '[data-testid="x-msku-evo"] .listbox-button__control'
  )) {
    const label = textOf(control.querySelector(".btn__label"));
    const value = textOf(control.querySelector(".btn__text"));
    if (
      !label ||
      !value ||
      !isAllowedSpecificLabel(label) ||
      isSelectionPlaceholder(value)
    ) {
      continue;
    }

    const button = output.createElement("button");
    button.className = "listbox-button__control";
    const labelSpan = output.createElement("span");
    labelSpan.className = "btn__label";
    labelSpan.textContent = label;
    const valueSpan = output.createElement("span");
    valueSpan.className = "btn__text";
    valueSpan.textContent = value;
    button.append(labelSpan, valueSpan);
    skuSelections.appendChild(button);
  }
  if (skuSelections.childElementCount > 0) {
    output.body.appendChild(skuSelections);
  }

  return "<!doctype html>\n" + output.documentElement.outerHTML;
}

function copyMatches(source, target, selectors) {
  const seen = new Set();
  for (const selector of selectors) {
    for (const element of source.querySelectorAll(selector)) {
      const key = element.outerHTML;
      if (seen.has(key)) continue;
      seen.add(key);
      target.appendChild(element.cloneNode(true));
    }
  }
}

function isAllowedSpecificLabel(label) {
  const normalized = normalizeLabel(label);
  return [
    "marke",
    "brand",
    "modell",
    "model",
    "modellnummer",
    "model number",
    "herstellernummer",
    "herstellerteilenummer",
    "manufacturer part number",
    "mpn",
    "gtin",
    "ean",
    "upc",
    "speicherkapazitat",
    "storage capacity",
    "festplattenkapazitat",
    "ssd-speicherkapazitat",
    "ssd capacity",
    "arbeitsspeicher",
    "arbeitsspeichergrosse",
    "ram",
    "ram grosse",
    "ram size",
    "bildschirmgrosse",
    "displaygrosse",
    "screen size",
    "display size",
    "anzahl pro packung",
    "packungsinhalt",
    "number in pack",
    "pack count",
    "edition",
    "ausgabe",
    "version",
    "bundle",
    "bundle-beschreibung",
    "bundle description",
    "versand",
    "shipping"
  ].includes(normalized);
}

function normalizeLabel(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/:+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSelectionPlaceholder(value) {
  return /^(?:auswahlen|bitte auswahlen|select|choose|please select)$/.test(
    normalizeLabel(value)
  );
}

function textOf(element) {
  return element?.textContent?.trim() || undefined;
}

function listingToExpected(listing) {
  if (!listing) return {supported: false};

  return {
    supported: true,
    itemId: listing.itemId,
    title: listing.title,
    "price.amount": listing.price.amount,
    "price.currency": listing.price.currency,
    "shipping.amount": listing.shipping?.amount ?? null,
    "shipping.currency": listing.shipping?.currency ?? null,
    condition: listing.condition,
    "identity.brand": listing.identity.brand ?? null,
    "identity.model": listing.identity.model ?? null,
    "identity.mpn": listing.identity.mpn ?? null,
    "identity.gtin": listing.identity.gtin ?? null,
    "identity.ean": listing.identity.ean ?? null,
    "identity.upc": listing.identity.upc ?? null,
    "identity.variant.storageGb": listing.identity.variant?.storageGb ?? null,
    "identity.variant.ramGb": listing.identity.variant?.ramGb ?? null,
    "identity.variant.screenSizeInches":
      listing.identity.variant?.screenSizeInches ?? null,
    "identity.variant.packCount": listing.identity.variant?.packCount ?? null
  };
}

function syntheticItemIdFor(id) {
  const digest = createHash("sha256").update(id).digest("hex");
  const numeric = BigInt("0x" + digest.slice(0, 12)).toString().slice(0, 12);
  return numeric.padStart(12, "9");
}

function safeFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "fixture";
}
