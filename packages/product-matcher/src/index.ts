// ---------------------------------------------------------------------------
// product-matcher — public API
// ---------------------------------------------------------------------------

export type {
  ProductIdentifiers,
  ExtractedSpecs,
  CanonicalProduct,
  ScoreBreakdown,
  MatchWeights,
} from './types';

export { DEFAULT_MATCH_WEIGHTS, resolveWeights } from './weights';
export type { KnownCategorySlug } from './weights';

export {
  normalizeProductTitle,
  ABBREVIATION_MAP,
  PRODUCT_STOP_WORDS,
} from './text-normalizer';

export {
  normalizeCpu,
  normalizeGpu,
  normalizeResolution,
  normalizeSpecForComparison,
} from './spec-normalizer';

export { computeTitleSimilarity, computeSpecOverlap } from './fuzzy-matcher';

export { computeCompositeScore } from './composite-matcher';
export type { CompositeScoreParams } from './composite-matcher';

export { matchByIdentifier } from './identifier-matcher';
export { matchByModelNumber } from './model-number-matcher';

export { findCandidates } from './blocking';
export type { BlockingInput } from './blocking';

// ---------------------------------------------------------------------------
// High-level orchestrator
// ---------------------------------------------------------------------------

import { matchByIdentifier } from './identifier-matcher';
import { matchByModelNumber } from './model-number-matcher';
import { computeTitleSimilarity, computeSpecOverlap } from './fuzzy-matcher';
import { computeCompositeScore } from './composite-matcher';
import { resolveWeights } from './weights';
import type { CanonicalProduct, ExtractedSpecs, ScoreBreakdown } from './types';

/** A listing (an offer from one store) being matched against the catalog. */
export interface MatchListingInput {
  /** Listing title — ideally already run through {@link normalizeProductTitle}. */
  normalizedTitle: string;
  /** Detected brand, if any. */
  brand?: string | null;
  /** Category slug — picks which weight profile is used. */
  categorySlug?: string | null;
  /** Structured identifiers parsed from the listing (UPC/EAN/ASIN/MPN). */
  identifiers?: Record<string, string>;
  /** Extracted technical specs (CPU/GPU/RAM/...). */
  specs?: ExtractedSpecs;
  /** Base / full model strings parsed from the title. */
  modelBase?: string | null;
  modelFull?: string | null;
}

/** A catalog product, optionally carrying the fields the fuzzy scorers can use. */
export interface MatchCandidate extends CanonicalProduct {
  normalizedName?: string;
  specs?: ExtractedSpecs;
}

export type MatchDecision = 'auto_match' | 'review' | 'new_product';

export interface MatchOutcome {
  /** The matched product's id — `null` when the decision is `new_product`. */
  productId: string | null;
  /** Composite score in [0, 1] for the chosen candidate. */
  score: number;
  decision: MatchDecision;
  /** Per-dimension breakdown — `null` for an identifier short-circuit / no candidates. */
  breakdown: ScoreBreakdown | null;
  /** How the decision was reached: `'identifier'`, `'composite'`, or `'no-candidates'`. */
  reason: string;
}

export interface MatchThresholds {
  /** Score `>=` this → `auto_match`. Default `0.85`. */
  autoMatch?: number;
  /** Score `>=` this (and `< autoMatch`) → `review`. Default `0.6`. */
  review?: number;
}

/**
 * End-to-end match of one listing against a set of candidate canonical products.
 *
 * Strategy — first decisive signal wins:
 *   1. **Exact identifier match** (UPC/EAN/ASIN/MPN) → `auto_match`, score `1`.
 *   2. Otherwise, score every candidate on model / brand / title / specs, combine
 *      with the category-specific weights, and keep the best.
 *   3. Map the best score to a decision via the thresholds.
 *
 * `candidates` is expected to already be a *blocked* shortlist — call
 * {@link findCandidates} (or your own SQL pre-filter) first on large catalogs.
 */
export function matchProduct(
  listing: MatchListingInput,
  candidates: MatchCandidate[],
  thresholds: MatchThresholds = {},
): MatchOutcome {
  const autoMatch = thresholds.autoMatch ?? 0.85;
  const review = thresholds.review ?? 0.6;
  const weights = resolveWeights(listing.categorySlug ?? null);

  // 1. Identifier short-circuit — the strongest possible signal.
  if (listing.identifiers && Object.keys(listing.identifiers).length > 0) {
    const hit = matchByIdentifier(listing.identifiers, candidates);
    if (hit) {
      return {
        productId: hit.id,
        score: 1,
        decision: 'auto_match',
        breakdown: null,
        reason: 'identifier',
      };
    }
  }

  if (candidates.length === 0) {
    return {
      productId: null,
      score: 0,
      decision: 'new_product',
      breakdown: null,
      reason: 'no-candidates',
    };
  }

  // 2. Score every candidate on the fuzzy dimensions.
  const modelHit = matchByModelNumber(
    listing.modelBase ?? null,
    listing.modelFull ?? null,
    listing.brand ?? null,
    candidates,
  );

  let best: { productId: string; score: number; breakdown: ScoreBreakdown } | null = null;
  const listingBrand = listing.brand?.trim().toLowerCase() ?? null;

  for (const candidate of candidates) {
    const modelScore =
      modelHit && modelHit.product.id === candidate.id ? modelHit.score : 0;

    const candidateBrand = candidate.brand?.trim().toLowerCase() ?? null;
    const brandScore =
      listingBrand && candidateBrand && listingBrand === candidateBrand ? 1 : 0;

    const titleScore = candidate.normalizedName
      ? computeTitleSimilarity(listing.normalizedTitle, candidate.normalizedName)
      : 0;

    const specScore =
      listing.specs && candidate.specs
        ? computeSpecOverlap(listing.specs, candidate.specs)
        : 0;

    const { score, breakdown } = computeCompositeScore({
      modelScore,
      brandScore,
      specScore,
      titleScore,
      embedScore: 0,
      categoryScore: listing.categorySlug ? 1 : 0,
      weights,
    });

    if (!best || score > best.score) {
      best = { productId: candidate.id, score, breakdown };
    }
  }

  // `best` is non-null here because `candidates.length > 0`.
  const { productId, score, breakdown } = best!;
  const decision: MatchDecision =
    score >= autoMatch ? 'auto_match' : score >= review ? 'review' : 'new_product';

  return {
    productId: decision === 'new_product' ? null : productId,
    score,
    decision,
    breakdown,
    reason: 'composite',
  };
}