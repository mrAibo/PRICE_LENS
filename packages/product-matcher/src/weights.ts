import type { MatchWeights } from './types';

/**
 * Default match weights per category slug.
 *
 * Each row sums to 1.0. Tune these to your catalog: e.g. peripherals are
 * mostly identified by their title (few structured specs), while components
 * lean heavily on the model number and the spec sheet.
 *
 * `embed` is reserved for embedding similarity and left at 0 until you wire it.
 */
export const DEFAULT_MATCH_WEIGHTS = {
  laptops: {
    model: 0.35, brand: 0.15, specs: 0.25,
    title: 0.20, embed: 0, category: 0.05,
  },
  components: {
    model: 0.40, brand: 0.15, specs: 0.30,
    title: 0.10, embed: 0, category: 0.05,
  },
  peripherals: {
    model: 0.30, brand: 0.15, specs: 0.15,
    title: 0.35, embed: 0, category: 0.05,
  },
  smartphones: {
    model: 0.40, brand: 0.20, specs: 0.15,
    title: 0.15, embed: 0, category: 0.10,
  },
  monitores: {
    model: 0.30, brand: 0.15, specs: 0.30,
    title: 0.15, embed: 0, category: 0.10,
  },
  desktops: {
    model: 0.30, brand: 0.15, specs: 0.30,
    title: 0.20, embed: 0, category: 0.05,
  },
} as const;

export type KnownCategorySlug = keyof typeof DEFAULT_MATCH_WEIGHTS;

/**
 * Resolve the match weights for a category slug, falling back to the `laptops`
 * profile for `null` or unknown categories. Returns a fresh mutable copy so
 * callers can override individual weights without mutating the defaults.
 */
export function resolveWeights(categorySlug: string | null): MatchWeights {
  if (!categorySlug) {
    return { ...DEFAULT_MATCH_WEIGHTS.laptops };
  }
  const slug = categorySlug.toLowerCase();
  if (slug in DEFAULT_MATCH_WEIGHTS) {
    return { ...DEFAULT_MATCH_WEIGHTS[slug as KnownCategorySlug] };
  }
  return { ...DEFAULT_MATCH_WEIGHTS.laptops };
}