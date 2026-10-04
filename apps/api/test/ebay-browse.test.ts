import {describe, expect, it, vi} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import type {ProviderCandidate} from "@price-lens/core";
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

  it("enriches a direct ePID returned with Browse product data", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "epid-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemId: "v1|123456789012|0",
          product: {
            brand: "Sony",
            mpn: "WH1000XM6B",
            epid: "123456789"
          }
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toMatchObject({
      brand: "Sony",
      mpn: "WH1000XM6B",
      epid: "123456789"
    });
    expect(result.extractionEvidence).toContain(
      "ebay-browse:brand,mpn,epid"
    );
  });

  it("resolves a unique exact Brand+MPN Catalog product to ePID when enabled", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemId: "v1|123456789012|0",
          brand: "Sony",
          mpn: "WH1000XM6B"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [
            {
              epid: "241976099",
              brand: "Sony",
              mpn: ["WH1000XM6B"],
              title: "Sony WH-1000XM6"
            },
            {
              epid: "999999999",
              brand: "Other Brand",
              mpn: ["WH1000XM6B"],
              title: "Unrelated collision"
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogEpidFallbackEnabled: true,
      catalogMarketplaceId: "EBAY_DE",
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toMatchObject({
      brand: "Sony",
      mpn: "WH1000XM6B",
      epid: "241976099"
    });
    expect(result.extractionEvidence).toContain(
      "ebay-browse:brand,mpn,epid"
    );

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const catalogTokenCall = fetchImpl.mock.calls[2]!;
    expect(String(catalogTokenCall[0])).toContain("/identity/v1/oauth2/token");
    expect(String(catalogTokenCall[1]?.body)).toContain(
      "commerce.catalog.readonly"
    );

    const catalogSearchCall = fetchImpl.mock.calls[3]!;
    const catalogUrl = new URL(String(catalogSearchCall[0]));
    expect(catalogUrl.pathname).toBe(
      "/commerce/catalog/v1_beta/product_summary/search"
    );
    expect(catalogUrl.searchParams.get("mpn")).toBe("WH1000XM6B");
    expect(catalogUrl.searchParams.get("limit")).toBe("20");
    expect(
      new Headers(catalogSearchCall[1]?.headers).get(
        "x-ebay-c-marketplace-id"
      )
    ).toBe("EBAY_DE");
  });

  it("resolves Brand+Model through query search only after exact Catalog detail verification", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          product: {model: "WH-1000XM6"}
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [
            {
              epid: "241976099",
              brand: "Sony",
              title: "Sony WH-1000XM6"
            },
            {
              epid: "999999999",
              brand: "Sony",
              title: "Sony WH-1000XM5"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          epid: "241976099",
          brand: "Sony",
          title: "Sony WH-1000XM6",
          aspects: [
            {localizedName: "Model", localizedValues: ["WH-1000XM6"]}
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          epid: "999999999",
          brand: "Sony",
          title: "Sony WH-1000XM5",
          aspects: [
            {localizedName: "Model", localizedValues: ["WH-1000XM5"]}
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogBrandModelFallbackEnabled: true,
      catalogBrandModelCandidateLimit: 5,
      catalogBrandModelDetailConcurrency: 2,
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toMatchObject({
      brand: "Sony",
      model: "WH-1000XM6",
      epid: "241976099"
    });
    expect(result.extractionEvidence).toContain(
      "ebay-browse:brand,model,epid"
    );

    const querySearch = fetchImpl.mock.calls.find(([input]) =>
      String(input).includes("/commerce/catalog/v1_beta/product_summary/search") &&
      String(input).includes("q=")
    );
    expect(querySearch).toBeDefined();
    const queryUrl = new URL(String(querySearch![0]));
    expect(queryUrl.searchParams.get("q")).toBe("Sony WH-1000XM6");
    expect(queryUrl.searchParams.get("limit")).toBe("5");

    const detailCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes("/commerce/catalog/v1_beta/product/")
    );
    expect(detailCalls).toHaveLength(2);
  });

  it("rejects Brand+Model fallback when multiple Catalog details verify exactly", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          product: {model: "WH-1000XM6"}
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [
            {epid: "111111111", brand: "Sony"},
            {epid: "222222222", brand: "Sony"}
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          epid: "111111111",
          brand: "Sony",
          aspects: [
            {localizedName: "Model", localizedValues: ["WH-1000XM6"]}
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          epid: "222222222",
          brand: "Sony",
          aspects: [
            {localizedName: "Modell", localizedValues: ["WH-1000XM6"]}
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogBrandModelFallbackEnabled: true,
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);
    expect(result.identity).toMatchObject({
      brand: "Sony",
      model: "WH-1000XM6"
    });
    expect(result.identity.epid).toBeUndefined();
  });

  it("does not trust title-only Brand+Model Catalog matches without an explicit model aspect", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          product: {model: "WH-1000XM6"}
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [
            {
              epid: "241976099",
              brand: "Sony",
              title: "Sony WH-1000XM6"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          epid: "241976099",
          brand: "Sony",
          title: "Sony WH-1000XM6",
          aspects: [
            {localizedName: "Colour", localizedValues: ["Black"]}
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogBrandModelFallbackEnabled: true,
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);
    expect(result.identity.epid).toBeUndefined();
  });

  it("does not attempt Brand+Model fallback when a structured variant is present", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "ExamplePhone",
          product: {model: "Phone 15"}
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogBrandModelFallbackEnabled: true,
      fetchImpl
    });

    const result = await enricher.enrich({
      ...baseListing,
      identity: {variant: {storageGb: 256}}
    });

    expect(result.identity).toMatchObject({
      brand: "ExamplePhone",
      model: "Phone 15",
      variant: {storageGb: 256}
    });
    expect(result.identity.epid).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps Browse identity when Brand+Model Catalog detail verification fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          product: {model: "WH-1000XM6"}
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [{epid: "241976099", brand: "Sony"}]
        })
      )
      .mockResolvedValueOnce(jsonResponse({errors: []}, 503));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogBrandModelFallbackEnabled: true,
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toMatchObject({
      brand: "Sony",
      model: "WH-1000XM6"
    });
    expect(result.identity.epid).toBeUndefined();
  });

  it("coalesces concurrent identical Brand+MPN Catalog ePID lookups", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          mpn: "WH1000XM6B"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [
            {
              epid: "241976099",
              brand: "Sony",
              mpn: ["WH1000XM6B"]
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogEpidFallbackEnabled: true,
      fetchImpl
    });

    const [first, second] = await Promise.all([
      enricher.enrich(baseListing),
      enricher.enrich(baseListing)
    ]);

    expect(first.identity.epid).toBe("241976099");
    expect(second.identity.epid).toBe("241976099");
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const catalogSearchCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes("/commerce/catalog/v1_beta/product_summary/search")
    );
    expect(catalogSearchCalls).toHaveLength(1);
  });

  it("does not choose an ePID when exact Brand+MPN Catalog results are ambiguous", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          mpn: "WH1000XM6B"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          productSummaries: [
            {epid: "111111111", brand: "Sony", mpn: ["WH1000XM6B"]},
            {epid: "222222222", brand: "Sony", mpn: ["WH1000XM6B"]}
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogEpidFallbackEnabled: true,
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toMatchObject({
      brand: "Sony",
      mpn: "WH1000XM6B"
    });
    expect(result.identity.epid).toBeUndefined();
  });

  it("keeps Browse enrichment when optional Catalog ePID resolution fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "browse-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          brand: "Sony",
          mpn: "WH1000XM6B"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({access_token: "catalog-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({errors: []}, 503));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      catalogEpidFallbackEnabled: true,
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.identity).toMatchObject({
      brand: "Sony",
      mpn: "WH1000XM6B"
    });
    expect(result.identity.epid).toBeUndefined();
    expect(result.extractionWarnings).toContain(
      "eBay Catalog ePID fallback is currently unavailable; Browse identity was kept."
    );
  });

  it("enriches the current listing origin country when Browse provides it", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "location-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemId: "v1|123456789012|0",
          itemLocation: {country: "US"}
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    const result = await enricher.enrich(baseListing);

    expect(result.itemLocationCountry).toBe("US");
    expect(result.extractionEvidence).toContain(
      "ebay-browse:itemLocationCountry"
    );
  });

  it("keeps an existing trusted listing origin instead of overwriting it", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "location-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemId: "v1|123456789012|0",
          itemLocation: {country: "US"}
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl
    });

    const result = await enricher.enrich({
      ...baseListing,
      itemLocationCountry: "DE"
    });

    expect(result.itemLocationCountry).toBe("DE");
    expect(result.extractionEvidence).not.toContain(
      "ebay-browse:itemLocationCountry"
    );
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
                feedbackScore: 18000,
                sellerAccountType: "BUSINESS"
              },
              shippingOptions: [
                {
                  shippingCost: {value: "4.99", currency: "EUR"},
                  shippingServiceCode: "Expedited",
                  minEstimatedDeliveryDate: "2026-10-05T10:00:00.000Z",
                  maxEstimatedDeliveryDate: "2026-10-06T10:00:00.000Z"
                },
                {
                  shippingCost: {value: "0.00", currency: "EUR"},
                  shippingServiceCode: "Standard",
                  shippingCarrierCode: "DHL",
                  minEstimatedDeliveryDate: "2026-10-07T10:00:00.000Z",
                  maxEstimatedDeliveryDate: "2026-10-09T10:00:00.000Z"
                }
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
      marketplace: "EBAY_DE",
      sellerFeedbackPercentage: 99.8,
      sellerFeedbackScore: 18000,
      sellerAccountType: "BUSINESS",
      deliveryWindow: {
        minEstimatedDeliveryDate: "2026-10-07T10:00:00.000Z",
        maxEstimatedDeliveryDate: "2026-10-09T10:00:00.000Z",
        shippingServiceCode: "Standard",
        shippingCarrierCode: "DHL"
      },
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
      "buyingOptions:{FIXED_PRICE},deliveryCountry:DE"
    );
    const searchHeaders = new Headers(fetchImpl.mock.calls[1]![1]?.headers);
    expect(searchHeaders.get("x-ebay-c-marketplace-id")).toBe("EBAY_DE");
    expect(searchHeaders.get("x-ebay-c-enduserctx")).toBeNull();
  });

  it("ignores unsupported seller account values and malformed delivery dates", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "metadata-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|225000000001|0",
              title: "Sony WH-1000XM6",
              itemWebUrl: "https://www.ebay.de/itm/225000000001",
              price: {value: "300.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000",
              seller: {
                username: "seller",
                sellerAccountType: "UNEXPECTED"
              },
              shippingOptions: [
                {
                  shippingCost: {value: "0.00", currency: "EUR"},
                  shippingServiceCode: "Standard",
                  minEstimatedDeliveryDate: "not-a-date"
                }
              ]
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE"],
      fetchImpl
    });

    const candidates = await enricher.searchMarketplace({
      ...baseListing,
      identity: {ean: "4548736162657"}
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        sellerAccountType: undefined,
        deliveryWindow: {
          shippingServiceCode: "Standard"
        }
      })
    ]);
  });

  it("fans exact-GTIN search across configured EU marketplaces and keeps market metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/identity/v1/oauth2/token") {
        return jsonResponse({access_token: "eu-token", expires_in: 7200});
      }

      const marketplace = new Headers(init?.headers).get(
        "x-ebay-c-marketplace-id"
      );
      if (marketplace === "EBAY_DE") {
        return jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|600000000001|0",
              title: "Sony WH-1000XM6 Deutschland",
              itemWebUrl: "https://www.ebay.de/itm/600000000001",
              price: {value: "309.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000",
              itemLocation: {country: "DE"},
              shippingOptions: [
                {shippingCost: {value: "0.00", currency: "EUR"}}
              ]
            }
          ]
        });
      }
      if (marketplace === "EBAY_PL") {
        return jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|600000000002|0",
              title: "Sony WH-1000XM6 Polska",
              itemWebUrl: "https://www.ebay.pl/itm/600000000002",
              price: {value: "1199.00", currency: "PLN"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000",
              itemLocation: {country: "PL"},
              shippingOptions: [
                {shippingCost: {value: "45.00", currency: "PLN"}}
              ]
            }
          ]
        });
      }
      return jsonResponse({itemSummaries: []});
    });

    const fanoutObserver = vi.fn();
    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE", "EBAY_PL"],
      deliveryCountry: "DE",
      marketplaceSearchConcurrency: 2,
      fetchImpl,
      fanoutObserver
    });

    const candidates = await enricher.searchMarketplace({
      ...baseListing,
      identity: {ean: "4548736162657"}
    });

    expect(candidates).toHaveLength(2);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerProductId: "v1|600000000001|0",
          marketplace: "EBAY_DE",
          itemLocationCountry: "DE",
          itemPrice: {amount: 309, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"}
        }),
        expect.objectContaining({
          providerProductId: "v1|600000000002|0",
          marketplace: "EBAY_PL",
          itemLocationCountry: "PL",
          itemPrice: {amount: 1199, currency: "PLN"},
          shipping: {amount: 45, currency: "PLN"}
        })
      ])
    );

    const marketCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes("/buy/browse/v1/item_summary/search")
    );
    expect(marketCalls).toHaveLength(2);
    expect(
      marketCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-ebay-c-marketplace-id")
      )
    ).toEqual(expect.arrayContaining(["EBAY_DE", "EBAY_PL"]));
    for (const [input, init] of marketCalls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("filter")).toBe(
        "buyingOptions:{FIXED_PRICE},deliveryCountry:DE"
      );
      expect(new Headers(init?.headers).get("x-ebay-c-enduserctx")).toBeNull();
    }
    expect(fanoutObserver).toHaveBeenCalledTimes(1);
    expect(fanoutObserver).toHaveBeenCalledWith({
      source: "ebay",
      attempted: 2,
      succeeded: 2,
      failed: 0,
      durationMs: expect.any(Number)
    });
  });

  it("uses explicit buyer postal code in eBay delivery filters and encoded shipping context", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "postal-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({itemSummaries: []}));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE"],
      fetchImpl
    });

    await enricher.searchMarketplace(
      {
        ...baseListing,
        identity: {ean: "4548736162657"}
      },
      undefined,
      {country: "DE", postalCode: "30159"}
    );

    const searchUrl = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(searchUrl.searchParams.get("filter")).toBe(
      "buyingOptions:{FIXED_PRICE},deliveryCountry:DE,deliveryPostalCode:30159"
    );

    const headers = new Headers(fetchImpl.mock.calls[1]![1]?.headers);
    expect(headers.get("x-ebay-c-enduserctx")).toBe(
      "contextualLocation=country%3DDE%2Czip%3D30159"
    );
  });

  it("uses a request destination instead of the server country fallback", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "destination-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({itemSummaries: []}));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_PL"],
      deliveryCountry: "DE",
      fetchImpl
    });

    await enricher.searchMarketplace(
      {
        ...baseListing,
        identity: {ean: "4548736162657"}
      },
      undefined,
      {country: "PL", postalCode: "00-001"}
    );

    const searchUrl = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(searchUrl.searchParams.get("filter")).toBe(
      "buyingOptions:{FIXED_PRICE},deliveryCountry:PL,deliveryPostalCode:00-001"
    );
  });

  it("accepts the official Belgium marketplace hostname", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "be-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|640000000001|0",
              title: "Sony WH-1000XM6 Belgium",
              itemWebUrl: "https://www.benl.ebay.be/itm/640000000001",
              price: {value: "299.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000"
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_BE"],
      fetchImpl
    });

    const candidates = await enricher.searchMarketplace({
      ...baseListing,
      identity: {ean: "4548736162657"}
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        providerProductId: "v1|640000000001|0",
        marketplace: "EBAY_BE"
      })
    ]);
  });

  it("keeps successful EU marketplace results when another market fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/identity/v1/oauth2/token") {
        return jsonResponse({access_token: "partial-token", expires_in: 7200});
      }
      const marketplace = new Headers(init?.headers).get(
        "x-ebay-c-marketplace-id"
      );
      if (marketplace === "EBAY_DE") {
        return jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|610000000001|0",
              title: "Sony WH-1000XM6",
              itemWebUrl: "https://www.ebay.de/itm/610000000001",
              price: {value: "300.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000"
            }
          ]
        });
      }
      return jsonResponse({errors: [{message: "temporary"}]}, 503);
    });

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE", "EBAY_PL"],
      fetchImpl
    });

    await expect(
      enricher.searchMarketplace({
        ...baseListing,
        identity: {ean: "4548736162657"}
      })
    ).resolves.toEqual([
      expect.objectContaining({
        providerProductId: "v1|610000000001|0",
        marketplace: "EBAY_DE"
      })
    ]);
  });

  it("deduplicates one eBay item returned through multiple marketplaces and prefers complete shipping", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/identity/v1/oauth2/token") {
        return jsonResponse({access_token: "dedupe-token", expires_in: 7200});
      }
      const marketplace = new Headers(init?.headers).get(
        "x-ebay-c-marketplace-id"
      );
      if (marketplace === "EBAY_DE") {
        return jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|620000000001|0",
              title: "Sony WH-1000XM6",
              itemWebUrl: "https://www.ebay.de/itm/620000000001",
              price: {value: "299.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000"
            }
          ]
        });
      }
      return jsonResponse({
        itemSummaries: [
          {
            itemId: "v1|620000000001|0",
            title: "Sony WH-1000XM6",
            itemWebUrl: "https://www.ebay.pl/itm/620000000001",
            price: {value: "299.00", currency: "EUR"},
            buyingOptions: ["FIXED_PRICE"],
            conditionId: "1000",
            shippingOptions: [
              {shippingCost: {value: "9.90", currency: "EUR"}}
            ]
          }
        ]
      });
    });

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE", "EBAY_PL"],
      fetchImpl
    });
    const candidates = await enricher.searchMarketplace({
      ...baseListing,
      identity: {ean: "4548736162657"}
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      providerProductId: "v1|620000000001|0",
      marketplace: "EBAY_PL",
      shipping: {amount: 9.9, currency: "EUR"}
    });
  });

  it("rejects a result whose item URL does not match the queried eBay marketplace", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "host-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|630000000001|0",
              title: "Unexpected host",
              itemWebUrl: "https://www.ebay.de/itm/630000000001",
              price: {value: "1000.00", currency: "PLN"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000"
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_PL"],
      fetchImpl
    });

    await expect(
      enricher.searchMarketplace({
        ...baseListing,
        identity: {ean: "4548736162657"}
      })
    ).resolves.toEqual([]);
  });

  it("bounds concurrent marketplace calls inside one explicit report", async () => {
    let activeSearches = 0;
    let maxActiveSearches = 0;

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/identity/v1/oauth2/token") {
        return jsonResponse({access_token: "bounded-token", expires_in: 7200});
      }

      activeSearches += 1;
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSearches -= 1;
      return jsonResponse({itemSummaries: []});
    });

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: [
        "EBAY_DE",
        "EBAY_PL",
        "EBAY_AT",
        "EBAY_FR",
        "EBAY_IT"
      ],
      marketplaceSearchConcurrency: 2,
      fetchImpl
    });

    await enricher.searchMarketplace({
      ...baseListing,
      identity: {ean: "4548736162657"}
    });

    expect(maxActiveSearches).toBe(2);
  });

  it("uses ePID marketplace search when GTIN/EAN/UPC is unavailable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "market-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemSummaries: [
            {
              itemId: "v1|650000000001|0",
              title: "Sony WH-1000XM6",
              itemWebUrl: "https://www.ebay.de/itm/650000000001",
              price: {value: "299.00", currency: "EUR"},
              buyingOptions: ["FIXED_PRICE"],
              conditionId: "1000",
              itemLocation: {country: "DE"},
              shippingOptions: [
                {shippingCost: {value: "0.00", currency: "EUR"}}
              ]
            }
          ]
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE"],
      fetchImpl
    });

    const candidates = await enricher.searchMarketplace({
      ...baseListing,
      identity: {
        brand: "Sony",
        mpn: "WH1000XM6B",
        epid: "241976099"
      }
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        providerProductId: "v1|650000000001|0",
        identity: {epid: "241976099"}
      })
    ]);

    const searchUrl = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(searchUrl.searchParams.get("epid")).toBe("241976099");
    expect(searchUrl.searchParams.has("gtin")).toBe(false);
  });

  it("prefers GTIN over ePID when both strong identifiers are available", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "market-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({itemSummaries: []}));

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE"],
      fetchImpl
    });

    await enricher.searchMarketplace({
      ...baseListing,
      identity: {
        ean: "4548736162657",
        epid: "241976099"
      }
    });

    const searchUrl = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(searchUrl.searchParams.get("gtin")).toBe("4548736162657");
    expect(searchUrl.searchParams.has("epid")).toBe(false);
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

