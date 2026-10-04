import type {
  BuyerDestination,
  ComparisonResult,
  EcommerceListing,
  ListingCondition,
  MarketOffer,
  DeliveryWindow,
  Money,
  PriceProviderId,
  ProductIdentity,
  ReturnPolicySummary,
  SellerAccountType,
  ProviderReviewCandidate,
  ProviderStatus
} from "@price-lens/contracts";
import {
  assessLandedCost,
  calculateLandedPrice,
  createComparisonResult
} from "./comparison.js";
import {evaluateProviderCandidate} from "./matching.js";

export interface ProviderCandidate {
  provider: PriceProviderId;
  providerProductId?: string;
  productTitle: string;
  merchant?: string;
  marketplace?: string;
  itemLocationCountry?: string;
  importChargesIncluded?: boolean;
  sellerFeedbackPercentage?: number;
  sellerFeedbackScore?: number;
  sellerAccountType?: SellerAccountType;
  deliveryWindow?: DeliveryWindow;
  returnPolicy?: ReturnPolicySummary;
  url: string;
  condition: ListingCondition;
  identity: ProductIdentity;
  itemPrice: Money;
  shipping?: Money;
  fetchedAt: string;
}

export interface ProviderSearchInput {
  listing: EcommerceListing;
  destination?: BuyerDestination;
  signal?: AbortSignal;
}

export interface AcceptedCandidateEnrichmentInput extends ProviderSearchInput {
  candidates: ProviderCandidate[];
}

export interface PriceProvider {
  readonly id: PriceProviderId;
  readonly matchAcrossConditions?: boolean;
  search(input: ProviderSearchInput): Promise<ProviderCandidate[]>;
  enrichAcceptedCandidates?(
    input: AcceptedCandidateEnrichmentInput
  ): Promise<ProviderCandidate[]>;
}

export function limitProviderConcurrency(
  provider: PriceProvider,
  maxConcurrent: number
): PriceProvider {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent must be a positive integer.");
  }

  let active = 0;

  async function withSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      throw new Error(
        `${provider.id} provider concurrency limit reached (${maxConcurrent}).`
      );
    }

    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
    }
  }

  const limited: PriceProvider = {
    id: provider.id,
    matchAcrossConditions: provider.matchAcrossConditions,
    search(input) {
      return withSlot(() => provider.search(input));
    }
  };

  if (provider.enrichAcceptedCandidates) {
    limited.enrichAcceptedCandidates = (input) =>
      withSlot(() => provider.enrichAcceptedCandidates!(input));
  }

  return limited;
}

export interface OfferNormalizationResult {
  offers: MarketOffer[];
  warnings?: string[];
}

export type OfferNormalizer = (
  listing: EcommerceListing,
  offers: MarketOffer[]
) => Promise<OfferNormalizationResult>;

export interface ProviderOrchestratorOptions {
  timeoutMs?: number;
  requestId?: string;
  normalizeOffers?: OfferNormalizer;
  destination?: BuyerDestination;
  restrictedProviders?: readonly PriceProviderId[];
}

export async function compareWithProviders(
  listing: EcommerceListing,
  providers: PriceProvider[],
  options: ProviderOrchestratorOptions = {}
): Promise<ComparisonResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const restrictedProviders = new Set(options.restrictedProviders ?? []);
  const activeProviders = providers.filter(
    (provider) => !restrictedProviders.has(provider.id)
  );
  const results = await Promise.all(
    activeProviders.map((provider) =>
      runProvider(
        provider,
        listing,
        timeoutMs,
        options.destination
      )
    )
  );

  const rawOffers = results.flatMap((result) => result.offers);
  let offers = rawOffers;
  let normalizationWarnings: string[] = [];

  if (options.normalizeOffers && rawOffers.length > 0) {
    try {
      const normalized = await options.normalizeOffers(listing, rawOffers);
      offers = normalized.offers;
      normalizationWarnings = normalized.warnings ?? [];
    } catch {
      normalizationWarnings = [
        "Currency normalization is unavailable; cross-currency offers were not ranked."
      ];
    }
  }

  const statusByProvider = new Map(
    results.map((result) => [result.status.provider, result.status] as const)
  );
  const allProviderIds = new Set<PriceProviderId>([
    "idealo",
    "geizhals",
    "amazon",
    ...providers.map((provider) => provider.id),
    ...restrictedProviders
  ]);

  const statuses: ProviderStatus[] = [...allProviderIds].map((provider) => {
    if (restrictedProviders.has(provider)) {
      return {
        provider,
        state: "restricted",
        message: "This source is currently available only in the PriceLens private beta."
      };
    }

    return statusByProvider.get(provider) ?? {
      provider,
      state: "unconfigured",
      message: "Provider adapter is not configured."
    };
  });

  return createComparisonResult(
    listing,
    offers,
    statuses,
    options.requestId,
    normalizationWarnings,
    options.destination
  );
}

