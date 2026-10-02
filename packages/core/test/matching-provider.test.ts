import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {
  compareWithProviders,
  evaluateProviderCandidate,
  type PriceProvider,
  type ProviderCandidate
} from "../src/index.js";

const listing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Sony WH-1000XM6 Wireless Headphones Black",
  price: {amount: 349, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {
    brand: "Sony",
    model: "WH-1000XM6",
    mpn: "WH1000XM6B",
    gtin: "4548736162657"
  },
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

function candidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    provider: "idealo",
    providerProductId: "sony-xm6",
    productTitle: "Sony WH-1000XM6 Black",
    merchant: "Example Shop",
    url: "https://example.test/sony-xm6",
    condition: "new",
    identity: {
      brand: "Sony",
      model: "WH-1000XM6",
      mpn: "WH1000XM6B",
      ean: "4548736162657"
    },
    itemPrice: {amount: 329, currency: "EUR"},
    shipping: {amount: 4.99, currency: "EUR"},
    fetchedAt: "2026-10-02T00:00:00Z",
    ...overrides
  };
}

describe("PriceLens matching guard", () => {
  it("auto-matches an exact GTIN/EAN identity", () => {
    expect(evaluateProviderCandidate(listing, candidate())).toMatchObject({
      decision: "auto_match",
      confidence: 1,
      method: "gtin"
    });
  });

  it("rejects a conflicting strong identifier before fuzzy scoring", () => {
    const result = evaluateProviderCandidate(
      listing,
      candidate({
        identity: {
          brand: "Sony",
          model: "WH-1000XM6",
          mpn: "WH1000XM6B",
          ean: "0000000000000"
        }
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("Conflicting GTIN");
  });

  it("rejects new-versus-used even with identical identifiers", () => {
    const result = evaluateProviderCandidate(
      listing,
      candidate({condition: "used"})
    );

    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("Condition mismatch");
  });

  it("accepts exact MPN only with a compatible brand", () => {
    const withoutGtin = {
      ...listing,
      identity: {
        brand: "Sony",
        model: "WH-1000XM6",
        mpn: "WH1000XM6B"
      }
    };

    expect(
      evaluateProviderCandidate(
        withoutGtin,
        candidate({
          identity: {
            brand: "Sony",
            model: "WH-1000XM6",
            mpn: "WH1000XM6B"
          }
        })
      )
    ).toMatchObject({
      decision: "auto_match",
      method: "mpn",
      confidence: 1
    });
  });
});

describe("provider orchestration", () => {
  it("converts only automatic matches into comparable market offers", async () => {
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        return [
          candidate(),
          candidate({
            providerProductId: "wrong-condition",
            condition: "used",
            itemPrice: {amount: 100, currency: "EUR"}
          })
        ];
      }
    };

    const result = await compareWithProviders(listing, [provider], {
      requestId: "req-provider-test"
    });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.providerProductId).toBe("sony-xm6");
    expect(result.offers[0]?.landedPrice.amount).toBe(333.99);
    expect(result.bestOffer?.provider).toBe("idealo");
    expect(result.providerStatus[0]?.state).toBe("ok");
  });

  it("isolates provider failures", async () => {
    const broken: PriceProvider = {
      id: "geizhals",
      async search() {
        throw new Error("fixture provider unavailable");
      }
    };

    const result = await compareWithProviders(listing, [broken], {
      requestId: "req-provider-error"
    });

    expect(result.offers).toHaveLength(0);
    expect(
      result.providerStatus.find((status) => status.provider === "geizhals")
    ).toMatchObject({
      provider: "geizhals",
      state: "error"
    });
    expect(
      result.providerStatus.find((status) => status.provider === "idealo")
    ).toMatchObject({
      provider: "idealo",
      state: "unconfigured"
    });
  });
});
