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

export interface BuyerDestination {
  country: string;
  postalCode?: string;
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

export type PriceProviderId =
  | "ebay_market"
  | "idealo"
  | "geizhals"
  | "amazon"
  | "fixture";
export type MatchMethod = "gtin" | "mpn" | "model" | "fuzzy" | "manual" | "unknown";

export interface FxConversion {
  source: "ecb_reference";
  rateDate: string;
  fetchedAt: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
}

export interface MarketOffer {
  provider: PriceProviderId;
  providerProductId?: string;
  productTitle: string;
  merchant?: string;
  marketplace?: string;
  itemLocationCountry?: string;
  sellerFeedbackPercentage?: number;
  sellerFeedbackScore?: number;
  url: string;
  condition: ListingCondition;
  itemPrice: Money;
  shipping?: Money;
  landedPrice: Money;
  landedPriceComplete: boolean;
  comparisonLandedPrice?: Money;
  fx?: FxConversion;
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
  destination?: BuyerDestination;
}
