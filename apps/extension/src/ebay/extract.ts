import type {
  EcommerceListing,
  ListingCondition,
  Money,
  ProductIdentity,
  WarningCode
} from "@price-lens/contracts";
import {
  detectCurrency,
  parseLocalizedAmount,
  parseMoneyText,
  parseSchemaAmount
} from "./price.js";
import {
  enrichIdentityFromSpecifics,
  extractItemSpecifics
} from "./specifics.js";

type JsonRecord = Record<string, unknown>;

export function extractEbayListing(
  document: Document,
  pageUrl: string
): EcommerceListing | null {
  const itemId = extractEbayItemId(pageUrl);
  if (!itemId) return null;

  const evidence: string[] = ["url:itemId"];
  const warnings: string[] = [];
  const warningCodes: WarningCode[] = [];
  const product = findProductJsonLd(document);

  const title =
    readString(product?.name) ??
    readMeta(document, 'meta[property="og:title"]') ??
    readText(document, "h1.x-item-title__mainTitle .ux-textspans--BOLD") ??
    readText(document, "h1.x-item-title__mainTitle") ??
    readText(document, '[data-testid="x-item-title"] h1') ??
    readText(document, "h1");

  if (!title) return null;
  if (product?.name) evidence.push("jsonld:Product.name");

  const price =
    extractJsonLdPrice(product, evidence) ??
    extractContentPrice(document, evidence) ??
    extractDomPrice(document, evidence);

  if (!price) return null;

  const identity = extractIdentity(product, document, evidence);
  const condition = extractCondition(product, document, evidence);
  const shipping = extractShipping(product, document, price.currency, evidence);
  const imageUrl = extractImage(product, document, evidence);

  if (!identity.gtin && !identity.ean && !identity.upc && !identity.mpn) {
    warnings.push("No strong product identifier was found on the page.");
    warningCodes.push("extraction_no_strong_identifier");
  }

  return {
    source: "ebay",
    itemId,
    url: canonicalizeUrl(pageUrl),
    title: cleanTitle(title),
    price,
    shipping,
    condition,
    identity,
    imageUrl,
    extractionEvidence: evidence,
    extractionWarnings: warnings,
    extractionWarningCodes: warningCodes
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

  const prices = objectList(product.offers)
    .map((offer) => {
      const amount = parseSchemaAmount(offer.price);
      const currency = readString(offer.priceCurrency);
      if (amount === undefined || !currency) return undefined;
      return {amount, currency: currency.toUpperCase()} satisfies Money;
    })
    .filter((price): price is Money => !!price);

  const price = unambiguousMoney(prices);
  if (!price) return undefined;

  evidence.push("jsonld:Product.offers.price");
  return price;
}

function extractContentPrice(
  document: Document,
  evidence: string[]
): Money | undefined {
  const amountText =
    readContent(document, '[itemprop="price"][content]') ??
    readContent(document, '[property="product:price:amount"][content]');
  const currency =
    readContent(document, '[itemprop="priceCurrency"][content]') ??
    readContent(document, '[property="product:price:currency"][content]');

  const amount = amountText ? parseSchemaAmount(amountText) : undefined;
  if (amount === undefined || !currency) return undefined;

  evidence.push("content-attribute:price");
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

  const amount = parseLocalizedAmount(text);
  const currency = detectCurrency(text);
  if (amount === undefined || !currency) return undefined;

  evidence.push("dom:primary-price");
  return {amount, currency};
}

function extractIdentity(
  product: JsonRecord | undefined,
  document: Document,
  evidence: string[]
): ProductIdentity {
  const identity: ProductIdentity = {};

  if (product) {
    const brand = readBrand(product.brand);
    const model = readString(product.model);
    const mpn = cleanTextIdentifier(readString(product.mpn));
    const gtin = cleanTradeIdentifier(
      readString(product.gtin14) ??
      readString(product.gtin13) ??
      readString(product.gtin12) ??
      readString(product.gtin)
    );
    const ean = cleanTradeIdentifier(readString(product.ean));
    const upc = cleanTradeIdentifier(readString(product.upc));

    if (brand) identity.brand = brand;
    if (model) identity.model = model;
    if (mpn) identity.mpn = mpn;
    if (gtin) identity.gtin = gtin;
    if (ean) identity.ean = ean;
    if (upc) identity.upc = upc;

    if (Object.keys(identity).length > 0) {
      evidence.push("jsonld:Product.identity");
    }
  }

  const specifics = extractItemSpecifics(document);
  const enriched = enrichIdentityFromSpecifics(identity, specifics);
  if (enriched.addedFields.length > 0) {
    evidence.push(`dom:item-specifics:${enriched.addedFields.join(",")}`);
  }

  return enriched.identity;
}

function extractCondition(
  product: JsonRecord | undefined,
  document: Document,
  evidence: string[]
): ListingCondition {
  const offerConditions = objectList(product?.offers)
    .map((offer) => readString(offer.itemCondition))
    .filter((value): value is string => !!value);
  const structured =
    readString(product?.itemCondition) ??
    unambiguousString(offerConditions) ??
    readContent(document, '[itemprop="itemCondition"][content]');

  const raw =
    structured ??
    readText(document, ".x-item-condition-text .ux-textspans") ??
    readText(document, ".x-item-condition-text");

  if (!raw) return "unknown";
  evidence.push(structured ? "structured:condition" : "dom:condition");

  const value = normalizeSearchText(raw);
  if (/refurb|generaluberholt|renewed|reconditioned|reacondicionado/.test(value)) {
    return "refurbished";
  }
  if (/open\s*box|geoffnet|offene\s+verpackung/.test(value)) {
    return "open_box";
  }
  if (/\bgebraucht\b|\bused\b/.test(value)) {
    return "used";
  }
  if (/newcondition|\bneu\b|\bnew\b/.test(value)) {
    return "new";
  }

  return "unknown";
}

function extractShipping(
  product: JsonRecord | undefined,
  document: Document,
  itemCurrency: string,
  evidence: string[]
): Money | undefined {
  const structured = extractJsonLdShipping(product, itemCurrency);
  if (structured) {
    evidence.push("jsonld:Offer.shippingDetails");
    return structured;
  }

  const dom = extractDomShipping(document, itemCurrency);
  if (dom) {
    evidence.push("dom:shipping");
    return dom;
  }

  return undefined;
}

function extractJsonLdShipping(
  product: JsonRecord | undefined,
  itemCurrency: string
): Money | undefined {
  const offers = objectList(product?.offers);
  if (offers.length !== 1) return undefined;
  const offer = offers[0];
  if (!offer) return undefined;

  const candidates = objectList(offer.shippingDetails)
    .map((details) => {
      const rate = firstObject(details.shippingRate);
      const amount = parseSchemaAmount(rate?.value ?? rate?.price);
      const currency =
        readString(rate?.currency) ??
        readString(rate?.priceCurrency) ??
        readString(offer.priceCurrency);
      if (amount === undefined || !currency) return undefined;

      return {
        money: {amount, currency: currency.toUpperCase()} satisfies Money,
        country: shippingCountry(details)
      };
    })
    .filter(
      (candidate): candidate is {money: Money; country: string | undefined} =>
        !!candidate && candidate.money.currency === itemCurrency.toUpperCase()
    );

  if (candidates.length === 0) return undefined;

  const german = candidates.filter((candidate) => isGermany(candidate.country));
  const destinationAgnostic = candidates.filter((candidate) => !candidate.country);
  const relevant = german.length > 0 ? german : destinationAgnostic;

  if (relevant.length === 1) return relevant[0]?.money;
  if (relevant.length > 1 && allSameMoney(relevant.map((candidate) => candidate.money))) {
    return relevant[0]?.money;
  }

  return undefined;
}

function extractDomShipping(
  document: Document,
  itemCurrency: string
): Money | undefined {
  for (const row of document.querySelectorAll(".ux-labels-values")) {
    const label =
      readTextFrom(row.querySelector(".ux-labels-values__labels-content")) ??
      readTextFrom(row.querySelector(".ux-labels-values__labels"));
    if (!label || !isShippingLabel(label)) continue;

    const value =
      readTextFrom(
        row.querySelector(".ux-labels-values__values .ux-textspans--BOLD")
      ) ??
      readTextFrom(row.querySelector(".ux-labels-values__values-content")) ??
      readTextFrom(row.querySelector(".ux-labels-values__values"));

    if (!value) continue;
    const money = parseMoneyText(value, {
      fallbackCurrency: itemCurrency,
      allowFreeText: true
    });
    if (money && money.currency === itemCurrency.toUpperCase()) return money;
  }

  const direct =
    readText(document, ".ux-labels-values--shipping .ux-textspans--BOLD") ??
    readText(document, ".ux-labels-values--shipping .ux-labels-values__values");

  if (!direct) return undefined;
  const money = parseMoneyText(direct, {
    fallbackCurrency: itemCurrency,
    allowFreeText: true
  });

  return money?.currency === itemCurrency.toUpperCase() ? money : undefined;
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
  if (raw && typeof raw === "object") {
    image = readString((raw as JsonRecord).url);
  }

  image ??= readMeta(document, 'meta[property="og:image"]');
  if (image) evidence.push("structured:image");
  return image;
}

function shippingCountry(details: JsonRecord): string | undefined {
  const destination = firstObject(details.shippingDestination);
  const raw = destination?.addressCountry;

  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    return readString((raw as JsonRecord).name);
  }

  return undefined;
}