async function runProvider(
  provider: PriceProvider,
  listing: EcommerceListing,
  timeoutMs: number,
  destination?: BuyerDestination
): Promise<{offers: MarketOffer[]; status: ProviderStatus}> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const candidates = await withTimeout(
      provider.search({
        listing,
        destination,
        signal: controller.signal
      }),
      timeoutMs,
      provider.id
    );

    const acceptedMatches: Array<{
      candidate: ProviderCandidate;
      match: ReturnType<typeof evaluateProviderCandidate>;
    }> = [];
    const reviewCandidates: ProviderReviewCandidate[] = [];
    let reviewCount = 0;

    for (const candidate of candidates) {
      if (candidate.provider !== provider.id) {
        continue;
      }

      const match = evaluateProviderCandidate(listing, candidate, {
        ignoreCondition: provider.matchAcrossConditions === true
      });
      if (match.decision === "review") {
        reviewCount += 1;
        if (reviewCandidates.length < 10) {
          reviewCandidates.push({
            providerProductId: candidate.providerProductId,
            productTitle: candidate.productTitle,
            confidence: match.confidence,
            matchMethod: match.method,
            reason: match.reason
          });
        }
        continue;
      }
      if (match.decision !== "auto_match") {
        continue;
      }

      acceptedMatches.push({candidate, match});
    }

    let acceptedCandidates = acceptedMatches.map(({candidate}) => candidate);
    if (
      provider.enrichAcceptedCandidates &&
      acceptedCandidates.length > 0
    ) {
      const elapsed = Date.now() - started;
      const remainingMs = timeoutMs - elapsed;
      if (remainingMs > 0) {
        try {
          const enriched = await withTimeout(
            provider.enrichAcceptedCandidates({
              listing,
              destination,
              signal: controller.signal,
              candidates: acceptedCandidates
            }),
            remainingMs,
            provider.id
          );
          if (
            acceptedCandidateEnrichmentIsValid(
              acceptedCandidates,
              enriched,
              provider.id
            )
          ) {
            acceptedCandidates = enriched;
          }
        } catch {
          // Optional post-match metadata must never discard valid price offers.
        }
      }
    }

    const accepted: MarketOffer[] = acceptedMatches.map(({match}, index) => {
      const candidate = acceptedCandidates[index]!;
      const landed = calculateLandedPrice(candidate.itemPrice, candidate.shipping);
      const landedCost = assessLandedCost(
        landed.complete,
        candidate.itemLocationCountry,
        destination,
        candidate.importChargesIncluded
      );
      return {
        provider: provider.id,
        providerProductId: candidate.providerProductId,
        productTitle: candidate.productTitle,
        merchant: candidate.merchant,
        marketplace: candidate.marketplace,
        itemLocationCountry: candidate.itemLocationCountry,
        sellerFeedbackPercentage: candidate.sellerFeedbackPercentage,
        sellerFeedbackScore: candidate.sellerFeedbackScore,
        sellerAccountType: candidate.sellerAccountType,
        deliveryWindow: candidate.deliveryWindow,
        returnPolicy: candidate.returnPolicy,
        url: candidate.url,
        condition: candidate.condition,
        itemPrice: candidate.itemPrice,
        shipping: candidate.shipping,
        landedPrice: landed.value,
        landedPriceComplete: landedCost.complete,
        landedCostStatus: landedCost.status,
        confidence: match.confidence,
        matchMethod: match.method,
        matchReason: match.reason,
        fetchedAt: candidate.fetchedAt
      };
    });

    const latencyMs = Date.now() - started;
    if (accepted.length > 0) {
      return {
        offers: accepted,
        status: {
          provider: provider.id,
          state: "ok",
          latencyMs,
          message: reviewCount > 0
            ? `${accepted.length} automatic match(es); ${reviewCount} candidate(s) require review.`
            : `${accepted.length} automatic match(es).`,
          reviewCandidates: reviewCandidates.length > 0 ? reviewCandidates : undefined
        }
      };
    }

    return {
      offers: [],
      status: {
        provider: provider.id,
        state: "no_match",
        latencyMs,
        message: reviewCount > 0
          ? `${reviewCount} candidate(s) require review; none were auto-matched.`
          : "No candidate passed the automatic match threshold.",
        reviewCandidates: reviewCandidates.length > 0 ? reviewCandidates : undefined
      }
    };
  } catch (error) {
    return {
      offers: [],
      status: {
        provider: provider.id,
        state: "error",
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "Provider failed."
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function acceptedCandidateEnrichmentIsValid(
  original: ProviderCandidate[],
  enriched: ProviderCandidate[],
  provider: PriceProviderId
): boolean {
  return (
    enriched.length === original.length &&
    enriched.every((candidate, index) => {
      const base = original[index];
      return (
        base !== undefined &&
        candidate.provider === provider &&
        candidate.providerProductId === base.providerProductId &&
        candidate.url === base.url
      );
    })
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  provider: PriceProviderId
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${provider} provider timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
