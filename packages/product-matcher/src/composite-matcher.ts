import type { MatchWeights, ScoreBreakdown } from './types';
import { DEFAULT_MATCH_WEIGHTS, resolveWeights } from './weights';

// Re-exported for convenience: `import { resolveWeights } from 'product-matcher'`.
export { resolveWeights, DEFAULT_MATCH_WEIGHTS };

/**
 * Parameters for computing a composite match score.
 */
export interface CompositeScoreParams {
  modelScore: number;
  brandScore: number;
  specScore: number;
  titleScore: number;
  embedScore: number;
  categoryScore: number;
  /** Weight overrides keyed by dimension name (model, brand, specs, title, embed, category). */
  weights: MatchWeights;
}

/**
 * Map of score param keys to the weight keys used in DEFAULT_MATCH_WEIGHTS.
 */
const SCORE_TO_WEIGHT_KEY: Record<string, string> = {
  modelScore: 'model',
  brandScore: 'brand',
  specScore: 'specs',
  titleScore: 'title',
  embedScore: 'embed',
  categoryScore: 'category',
};

/**
 * Compute a weighted composite match score from individual dimension scores.
 *
 * Each dimension score (0-1) is multiplied by its corresponding weight.
 * The weights are normalized so they sum to 1.0, ensuring the final score
 * is also in the 0-1 range.
 *
 * Weights come from the provided `weights` param, which can be category-specific
 * overrides or the DEFAULT_MATCH_WEIGHTS.
 *
 * @param params - Individual scores and the weight configuration
 * @returns The composite score and a detailed breakdown
 */
export function computeCompositeScore(
  params: CompositeScoreParams,
): { score: number; breakdown: ScoreBreakdown } {
  const { modelScore, brandScore, specScore, titleScore, embedScore, categoryScore, weights } = params;

  const scores: Record<string, number> = {
    modelScore,
    brandScore,
    specScore,
    titleScore,
    embedScore,
    categoryScore,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [scoreKey, scoreValue] of Object.entries(scores)) {
    const weightKey = SCORE_TO_WEIGHT_KEY[scoreKey];
    const weight = weights[weightKey] ?? 0;
    weightedSum += scoreValue * weight;
    totalWeight += weight;
  }

  // Normalize if weights do not sum to 1
  const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const breakdown: ScoreBreakdown = {
    modelScore,
    brandScore,
    specScore,
    titleScore,
    embedScore,
    categoryScore,
    weights,
  };

  return { score, breakdown };
}