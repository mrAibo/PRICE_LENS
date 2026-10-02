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

export interface ProductIdentity {
  brand?: string;
  model?: string;
  mpn?: string;
  gtin?: string;
  ean?: string;
  upc?: string;
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

export type PriceProviderId = "idealo" | "geizhals" | "amazon";
export type MatchMethod = "gtin" | "mpn" | "model" | "fuzzy" | "manual" | "unknown";

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

export interface ProviderStatus {
  provider: PriceProviderId;
  state: ProviderState;
  message?: string;
  latencyMs?: number;
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
