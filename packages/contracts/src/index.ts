export type CurrencyCode = "EUR" | string;

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export type ListingCondition =
  | "new"
  | "used"
  | "refurbished"
  | "open_box"
  | "unknown";

export interface ProductVariant {
  storageGb?: number;
  ramGb?: number;
  screenSizeInches?: number;
  packCount?: number;
  edition?: string;
  modelQualifier?: string;
  bundleIncluded?: boolean;
}

export interface ProductIdentity {
  brand?: string;
  model?: string;
  mpn?: string;
  gtin?: string;
  ean?: string;
  upc?: string;
  variant?: ProductVariant;
}

export interface EcommerceListing {
  source: "ebay";
  itemId: string;
  url: string;
  title: string;
  price: Money;
  shipping?: Money;
  condition: ListingCondition;
  identity: ProductIdentity;
  imageUrl?: string;
  extractionEvidence: string[];
  extractionWarnings: string[];
}

export type PriceProviderId = "idealo" | "geizhals" | "amazon" | "fixture";
export type MatchMethod = "gtin" | "mpn" | "model" | "fuzzy" | "manual" | "unknown";
export type MatchDecision = "auto_match" | "review" | "reject";

export type MatchReasonCode =
  | "condition_mismatch"
  | "brand_mismatch"
  | "identifier_conflict"
  | "mpn_conflict"
  | "storage_mismatch"
  | "ram_mismatch"
  | "screen_size_mismatch"
  | "pack_count_mismatch"
  | "edition_mismatch"
  | "model_qualifier_mismatch"
  | "bundle_mismatch"
  | "model_generation_mismatch"
  | "exact_trade_identifier"
  | "exact_brand_mpn"
  | "normalized_identifier"
  | "composite_auto"
  | "composite_review"
  | "below_review_threshold";

export interface ProviderMatchDiagnostics {
  candidateCount: number;
  decisionCounts: Record<MatchDecision, number>;
  reasonCounts: Partial<Record<MatchReasonCode, number>>;
}

export interface MarketOffer {
  provider: PriceProviderId;
  providerProductId?: string;
  productTitle: string;
  merchant?: string;
  url: string;
  condition: ListingCondition;
  itemPrice: Money;
  shipping?: Money;
  landedPrice: Money;
  landedPriceComplete: boolean;
  confidence: number;
  matchMethod: MatchMethod;
  matchReason: string;
  fetchedAt: string;
}

export type ProviderState = "ok" | "unconfigured" | "unavailable" | "no_match" | "error";

export interface ProviderReviewCandidate {
  providerProductId?: string;
  productTitle: string;
  confidence: number;
  matchMethod: MatchMethod;
  reason: string;
}

export interface ProviderStatus {
  provider: PriceProviderId;
  state: ProviderState;
  message?: string;
  latencyMs?: number;
  reviewCandidates?: ProviderReviewCandidate[];
  matchDiagnostics?: ProviderMatchDiagnostics;
}

export interface ComparisonDelta {
  absolute: Money;
  percentage: number;
}

export interface ComparisonResult {
  requestId: string;
  listing: EcommerceListing;
  ebayLandedPrice: Money;
  ebayLandedPriceComplete: boolean;
  offers: MarketOffer[];
  bestOffer?: MarketOffer;
  marketMinimum?: Money;
  delta?: ComparisonDelta;
  providerStatus: ProviderStatus[];
  warnings: string[];
  generatedAt: string;
}

export interface ComparisonRequest {
  listing: EcommerceListing;
}
