import * as fuzzball from 'fuzzball';
import type { ExtractedSpecs } from './types';
import { normalizeSpecForComparison } from './spec-normalizer';

/**
 * Compute a title similarity score between two product titles
 * using fuzzball's token_set_ratio algorithm.
 *
 * token_set_ratio is ideal for product titles because it handles
 * reordered tokens and differing lengths gracefully.
 *
 * @param titleA - First product title (or normalized title)
 * @param titleB - Second product title (or normalized title)
 * @returns Similarity score between 0 and 1
 */
export function computeTitleSimilarity(
  titleA: string,
  titleB: string,
): number {
  if (!titleA || !titleB) {
    return 0;
  }

  // fuzzball.token_set_ratio returns 0-100
  const score = fuzzball.token_set_ratio(
    titleA.toLowerCase(),
    titleB.toLowerCase(),
  );

  return score / 100;
}

/**
 * Spec fields with weights for overlap calculation.
 * Higher weight = more distinguishing for product identity.
 *
 * CPU + RAM + Storage are the strongest signals (a laptop is defined by these).
 * GPU and screenSize are secondary differentiators.
 * OS and storageType rarely differ between the same product across stores.
 */
const WEIGHTED_SPEC_FIELDS: Array<{ field: keyof ExtractedSpecs; weight: number }> = [
  { field: 'cpu', weight: 3 },
  { field: 'ramGb', weight: 3 },
  { field: 'storageGb', weight: 2.5 },
  { field: 'gpu', weight: 2 },
  { field: 'screenSize', weight: 1.5 },
  { field: 'storageType', weight: 0.5 },
  { field: 'resolution', weight: 1 },
  { field: 'os', weight: 0.5 },
];

/**
 * Compute a weighted overlap score between two ExtractedSpecs objects.
 *
 * Uses normalized canonical forms for string fields (CPU, GPU, resolution, OS)
 * so that "Intel Core i7-13700H" matches "i7 13700H".
 *
 * Applies weighted scoring: critical specs (CPU, RAM) contribute more
 * than secondary specs (OS, storageType).
 *
 * @param specsA - First set of extracted specs
 * @param specsB - Second set of extracted specs
 * @returns Overlap score between 0 and 1 (0 if no comparable fields exist)
 */
export function computeSpecOverlap(
  specsA: ExtractedSpecs,
  specsB: ExtractedSpecs,
): number {
  let weightedMatch = 0;
  let totalWeight = 0;

  for (const { field, weight } of WEIGHTED_SPEC_FIELDS) {
    const valA = specsA[field] as string | number | null;
    const valB = specsB[field] as string | number | null;

    // Both null — field is irrelevant, skip entirely (no penalty)
    if (valA == null && valB == null) {
      continue;
    }

    // One side has data, the other doesn't — partial penalty instead of full
    // This prevents unfairly punishing products with incomplete spec extraction
    if (valA == null || valB == null) {
      totalWeight += weight * 0.3;
      continue;
    }

    // Both present — full weight, compare canonical forms
    totalWeight += weight;

    const normA = normalizeSpecForComparison(field, valA);
    const normB = normalizeSpecForComparison(field, valB);

    if (normA && normB && normA === normB) {
      weightedMatch += weight;
    }
  }

  if (totalWeight === 0) {
    return 0;
  }

  return weightedMatch / totalWeight;
}