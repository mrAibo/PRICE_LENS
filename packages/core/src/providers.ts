import type {
  ComparisonResult,
  EcommerceListing,
  ListingCondition,
  MarketOffer,
  Money,
  PriceProviderId,
  ProductIdentity,
  ProviderStatus
} from "@price-lens/contracts";
import {calculateLandedPrice, createComparisonResult} from "./index.js";
import {evaluateProviderCandidate} from "./matching.js";

export interface ProviderCandidate {
  provider: PriceProviderId;
  providerProductId?: string;
  productTitle: string;
  merchant?: string;
  url: string;
  condition: ListingCondition;
  identity: ProductIdentity;
  itemPrice: Money;
  shipping?: Money;
  fetchedAt: string;
}

export interface ProviderSearchInput {
  listing: EcommerceListing;
  signal?: AbortSignal;
}

export interface PriceProvider {
  readonly id: PriceProviderId;
  search(input: ProviderSearchInput): Promise<ProviderCandidate[]>;
}

export interface ProviderOrchestratorOptions {
  timeoutMs?: number;
  requestId?: string;
}

export async function compareWithProviders(
  listing: EcommerceListing,
  providers: PriceProvider[],
  options: ProviderOrchestratorOptions = {}
): Promise<ComparisonResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const results = await Promise.all(
    providers.map((provider) => runProvider(provider, listing, timeoutMs))
  );

  const offers = results.flatMap((result) => result.offers);
  const statuses = results.map((result) => result.status);

  return createComparisonResult(listing, offers, statuses, options.requestId);
}

async function runProvider(
  provider: PriceProvider,
  listing: EcommerceListing,
  timeoutMs: number
): Promise<{offers: MarketOffer[]; status: ProviderStatus}> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const candidates = await withTimeout(
      provider.search({listing, signal: controller.signal}),
      timeoutMs,
      provider.id
    );

    const accepted: MarketOffer[] = [];
    let reviewCount = 0;

    for (const candidate of candidates) {
      if (candidate.provider !== provider.id) {
        continue;
      }

      const match = evaluateProviderCandidate(listing, candidate);
      if (match.decision === "review") {
        reviewCount += 1;
        continue;
      }
      if (match.decision !== "auto_match") {
        continue;
      }

      const landed = calculateLandedPrice(candidate.itemPrice, candidate.shipping);
      accepted.push({
        provider: provider.id,
        providerProductId: candidate.providerProductId,
        productTitle: candidate.productTitle,
        merchant: candidate.merchant,
        url: candidate.url,
        condition: candidate.condition,
        itemPrice: candidate.itemPrice,
        shipping: candidate.shipping,
        landedPrice: landed.value,
        landedPriceComplete: landed.complete,
        confidence: match.confidence,
        matchMethod: match.method,
        matchReason: match.reason,
        fetchedAt: candidate.fetchedAt
      });
    }

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
            : `${accepted.length} automatic match(es).`
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
          : "No candidate passed the automatic match threshold."
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
