import {describe, expect, it, vi} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import {compareWithProviders} from "@price-lens/core";
import {
  AmazonCreatorsProvider,
  createAmazonCreatorsProviderFromEnv
} from "../src/amazon-creators-provider.js";

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
    ean: "4548736162657"
  },
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"content-type": "application/json"}
  });
}

function searchResponse(): unknown {
  return {
    searchResult: {
      items: [
        {
          asin: "B0EXAMPLE01",
          detailPageURL:
            "https://www.amazon.de/dp/B0EXAMPLE01?tag=price-lens-21",
          itemInfo: {
            title: {
              displayValue: "Sony WH-1000XM6 Wireless Headphones Black"
            },
            byLineInfo: {
              brand: {displayValue: "Sony"}
            },
            externalIds: {
              eans: {displayValues: ["4548736162657"]}
            },
            manufactureInfo: {
              model: {displayValue: "WH-1000XM6"},
              itemPartNumber: {displayValue: "WH1000XM6B"}
            },
            contentInfo: {
              edition: {displayValue: "Standard Edition"}
            },
            productInfo: {
              unitCount: {displayValue: 1}
            }
          },
          offersV2: {
            listings: [
              {
                availability: {type: "NOW"},
                condition: {
                  value: "New",
                  subCondition: "New"
                },
                merchantInfo: {name: "Amazon.de"},
                price: {
                  money: {
                    amount: 329.99,
                    currency: "EUR"
                  }
                }
              }
            ]
          }
        }
      ]
    }
  };
}

function searchResponseFor(
  marketplace: "www.amazon.de" | "www.amazon.pl" | "www.amazon.com.be",
  partnerTag: string,
  amount: number,
  currency: string
): unknown {
  const response = searchResponse() as {
    searchResult: {
      items: Array<{
        detailPageURL: string;
        offersV2: {
          listings: Array<{
            merchantInfo: {name: string};
            price: {money: {amount: number; currency: string}};
          }>;
        };
      }>;
    };
  };
  const root =
    marketplace === "www.amazon.com.be"
      ? "www.amazon.com.be"
      : marketplace;
  response.searchResult.items[0]!.detailPageURL =
    `https://${root}/dp/B0EXAMPLE01?tag=${partnerTag}`;
  response.searchResult.items[0]!.offersV2.listings[0]!.merchantInfo.name =
    marketplace;
  response.searchResult.items[0]!.offersV2.listings[0]!.price.money = {
    amount,
    currency
  };
  return response;
}

