import {describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {
  compareWithProviders,
  evaluateProviderCandidate,
  limitProviderConcurrency,
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

  it.each([
    ["storage", {storageGb: 512}, "Storage capacity mismatch"],
    ["RAM", {ramGb: 32}, "RAM mismatch"],
    ["screen size", {screenSizeInches: 15.7}, "Screen-size mismatch"],
    ["pack count", {packCount: 2}, "Pack-count mismatch"]
  ])(
    "rejects a %s variant conflict even when the strong product identifier matches",
    (_label, conflictingVariant, expectedReason) => {
      const source = {
        ...listing,
        identity: {
          ...listing.identity,
          variant: {
            storageGb: 256,
            ramGb: 16,
            screenSizeInches: 15.6,
            packCount: 1
          }
        }
      };

      const result = evaluateProviderCandidate(
        source,
        candidate({
          identity: {
            brand: "Sony",
            model: "WH-1000XM6",
            mpn: "WH1000XM6B",
            ean: "4548736162657",
            variant: {
              storageGb: 256,
              ramGb: 16,
              screenSizeInches: 15.6,
              packCount: 1,
              ...conflictingVariant
            }
          }
        })
      );

      expect(result.decision).toBe("reject");
      expect(result.reason).toContain(expectedReason);
    }
  );

  it.each([
    ["edition", {edition: "Digital Edition"}, {edition: "Disc Edition"}, "Edition mismatch"],
    ["model qualifier", {modelQualifier: "CFI-2016A"}, {modelQualifier: "CFI-2016B"}, "Model qualifier mismatch"],
    ["bundle state", {bundleIncluded: false}, {bundleIncluded: true}, "Bundle-state mismatch"]
  ])(
    "rejects an explicit %s conflict before an exact identifier match",
    (_label, sourceVariant, candidateVariant, expectedReason) => {
      const source = {
        ...listing,
        identity: {
          ...listing.identity,
          variant: sourceVariant
        }
      };

      const result = evaluateProviderCandidate(
        source,
        candidate({
          identity: {
            ...candidate().identity,
            variant: candidateVariant
          }
        })
      );

      expect(result.decision).toBe("reject");
      expect(result.reason).toContain(expectedReason);
    }
  );

  it("rejects conflicting explicit edition signals in titles", () => {
    const source = {
      ...listing,
      title: "Sony PlayStation 5 Digital Edition",
      identity: {
        ...listing.identity,
        model: "PlayStation 5"
      }
    };

    const result = evaluateProviderCandidate(
      source,
      candidate({
        productTitle: "Sony PlayStation 5 Disc Edition",
        identity: {
          ...candidate().identity,
          model: "PlayStation 5"
        }
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("Edition mismatch from titles");
  });

  it("rejects explicit standalone-versus-kit bundle signals", () => {
    const source = {
      ...listing,
      title: "Canon EOS R6 Body Only",
      identity: {
        ...listing.identity,
        brand: "Canon",
        model: "EOS R6"
      }
    };

    const result = evaluateProviderCandidate(
      source,
      candidate({
        productTitle: "Canon EOS R6 24-105 Kit",
        identity: {
          ...candidate().identity,
          brand: "Canon",
          model: "EOS R6"
        }
      })
    );

    expect(result.decision).toBe("reject");
    expect(result.reason).toContain("Bundle mismatch from titles");
  });

  it.each([
    ["known qualifier", "iPhone 16 Pro", "iPhone 16 Pro Max", "Model qualifier mismatch"],
    ["numeric generation", "WH-1000XM6", "WH-1000XM5", "Model generation mismatch"]
  ])(
    "rejects a %s model conflict before an exact identifier match",
    (_label, sourceModel, candidateModel, expectedReason) => {
      const source = {
        ...listing,
        identity: {
          ...listing.identity,
          model: sourceModel
        }
      };

      const result = evaluateProviderCandidate(
        source,
        candidate({
          identity: {
            ...candidate().identity,
            model: candidateModel
          }
        })
      );

      expect(result.decision).toBe("reject");
      expect(result.reason).toContain(expectedReason);
    }
  );

  it("uses matching structured specs to make the 0.90 auto threshold reachable", () => {
    const source: EcommerceListing = {
      ...listing,
      title: "ExampleTech Pro 15",
      identity: {
        brand: "ExampleTech",
        model: "Pro 15",
        variant: {
          storageGb: 1000,
          ramGb: 16,
          screenSizeInches: 15.6
        }
      }
    };

    const result = evaluateProviderCandidate(
      source,
      candidate({
        productTitle: "ExampleTech Pro 15",
        identity: {
          brand: "ExampleTech",
          model: "Pro 15",
          variant: {
            storageGb: 1000,
            ramGb: 16,
            screenSizeInches: 15.6
          }
        }
      })
    );

    expect(result.decision).toBe("auto_match");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.method).toBe("fuzzy");
  });

  it("keeps an otherwise identical unstructured match at the 0.70 review boundary", () => {
    const source: EcommerceListing = {
      ...listing,
      title: "ExampleTech Pro 15",
      identity: {
        brand: "ExampleTech",
        model: "Pro 15"
      }
    };

    const result = evaluateProviderCandidate(
      source,
      candidate({
        productTitle: "ExampleTech Pro 15",
        identity: {
          brand: "ExampleTech",
          model: "Pro 15"
        }
      })
    );

    expect(result.decision).toBe("review");
    expect(result.confidence).toBeCloseTo(0.7, 5);
  });

  it("does not reject when variant data is missing on one side", () => {
    const source = {
      ...listing,
      identity: {
        ...listing.identity,
        variant: {
          storageGb: 256,
          ramGb: 16
        }
      }
    };

    const result = evaluateProviderCandidate(source, candidate());

    expect(result).toMatchObject({
      decision: "auto_match",
      confidence: 1,
      method: "gtin"
    });
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

describe("provider concurrency limits", () => {
  it("rejects provider work immediately when the concurrency cap is reached", async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let callCount = 0;
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        callCount += 1;
        if (callCount === 1) {
          markStarted();
          await firstPending;
        }
        return [];
      }
    };

    const limited = limitProviderConcurrency(provider, 1);
    const first = limited.search({listing});
    await firstStarted;

    await expect(limited.search({listing})).rejects.toThrow(
      "idealo provider concurrency limit reached (1)"
    );

    releaseFirst();
    await expect(first).resolves.toEqual([]);
    await expect(limited.search({listing})).resolves.toEqual([]);
  });

  it.each([0, -1, 1.5])(
    "rejects invalid provider concurrency limit %s",
    (limit) => {
      const provider: PriceProvider = {
        id: "idealo",
        async search() {
          return [];
        }
      };

      expect(() => limitProviderConcurrency(provider, limit)).toThrow(
        "maxConcurrent must be a positive integer"
      );
    }
  );
});

describe("provider orchestration", () => {
  it("does not call providers that are restricted by server-owned access policy", async () => {
    let idealoCalls = 0;
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        idealoCalls += 1;
        return [candidate()];
      }
    };

    const result = await compareWithProviders(listing, [provider], {
      restrictedProviders: ["idealo"]
    });

    expect(idealoCalls).toBe(0);
    expect(result.offers).toEqual([]);
    expect(
      result.providerStatus.find((status) => status.provider === "idealo")
    ).toMatchObject({
      state: "restricted"
    });
  });

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

  it("exposes bounded review-candidate diagnostics", async () => {
    const source: EcommerceListing = {
      ...listing,
      title: "ExampleTech Pro 15",
      identity: {
        brand: "ExampleTech",
        model: "Pro 15"
      }
    };

    const reviewCandidate = candidate({
      providerProductId: "review-example",
      productTitle: "ExampleTech Pro 15",
      identity: {
        brand: "ExampleTech",
        model: "Pro 15"
      }
    });

    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        return [reviewCandidate];
      }
    };

    const result = await compareWithProviders(source, [provider], {
      requestId: "req-review-diagnostics"
    });

    expect(result.offers).toHaveLength(0);
    expect(result.providerStatus[0]).toMatchObject({
      provider: "idealo",
      state: "no_match",
      reviewCandidates: [
        {
          providerProductId: "review-example",
          productTitle: "ExampleTech Pro 15",
          confidence: 0.7,
          matchMethod: "fuzzy"
        }
      ]
    });
  });

  it("accepts same-product eBay alternatives across conditions without making used the new-item best price", async () => {
    const newListing: EcommerceListing = {
      ...listing,
      condition: "new",
      identity: {ean: "4548736162657"}
    };
    const ebayMarket: PriceProvider = {
      id: "ebay_market",
      matchAcrossConditions: true,
      async search() {
        return [
          {
            provider: "ebay_market",
            providerProductId: "used-1",
            productTitle: "Sony WH-1000XM6 used",
            url: "https://www.ebay.de/itm/223456789012",
            condition: "used",
            identity: {gtin: "4548736162657"},
            itemPrice: {amount: 200, currency: "EUR"},
            shipping: {amount: 0, currency: "EUR"},
            fetchedAt: new Date().toISOString()
          },
          {
            provider: "ebay_market",
            providerProductId: "new-1",
            productTitle: "Sony WH-1000XM6 new",
            url: "https://www.ebay.de/itm/323456789012",
            condition: "new",
            identity: {gtin: "4548736162657"},
            itemPrice: {amount: 300, currency: "EUR"},
            shipping: {amount: 0, currency: "EUR"},
            fetchedAt: new Date().toISOString()
          }
        ];
      }
    };

    const result = await compareWithProviders(newListing, [ebayMarket]);

    expect(result.offers).toHaveLength(2);
    expect(result.bestOffer).toMatchObject({
      provider: "ebay_market",
      condition: "new",
      landedPrice: {amount: 300, currency: "EUR"}
    });
    expect(
      result.providerStatus.find((status) => status.provider === "ebay_market")
    ).toMatchObject({state: "ok"});
  });

  it("runs FX normalization after matching and before best-offer selection", async () => {
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        return [
          candidate({
            providerProductId: "pln-offer",
            itemPrice: {amount: 1200, currency: "PLN"},
            shipping: {amount: 40, currency: "PLN"}
          })
        ];
      }
    };

    const result = await compareWithProviders(listing, [provider], {
      requestId: "req-normalized",
      normalizeOffers: async (_listing, offers) => ({
        offers: offers.map((offer) => ({
          ...offer,
          comparisonLandedPrice: {amount: 280, currency: "EUR"},
          fx: {
            source: "ecb_reference",
            rateDate: "2026-10-02",
            fetchedAt: "2026-10-04T00:00:00Z",
            fromCurrency: "PLN",
            toCurrency: "EUR",
            rate: 0.2258064516
          }
        }))
      })
    });

    expect(result.offers[0]).toMatchObject({
      landedPrice: {amount: 1240, currency: "PLN"},
      comparisonLandedPrice: {amount: 280, currency: "EUR"}
    });
    expect(result.bestOffer?.providerProductId).toBe("pln-offer");
    expect(result.marketMinimum).toEqual({amount: 280, currency: "EUR"});
  });

  it("fails open when the FX normalizer is unavailable", async () => {
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        return [
          candidate({
            providerProductId: "pln-offer",
            itemPrice: {amount: 1200, currency: "PLN"},
            shipping: {amount: 40, currency: "PLN"}
          })
        ];
      }
    };

    const result = await compareWithProviders(listing, [provider], {
      normalizeOffers: async () => {
        throw new Error("ECB unavailable");
      }
    });

    expect(result.offers[0]?.landedPrice).toEqual({
      amount: 1240,
      currency: "PLN"
    });
    expect(result.bestOffer).toBeUndefined();
    expect(result.warnings).toContain(
      "Currency normalization is unavailable; cross-currency offers were not ranked."
    );
  });

  it("passes buyer destination to provider searches", async () => {
    let destination: unknown;
    const provider: PriceProvider = {
      id: "idealo",
      async search(input) {
        destination = input.destination;
        return [];
      }
    };

    await compareWithProviders(listing, [provider], {
      destination: {country: "DE", postalCode: "30159"}
    });

    expect(destination).toEqual({
      country: "DE",
      postalCode: "30159"
    });
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
