import {describe, expect, it, vi} from "vitest";
import type {
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";
import {
  exchangeGoogleSession,
  requestComparison
} from "../src/api/client.js";

const listing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Example Product",
  price: {amount: 100, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {brand: "Example"},
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

const result: ComparisonResult = {
  requestId: "req-test",
  listing,
  ebayLandedPrice: {amount: 100, currency: "EUR"},
  ebayLandedPriceComplete: true,
  offers: [],
  providerStatus: [],
  warnings: [],
  generatedAt: "2026-10-02T00:00:00Z"
};

describe("PriceLens API client", () => {
  it("posts the normalized listing and accepts a comparison result", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8787/v1/compare");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({listing});
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {"content-type": "application/json"}
      });
    }) as typeof fetch;

    await expect(
      requestComparison(listing, {fetchImpl})
    ).resolves.toEqual(result);
  });

  it("adds the short-lived PriceLens bearer session only when provided", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer aaa.bbb.cccccccccccccccccccccccccccccc");
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {"content-type": "application/json"}
      });
    }) as typeof fetch;

    await requestComparison(listing, {
      fetchImpl,
      sessionToken: "aaa.bbb.cccccccccccccccccccccccccccccc"
    });
  });

  it("posts an explicit buyer destination when provided", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        listing,
        destination: {country: "DE", postalCode: "30159"}
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {"content-type": "application/json"}
      });
    }) as typeof fetch;

    await expect(
      requestComparison(listing, {
        fetchImpl,
        destination: {country: "DE", postalCode: "30159"}
      })
    ).resolves.toEqual(result);
  });

  it("rejects non-success API responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({error: "bad_request"}), {
        status: 400,
        statusText: "Bad Request"
      })
    ) as typeof fetch;

    await expect(
      requestComparison(listing, {fetchImpl})
    ).rejects.toThrow("HTTP 400");
  });

  it("rejects malformed success payloads", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ok: true}), {status: 200})
    ) as typeof fetch;

    await expect(
      requestComparison(listing, {fetchImpl})
    ).rejects.toThrow("invalid comparison payload");
  });
});

describe("PriceLens Google session exchange client", () => {
  it("exchanges a Google access token for a validated short-lived PriceLens session", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8787/v1/session/google");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({
        accessToken: "google-access-token-1234567890"
      });
      return new Response(
        JSON.stringify({
          sessionToken: "aaa.bbb.cccccccccccccccccccccccccccccc",
          expiresAt: "2026-10-04T07:15:00.000Z",
          tier: "pilot"
        }),
        {
          status: 200,
          headers: {"content-type": "application/json"}
        }
      );
    }) as typeof fetch;

    await expect(
      exchangeGoogleSession("google-access-token-1234567890", {fetchImpl})
    ).resolves.toEqual({
      sessionToken: "aaa.bbb.cccccccccccccccccccccccccccccc",
      expiresAt: "2026-10-04T07:15:00.000Z",
      tier: "pilot"
    });
  });

  it("rejects malformed exchange payloads", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        sessionToken: "bad",
        expiresAt: "never",
        tier: "admin"
      }), {status: 200})
    ) as typeof fetch;

    await expect(
      exchangeGoogleSession("google-access-token-1234567890", {fetchImpl})
    ).rejects.toThrow("invalid session payload");
  });
});

