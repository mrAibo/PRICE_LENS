import type {
  EcommerceListing,
  ListingCondition,
  MatchMethod,
  ProductIdentity,
  ProductVariant
} from "@price-lens/contracts";
import {
  matchProduct,
  normalizeProductTitle,
  type ExtractedSpecs,
  type MatchCandidate
} from "product-matcher";
import type {ProviderCandidate} from "./providers.js";

export type PriceLensMatchDecision = "auto_match" | "review" | "reject";

export interface PriceLensMatchResult {
  decision: PriceLensMatchDecision;
  confidence: number;
  method: MatchMethod;
  reason: string;
}

export const PRICE_LENS_MATCH_THRESHOLDS = {
  autoMatch: 0.9,
  review: 0.7
} as const;

export function evaluateProviderCandidate(
  listing: EcommerceListing,
  candidate: ProviderCandidate
): PriceLensMatchResult {
  const hardMismatch = findHardMismatch(
    listing.condition,
    listing.identity,
    candidate.condition,
    candidate.identity
  );

  if (hardMismatch) {
    return {
      decision: "reject",
      confidence: 0,
      method: "unknown",
      reason: hardMismatch
    };
  }

  const titleVariantMismatch = findTitleVariantMismatch(
    listing.title,
    candidate.productTitle,
    listing.identity.model,
    candidate.identity.model
  );
  if (titleVariantMismatch) {
    return {
      decision: "reject",
      confidence: 0,
      method: "unknown",
      reason: titleVariantMismatch
    };
  }

  if (hasExactTradeItemIdentifier(listing.identity, candidate.identity)) {
    return {
      decision: "auto_match",
      confidence: 1,
      method: "gtin",
      reason: "Exact GTIN/EAN/UPC match."
    };
  }

  if (hasExactBrandMpn(listing.identity, candidate.identity)) {
    return {
      decision: "auto_match",
      confidence: 1,
      method: "mpn",
      reason: "Exact brand + MPN match."
    };
  }

  const productCandidate: MatchCandidate = {
    id: candidate.providerProductId ?? candidate.url,
    brand: candidate.identity.brand ?? null,
    model: candidate.identity.model ?? null,
    identifiers: matcherIdentifiers(candidate.identity),
    normalizedName: normalizeProductTitle(candidate.productTitle),
    specs: matcherSpecs(candidate.identity)
  };

  const outcome = matchProduct(
    {
      normalizedTitle: normalizeProductTitle(listing.title),
      brand: listing.identity.brand ?? null,
      identifiers: matcherIdentifiers(listing.identity),
      modelBase: listing.identity.model ?? null,
      modelFull: listing.identity.model ?? null,
      specs: matcherSpecs(listing.identity)
    },
    [productCandidate],
    PRICE_LENS_MATCH_THRESHOLDS
  );

  if (outcome.decision === "auto_match") {
    return {
      decision: "auto_match",
      confidence: outcome.score,
      method: outcome.reason === "identifier" ? "gtin" : "fuzzy",
      reason: outcome.reason === "identifier"
        ? "Exact normalized product identifier match."
        : "Product matcher composite score passed the automatic threshold."
    };
  }

  if (outcome.decision === "review") {
    return {
      decision: "review",
      confidence: outcome.score,
      method: "fuzzy",
      reason: "Product matcher score requires review."
    };
  }

  return {
    decision: "reject",
    confidence: outcome.score,
    method: "fuzzy",
    reason: "Product matcher score is below the review threshold."
  };
}

export function findHardMismatch(
  listingCondition: ListingCondition,
  listingIdentity: ProductIdentity,
  candidateCondition: ListingCondition,
  candidateIdentity: ProductIdentity
): string | undefined {
  if (
    listingCondition !== "unknown" &&
    candidateCondition !== "unknown" &&
    listingCondition !== candidateCondition
  ) {
    return `Condition mismatch: ${listingCondition} vs ${candidateCondition}.`;
  }

  const listingBrand = normalizeToken(listingIdentity.brand);
  const candidateBrand = normalizeToken(candidateIdentity.brand);
  if (listingBrand && candidateBrand && listingBrand !== candidateBrand) {
    return "Brand mismatch.";
  }

  const listingGtins = canonicalTradeItemIdentifiers(listingIdentity);
  const candidateGtins = canonicalTradeItemIdentifiers(candidateIdentity);
  if (
    listingGtins.size > 0 &&
    candidateGtins.size > 0 &&
    !setsIntersect(listingGtins, candidateGtins)
  ) {
    return "Conflicting GTIN/EAN/UPC identifiers.";
  }

  const listingMpn = normalizeToken(listingIdentity.mpn);
  const candidateMpn = normalizeToken(candidateIdentity.mpn);
  if (listingMpn && candidateMpn && listingMpn !== candidateMpn) {
    return "Conflicting manufacturer part numbers.";
  }

  const variantMismatch = findVariantMismatch(
    listingIdentity.variant,
    candidateIdentity.variant
  );
  if (variantMismatch) return variantMismatch;

  return undefined;
}

