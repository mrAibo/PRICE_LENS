import {describe, expect, it, vi} from "vitest";
import type {
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";
import {requestComparison} from "../src/api/client.js";

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
