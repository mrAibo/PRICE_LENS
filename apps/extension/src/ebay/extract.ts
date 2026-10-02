import type {
  EcommerceListing,
  ListingCondition,
  Money,
  ProductIdentity
} from "@price-lens/contracts";

type JsonRecord = Record<string, unknown>;

export function extractEbayListing(
  document: Document,
  pageUrl: string
): EcommerceListing | null {
  const itemId = extractEbayItemId(pageUrl);
  if (!itemId) return null;

  const evidence: string[] = ["url:itemId"];
  const warnings: string[] = [];
  const product = findProductJsonLd(document);

  const title =
    readString(product?.name) ??
    readMeta(document, 'meta[property="og:title"]') ??
    readText(document, "h1.x-item-title__mainTitle") ??
    readText(document, '[data-testid="x-item-title"] h1') ??
    readText(document, "h1");

  if (!title) return null;
  if (product?.name) evidence.push("jsonld:Product.name");

  const price =
    extractJsonLdPrice(product, evidence) ??
    extractMetaPrice(document, evidence) ??
    extractDomPrice(document, evidence);

  if (!price) return null;

  const identity = extractIdentity(product, evidence);
  const condition = extractCondition(product, document, evidence);
  const imageUrl = extractImage(product, document, evidence);

  if (!identity.gtin && !identity.ean && !identity.upc && !identity.mpn) {
    warnings.push("No strong product identifier was found on the page.");
  }

  return {
    source: "ebay",
    itemId,
    url: canonicalizeUrl(pageUrl),
    title: cleanTitle(title),
    price,
    condition,
    identity,
    imageUrl,
    extractionEvidence: evidence,
    extractionWarnings: warnings
  };
}

export function extractEbayItemId(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    const pathMatch = url.pathname.match(
      /\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?#]|$)/i
    );
    if (pathMatch?.[1]) return pathMatch[1];

    const queryItem = url.searchParams.get("item");
    if (queryItem && /^\d{9,15}$/.test(queryItem)) return queryItem;
  } catch {
    return null;
  }
  return null;
}

function findProductJsonLd(document: Document): JsonRecord | undefined {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]'
  );

  for (const script of scripts) {
    const text = script.textContent?.trim();
    if (!text) continue;
    try {
      const records = flattenJsonLd(JSON.parse(text) as unknown);
      const product = records.find((record) => hasType(record, "Product"));
      if (product) return product;
    } catch {
      continue;
    }
  }
  return undefined;
}

function flattenJsonLd(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const record = value as JsonRecord;
  const graph = record["@graph"];
  return graph ? [record, ...flattenJsonLd(graph)] : [record];
}

function hasType(record: JsonRecord, expected: string): boolean {
  const type = record["@type"];
  return type === expected || (Array.isArray(type) && type.includes(expected));
}

function extractJsonLdPrice(
  product: JsonRecord | undefined,
  evidence: string[]
): Money | undefined {
  if (!product) return undefined;
  const offer = firstObject(product.offers);
  if (!offer) return undefined;
  const amount = parseNumericPrice(offer.price);
  const currency = readString(offer.priceCurrency);
  if (amount === undefined || !currency) return undefined;
  evidence.push("jsonld:Product.offers.price");
  return {amount, currency: currency.toUpperCase()};
}

function extractMetaPrice(
  document: Document,
  evidence: string[]
): Money | undefined {
  const amountText =
    readMeta(document, 'meta[itemprop="price"]') ??
    readMeta(document, 'meta[property="product:price:amount"]');
  const currency =
    readMeta(document, 'meta[itemprop="priceCurrency"]') ??
    readMeta(document, 'meta[property="product:price:currency"]');

  const amount = parseNumericPrice(amountText);
  if (amount === undefined || !currency) return undefined;
  evidence.push("meta:price");
  return {amount, currency: currency.toUpperCase()};
}

function extractDomPrice(
  document: Document,
  evidence: string[]
): Money | undefined {
  const text =
    readText(document, '[data-testid="x-price-primary"]') ??
    readText(document, ".x-price-primary") ??
    readText(document, '[itemprop="price"]');

  if (!text) return undefined;
  const amount = parseLocalizedPrice(text);
  if (amount === undefined) return undefined;

  const currency = /\bEUR\b|€/.test(text) ? "EUR" : undefined;
  if (!currency) return undefined;

  evidence.push("dom:primary-price");
  return {amount, currency};
}

function extractIdentity(
  product: JsonRecord | undefined,
  evidence: string[]
): ProductIdentity {
  if (!product) return {};
  const identity: ProductIdentity = {};
  const brand = readBrand(product.brand);
  const model = readString(product.model);
  const mpn = readString(product.mpn);
  const gtin =
    readString(product.gtin14) ??
    readString(product.gtin13) ??
    readString(product.gtin12) ??
    readString(product.gtin);
  const ean = readString(product.ean);
  const upc = readString(product.upc);

  if (brand) identity.brand = brand;
  if (model) identity.model = model;
  if (mpn) identity.mpn = mpn;
  if (gtin) identity.gtin = digitsOnly(gtin);
  if (ean) identity.ean = digitsOnly(ean);
  if (upc) identity.upc = digitsOnly(upc);
  if (Object.keys(identity).length > 0) evidence.push("jsonld:Product.identity");

  return identity;
}

function extractCondition(
  product: JsonRecord | undefined,
  document: Document,
  evidence: string[]
): ListingCondition {
  const offer = firstObject(product?.offers);
  const raw =
    readString(offer?.itemCondition) ??
    readString(product?.itemCondition) ??
    readMeta(document, 'meta[itemprop="itemCondition"]');

  if (!raw) return "unknown";
  evidence.push("structured:condition");

  const value = raw.toLowerCase();
  if (value.includes("newcondition") || /\bnew\b/.test(value)) return "new";
  if (value.includes("refurb")) return "refurbished";
  if (value.includes("openbox") || value.includes("open box")) return "open_box";
  if (value.includes("used")) return "used";
  return "unknown";
}

function extractImage(
  product: JsonRecord | undefined,
  document: Document,
  evidence: string[]
): string | undefined {
  const raw = product?.image;
  let image: string | undefined;
  if (typeof raw === "string") image = raw;
  if (Array.isArray(raw)) image = readString(raw[0]);
  if (raw && typeof raw === "object") image = readString((raw as JsonRecord).url);
  image ??= readMeta(document, 'meta[property="og:image"]');
  if (image) evidence.push("structured:image");
  return image;
}

function readBrand(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object") return readString((value as JsonRecord).name);
  return undefined;
}

function firstObject(value: unknown): JsonRecord | undefined {
  if (Array.isArray(value)) {
    return value.find(
      (entry): entry is JsonRecord => !!entry && typeof entry === "object"
    );
  }
  return value && typeof value === "object" ? (value as JsonRecord) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMeta(document: Document, selector: string): string | undefined {
  const element = document.querySelector<HTMLMetaElement>(selector);
  return element?.content?.trim() || undefined;
}

function readText(document: Document, selector: string): string | undefined {
  return document.querySelector(selector)?.textContent?.trim() || undefined;
}

function parseNumericPrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value !== "string") return undefined;
  const amount = Number.parseFloat(value.trim().replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined;
}

function parseLocalizedPrice(text: string): number | undefined {
  const compact = text.replace(/\s/g, "");
  const match = compact.match(
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2})?)/
  );
  if (!match?.[1]) return undefined;
  const raw = match[1];
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanTitle(value: string): string {
  return value.replace(/^details about\s+/i, "").trim();
}

function canonicalizeUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return pageUrl;
  }
}
