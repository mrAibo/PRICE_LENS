import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";
import {
  formatFreshness,
  mountPriceLens,
  mountUnsupportedPriceLens
} from "../src/ui/render.js";

const listing: EcommerceListing = {
  source: "ebay",
  itemId: "123456789012",
  url: "https://www.ebay.de/itm/123456789012",
  title: "Example Product",
  price: {amount: 199, currency: "EUR"},
  shipping: {amount: 0, currency: "EUR"},
  condition: "new",
  identity: {},
  extractionEvidence: ["fixture"],
  extractionWarnings: []
};

describe("PriceLens unsupported UI", () => {
  it("renders a labelled unsupported card", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");

    mountUnsupportedPriceLens(
      dom.window.document,
      "This listing cannot be compared safely."
    );

    const host = dom.window.document.getElementById("price-lens-root");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.textContent).toContain("Unsupported");
    expect(host?.shadowRoot?.textContent).toContain(
      "This listing cannot be compared safely."
    );
    expect(host?.shadowRoot?.textContent).toContain(
      "No market lookup was sent"
    );
  });

  it("explains incomplete landed-price offers instead of saying providers are unconfigured", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "amazon-incomplete",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [
        {
          provider: "amazon",
          providerProductId: "B0EXAMPLE01",
          productTitle: "Example Product",
          merchant: "Amazon.de",
          url: "https://www.amazon.de/dp/B0EXAMPLE01",
          condition: "new",
          itemPrice: {amount: 189, currency: "EUR"},
          landedPrice: {amount: 189, currency: "EUR"},
          landedPriceComplete: false,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-02T00:00:00Z"
        }
      ],
      providerStatus: [
        {
          provider: "amazon",
          state: "ok",
          message: "1 automatic match(es)."
        }
      ],
      warnings: [],
      generatedAt: "2026-10-02T00:00:00Z"
    };

    view.renderComparison(result);

    const text = dom.window.document.getElementById("price-lens-root")
      ?.shadowRoot?.textContent ?? "";
    expect(text).toContain("mandatory shipping is unavailable");
    expect(text).not.toContain("Price providers are not configured yet");
  });

  it("labels partial provider outages and the best price as available-only", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "partial-result",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [
        {
          provider: "amazon",
          providerProductId: "B0EXAMPLE02",
          productTitle: "Example Product",
          merchant: "Amazon.de",
          url: "https://www.amazon.de/dp/B0EXAMPLE02",
          condition: "new",
          itemPrice: {amount: 189, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 189, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-02T11:55:00Z"
        }
      ],
      bestOffer: {
        provider: "amazon",
        providerProductId: "B0EXAMPLE02",
        productTitle: "Example Product",
        merchant: "Amazon.de",
        url: "https://www.amazon.de/dp/B0EXAMPLE02",
        condition: "new",
        itemPrice: {amount: 189, currency: "EUR"},
        shipping: {amount: 0, currency: "EUR"},
        landedPrice: {amount: 189, currency: "EUR"},
        landedPriceComplete: true,
        confidence: 1,
        matchMethod: "gtin",
        matchReason: "Exact EAN match.",
        fetchedAt: "2026-10-02T11:55:00Z"
      },
      marketMinimum: {amount: 189, currency: "EUR"},
      delta: {
        absolute: {amount: 10, currency: "EUR"},
        percentage: 5.29
      },
      providerStatus: [
        {provider: "amazon", state: "ok"},
        {provider: "idealo", state: "error"},
        {provider: "geizhals", state: "unavailable"}
      ],
      warnings: [],
      generatedAt: "2026-10-02T12:00:00Z"
    };

    view.renderComparison(result);

    const text = dom.window.document.getElementById("price-lens-root")
      ?.shadowRoot?.textContent ?? "";
    expect(text).toContain("Best available market price");
    expect(text).toContain("Amazon.de");
    expect(text).toContain("fetched 5 min ago");
    expect(text).toContain("Some price sources are currently unavailable");
    expect(text).toContain("Idealo, Geizhals");
    expect(text).toContain("eBay vs available market");
    expect(text).toContain("temporarily unavailable");
  });

  it("shows review-only candidates as excluded uncertainty, not market offers", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "review-only",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [],
      providerStatus: [
        {
          provider: "amazon",
          state: "no_match",
          reviewCandidates: [
            {
              providerProductId: "B0REVIEW01",
              productTitle: "Example Product Bundle",
              confidence: 0.74,
              matchMethod: "fuzzy",
              reason: "Product matcher score requires review."
            },
            {
              providerProductId: "B0REVIEW02",
              productTitle: "Example Product Alternate",
              confidence: 0.71,
              matchMethod: "fuzzy",
              reason: "Product matcher score requires review."
            }
          ]
        }
      ],
      warnings: [],
      generatedAt: "2026-10-02T12:00:00Z"
    };

    view.renderComparison(result);

    const text = dom.window.document.getElementById("price-lens-root")
      ?.shadowRoot?.textContent ?? "";

    expect(text).toContain("Possible matches excluded from price comparison");
    expect(text).toContain("Example Product Bundle");
    expect(text).toContain("74% confidence");
    expect(text).toContain("+1 more");
    expect(text).toContain("not used for the best-price");
    expect(text).toContain("2 need review");
    expect(text).not.toContain("Best available market price");
  });

  it("formats offer freshness against the comparison generation time", () => {
    expect(
      formatFreshness(
        "2026-10-02T11:59:45Z",
        "2026-10-02T12:00:00Z"
      )
    ).toBe("fetched just now");
    expect(
      formatFreshness(
        "2026-10-02T10:00:00Z",
        "2026-10-02T12:00:00Z"
      )
    ).toBe("fetched 2 h ago");
    expect(
      formatFreshness(
        "2026-09-30T12:00:00Z",
        "2026-10-02T12:00:00Z"
      )
    ).toBe("fetched 2 d ago");
    expect(formatFreshness("invalid", "2026-10-02T12:00:00Z")).toBeUndefined();
  });

  it("is replaced by the normal card when extraction later succeeds", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");

    mountUnsupportedPriceLens(dom.window.document, "Unsupported");
    mountPriceLens(dom.window.document, listing);

    expect(dom.window.document.querySelectorAll("#price-lens-root")).toHaveLength(1);
    const host = dom.window.document.getElementById("price-lens-root");
    expect(host?.shadowRoot?.textContent).toContain("Example Product");
    expect(host?.shadowRoot?.textContent).not.toContain(
      "No market lookup was sent"
    );
  });
});