describe("Amazon Creators provider", () => {
  it("uses EU v3.2 OAuth and SearchItems for Amazon.de", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "amazon-token",
          expires_in: 3600
        })
      )
      .mockResolvedValueOnce(jsonResponse(searchResponse()));

    const provider = new AmazonCreatorsProvider({
      credentialId: "credential-id",
      credentialSecret: "credential-secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl
    });

    const result = await provider.search({listing});

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const tokenCall = fetchImpl.mock.calls[0]!;
    expect(String(tokenCall[0])).toBe(
      "https://api.amazon.co.uk/auth/o2/token"
    );
    expect(tokenCall[1]?.method).toBe("POST");
    expect(JSON.parse(String(tokenCall[1]?.body))).toEqual({
      grant_type: "client_credentials",
      client_id: "credential-id",
      client_secret: "credential-secret",
      scope: "creatorsapi::default"
    });

    const searchCall = fetchImpl.mock.calls[1]!;
    expect(String(searchCall[0])).toBe(
      "https://creatorsapi.amazon/catalog/v1/searchItems"
    );
    const headers = new Headers(searchCall[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer amazon-token");
    expect(headers.get("x-marketplace")).toBe("www.amazon.de");

    const body = JSON.parse(String(searchCall[1]?.body));
    expect(body).toMatchObject({
      partnerTag: "price-lens-21",
      marketplace: "www.amazon.de",
      brand: "Sony",
      condition: "New",
      itemCount: 10,
      currencyOfPreference: "EUR"
    });
    expect(body.keywords).toContain("WH-1000XM6");
    expect(body.resources).toEqual(
      expect.arrayContaining([
        "itemInfo.title",
        "itemInfo.externalIds",
        "itemInfo.manufactureInfo",
        "offersV2.listings.condition",
        "offersV2.listings.merchantInfo",
        "offersV2.listings.price"
      ])
    );

    expect(result).toEqual([
      {
        provider: "amazon",
        providerProductId: "B0EXAMPLE01",
        productTitle: "Sony WH-1000XM6 Wireless Headphones Black",
        merchant: "Amazon.de",
        marketplace: "www.amazon.de",
        url: "https://www.amazon.de/dp/B0EXAMPLE01?tag=price-lens-21",
        condition: "new",
        identity: {
          brand: "Sony",
          model: "WH-1000XM6",
          mpn: "WH1000XM6B",
          ean: "4548736162657",
          variant: {
            edition: "Standard Edition",
            packCount: 1
          }
        },
        itemPrice: {amount: 329.99, currency: "EUR"},
        shipping: undefined,
        fetchedAt: expect.any(String)
      }
    ]);
  });

  it("fans out across configured EU marketplaces with locale-specific Partner Tags", async () => {
    const searchCalls: Array<{marketplace: string; body: Record<string, unknown>}> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/o2/token")) {
        return jsonResponse({access_token: "eu-token", expires_in: 3600});
      }

      const headers = new Headers(init?.headers);
      const marketplace = headers.get("x-marketplace") ?? "";
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      searchCalls.push({marketplace, body});

      if (marketplace === "www.amazon.de") {
        return jsonResponse(
          searchResponseFor(
            "www.amazon.de",
            "de-tag-21",
            329.99,
            "EUR"
          )
        );
      }
      if (marketplace === "www.amazon.pl") {
        return jsonResponse(
          searchResponseFor(
            "www.amazon.pl",
            "pl-tag-21",
            1399,
            "PLN"
          )
        );
      }
      return jsonResponse({searchResult: {items: []}});
    });

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      marketplacePartnerTags: {
        "www.amazon.de": "de-tag-21",
        "www.amazon.pl": "pl-tag-21"
      },
      marketplaceConcurrency: 2,
      fetchImpl
    });

    const result = await provider.search({listing});

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls).toEqual(
      expect.arrayContaining([
        {
          marketplace: "www.amazon.de",
          body: expect.objectContaining({
            partnerTag: "de-tag-21",
            marketplace: "www.amazon.de",
            currencyOfPreference: "EUR"
          })
        },
        {
          marketplace: "www.amazon.pl",
          body: expect.objectContaining({
            partnerTag: "pl-tag-21",
            marketplace: "www.amazon.pl",
            currencyOfPreference: "PLN"
          })
        }
      ])
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          marketplace: "www.amazon.de",
          itemPrice: {amount: 329.99, currency: "EUR"},
          shipping: undefined
        }),
        expect.objectContaining({
          marketplace: "www.amazon.pl",
          itemPrice: {amount: 1399, currency: "PLN"},
          shipping: undefined
        })
      ])
    );
  });

  it("keeps successful Amazon locales when another configured locale fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/auth/o2/token")) {
        return jsonResponse({access_token: "partial-token", expires_in: 3600});
      }

      const marketplace = new Headers(init?.headers).get("x-marketplace");
      if (marketplace === "www.amazon.de") {
        return jsonResponse(
          searchResponseFor(
            "www.amazon.de",
            "de-tag-21",
            329.99,
            "EUR"
          )
        );
      }
      return jsonResponse({message: "temporary"}, 503);
    });

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      marketplacePartnerTags: {
        "www.amazon.de": "de-tag-21",
        "www.amazon.pl": "pl-tag-21"
      },
      marketplaceConcurrency: 2,
      fetchImpl
    });

    await expect(provider.search({listing})).resolves.toEqual([
      expect.objectContaining({
        marketplace: "www.amazon.de"
      })
    ]);
  });

  it("accepts Amazon Belgium URLs only for the Belgium marketplace", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith("/auth/o2/token")) {
        return jsonResponse({access_token: "be-token", expires_in: 3600});
      }
      return jsonResponse(
        searchResponseFor(
          "www.amazon.com.be",
          "be-tag-21",
          319.99,
          "EUR"
        )
      );
    });

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      marketplacePartnerTags: {
        "www.amazon.com.be": "be-tag-21"
      },
      fetchImpl
    });

    const result = await provider.search({listing});
    expect(result).toEqual([
      expect.objectContaining({
        marketplace: "www.amazon.com.be",
        url: expect.stringContaining("amazon.com.be")
      })
    ]);
  });

  it("bounds Amazon marketplace fan-out concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/auth/o2/token")) {
        return jsonResponse({access_token: "bounded-token", expires_in: 3600});
      }

      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse({searchResult: {items: []}});
    });

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      marketplacePartnerTags: {
        "www.amazon.de": "de-tag",
        "www.amazon.pl": "pl-tag",
        "www.amazon.fr": "fr-tag"
      },
      marketplaceConcurrency: 2,
      fetchImpl
    });

    await provider.search({listing});
    expect(maxActive).toBe(2);
  });

  it("ignores provider items whose detail URL leaves the Amazon Germany domain", async () => {
    const payload = searchResponse() as {
      searchResult: {
        items: Array<{detailPageURL: string}>;
      };
    };
    payload.searchResult.items[0]!.detailPageURL =
      "https://www.amazon.de.evil.example/dp/B0EXAMPLE01";

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse(payload));

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl
    });

    await expect(provider.search({listing})).resolves.toEqual([]);
  });

  it("keeps Amazon shipping unknown so it cannot become the best landed-price offer", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse(searchResponse()));

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl
    });

    const comparison = await compareWithProviders(listing, [provider], {
      requestId: "amazon-incomplete-shipping"
    });

    expect(comparison.offers).toHaveLength(1);
    expect(comparison.offers[0]).toMatchObject({
      provider: "amazon",
      landedPrice: {amount: 329.99, currency: "EUR"},
      landedPriceComplete: false
    });
    expect(comparison.bestOffer).toBeUndefined();
    expect(
      comparison.providerStatus.find((status) => status.provider === "amazon")
    ).toMatchObject({
      provider: "amazon",
      state: "ok"
    });
  });

  it("coalesces concurrent identical searches and token minting", async () => {
    const cacheObserver = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "shared-token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse(searchResponse()));

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl,
      cacheObserver
    });

    const [first, second] = await Promise.all([
      provider.search({listing}),
      provider.search({listing})
    ]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cacheObserver.mock.calls.map(([event]) => event.outcome)).toEqual([
      "miss",
      "coalesced"
    ]);
  });

  it("does not let one aborted waiter cancel a shared Amazon search", async () => {
    let resolveSearch: ((response: Response) => void) | undefined;
    const searchPending = new Promise<Response>((resolve) => {
      resolveSearch = resolve;
    });

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "shared-token", expires_in: 3600})
      )
      .mockImplementationOnce(() => searchPending);

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl
    });

    const controller = new AbortController();
    const aborted = provider.search({
      listing,
      signal: controller.signal
    });
    const surviving = provider.search({listing});

    controller.abort();
    await expect(aborted).rejects.toThrow("aborted");

    resolveSearch!(jsonResponse(searchResponse()));
    await expect(surviving).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not cache Amazon product data between sequential searches by default", async () => {
    const cacheObserver = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse(searchResponse()))
      .mockResolvedValueOnce(jsonResponse(searchResponse()));

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl,
      cacheObserver
    });

    await provider.search({listing});
    await provider.search({listing});

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(cacheObserver.mock.calls.map(([event]) => event.outcome)).toEqual([
      "miss",
      "miss"
    ]);
  });

  it("caches identical Amazon searches only with an explicit TTL", async () => {
    const cacheObserver = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse(searchResponse()));

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      cacheTtlMs: 60_000,
      fetchImpl,
      cacheObserver
    });

    await provider.search({listing});
    await provider.search({listing});

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cacheObserver.mock.calls.map(([event]) => event.outcome)).toEqual([
      "miss",
      "hit"
    ]);
  });

  it("refreshes the token once after a 401", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "stale", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse({message: "unauthorized"}, 401))
      .mockResolvedValueOnce(
        jsonResponse({access_token: "fresh", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse(searchResponse()));

    const provider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl
    });

    const result = await provider.search({listing});

    expect(result).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(
      new Headers(fetchImpl.mock.calls[3]![1]?.headers).get("authorization")
    ).toBe("Bearer fresh");
  });

  it("returns no candidates for a 404 and surfaces 429 rate limiting", async () => {
    const notFoundFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse({message: "not found"}, 404));

    const notFoundProvider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl: notFoundFetch
    });

    await expect(notFoundProvider.search({listing})).resolves.toEqual([]);

    const rateLimitFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({access_token: "token", expires_in: 3600})
      )
      .mockResolvedValueOnce(jsonResponse({message: "rate limit"}, 429));

    const rateLimitProvider = new AmazonCreatorsProvider({
      credentialId: "id",
      credentialSecret: "secret",
      credentialVersion: "3.2",
      partnerTag: "price-lens-21",
      fetchImpl: rateLimitFetch
    });

    await expect(rateLimitProvider.search({listing})).rejects.toThrow(
      "rate limit"
    );
  });
});