function findVariantMismatch(
  listing: ProductVariant | undefined,
  candidate: ProductVariant | undefined
): string | undefined {
  if (!listing || !candidate) return undefined;

  if (
    listing.storageGb !== undefined &&
    candidate.storageGb !== undefined &&
    listing.storageGb !== candidate.storageGb
  ) {
    return `Storage capacity mismatch: ${listing.storageGb} GB vs ${candidate.storageGb} GB.`;
  }

  if (
    listing.ramGb !== undefined &&
    candidate.ramGb !== undefined &&
    listing.ramGb !== candidate.ramGb
  ) {
    return `RAM mismatch: ${listing.ramGb} GB vs ${candidate.ramGb} GB.`;
  }

  if (
    listing.screenSizeInches !== undefined &&
    candidate.screenSizeInches !== undefined &&
    Math.abs(listing.screenSizeInches - candidate.screenSizeInches) > 0.05
  ) {
    return `Screen-size mismatch: ${listing.screenSizeInches} in vs ${candidate.screenSizeInches} in.`;
  }

  if (
    listing.packCount !== undefined &&
    candidate.packCount !== undefined &&
    listing.packCount !== candidate.packCount
  ) {
    return `Pack-count mismatch: ${listing.packCount} vs ${candidate.packCount}.`;
  }

  const listingEdition = normalizeToken(listing.edition);
  const candidateEdition = normalizeToken(candidate.edition);
  if (
    listingEdition &&
    candidateEdition &&
    listingEdition !== candidateEdition
  ) {
    return `Edition mismatch: ${listing.edition} vs ${candidate.edition}.`;
  }

  const listingQualifier = normalizeToken(listing.modelQualifier);
  const candidateQualifier = normalizeToken(candidate.modelQualifier);
  if (
    listingQualifier &&
    candidateQualifier &&
    listingQualifier !== candidateQualifier
  ) {
    return `Model qualifier mismatch: ${listing.modelQualifier} vs ${candidate.modelQualifier}.`;
  }

  if (
    listing.bundleIncluded !== undefined &&
    candidate.bundleIncluded !== undefined &&
    listing.bundleIncluded !== candidate.bundleIncluded
  ) {
    return `Bundle-state mismatch: ${listing.bundleIncluded ? "bundle" : "standalone"} vs ${candidate.bundleIncluded ? "bundle" : "standalone"}.`;
  }

  return undefined;
}

function findTitleVariantMismatch(
  listingTitle: string,
  candidateTitle: string,
  listingModel: string | undefined,
  candidateModel: string | undefined
): string | undefined {
  const listingEdition = editionSignal(listingTitle);
  const candidateEdition = editionSignal(candidateTitle);
  if (
    listingEdition &&
    candidateEdition &&
    listingEdition !== candidateEdition
  ) {
    return `Edition mismatch from titles: ${listingEdition} vs ${candidateEdition}.`;
  }

  const listingBundle = bundleSignal(listingTitle);
  const candidateBundle = bundleSignal(candidateTitle);
  if (
    listingBundle &&
    candidateBundle &&
    listingBundle !== candidateBundle
  ) {
    return `Bundle mismatch from titles: ${listingBundle} vs ${candidateBundle}.`;
  }

  const modelMismatch = findModelQualifierOrGenerationMismatch(
    listingModel,
    candidateModel
  );
  if (modelMismatch) return modelMismatch;

  return undefined;
}

function editionSignal(value: string): string | undefined {
  const normalized = normalizeWords(value);
  const patterns: Array<[RegExp, string]> = [
    [/\bdigital edition\b|\bdigital ausgabe\b/, "digital"],
    [/\bdisc edition\b|\bdisk edition\b|\bdisc version\b/, "disc"],
    [/\bstandard edition\b|\bstandard ausgabe\b/, "standard"],
    [/\bcollector s edition\b|\bcollectors edition\b|\bsammleredition\b/, "collector"],
    [/\blimited edition\b|\blimitierte ausgabe\b/, "limited"],
    [/\bdeluxe edition\b/, "deluxe"],
    [/\bultimate edition\b/, "ultimate"]
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(normalized)) return label;
  }
  return undefined;
}

function bundleSignal(value: string): "bundle" | "standalone" | undefined {
  const normalized = normalizeWords(value);

  if (
    /\bbody only\b|\bnur gehause\b|\bconsole only\b|\bnur konsole\b|\bwithout accessories\b|\bohne zubehor\b|\bdevice only\b|\bnur gerat\b/.test(
      normalized
    )
  ) {
    return "standalone";
  }

  if (
    /\bbundle\b|\bkit\b|\binklusive (?:controller|spiel|game|objektiv|lens|tasche|case)\b/.test(
      normalized
    )
  ) {
    return "bundle";
  }

  return undefined;
}

