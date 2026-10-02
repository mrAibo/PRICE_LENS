// ---------------------------------------------------------------------------
// Shared types for the product matcher
// ---------------------------------------------------------------------------

/**
 * Standard structured identifiers that uniquely (or near-uniquely) pin a
 * product across stores. All optional — most listings carry at most one.
 */
export interface ProductIdentifiers {
  /** Universal Product Code (12 digits, North America). */
  upc?: string;
  /** International Article Number (13 digits, EU/global). */
  ean?: string;
  /** Amazon Standard Identification Number. */
  asin?: string;
  /** Manufacturer Part Number. */
  mpn?: string;
}

/**
 * Technical specs extracted from a product title / attributes.
 * `null` means "not found", which is treated differently from "found and empty".
 */
export interface ExtractedSpecs {
  brand: string | null;
  /** Product line, e.g. "VivoBook", "IdeaPad". */
  modelBase: string | null;
  /** Full model code, e.g. "VivoBook 15 X1502ZA-EJ789W". */
  modelFull: string | null;
  cpu: string | null;
  gpu: string | null;
  ramGb: number | null;
  storageGb: number | null;
  storageType: string | null;
  /** Screen size in inches. */
  screenSize: number | null;
  resolution: string | null;
  os: string | null;
  /** Tokens left over after structured extraction (useful for fuzzy fallback). */
  remainingTokens: string[];
}

/**
 * A canonical product in your catalog — the thing listings get matched *to*.
 *
 * This is intentionally a structural, framework-agnostic shape: pass your own
 * entity / row / DTO as long as it carries these fields. Only `id` is required.
 */
export interface CanonicalProduct {
  id: string;
  brand?: string | null;
  /** Stored model string, e.g. "IdeaPad 3 15ITL6". */
  model?: string | null;
  /** Structured identifiers (UPC/EAN/ASIN/MPN). */
  identifiers?: Record<string, string | undefined> | ProductIdentifiers | null;
  /** Normalized name used by the in-memory blocking pass. */
  normalizedName?: string;
  /** Category slug used by the in-memory blocking pass. */
  categorySlug?: string | null;
  /** Active flag; `false` excludes the product from blocking. Default: included. */
  isActive?: boolean;
}

/**
 * Per-dimension scores and the weights used to combine them.
 */
export interface ScoreBreakdown {
  modelScore: number;
  brandScore: number;
  specScore: number;
  titleScore: number;
  /** Embedding / vector similarity score. Reserved — `0` until you wire embeddings. */
  embedScore: number;
  categoryScore: number;
  weights: Record<string, number>;
}

/** Weight map keyed by dimension: `model`, `brand`, `specs`, `title`, `embed`, `category`. */
export type MatchWeights = Record<string, number>;