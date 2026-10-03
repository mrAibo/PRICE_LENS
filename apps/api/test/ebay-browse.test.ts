import {describe, expect, it, vi} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {
  EbayBrowseEnricher,
  createEbayBrowseEnricherFromEnv
} from "../src/ebay-browse.js";

const baseListing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Sony WH-1000XM6",
  price: {amount: 349, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {},
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type": "application/json"}
  });
}

describe("eBay Browse enrichment", () => {
  it("mints an application token and enriches missing strong identity fields", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "token-1",
          token_type: "Application Access Token",
          expires_in: 7200
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemId: "v1|123456789012|0",
          brand: "Sony",
          localizedAspects: [
            {name: "Model", value: "WH-1000XM6"},
            {name: "MPN", value: "WH1000XM6B"},
            {name: "EAN", value: "4548736162657"}
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toEqual({
      brand: "Sony",
      model: "WH-1000XM6",
      mpn: "WH1000XM6B",
      ean: "4548736162657"
    });
    expect(result.extractionEvidence).toContain(
      "ebay-browse:brand,model,mpn,ean"
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tokenCall = fetchImpl.mock.calls[0]!;
    expect(String(tokenCall[0])).toBe(
      "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    );
    expect(tokenCall[1]?.method).toBe("POST");
    expect(new Headers(tokenCall[1]?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("sandbox-client:sandbox-secret").toString("base64")}`
    );
    expect(String(tokenCall[1]?.body)).toContain("grant_type=client_credentials");
    expect(String(tokenCall[1]?.body)).toContain(
      "scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
    );

    const browseCall = fetchImpl.mock.calls[1]!;
    const browseUrl = new URL(String(browseCall[0]));
    expect(browseUrl.origin).toBe("https://api.sandbox.ebay.com");
    expect(browseUrl.pathname).toBe(
      "/buy/browse/v1/item/get_item_by_legacy_id"
    );
    expect(browseUrl.searchParams.get("legacy_item_id")).toBe(
      "123456789012"
    );
    expect(browseUrl.searchParams.get("fieldgroups")).toBe("PRODUCT");
    const browseHeaders = new Headers(browseCall[1]?.headers);
    expect(browseHeaders.get("authorization")).toBe("Bearer token-1");
    expect(browseHeaders.get("x-ebay-c-marketplace-id")).toBe("EBAY_DE");
  });

  it("coalesces concurrent identical legacy-item lookups", async () => {
    const cacheObserver = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "shared-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          localizedAspects: [{name: "EAN", value: "4548736162657"}]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      cacheObserver
    });

    const [first, second] = await Promise.all([
      enricher.enrich(baseListing),
      enricher.enrich(baseListing)
    ]);

    expect(first.identity.ean).toBe("4548736162657");
    expect(second.identity.ean).toBe("4548736162657");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cacheObserver.mock.calls.map(([event]) => event.outcome)).toEqual([
      "miss",
      "coalesced"
    ]);
  });

  it("does not cache eBay product data between sequential requests by default", async () => {
    const cacheObserver = vi.fn();
    const itemResponse = {
      brand: "Sony",
      localizedAspects: [{name: "EAN", value: "4548736162657"}]
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "cached-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse(itemResponse))
      .mockResolvedValueOnce(jsonResponse(itemResponse));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      cacheObserver
    });

    await enricher.enrich(baseListing);
    await enricher.enrich(baseListing);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(cacheObserver.mock.calls.map(([event]) => event.outcome)).toEqual([
      "miss",
      "miss"
    ]);
  });

  it("caches legacy-item data only when an explicit TTL is configured", async () => {
    const cacheObserver = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "cached-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          localizedAspects: [{name: "EAN", value: "4548736162657"}]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      cacheTtlMs: 60_000,
      fetchImpl,
      cacheObserver
    });

    await enricher.enrich(baseListing);
    await enricher.enrich(baseListing);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cacheObserver.mock.calls.map(([event]) => event.outcome)).toEqual([
      "miss",
      "hit"
    ]);
  });

  it("keeps page identity when Browse enrichment conflicts", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "OtherBrand",
          localizedAspects: [
            {name: "EAN", value: "4006381333931"},
            {name: "MPN", value: "OTHER-MPN"}
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    const listing: EcommerceListing = {
      ...baseListing,
      identity: {
        brand: "Sony",
        mpn: "WH1000XM6B",
        ean: "4548736162657"
      }
    };

    const result = await enricher.enrich(listing);

    expect(result.identity).toEqual(listing.identity);
    expect(result.extractionWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("brand"),
        expect.stringContaining("mpn"),
        expect.stringContaining("conflicting product identifier")
      ])
    );
  });

  it("refreshes the application token once after a 401", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "stale-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({error: "invalid_token"}, 401))
      .mockResolvedValueOnce(
        jsonResponse({access_token: "fresh-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          localizedAspects: [{name: "EAN", value: "4548736162657"}]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity.ean).toBe("4548736162657");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(
      new Headers(fetchImpl.mock.calls[3]![1]?.headers).get("authorization")
    ).toBe("Bearer fresh-token");
  });

  it("treats a missing legacy item as a no-op", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({errors: []}, 404));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    await expect(enricher.enrich(baseListing)).resolves.toBe(baseListing);
  });

  it("surfaces rate limiting as a controlled enrichment error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({errors: []}, 429));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    await expect(enricher.enrich(baseListing)).rejects.toThrow(
      "rate limit"
    );
  });
});

describe("eBay same-product marketplace search", () => {
  it("searches exact GTIN fixed-price listings, excludes the current listing and preserves conditions", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "market-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|123456789012|0",
              title: "Current Sony WH-1000XM6",
              itemWebUrl: "https://www.ebay.de/itm/123456789012",
              price: {value: "349.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000"
            },
            {
              itemId: "v1|223456789012|0",
              title: "Sony WH-1000XM6 Neu",
              itemWebUrl: "https://www.ebay.de/itm/223456789012",
              price: {value: "309.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000",
              seller: {
                username: "trusted-shop",
                feedbackPercentage: "99.8",
                feedbackScore: 18000
              },
              shippingOptions: [
                {shippingCost: {value: "4.99", currency: "EUR"}},
                {shippingCost: {value: "0.00", currency: "EUR"}}
              ]
            },
            {
              itemId: "v1|323456789012|0",
              title: "Sony WH-1000XM6 Refurbished",
              itemWebUrl: "https://www.ebay.de/itm/323456789012",
              price: {value: "269.90", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "2500"
            },
            {
              itemId: "v1|423456789012|0",
              title: "Sony WH-1000XM6 Gebraucht",
              itemWebUrl: "https://www.ebay.de/itm/423456789012",
              price: {value: "219.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "5000",
              shippingOptions: [
                {shippingCost: {value: "6.99", currency: "EUR"}}
              ]
            },
            {
              itemId: "v1|523456789012|0",
              title: "Auction should be ignored",
              itemWebUrl: "https://www.ebay.de/itm/523456789012",
              price: {value: "100.00", currency: "EUR"},
              buyingOptions: ["AUCTION"],
              conditionId: "3000"
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      now: () => Date.parse("2026-10-03T17:00:00.000Z")
    });
    const listing: EcommerceListing = {
      ...baseListing,
      identity: {ean: "4548736162657"}
    };

    const candidates = await enricher.searchMarketplace(listing);

    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.condition)).toEqual([
      "new",
      "refurbished",
      "used"
    ]);
    expect(candidates[0]).toMatchObject({
      provider: "ebay_market",
      providerProductId: "v1|223456789012|0",
      merchant: "trusted-shop",
      sellerFeedbackPercentage: 99.8,
      sellerFeedbackScore: 18000,
      identity: {gtin: "4548736162657"},
      itemPrice: {amount: 309, currency: "EUR"},
      shipping: {amount: 0, currency: "EUR"},
      fetchedAt: "2026-10-03T17:00:00.000Z"
    });
    expect(candidates[2]?.shipping).toEqual({amount: 6.99, currency: "EUR"});

    const searchUrl = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(searchUrl.pathname).toBe("/buy/browse/v1/item_summary/search");
    expect(searchUrl.searchParams.get("gtin")).toBe("4548736162657");
    expect(searchUrl.searchParams.get("limit")).toBe("25");
    expect(searchUrl.searchParams.get("filter")).toBe(
      "buyingOptions:{FIXED_PRICE}"
    );
  });

  it("does not issue a broad title search when no strong trade identifier exists", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    await expect(enricher.searchMarketplace(baseListing)).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("eBay Browse environment configuration", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(
      createEbayBrowseEnricherFromEnv({
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret"
      })
    ).toBeUndefined();
  });

  it("rejects enabled configuration without credentials", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1"
      })
    ).toThrow("EBAY_CLIENT_ID");
  });

  it("rejects invalid product-data cache TTL configuration", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_BROWSE_CACHE_TTL_MS: "-1"
      })
    ).toThrow("EBAY_BROWSE_CACHE_TTL_MS");
  });

  it("accepts an explicit production configuration", () => {
    expect(
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_ENVIRONMENT: "production",
        EBAY_MARKETPLACE_ID: "EBAY_DE"
      })
    ).toBeInstanceOf(EbayBrowseEnricher);
  });
});
