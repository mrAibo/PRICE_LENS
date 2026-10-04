import type {
  BuyerDestination,
  ComparisonDelta,
  ComparisonResult,
  EcommerceListing,
  LandedCostStatus,
  MarketOffer,
  Money,
  PriceProviderId,
  ProviderStatus
} from "@price-lens/contracts";

export interface LandedPriceResult {
  value: Money;
  complete: boolean;
}

export interface LandedCostAssessment {
  complete: boolean;
  status: LandedCostStatus;
}

const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK"
]);

export function assessLandedCost(
  shippingComplete: boolean,
  originCountry: string | undefined,
  destination: BuyerDestination | undefined,
  importChargesIncluded = false
): LandedCostAssessment {
  if (!shippingComplete) {
    return {complete: false, status: "shipping_unknown"};
  }
  if (!destination) {
    return {complete: true, status: "complete"};
  }

  const destinationCountry = normalizeCountryCode(destination.country);
  if (!destinationCountry) {
    throw new Error(
      "Buyer destination country must be a two-letter ISO country code."
    );
  }

  const origin = normalizeCountryCode(originCountry);
  if (!origin) {
    return {complete: true, status: "origin_unknown"};
  }
  if (origin === destinationCountry) {
    return {complete: true, status: "complete"};
  }
  if (
    EU_COUNTRY_CODES.has(origin) &&
    EU_COUNTRY_CODES.has(destinationCountry)
  ) {
    return {complete: true, status: "complete"};
  }
  if (importChargesIncluded) {
    return {complete: true, status: "complete"};
  }
  return {complete: false, status: "import_costs_unknown"};
}

export function assessLandedCostStatus(
  shippingComplete: boolean,
  originCountry: string | undefined,
  destination: BuyerDestination | undefined,
  importChargesIncluded = false
): LandedCostStatus {
  return assessLandedCost(
    shippingComplete,
    originCountry,
    destination,
    importChargesIncluded
  ).status;
}


export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export function normalizeLookupTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function strongestIdentifier(listing: EcommerceListing): string | undefined {
  const identity = listing.identity;
  if (identity.gtin) return `gtin:${identity.gtin}`;
  if (identity.ean) return `ean:${identity.ean}`;
  if (identity.upc) return `upc:${identity.upc}`;
  if (identity.mpn && identity.brand) {
    return `mpn:${identity.brand.toLowerCase()}:${identity.mpn.toLowerCase()}`;
  }
  if (identity.model && identity.brand) {
    return `model:${identity.brand.toLowerCase()}:${identity.model.toLowerCase()}`;
  }
  return undefined;
}

export function buildLookupFingerprint(listing: EcommerceListing): string {
  return strongestIdentifier(listing) ?? `title:${normalizeLookupTitle(listing.title)}`;
}

export function calculateLandedPrice(itemPrice: Money, shipping?: Money): LandedPriceResult {
  const currency = normalizeCurrency(itemPrice.currency);
  if (!Number.isFinite(itemPrice.amount) || itemPrice.amount < 0) {
    throw new Error("Item price must be a finite non-negative number");
  }

  if (!shipping) {
    return {value: {amount: roundMoney(itemPrice.amount), currency}, complete: false};
  }

  if (normalizeCurrency(shipping.currency) !== currency) {
    throw new Error("Item price and shipping currency must match");
  }
  if (!Number.isFinite(shipping.amount) || shipping.amount < 0) {
    throw new Error("Shipping price must be a finite non-negative number");
  }

  return {
    value: {amount: roundMoney(itemPrice.amount + shipping.amount), currency},
    complete: true
  };
}

export function calculateDelta(ebay: Money, market: Money): ComparisonDelta {
  const ebayCurrency = normalizeCurrency(ebay.currency);
  const marketCurrency = normalizeCurrency(market.currency);
  if (ebayCurrency !== marketCurrency) {
    throw new Error("Cannot compare prices in different currencies");
  }
  if (market.amount <= 0) {
    throw new Error("Market comparison price must be greater than zero");
  }

  const absolute = roundMoney(ebay.amount - market.amount);
  return {
    absolute: {amount: absolute, currency: ebayCurrency},
    percentage: roundPercent((absolute / market.amount) * 100)
  };
}

