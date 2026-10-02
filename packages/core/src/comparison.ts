import type {
  ComparisonDelta,
  ComparisonResult,
  EcommerceListing,
  MarketOffer,
  Money,
  PriceProviderId,
  ProviderStatus,
  WarningCode
} from "@price-lens/contracts";

export interface LandedPriceResult {
  value: Money;
  complete: boolean;
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

export function selectBestOffer(offers: MarketOffer[]): MarketOffer | undefined {
  return offers
    .filter((offer) =>
      offer.landedPriceComplete &&
      Number.isFinite(offer.landedPrice.amount) &&
      offer.landedPrice.amount >= 0
    )
    .slice()
    .sort((a, b) => a.landedPrice.amount - b.landedPrice.amount)[0];
}

export function createComparisonResult(
  listing: EcommerceListing,
  offers: MarketOffer[],
  providerStatus: ProviderStatus[],
  requestId = createRequestId()
): ComparisonResult {
  const ebay = calculateLandedPrice(listing.price, listing.shipping);
  const bestOffer = selectBestOffer(offers);
  const warnings = [...listing.extractionWarnings];
  const warningCodes = new Set<WarningCode>(
    listing.extractionWarningCodes ?? []
  );

  if (!ebay.complete) {
    warnings.push("eBay shipping is unknown; landed price is incomplete.");
    warningCodes.add("ebay_shipping_unknown");
  }

  if (offers.some((offer) => !offer.landedPriceComplete)) {
    warnings.push(
      "One or more market offers have unknown mandatory shipping; their landed prices are incomplete."
    );
    warningCodes.add("market_shipping_incomplete");
  }

  if (!bestOffer) {
    return {
      requestId,
      listing,
      ebayLandedPrice: ebay.value,
      ebayLandedPriceComplete: ebay.complete,
      offers,
      providerStatus,
      warnings,
      warningCodes: [...warningCodes],
      generatedAt: new Date().toISOString()
    };
  }

  const delta = ebay.complete ? calculateDelta(ebay.value, bestOffer.landedPrice) : undefined;

  return {
    requestId,
    listing,
    ebayLandedPrice: ebay.value,
    ebayLandedPriceComplete: ebay.complete,
    offers,
    bestOffer,
    marketMinimum: bestOffer.landedPrice,
    delta,
    providerStatus,
    warnings,
    warningCodes: [...warningCodes],
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

