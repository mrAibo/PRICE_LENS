import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {JSDOM} from "jsdom";
import {build} from "esbuild";

const args = parseArgs(process.argv.slice(2));

if (!args.html || !args.url || !args.id) {
  printUsage();
  process.exitCode = 2;
} else if (!isAllowedSearchUrl(args.url)) {
  process.stderr.write("Source URL must be an https://www.ebay.de/sch/... search page.\n");
  process.exitCode = 2;
} else {
  const htmlPath = path.resolve(args.html);
  const sourceHtml = await readFile(htmlPath, "utf8");
  const sourceDocument = new JSDOM(sourceHtml, {url: args.url}).window.document;
  const limit = parseLimit(args.limit);
  const sanitizedHtml = buildSanitizedSearchHtml(
    sourceDocument,
    args.id,
    limit
  );
  const fixtureUrl = "https://www.ebay.de/sch/i.html?_nkw=pricelens-fixture";
  const extractor = await loadSearchExtractor();
  const sanitizedDocument = new JSDOM(sanitizedHtml, {
    url: fixtureUrl
  }).window.document;
  const cards = [...sanitizedDocument.querySelectorAll(".s-item")];

  const fixture = {
    schemaVersion: 1,
    id: args.id,
    description:
      args.description ?? "Observed anonymized eBay.de search-results layout fixture.",
    source: {
      kind: "observed-search",
      marketplace: "ebay.de",
      capturedAt: new Date().toISOString(),
      sourceUrlSha256: createHash("sha256").update(args.url).digest("hex"),
      layoutClass: args.layoutClass ?? "search-results",
      capturedCardCount: cards.length
    },
    reviewed: false,
    reviewNote:
      "Verify expectedCards against the saved live page or screenshots, correct any generated expectation errors, then set reviewed=true. Metrics ignore unreviewed fixtures.",
    url: fixtureUrl,
    html: sanitizedHtml,
    expectedCards: cards.map((card, index) =>
      searchCardToExpected(
        extractor.extractEbaySearchCard(card),
        index
      )
    )
  };

  const outPath = path.resolve(
    args.out ??
      path.join(
        "apps",
        "extension",
        "test",
        "fixtures",
        "observed-search",
        `${safeFileName(args.id)}.json`
      )
  );

  await mkdir(path.dirname(outPath), {recursive: true});
  await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");

  process.stdout.write(
    [
      `Captured anonymized search fixture: ${outPath}`,
      `Source URL SHA-256: ${fixture.source.sourceUrlSha256}`,
      `Cards retained: ${cards.length}`,
      "",
      "NEXT REQUIRED STEP:",
      "1. Compare every expectedCards entry with the saved live page or screenshots.",
      "2. Correct expectedCards when the extractor is wrong.",
      "3. Set reviewed=true only after independent verification.",
      "4. Run: npm run evidence:ebay-search",
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
    description: result.description,
    layoutClass: result["layout-class"],
    limit: result.limit
  };
}

function printUsage() {
  process.stderr.write(`
Usage:
  npm run capture:ebay-search -- \\
    --html /path/to/saved-ebay-search-page.html \\
    --url "https://www.ebay.de/sch/i.html?_nkw=headphones" \\
    --id "observed-search-headphones" \\
    --layout-class "desktop-grid"

Optional:
  --description "Short fixture description"
  --limit 20
  --out /custom/output.json

The command retains only search-card markup used by PriceLens extraction, replaces
real item IDs/URLs with deterministic synthetic values, excludes seller/account areas,
and stores only a SHA-256 digest of the original search URL.
`);
}

function isAllowedSearchUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "ebay.de" || host.endsWith(".ebay.de")) &&
      url.pathname.startsWith("/sch/")
    );
  } catch {
    return false;
  }
}

