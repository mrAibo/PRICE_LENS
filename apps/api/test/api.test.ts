import {once} from "node:events";
import type {AddressInfo} from "node:net";
import {afterEach, describe, expect, it} from "vitest";
import type {EcommerceListing} from "@price-lens/contracts";
import type {PriceProvider} from "@price-lens/core";
import {createPriceLensServer} from "../src/app.js";
import {createFixtureProvider} from "../src/fixture-provider.js";

const servers: ReturnType<typeof createPriceLensServer>[] = [];

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

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

async function startServer(providers: PriceProvider[] = []): Promise<string> {
  const server = createPriceLensServer({providers});
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("PriceLens HTTP API", () => {
  it("reports deployment readiness without probing external providers", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "price-lens-api"
    });
  });

  it("reports provider configuration", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      providers: {
        idealo: "unconfigured",
        geizhals: "unconfigured",
        amazon: "unconfigured"
      }
    });
  });

  it("reports optional eBay enrichment configuration", async () => {
    const server = createPriceLensServer({
      enrichmentStatus: {ebay: "configured"}
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/health`
    );

    await expect(response.json()).resolves.toMatchObject({
      enrichment: {
        ebay: "configured"
      }
    });
  });

  it("fails open when eBay enrichment is unavailable", async () => {
    const server = createPriceLensServer({
      enrichListing: async () => {
        throw new Error("sandbox unavailable");
      }
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing})
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.listing.identity).toEqual(listing.identity);
    expect(result.listing.extractionWarnings).toContain(
      "eBay API enrichment is currently unavailable; page extraction was used."
    );
  });

  it("returns 503 when the comparison concurrency budget is exhausted", async () => {
    let releaseEnrichment!: () => void;
    let markEnrichmentStarted!: () => void;
    const enrichmentStarted = new Promise<void>((resolve) => {
      markEnrichmentStarted = resolve;
    });
    const enrichmentPending = new Promise<void>((resolve) => {
      releaseEnrichment = resolve;
    });
    const diagnostics: unknown[] = [];

    const server = createPriceLensServer({
      maxConcurrentComparisons: 1,
      enrichListing: async (value) => {
        markEnrichmentStarted();
        await enrichmentPending;
        return value;
      },
      diagnostics: (event) => diagnostics.push(event)
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const first = fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing})
    });
    await enrichmentStarted;

    const overloaded = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing})
    });

    expect(overloaded.status).toBe(503);
    expect(overloaded.headers.get("retry-after")).toBe("1");
    await expect(overloaded.json()).resolves.toMatchObject({
      error: "server_busy"
    });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "request_rejected",
          status: 503,
          reason: "server_busy"
        })
      ])
    );

    releaseEnrichment();
    expect((await first).status).toBe(200);
  });

  it.each([0, -1, 1.5])(
    "rejects invalid comparison concurrency limit %s",
    (limit) => {
      expect(() =>
        createPriceLensServer({maxConcurrentComparisons: limit})
      ).toThrow("maxConcurrentComparisons must be a positive integer");
    }
  );

  it("routes comparisons through the provider orchestrator", async () => {
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        return [{
          provider: "idealo",
          providerProductId: "sony-xm6",
          productTitle: "Sony WH-1000XM6 Black",
          merchant: "Fixture Shop",
          url: "https://example.test/sony-xm6",
          condition: "new",
          identity: {
            brand: "Sony",
            model: "WH-1000XM6",
            ean: "4548736162657"
          },
          itemPrice: {amount: 329, currency: "EUR"},
          shipping: {amount: 4.99, currency: "EUR"},
          fetchedAt: "2026-10-02T00:00:00Z"
        }];
      }
    };

    const baseUrl = await startServer([provider]);
    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing})
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    expect(result.offers).toHaveLength(1);
    expect(result.bestOffer.provider).toBe("idealo");
    expect(result.bestOffer.landedPrice.amount).toBe(333.99);
    expect(result.providerStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({provider: "idealo", state: "ok"}),
        expect.objectContaining({provider: "geizhals", state: "unconfigured"}),
        expect.objectContaining({provider: "amazon", state: "unconfigured"})
      ])
    );
  });

  it("can run a complete local comparison with the explicit fixture provider", async () => {
    const baseUrl = await startServer([createFixtureProvider({discountRatio: 0.1})]);

    const healthResponse = await fetch(`${baseUrl}/health`);
    await expect(healthResponse.json()).resolves.toMatchObject({
      providers: {
        fixture: "configured"
      }
    });

    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing})
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    expect(result.bestOffer).toMatchObject({
      provider: "fixture",
      merchant: "PriceLens Fixture Shop",
      landedPrice: {
        amount: 314.1,
        currency: "EUR"
      },
      confidence: 1
    });
    expect(result.delta).toMatchObject({
      absolute: {
        amount: 34.9,
        currency: "EUR"
      }
    });
    expect(result.providerStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({provider: "fixture", state: "ok"})
      ])
    );
  });

  it("emits privacy-minimized compare diagnostics", async () => {
    const diagnostics: unknown[] = [];
    let nowValue = 1_000;

    const server = createPriceLensServer({
      providers: [createFixtureProvider({discountRatio: 0.1})],
      requestIdFactory: () => "req-diagnostic-001",
      diagnostics: (event) => diagnostics.push(event),
      now: () => {
        nowValue += 7;
        return nowValue;
      }
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/compare`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({listing})
      }
    );

    expect(response.status).toBe(200);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      type: "compare_completed",
      requestId: "req-diagnostic-001",
      route: "/v1/compare",
      status: 200,
      offerCount: 1,
      enrichmentFallback: false,
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider: "fixture",
          state: "ok"
        })
      ])
    });

    const serialized = JSON.stringify(diagnostics[0]);
    expect(serialized).not.toContain(listing.title);
    expect(serialized).not.toContain(listing.itemId);
    expect(serialized).not.toContain(listing.url);
  });

  it("diagnostic sink failures never break the request", async () => {
    const server = createPriceLensServer({
      providers: [createFixtureProvider()],
      diagnostics: () => {
        throw new Error("diagnostic sink unavailable");
      }
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/compare`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({listing})
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      listing: {
        itemId: listing.itemId
      }
    });
  });

  it("uses one request id in both the response header and comparison result", async () => {
    const server = createPriceLensServer({
      providers: [createFixtureProvider({discountRatio: 0.1})],
      requestIdFactory: () => "req-correlation-001"
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing})
    });

    expect(response.headers.get("x-price-lens-request-id")).toBe(
      "req-correlation-001"
    );
    await expect(response.json()).resolves.toMatchObject({
      requestId: "req-correlation-001"
    });
  });

  it("emits a controlled diagnostic for rejected requests", async () => {
    const diagnostics: unknown[] = [];
    const server = createPriceLensServer({
      requestIdFactory: () => "req-rejected-001",
      diagnostics: (event) => diagnostics.push(event)
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/compare`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({listing: {source: "ebay"}})
      }
    );

    expect(response.status).toBe(400);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        type: "request_rejected",
        requestId: "req-rejected-001",
        route: "/v1/compare",
        status: 400,
        reason: "invalid_request"
      })
    ]);
  });

  it("correlates validation errors with the response header", async () => {
    const server = createPriceLensServer({
      requestIdFactory: () => "req-error-001"
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing: {source: "ebay"}})
    });

    expect(response.headers.get("x-price-lens-request-id")).toBe(
      "req-error-001"
    );
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
      requestId: "req-error-001"
    });
  });

  it.each([
    [
      "non-eBay HTTPS URL",
      {
        ...listing,
        url: "https://example.test/itm/123456789012"
      }
    ],
    [
      "mismatched eBay item id",
      {
        ...listing,
        url: "https://www.ebay.de/itm/999999999999"
      }
    ],
    [
      "invalid nested identity type",
      {
        ...listing,
        identity: {
          ...listing.identity,
          brand: 123
        }
      }
    ],
    [
      "invalid structured variant",
      {
        ...listing,
        identity: {
          ...listing.identity,
          variant: {
            packCount: 1.5
          }
        }
      }
    ],
    [
      "invalid condition",
      {
        ...listing,
        condition: "brand_new"
      }
    ]
  ])("rejects %s at the API trust boundary", async (_label, invalidListing) => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing: invalidListing})
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request"
    });
  });

  it.each([
    ["text/plain", "text/plain"],
    ["form encoding", "application/x-www-form-urlencoded"]
  ])("rejects %s comparison requests before provider work", async (_label, contentType) => {
    let providerCalls = 0;
    const diagnostics: unknown[] = [];
    const provider: PriceProvider = {
      id: "idealo",
      async search() {
        providerCalls += 1;
        return [];
      }
    };

    const server = createPriceLensServer({
      providers: [provider],
      requestIdFactory: () => "req-media-type-001",
      diagnostics: (event) => diagnostics.push(event)
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/compare`,
      {
        method: "POST",
        headers: {"content-type": contentType},
        body: JSON.stringify({listing})
      }
    );

    expect(response.status).toBe(415);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: "unsupported_media_type",
      message: "Content-Type must be application/json.",
      requestId: "req-media-type-001"
    });
    expect(providerCalls).toBe(0);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        type: "request_rejected",
        status: 415,
        reason: "unsupported_media_type"
      })
    ]);
  });

  it("accepts application/json with a charset parameter", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json; charset=UTF-8"},
      body: JSON.stringify({listing})
    });

    expect(response.status).toBe(200);
  });

  it("does not expose a permissive CORS preflight for comparison requests", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "OPTIONS",
      headers: {
        origin: "https://example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("rejects malformed comparison requests", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({listing: {source: "ebay"}})
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request"
    });
  });

  it("returns 404 for unknown routes", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/unknown`);
    expect(response.status).toBe(404);
  });
});
