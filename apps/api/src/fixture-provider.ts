import type {PriceProvider} from "@price-lens/core";

export interface FixtureProviderOptions {
  discountRatio?: number;
}

export function createFixtureProvider(
  options: FixtureProviderOptions = {}
): PriceProvider {
  const discountRatio = clampDiscount(options.discountRatio ?? 0.08);

  return {
    id: "fixture",

    async search({listing, signal}) {
      if (signal?.aborted) {
        throw new Error("Fixture provider request was aborted.");
      }

      const fixtureAmount = roundMoney(
        Math.max(0.01, listing.price.amount * (1 - discountRatio))
      );

      return [{
        provider: "fixture",
        providerProductId: `fixture:${listing.itemId}`,
        productTitle: listing.title,
        merchant: "PriceLens Fixture Shop",
        url: `https://example.invalid/price-lens-fixture/${encodeURIComponent(listing.itemId)}`,
        condition: listing.condition,
        identity: {...listing.identity},
        itemPrice: {
          amount: fixtureAmount,
          currency: listing.price.currency
        },
        shipping: {
          amount: 0,
          currency: listing.price.currency
        },
        fetchedAt: new Date().toISOString()
      }];
    }
  };
}

function clampDiscount(value: number): number {
  if (!Number.isFinite(value)) return 0.08;
  return Math.min(Math.max(value, 0), 0.5);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