function parseLimit(raw) {
  if (raw === undefined) return 20;
  if (!/^\d+$/.test(String(raw))) {
    throw new Error("--limit must be a positive integer.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error("--limit must be between 1 and 100.");
  }
  return value;
}

async function loadSearchExtractor() {
  const sourcePath = path.resolve(
    "apps",
    "extension",
    "src",
    "search-results.ts"
  );
  const result = await build({
    entryPoints: [sourcePath],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node22"],
    write: false,
    logLevel: "silent"
  });

  const code = result.outputFiles?.[0]?.text;
  if (!code) throw new Error("Failed to bundle the eBay search-card extractor.");

  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(code, "utf8").toString("base64");
  return import(dataUrl);
}

function buildSanitizedSearchHtml(document, fixtureId, limit) {
  const output = document.implementation.createHTMLDocument(
    "PriceLens search fixture"
  );
  const list = output.createElement("ul");
  list.className = "srp-results";
  output.body.appendChild(list);

  const seen = new Set();
  const cards = [];
  for (const card of document.querySelectorAll("li.s-item, .srp-results .s-item")) {
    if (seen.has(card)) continue;
    seen.add(card);
    cards.push(card);
    if (cards.length >= limit) break;
  }

  cards.forEach((card, index) => {
    const reduced = output.createElement("li");
    reduced.className = "s-item";

    const sourceLink =
      card.querySelector("a.s-item__link[href*='/itm/']") ??
      card.querySelector("a[href*='/itm/']");
    const syntheticId = syntheticItemIdFor(fixtureId, index);
    const link = sourceLink ? output.createElement("a") : undefined;
    if (link) {
      link.className = sourceLink.classList.contains("s-item__link")
        ? "s-item__link"
        : "";
      link.href = `https://www.ebay.de/itm/${syntheticId}`;
      reduced.appendChild(link);
    }

    copyFirstMatch(card, link ?? reduced, output, [
      ".s-item__title",
      "[role='heading']"
    ]);
    copyFirstMatch(card, reduced, output, [
      ".s-item__price",
      "[data-testid='item-price']"
    ]);
    copyFirstMatch(card, reduced, output, [
      ".s-item__shipping",
      ".s-item__logisticsCost"
    ]);
    copyFirstMatch(card, reduced, output, [
      ".SECONDARY_INFO",
      ".s-item__condition"
    ]);

    list.appendChild(reduced);
  });

  return "<!doctype html>\n" + output.documentElement.outerHTML;
}

function copyFirstMatch(source, target, output, selectors) {
  for (const selector of selectors) {
    const match = source.querySelector(selector);
    if (!match) continue;

    const clone = output.createElement(match.tagName.toLowerCase());
    const className = [...match.classList].filter((value) =>
      [
        "s-item__title",
        "s-item__price",
        "s-item__shipping",
        "s-item__logisticsCost",
        "SECONDARY_INFO",
        "s-item__condition"
      ].includes(value)
    );
    if (className.length > 0) clone.className = className.join(" ");
    const role = match.getAttribute("role");
    if (role === "heading") clone.setAttribute("role", "heading");
    const testId = match.getAttribute("data-testid");
    if (testId === "item-price") clone.setAttribute("data-testid", testId);
    clone.textContent = match.textContent ?? "";
    target.appendChild(clone);
    return;
  }
}

function searchCardToExpected(listing, index) {
  if (!listing) {
    return {
      cardIndex: index,
      supported: false
    };
  }

  return {
    cardIndex: index,
    supported: true,
    itemId: listing.itemId,
    title: listing.title,
    "price.amount": listing.price.amount,
    "price.currency": listing.price.currency,
    "shipping.amount": listing.shipping?.amount ?? null,
    "shipping.currency": listing.shipping?.currency ?? null,
    condition: listing.condition
  };
}

function syntheticItemIdFor(id, index) {
  const digest = createHash("sha256")
    .update(`${id}:${index}`)
    .digest("hex");
  const numeric = BigInt("0x" + digest.slice(0, 12)).toString().slice(0, 12);
  return numeric.padStart(12, "9");
}

function safeFileName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "fixture";
}
