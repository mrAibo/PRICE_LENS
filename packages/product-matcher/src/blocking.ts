import type { CanonicalProduct } from './types';

/**
 * Minimum information needed to find candidate products for a listing.
 */
export interface BlockingInput {
  brand: string | null;
  categorySlug: string | null;
  normalizedTitle: string;
}

const MAX_CANDIDATES = 50;
const MIN_RESULTS_THRESHOLD = 5;

const lc = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * "Blocking" narrows a (potentially huge) catalog down to a small candidate
 * set that's worth scoring in detail — instead of comparing a listing against
 * every product, you compare it against ~50.
 *
 * This in-memory implementation mirrors the three-level strategy used in
 * production (where levels 1–2 are pushed into SQL and only the survivors are
 * loaded into memory):
 *
 *   - **Level 1** — exact brand + category match (most selective).
 *   - **Level 2** — same brand, and the listing's model prefix appears in the
 *     product's normalized name.
 *   - **Fallback** — token overlap on the normalized name, used only if
 *     levels 1–2 together yield fewer than 5 candidates.
 *
 * Returns up to 50 candidates, de-duplicated, in priority order.
 *
 * @param listing  - Brand, category slug and normalized title of the listing
 * @param products - The catalog to search (only `id` + the fields above are used)
 */
export function findCandidates<T extends CanonicalProduct>(
  listing: BlockingInput,
  products: T[],
): T[] {
  const { brand, categorySlug, normalizedTitle } = listing;
  const active = products.filter((p) => p.isActive !== false);
  const candidates = new Map<string, T>();

  // --- Level 1: brand + category filter ---
  if (brand || categorySlug) {
    for (const p of active) {
      if (candidates.size >= MAX_CANDIDATES) break;
      if (brand && lc(p.brand) !== lc(brand)) continue;
      if (categorySlug && lc(p.categorySlug) !== lc(categorySlug)) continue;
      candidates.set(p.id, p);
    }
  }

  // --- Level 2: brand + model-prefix search in normalized name ---
  if (brand && candidates.size < MAX_CANDIDATES) {
    const titleTokens = normalizedTitle.split(/\s+/).filter((t) => t.length > 2);
    const modelPrefix = lc(titleTokens.slice(0, 3).join(' '));
    if (modelPrefix) {
      for (const p of active) {
        if (candidates.size >= MAX_CANDIDATES) break;
        if (candidates.has(p.id)) continue;
        if (lc(p.brand) !== lc(brand)) continue;
        if (!lc(p.normalizedName).includes(modelPrefix)) continue;
        candidates.set(p.id, p);
      }
    }
  }

  // --- Fallback: token overlap on normalized name ---
  if (candidates.size < MIN_RESULTS_THRESHOLD) {
    const searchTokens = normalizedTitle
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 5)
      .map((t) => t.toLowerCase());
    if (searchTokens.length > 0) {
      for (const p of active) {
        if (candidates.size >= MAX_CANDIDATES) break;
        if (candidates.has(p.id)) continue;
        const name = lc(p.normalizedName);
        if (searchTokens.some((t) => name.includes(t))) {
          candidates.set(p.id, p);
        }
      }
    }
  }

  return Array.from(candidates.values());
}