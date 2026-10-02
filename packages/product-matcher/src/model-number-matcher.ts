import type { CanonicalProduct } from './types';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a listing to a canonical product based on model-number comparison.
 *
 * Scoring:
 *  - Exact full model match (case-insensitive) = 1.0
 *  - Exact base model match (case-insensitive) = 0.85
 *  - Word-boundary base model contained in product model = 0.80
 *
 * Brand is checked when available: if both the listing and product have a brand
 * and they do not match (case-insensitive), the candidate is skipped.
 *
 * The base-model containment check uses a word-boundary regex (not `String#includes`)
 * so a short base model like `"15"` does not falsely match `"IdeaPad 512"`.
 *
 * @param modelBase - The base/line model name (e.g. `"IdeaPad"`)
 * @param modelFull - The full model string (e.g. `"IdeaPad 5 15ALC05"`)
 * @param brand     - The detected brand (e.g. `"lenovo"`)
 * @param products  - Candidate canonical products
 * @returns The best match with its score, or `null` if no model was extracted / nothing matched
 */
export function matchByModelNumber<T extends CanonicalProduct>(
  modelBase: string | null,
  modelFull: string | null,
  brand: string | null,
  products: T[],
): { product: T; score: number } | null {
  // Cannot match without at least one model identifier
  if (!modelBase && !modelFull) {
    return null;
  }

  const normalizedModelFull = modelFull?.trim().toLowerCase() ?? null;
  const normalizedModelBase = modelBase?.trim().toLowerCase() ?? null;
  const normalizedBrand = brand?.trim().toLowerCase() ?? null;

  // Pre-build word-boundary regex for base model (avoids substring false positives)
  const baseModelRe = normalizedModelBase
    ? new RegExp(`\\b${escapeRegex(normalizedModelBase)}\\b`)
    : null;

  let bestMatch: { product: T; score: number } | null = null;

  for (const product of products) {
    const productModel = product.model?.trim().toLowerCase() ?? null;
    if (!productModel) {
      continue;
    }

    // If both have brands, they must match
    const productBrand = product.brand?.trim().toLowerCase() ?? null;
    if (normalizedBrand && productBrand && normalizedBrand !== productBrand) {
      continue;
    }

    // Exact full model match -> score 1.0
    if (normalizedModelFull && productModel === normalizedModelFull) {
      return { product, score: 1.0 };
    }

    // Exact base model match -> score 0.85
    if (
      normalizedModelBase &&
      productModel === normalizedModelBase &&
      (!bestMatch || bestMatch.score < 0.85)
    ) {
      bestMatch = { product, score: 0.85 };
    }

    // Word-boundary base model contained in product model -> score 0.80
    if (
      baseModelRe &&
      baseModelRe.test(productModel) &&
      (!bestMatch || bestMatch.score < 0.80)
    ) {
      bestMatch = { product, score: 0.80 };
    }
  }

  return bestMatch;
}