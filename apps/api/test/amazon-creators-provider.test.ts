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
      fetchImpl
    });

    const [first, second] = await Promise.all([
      provider.search({listing}),
      provider.search({listing})
    ]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("caches the access token and identical searches", async () => {
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

    await provider.search({listing});
    await provider.search({listing});

    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("rejects a non-German marketplace hostname", () => {
    expect(() =>
      new AmazonCreatorsProvider({
        credentialId: "id",
        credentialSecret: "secret",
        credentialVersion: "3.2",
        partnerTag: "price-lens-21",
        marketplace: "www.amazon.com"
      })
    ).toThrow("amazon.de hostname");
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