export function comparableLandedPrice(
  offer: MarketOffer,
  comparisonCurrency?: string
): Money | undefined {
  if (
    !offer.landedPriceComplete ||
    offer.landedCostStatus === "origin_unknown" ||
    offer.landedCostStatus === "import_costs_unknown"
  ) {
    return undefined;
  }

  if (!comparisonCurrency) return offer.landedPrice;
  const normalizedComparisonCurrency = normalizeCurrency(comparisonCurrency);

  if (
    offer.comparisonLandedPrice &&
    normalizeCurrency(offer.comparisonLandedPrice.currency) ===
      normalizedComparisonCurrency
  ) {
    return offer.comparisonLandedPrice;
  }

  if (
    normalizeCurrency(offer.landedPrice.currency) ===
    normalizedComparisonCurrency
  ) {
    return offer.landedPrice;
  }

  return undefined;
}

export function selectBestOffer(
  offers: MarketOffer[],
  comparisonCurrency?: string
): MarketOffer | undefined {
  return offers
    .map((offer) => ({
      offer,
      price: comparableLandedPrice(offer, comparisonCurrency)
    }))
    .filter(
      (entry): entry is {offer: MarketOffer; price: Money} =>
        entry.price !== undefined &&
        Number.isFinite(entry.price.amount) &&
        entry.price.amount >= 0
    )
    .sort((a, b) => a.price.amount - b.price.amount)[0]
    ?.offer;
}

export function createComparisonResult(
  listing: EcommerceListing,
  offers: MarketOffer[],
  providerStatus: ProviderStatus[],
  requestId = createRequestId(),
  additionalWarnings: string[] = [],
  destination?: BuyerDestination
): ComparisonResult {
  const ebay = calculateLandedPrice(listing.price, listing.shipping);
  const ebayLandedCost = assessLandedCost(
    ebay.complete,
    listing.itemLocationCountry,
    destination
  );
  const bestOffer = selectBestOffer(
    offers.filter(
      (offer) =>
        offer.provider !== "ebay_market" ||
        listing.condition === "unknown" ||
        offer.condition === listing.condition
    ),
    ebay.value.currency
  );
  const warnings = [...listing.extractionWarnings, ...additionalWarnings];

  if (ebayLandedCost.status === "shipping_unknown") {
    warnings.push("eBay shipping is unknown; landed price is incomplete.");
  } else if (ebayLandedCost.status === "origin_unknown") {
    warnings.push(
      "eBay item origin is unknown; import costs cannot be verified for the selected destination."
    );
  } else if (ebayLandedCost.status === "import_costs_unknown") {
    warnings.push(
      "eBay item ships across a customs boundary; import VAT, duties or handling fees are not confirmed."
    );
  }

  if (!bestOffer) {
    return {
      requestId,
      listing,
      ebayLandedPrice: ebay.value,
      ebayLandedPriceComplete: ebayLandedCost.complete,
    ebayLandedCostStatus: ebayLandedCost.status,
      offers,
      providerStatus,
      warnings,
      generatedAt: new Date().toISOString()
    };
  }

  const bestComparablePrice = comparableLandedPrice(
    bestOffer,
    ebay.value.currency
  );
  const delta =
    ebayLandedCost.complete && bestComparablePrice
      ? calculateDelta(ebay.value, bestComparablePrice)
      : undefined;

  return {
    requestId,
    listing,
    ebayLandedPrice: ebay.value,
    ebayLandedPriceComplete: ebayLandedCost.complete,
      ebayLandedCostStatus: ebayLandedCost.status,
    offers,
    bestOffer,
    marketMinimum: bestComparablePrice,
    delta,
    providerStatus,
    warnings,
    generatedAt: new Date().toISOString()
  };
}

export function createComparisonShell(
  listing: EcommerceListing,
  requestId?: string
): ComparisonResult {
  const providers: PriceProviderId[] = ["idealo", "geizhals", "amazon"];
  const statuses: ProviderStatus[] = providers.map((provider) => ({
    provider,
    state: "unconfigured",
    message: "Provider adapter is not configured in the bootstrap build."
  }));
  return createComparisonResult(listing, [], statuses, requestId);
}

function normalizeCountryCode(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

