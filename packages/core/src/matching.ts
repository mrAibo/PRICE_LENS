import type {
  EcommerceListing,
  ListingCondition,
  MatchMethod,
  ProductIdentity
} from "@price-lens/contracts";
import {
  matchProduct,
  normalizeProductTitle,
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
    normalizedName: normalizeProductTitle(candidate.productTitle)
  };

  const outcome = matchProduct(
    {
      normalizedTitle: normalizeProductTitle(listing.title),
      brand: listing.identity.brand ?? null,
      identifiers: matcherIdentifiers(listing.identity),
      modelBase: listing.identity.model ?? null,
      modelFull: listing.identity.model ?? null
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

  return undefined;
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