describe("Amazon Creators environment configuration", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_PARTNER_TAG: "price-lens-21"
      })
    ).toBeUndefined();
  });

  it("requires all credential fields when enabled", () => {
    expect(() =>
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1"
      })
    ).toThrow("requires credential");
  });

  it("rejects invalid product-data cache TTL configuration", () => {
    expect(() =>
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_PARTNER_TAG: "price-lens-21",
        AMAZON_CREATORS_CACHE_TTL_MS: "1.5"
      })
    ).toThrow("AMAZON_CREATORS_CACHE_TTL_MS");
  });

  it("rejects an unsupported Amazon marketplace hostname", () => {
    expect(() =>
      new AmazonCreatorsProvider({
        credentialId: "id",
        credentialSecret: "secret",
        credentialVersion: "3.2",
        partnerTag: "price-lens-21",
        marketplace: "www.amazon.com"
      })
    ).toThrow("Unsupported Amazon EU marketplace");
  });

  it("accepts a JSON map of locale-specific Partner Tags", () => {
    expect(
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_MARKETPLACE_PARTNER_TAGS_JSON: JSON.stringify({
          "www.amazon.de": "de-tag-21",
          "www.amazon.pl": "pl-tag-21"
        }),
        AMAZON_MARKETPLACE_SEARCH_CONCURRENCY: "2"
      })
    ).toBeInstanceOf(AmazonCreatorsProvider);
  });

  it("rejects malformed or unsupported marketplace tag maps", () => {
    expect(() =>
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_MARKETPLACE_PARTNER_TAGS_JSON: "{bad-json"
      })
    ).toThrow("JSON object");

    expect(() =>
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_MARKETPLACE_PARTNER_TAGS_JSON: JSON.stringify({
          "www.amazon.com": "us-tag"
        })
      })
    ).toThrow("Unsupported Amazon EU marketplace");
  });

  it("requires at least one marketplace Partner Tag when enabled", () => {
    expect(() =>
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2"
      })
    ).toThrow("at least one marketplace Partner Tag");
  });

  it("rejects invalid Amazon marketplace concurrency", () => {
    expect(() =>
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_PARTNER_TAG: "price-lens-21",
        AMAZON_MARKETPLACE_SEARCH_CONCURRENCY: "0"
      })
    ).toThrow("positive");
  });

  it("creates a Germany provider with assigned credential version", () => {
    expect(
      createAmazonCreatorsProviderFromEnv({
        AMAZON_CREATORS_ENABLED: "1",
        AMAZON_CREATORS_CREDENTIAL_ID: "id",
        AMAZON_CREATORS_CREDENTIAL_SECRET: "secret",
        AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
        AMAZON_PARTNER_TAG: "price-lens-21",
        AMAZON_MARKETPLACE: "www.amazon.de"
      })
    ).toBeInstanceOf(AmazonCreatorsProvider);
  });
});
