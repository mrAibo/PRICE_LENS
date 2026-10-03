import {describe, expect, it} from "vitest";
import type {EcommerceListing, MarketOffer} from "@price-lens/contracts";
import {
  buildLookupFingerprint,
  calculateDelta,
  calculateLandedPrice,
  createComparisonResult,
  normalizeLookupTitle,
  selectBestOffer
} from "../src/index.js";

const listing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Apple iPhone 16 Pro 256 GB",
  price: {amount: 999, currency: "EUR"},
  shipping: {amount: 4.99, currency: "EUR"},
  condition: "new",
  identity: {brand: "Apple", model: "iPhone 16 Pro", gtin: "1234567890123"},
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

describe("core pricing", () => {
  it("calculates landed price", () => {
    expect(calculateLandedPrice(
      {amount: 100, currency: "eur"},
      {amount: 4.99, currency: "EUR"}
    )).toEqual({value: {amount: 104.99, currency: "EUR"}, complete: true});
  });

  it("marks unknown shipping incomplete", () => {
    expect(calculateLandedPrice({amount: 100, currency: "EUR"})).toEqual({
      value: {amount: 100, currency: "EUR"},
      complete: false
    });
  });

  it("calculates delta", () => {
    expect(calculateDelta(
      {amount: 120, currency: "EUR"},
      {amount: 100, currency: "EUR"}
    )).toEqual({absolute: {amount: 20, currency: "EUR"}, percentage: 20});
  });
});

describe("lookup identity", () => {
  it("prefers GTIN", () => {
    expect(buildLookupFingerprint(listing)).toBe("gtin:1234567890123");
  });

  it("normalizes titles", () => {
    expect(normalizeLookupTitle("  SONY WH-1000XM6 – Neu! ")).toBe("sony wh 1000xm6 neu");
  });
});

describe("comparison", () => {
  it("does not compare raw numeric prices across currencies", () => {
    const offers: MarketOffer[] = [
      {
        provider: "ebay_market",
        productTitle: "Polish offer",
        url: "https://www.ebay.pl/itm/1",
        condition: "new",
        itemPrice: {amount: 899, currency: "PLN"},
        shipping: {amount: 0, currency: "PLN"},
        landedPrice: {amount: 899, currency: "PLN"},
        landedPriceComplete: true,
        confidence: 1,
        matchMethod: "gtin",
        matchReason: "exact GTIN",
        fetchedAt: "2026-10-04T00:00:00Z"
      },
      {
        provider: "ebay_market",
        productTitle: "German offer",
        url: "https://www.ebay.de/itm/2",
        condition: "new",
        itemPrice: {amount: 950, currency: "EUR"},
        shipping: {amount: 0, currency: "EUR"},
        landedPrice: {amount: 950, currency: "EUR"},
        landedPriceComplete: true,
        confidence: 1,
        matchMethod: "gtin",
        matchReason: "exact GTIN",
        fetchedAt: "2026-10-04T00:00:00Z"
      }
    ];

    expect(selectBestOffer(offers, "EUR")?.landedPrice).toEqual({
      amount: 950,
      currency: "EUR"
    });

    const result = createComparisonResult(
      listing,
      offers,
      [{provider: "ebay_market", state: "ok"}],
      "req-currency"
    );
    expect(result.bestOffer?.landedPrice.currency).toBe("EUR");
    expect(result.marketMinimum).toEqual({amount: 950, currency: "EUR"});
  });

  it("selects the cheapest complete landed offer", () => {
    const offers: MarketOffer[] = [
      {
        provider: "idealo",
        productTitle: "Example",
        url: "https://example.test/a",
        condition: "new",
        itemPrice: {amount: 960, currency: "EUR"},
        landedPrice: {amount: 960, currency: "EUR"},
        landedPriceComplete: true,
        confidence: 0.99,
        matchMethod: "gtin",
        matchReason: "exact GTIN",
        fetchedAt: "2026-10-02T00:00:00Z"
      },
      {
        provider: "geizhals",
        productTitle: "Example",
        url: "https://example.test/b",
        condition: "new",
        itemPrice: {amount: 950, currency: "EUR"},
        landedPrice: {amount: 955, currency: "EUR"},
        landedPriceComplete: true,
        confidence: 0.98,
        matchMethod: "gtin",
        matchReason: "exact GTIN",
        fetchedAt: "2026-10-02T00:00:00Z"
      }
    ];

    expect(selectBestOffer(offers)?.provider).toBe("geizhals");
    const result = createComparisonResult(
      listing,
      offers,
      [
        {provider: "idealo", state: "ok"},
        {provider: "geizhals", state: "ok"},
        {provider: "amazon", state: "unconfigured"}
      ],
      "req-test"
    );
    expect(result.marketMinimum?.amount).toBe(955);
    expect(result.delta?.absolute.amount).toBe(48.99);
  });
});