function isGermany(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = normalizeSearchText(value).replace(/\s+/g, "");
  return ["de", "deu", "germany", "deutschland"].includes(normalized);
}

function unambiguousMoney(values: Money[]): Money | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  if (!first) return undefined;

  return values.every(
    (value) =>
      value.currency === first.currency &&
      value.amount === first.amount
  )
    ? first
    : undefined;
}

function unambiguousString(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const normalized = new Map<string, string>();

  for (const value of values) {
    const key = normalizeSearchText(value).trim();
    if (!key) continue;
    if (!normalized.has(key)) normalized.set(key, value);
  }

  return normalized.size === 1 ? normalized.values().next().value : undefined;
}

function allSameMoney(values: Money[]): boolean {
  if (values.length < 2) return true;
  const first = values[0];
  return values.every(
    (value) =>
      value.currency === first?.currency &&
      value.amount === first?.amount
  );
}

function isShippingLabel(value: string): boolean {
  const normalized = normalizeSearchText(value).replace(/:+$/g, "").trim();
  return normalized === "versand" || normalized === "shipping";
}

function readBrand(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object") {
    return readString((value as JsonRecord).name);
  }
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

function objectList(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is JsonRecord => !!entry && typeof entry === "object"
    );
  }
  return value && typeof value === "object" ? [value as JsonRecord] : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMeta(document: Document, selector: string): string | undefined {
  const element = document.querySelector<HTMLMetaElement>(selector);
  return element?.content?.trim() || undefined;
}

function readContent(document: Document, selector: string): string | undefined {
  return document.querySelector(selector)?.getAttribute("content")?.trim() || undefined;
}

function readText(document: Document, selector: string): string | undefined {
  return readTextFrom(document.querySelector(selector));
}

function readTextFrom(element: Element | null): string | undefined {
  return element?.textContent?.trim() || undefined;
}

function cleanTradeIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : undefined;
}

function cleanTextIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  if (
    /^(?:n\/?a|none|unknown|nicht\s+zutreffend|does\s+not\s+apply)$/i.test(cleaned)
  ) {
    return undefined;
  }
  return cleaned;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