describe("eBay accepted-candidate detail enrichment", () => {
  function ebayCandidate(
    id: string,
    marketplace = "EBAY_DE"
  ): ProviderCandidate {
    return {
      provider: "ebay_market",
      providerProductId: id,
      productTitle: "Sony WH-1000XM6",
      marketplace,
      itemLocationCountry: "DE",
      url: "https://www.ebay.de/itm/650000000001",
      condition: "new",
      identity: {ean: "4548736162657"},
      itemPrice: {amount: 299, currency: "EUR"},
      shipping: {amount: 0, currency: "EUR"},
      fetchedAt: "2026-10-04T12:00:00.000Z"
    };
  }

  it("fetches return terms only for accepted candidates and sends destination context", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "detail-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          itemId: "v1|650000000001|0",
          returnTerms: {
            returnsAccepted: true,
            returnPeriod: {
              value: 30,
              unit: "CALENDAR_DAY"
            },
            returnShippingCostPayer: "BUYER"
          }
        })
      );

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceDetailEnrichmentEnabled: true,
      fetchImpl
    });

    const [result] = await enricher.enrichAcceptedMarketplaceCandidates(
      [ebayCandidate("v1|650000000001|0")],
      undefined,
      {country: "DE", postalCode: "30159"}
    );

    expect(result).toMatchObject({
      providerProductId: "v1|650000000001|0",
      returnPolicy: {
        returnsAccepted: true,
        returnPeriodValue: 30,
        returnPeriodUnit: "CALENDAR_DAY",
        returnShippingCostPayer: "BUYER"
      }
    });

    const detailCall = fetchImpl.mock.calls[1]!;
    const detailUrl = new URL(String(detailCall[0]));
    expect(detailUrl.pathname).toContain("/buy/browse/v1/item/");
    expect(decodeURIComponent(detailUrl.pathname)).toContain(
      "v1|650000000001|0"
    );
    const headers = new Headers(detailCall[1]?.headers);
    expect(headers.get("x-ebay-c-marketplace-id")).toBe("EBAY_DE");
    expect(headers.get("x-ebay-c-enduserctx")).toBe(
      "contextualLocation=country%3DDE%2Czip%3D30159"
    );
  });

  it("is disabled by default and bounds optional detail enrichment by limit", async () => {
    const disabledFetch = vi.fn<typeof fetch>();
    const disabled = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: disabledFetch
    });
    const candidates = [
      ebayCandidate("v1|650000000001|0"),
      ebayCandidate("v1|650000000002|0")
    ];

    await expect(
      disabled.enrichAcceptedMarketplaceCandidates(candidates)
    ).resolves.toBe(candidates);
    expect(disabledFetch).not.toHaveBeenCalled();

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/identity/v1/oauth2/token") {
        return jsonResponse({access_token: "limited-token", expires_in: 7200});
      }
      return jsonResponse({
        returnTerms: {
          returnsAccepted: false
        }
      });
    });
    const limited = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceDetailEnrichmentEnabled: true,
      marketplaceDetailLimit: 1,
      fetchImpl
    });

    const enriched = await limited.enrichAcceptedMarketplaceCandidates(
      candidates,
      undefined,
      {country: "DE"}
    );

    expect(enriched[0]?.returnPolicy).toEqual({returnsAccepted: false});
    expect(enriched[1]?.returnPolicy).toBeUndefined();
    const detailCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes("/buy/browse/v1/item/")
    );
    expect(detailCalls).toHaveLength(1);
  });

  it("fails open for detail errors and ignores unsafe return-term fields", async () => {
    const rateLimitedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "rate-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(jsonResponse({errors: []}, 429));
    const rateLimited = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceDetailEnrichmentEnabled: true,
      fetchImpl: rateLimitedFetch
    });
    const candidate = ebayCandidate("v1|650000000003|0");

    await expect(
      rateLimited.enrichAcceptedMarketplaceCandidates(
        [candidate],
        undefined,
        {country: "DE"}
      )
    ).resolves.toEqual([candidate]);

    const unsafeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "unsafe-token", expires_in: 7200})
      )
      .mockResolvedValueOnce(
        jsonResponse({
          returnTerms: {
            returnsAccepted: true,
            returnPeriod: {
              value: -5,
              unit: "<script>"
            },
            returnShippingCostPayer: "UNKNOWN"
          }
        })
      );
    const unsafe = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceDetailEnrichmentEnabled: true,
      fetchImpl: unsafeFetch
    });

    const [safeResult] = await unsafe.enrichAcceptedMarketplaceCandidates(
      [candidate],
      undefined,
      {country: "DE"}
    );
    expect(safeResult?.returnPolicy).toEqual({returnsAccepted: true});
  });

  it("coalesces concurrent identical item-detail lookups", async () => {
    let resolveDetail!: (value: Response) => void;
    const pendingDetail = new Promise<Response>((resolve) => {
      resolveDetail = resolve;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "shared-detail-token", expires_in: 7200})
      )
      .mockReturnValueOnce(pendingDetail);

    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceDetailEnrichmentEnabled: true,
      fetchImpl
    });
    const candidate = ebayCandidate("v1|650000000004|0");

    const first = enricher.enrichAcceptedMarketplaceCandidates(
      [candidate],
      undefined,
      {country: "DE", postalCode: "30159"}
    );
    const second = enricher.enrichAcceptedMarketplaceCandidates(
      [candidate],
      undefined,
      {country: "DE", postalCode: "30159"}
    );

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    resolveDetail(
      jsonResponse({
        returnTerms: {
          returnsAccepted: true,
          returnPeriod: {value: "14", unit: "CALENDAR_DAY"},
          returnShippingCostPayer: "SELLER"
        }
      })
    );

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult[0]?.returnPolicy).toMatchObject({
      returnsAccepted: true,
      returnPeriodValue: 14,
      returnShippingCostPayer: "SELLER"
    });
    expect(secondResult[0]?.returnPolicy).toEqual(
      firstResult[0]?.returnPolicy
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("rejects unsupported EU marketplace search IDs", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_MARKETPLACE_SEARCH_IDS: "EBAY_DE,EBAY_US"
      })
    ).toThrow("Unsupported eBay marketplace ID");
  });

  it("rejects invalid delivery-country and marketplace-concurrency configuration", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_DELIVERY_COUNTRY: "GER"
      })
    ).toThrow("two-letter ISO country code");

    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_MARKETPLACE_SEARCH_CONCURRENCY: "0"
      })
    ).toThrow("positive");
  });

  it("rejects an invalid configured delivery postal code only when explicitly requested", async () => {
    const enricher = new EbayBrowseEnricher({
      clientId: "id",
      clientSecret: "secret",
      marketplaceSearchIds: ["EBAY_DE"],
      fetchImpl: vi.fn<typeof fetch>()
    });

    await expect(
      enricher.searchMarketplace(
        {
          ...baseListing,
          identity: {ean: "4548736162657"}
        },
        undefined,
        {country: "DE", postalCode: "30159,evil"}
      )
    ).rejects.toThrow("postal code");
  });

  it("rejects unsupported Catalog marketplace configuration", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_CATALOG_EPID_FALLBACK_ENABLED: "1",
        EBAY_CATALOG_MARKETPLACE_ID: "EBAY_PL"
      })
    ).toThrow("Unsupported eBay Catalog marketplace ID");
  });

  it("rejects invalid Brand+Model Catalog limits and concurrency", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_CATALOG_BRAND_MODEL_FALLBACK_ENABLED: "1",
        EBAY_CATALOG_BRAND_MODEL_CANDIDATE_LIMIT: "0"
      })
    ).toThrow("EBAY_CATALOG_BRAND_MODEL_CANDIDATE_LIMIT");

    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_CATALOG_BRAND_MODEL_FALLBACK_ENABLED: "1",
        EBAY_CATALOG_BRAND_MODEL_DETAIL_CONCURRENCY: "0"
      })
    ).toThrow("EBAY_CATALOG_BRAND_MODEL_DETAIL_CONCURRENCY");
  });

  it("rejects invalid marketplace detail limits and concurrency", () => {
    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_MARKETPLACE_DETAIL_LIMIT: "-1"
      })
    ).toThrow("EBAY_MARKETPLACE_DETAIL_LIMIT");

    expect(() =>
      createEbayBrowseEnricherFromEnv({
        EBAY_BROWSE_ENABLED: "1",
        EBAY_CLIENT_ID: "id",
        EBAY_CLIENT_SECRET: "secret",
        EBAY_MARKETPLACE_DETAIL_CONCURRENCY: "0"
      })
    ).toThrow("EBAY_MARKETPLACE_DETAIL_CONCURRENCY");
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