function findModelQualifierOrGenerationMismatch(
  listingModel: string | undefined,
  candidateModel: string | undefined
): string | undefined {
  if (!listingModel || !candidateModel) return undefined;

  const left = modelShape(listingModel);
  const right = modelShape(candidateModel);

  if (
    left.base &&
    right.base &&
    left.base === right.base &&
    left.qualifiers.join(",") !== right.qualifiers.join(",") &&
    (left.qualifiers.length > 0 || right.qualifiers.length > 0)
  ) {
    return `Model qualifier mismatch: ${listingModel} vs ${candidateModel}.`;
  }

  const leftGeneration = trailingGeneration(listingModel);
  const rightGeneration = trailingGeneration(candidateModel);
  if (
    leftGeneration &&
    rightGeneration &&
    leftGeneration.prefix === rightGeneration.prefix &&
    leftGeneration.suffix === rightGeneration.suffix &&
    leftGeneration.generation !== rightGeneration.generation
  ) {
    return `Model generation mismatch: ${listingModel} vs ${candidateModel}.`;
  }

  return undefined;
}

const MODEL_QUALIFIERS = new Set([
  "air",
  "fe",
  "lite",
  "max",
  "mini",
  "plus",
  "pro",
  "se",
  "slim",
  "ultra",
  "xl"
]);

function modelShape(value: string): {base: string; qualifiers: string[]} {
  const tokens = normalizeWords(value).split(" ").filter(Boolean);
  const qualifiers = [...new Set(tokens.filter((token) => MODEL_QUALIFIERS.has(token)))].sort();
  const base = tokens.filter((token) => !MODEL_QUALIFIERS.has(token)).join("");
  return {base, qualifiers};
}

function trailingGeneration(
  value: string
): {prefix: string; generation: string; suffix: string} | undefined {
  const compact = normalizeToken(value);
  if (!compact) return undefined;

  const match = compact.match(/^(.{4,}?)(\d+)([a-z]*)$/);
  if (!match?.[1] || !match[2]) return undefined;

  return {
    prefix: match[1],
    generation: match[2],
    suffix: match[3] ?? ""
  };
}

function matcherSpecs(identity: ProductIdentity): ExtractedSpecs | undefined {
  const variant = identity.variant;
  if (
    !variant ||
    (
      variant.ramGb === undefined &&
      variant.storageGb === undefined &&
      variant.screenSizeInches === undefined
    )
  ) {
    return undefined;
  }

  return {
    brand: identity.brand ?? null,
    modelBase: identity.model ?? null,
    modelFull: identity.model ?? null,
    cpu: null,
    gpu: null,
    ramGb: variant.ramGb ?? null,
    storageGb: variant.storageGb ?? null,
    storageType: null,
    screenSize: variant.screenSizeInches ?? null,
    resolution: null,
    os: null,
    remainingTokens: []
  };
}

function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExactTradeItemIdentifier(
  left: ProductIdentity,
  right: ProductIdentity
): boolean {
  const a = canonicalTradeItemIdentifiers(left);
  const b = canonicalTradeItemIdentifiers(right);
  return a.size > 0 && b.size > 0 && setsIntersect(a, b);
}

function hasExactBrandMpn(left: ProductIdentity, right: ProductIdentity): boolean {
  const leftBrand = normalizeToken(left.brand);
  const rightBrand = normalizeToken(right.brand);
  const leftMpn = normalizeToken(left.mpn);
  const rightMpn = normalizeToken(right.mpn);

  return !!(
    leftBrand &&
    rightBrand &&
    leftBrand === rightBrand &&
    leftMpn &&
    rightMpn &&
    leftMpn === rightMpn
  );
}

function canonicalTradeItemIdentifiers(identity: ProductIdentity): Set<string> {
  const result = new Set<string>();

  for (const raw of [identity.gtin, identity.ean, identity.upc]) {
    const digits = raw?.replace(/\D/g, "");
    if (!digits) continue;

    result.add(digits);

    if (digits.length === 12) {
      result.add(`0${digits}`);
    } else if (digits.length === 13 && digits.startsWith("0")) {
      result.add(digits.slice(1));
    }
  }

  return result;
}

function matcherIdentifiers(identity: ProductIdentity): Record<string, string> {
  const identifiers: Record<string, string> = {};
  const gtin = identity.gtin?.replace(/\D/g, "");
  const ean = identity.ean?.replace(/\D/g, "");
  const upc = identity.upc?.replace(/\D/g, "");

  if (ean) identifiers.ean = ean;
  if (upc) identifiers.upc = upc;
  if (gtin?.length === 13) identifiers.ean ??= gtin;
  if (gtin?.length === 12) identifiers.upc ??= gtin;

  return identifiers;
}

function normalizeToken(value: string | undefined): string | undefined {
  const normalized = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return normalized || undefined;
}

function setsIntersect(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}
