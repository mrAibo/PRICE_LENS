import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import type {
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";
import {
  formatFreshness,
  mountPriceLens,
  selectCompactOffers,
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

  it("starts idle and only invokes the report action when the lens button is pressed", async () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    let calls = 0;
    mountPriceLens(dom.window.document, listing, {
      async onRequestComparison() {
        calls += 1;
      }
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    expect(shadow?.textContent).toContain("Compare with PriceLens");
    expect(shadow?.textContent).toContain("No provider request has been sent");
    expect(calls).toBe(0);

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")?.click();
    await Promise.resolve();

    expect(calls).toBe(1);
  });

  it("passes the selected country and postal code only when the user requests a report", async () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    let destination: unknown;

    mountPriceLens(dom.window.document, listing, {
      initialDestination: {country: "DE", postalCode: "30159"},
      async onRequestComparison(value) {
        destination = value;
      }
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const country = shadow?.querySelector<HTMLSelectElement>(
      "[data-price-lens-country]"
    );
    const postal = shadow?.querySelector<HTMLInputElement>(
      "[data-price-lens-postal]"
    );

    expect(country?.value).toBe("DE");
    expect(postal?.value).toBe("30159");

    if (country) country.value = "PL";
    if (postal) postal.value = "00-001";

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")?.click();
    await Promise.resolve();

    expect(destination).toEqual({
      country: "PL",
      postalCode: "00-001"
    });
  });

  it("rejects an unsafe postal code locally without sending a report", async () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    let calls = 0;

    mountPriceLens(dom.window.document, listing, {
      async onRequestComparison() {
        calls += 1;
      }
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const postal = shadow?.querySelector<HTMLInputElement>(
      "[data-price-lens-postal]"
    );
    if (postal) postal.value = "30159,zip=99999";

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")?.click();
    await Promise.resolve();

    expect(calls).toBe(0);
    expect(shadow?.textContent).toContain("valid postal code");
  });

  it("offers an explicit refresh that bypasses session reuse with the saved destination", async () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const requests: Array<{destination: unknown; forceRefresh: boolean | undefined}> = [];
    const view = mountPriceLens(dom.window.document, listing, {
      initialDestination: {country: "PL", postalCode: "00-001"},
      async onRequestComparison(destination, options) {
        requests.push({
          destination,
          forceRefresh: options?.forceRefresh
        });
      }
    });

    view.renderComparison({
      requestId: "refresh-report",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [],
      providerStatus: [],
      warnings: [],
      generatedAt: "2026-10-04T00:00:00Z"
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    expect(shadow?.textContent).toContain("Refresh report");
    expect(shadow?.textContent).toContain("query the enabled sources again");
    expect(requests).toHaveLength(0);

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-refresh]")?.click();
    await Promise.resolve();

    expect(requests).toEqual([
      {
        destination: {country: "PL", postalCode: "00-001"},
        forceRefresh: true
      }
    ]);
  });

  it("offers explicit Google sign-in only when pilot auth is enabled and the report is restricted", async () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    let signInCalls = 0;
    const view = mountPriceLens(dom.window.document, listing, {
      pilotAuth: {
        getStatus: () => ({enabled: true, signedIn: false}),
        async onSignIn() {
          signInCalls += 1;
        },
        async onSignOut() {}
      }
    });

    view.renderComparison({
      requestId: "pilot-login",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [],
      providerStatus: [
        {provider: "idealo", state: "restricted"},
        {provider: "geizhals", state: "restricted"}
      ],
      warnings: [],
      generatedAt: "2026-10-04T00:00:00Z"
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    expect(shadow?.textContent).toContain("Sign in with Google");
    expect(shadow?.textContent).toContain("short-lived Google OAuth access token");

    shadow
      ?.querySelector<HTMLButtonElement>("[data-price-lens-pilot-signin]")
      ?.click();
    await Promise.resolve();

    expect(signInCalls).toBe(1);
  });

  it("shows pilot enrollment state and a sign-out control without exposing identity data", async () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    let signOutCalls = 0;
    const view = mountPriceLens(dom.window.document, listing, {
      onDisableSharing: async () => {},
      pilotAuth: {
        getStatus: () => ({
          enabled: true,
          signedIn: true,
          tier: "free",
          expiresAt: "2026-10-04T07:15:00Z"
        }),
        async onSignIn() {},
        async onSignOut() {
          signOutCalls += 1;
        }
      }
    });

    view.renderComparison({
      requestId: "pilot-free",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [],
      providerStatus: [
        {provider: "idealo", state: "restricted"},
        {provider: "geizhals", state: "restricted"}
      ],
      warnings: [],
      generatedAt: "2026-10-04T00:00:00Z"
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const text = shadow?.textContent ?? "";
    expect(text).toContain("not enrolled in the private beta");
    expect(text).toContain("Pilot sign-in active · free");
    expect(text).toContain("Sign out of pilot access");
    expect(text).not.toContain("@");

    shadow
      ?.querySelector<HTMLButtonElement>("[data-price-lens-pilot-signout]")
      ?.click();
    await Promise.resolve();

    expect(signOutCalls).toBe(1);
  });

  it("shows restricted comparison sources as private beta without treating them as outages", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "restricted-sources",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [],
      providerStatus: [
        {
          provider: "idealo",
          state: "restricted",
          message: "Private beta"
        },
        {
          provider: "geizhals",
          state: "restricted",
          message: "Private beta"
        },
        {provider: "amazon", state: "unconfigured"}
      ],
      warnings: [],
      generatedAt: "2026-10-04T00:00:00Z"
    };

    view.renderComparison(result);

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const text = shadow?.textContent ?? "";
    expect(text).toContain("Private beta sources");
    expect(text).toContain("Idealo · Geizhals");
    expect(text).toContain("not available in the public plan yet");

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-expand]")?.click();
    expect(shadow?.textContent).toContain("private beta");
    expect(text).not.toContain("temporarily unavailable");
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
    expect(text).toContain("no complete same-currency landed-price comparison is available");
    expect(text).not.toContain("Price providers are not configured yet");
  });

  it("explains why a non-EU offer is not ranked when import costs are unknown", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "import-uncertain-offer",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      ebayLandedCostStatus: "complete",
      offers: [
        {
          provider: "ebay_market",
          providerProductId: "us-cheap",
          productTitle: "Example Product",
          marketplace: "EBAY_DE",
          itemLocationCountry: "US",
          url: "https://www.ebay.de/itm/500000000001",
          condition: "new",
          itemPrice: {amount: 120, currency: "EUR"},
          shipping: {amount: 10, currency: "EUR"},
          landedPrice: {amount: 130, currency: "EUR"},
          landedPriceComplete: false,
          landedCostStatus: "import_costs_unknown",
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        }
      ],
      providerStatus: [{provider: "ebay_market", state: "ok"}],
      warnings: [],
      generatedAt: "2026-10-04T00:00:10Z"
    };

    view.renderComparison(result);

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const text = shadow?.textContent ?? "";

    expect(text).toContain("No cheaper complete offer");
    expect(text).toContain(
      "cross-border offers are excluded from savings ranking because import costs cannot be verified"
    );

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-expand]")?.click();

    const expanded = shadow?.textContent ?? "";
    expect(expanded).toContain("before possible import charges");
    expect(expanded).toContain("Not ranked");
    expect(expanded).toContain("ships from US");
    expect(expanded).toContain("import VAT, duties or handling fees are not confirmed");
    expect(expanded).not.toContain("69,00 € cheaper");
  });

  it("explains when the current eBay listing itself has unknown import costs", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, {
      ...listing,
      itemLocationCountry: "US"
    });

    view.renderComparison({
      requestId: "current-import-uncertain",
      listing: {
        ...listing,
        itemLocationCountry: "US"
      },
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: false,
      ebayLandedCostStatus: "import_costs_unknown",
      offers: [],
      providerStatus: [],
      warnings: [],
      generatedAt: "2026-10-04T00:00:00Z"
    });

    const text = dom.window.document.getElementById("price-lens-root")
      ?.shadowRoot?.textContent ?? "";
    expect(text).toContain("current listing crosses a customs boundary");
    expect(text).toContain("import VAT, duties or handling fees are not confirmed");
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
    expect(text).toContain("Best comparable market price");
    expect(text).toContain("Amazon.de");
    expect(text).toContain("fetched 5 min ago");
    expect(text).toContain("Some price sources are currently unavailable");
    expect(text).toContain("Idealo, Geizhals");
    expect(text).toContain("eBay vs comparable market");
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
    expect(text).not.toContain("Best comparable market price");
  });

  it("groups same-product eBay alternatives by condition and shows seller/market stats", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "ebay-market",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [
        {
          provider: "ebay_market",
          providerProductId: "new-1",
          productTitle: "Example Product New",
          merchant: "top-shop",
          sellerFeedbackPercentage: 99.8,
          sellerFeedbackScore: 18000,
          url: "https://www.ebay.de/itm/200000000001",
          condition: "new",
          itemPrice: {amount: 180, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 180, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-03T17:00:00Z"
        },
        {
          provider: "ebay_market",
          providerProductId: "new-2",
          productTitle: "Example Product New 2",
          url: "https://www.ebay.de/itm/200000000002",
          condition: "new",
          itemPrice: {amount: 190, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 190, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-03T17:00:00Z"
        },
        {
          provider: "ebay_market",
          providerProductId: "refurb-1",
          productTitle: "Example Product Refurbished",
          url: "https://www.ebay.de/itm/200000000003",
          condition: "refurbished",
          itemPrice: {amount: 150, currency: "EUR"},
          shipping: {amount: 5, currency: "EUR"},
          landedPrice: {amount: 155, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-03T17:00:00Z"
        },
        {
          provider: "ebay_market",
          providerProductId: "used-1",
          productTitle: "Example Product Used",
          url: "https://www.ebay.de/itm/200000000004",
          condition: "used",
          itemPrice: {amount: 120, currency: "EUR"},
          landedPrice: {amount: 120, currency: "EUR"},
          landedPriceComplete: false,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-03T17:00:00Z"
        }
      ],
      bestOffer: {
        provider: "ebay_market",
        providerProductId: "new-1",
        productTitle: "Example Product New",
        merchant: "top-shop",
        sellerFeedbackPercentage: 99.8,
        sellerFeedbackScore: 18000,
        url: "https://www.ebay.de/itm/200000000001",
        condition: "new",
        itemPrice: {amount: 180, currency: "EUR"},
        shipping: {amount: 0, currency: "EUR"},
        landedPrice: {amount: 180, currency: "EUR"},
        landedPriceComplete: true,
        confidence: 1,
        matchMethod: "gtin",
        matchReason: "Exact EAN match.",
        fetchedAt: "2026-10-03T17:00:00Z"
      },
      marketMinimum: {amount: 180, currency: "EUR"},
      delta: {
        absolute: {amount: 19, currency: "EUR"},
        percentage: 10.56
      },
      providerStatus: [
        {provider: "ebay_market", state: "ok"}
      ],
      warnings: [],
      generatedAt: "2026-10-03T17:00:10Z"
    };

    view.renderComparison(result);

    const text = dom.window.document.getElementById("price-lens-root")
      ?.shadowRoot?.textContent ?? "";
    expect(text).toContain("eBay market summary");
    expect(text).toContain("New");
    expect(text).toContain("2 matched");
    expect(text).toContain("median");
    expect(text).toContain("19,00");
    expect(text).toContain("cheaper");
    expect(text).toContain("Refurbished");
    expect(text).toContain("Used");
    expect(text).toContain("shipping unknown");
    expect(text).toContain("top-shop");
    expect(text).toContain("99.8% positive");
    expect(text).toContain("18000 feedback");
    expect(text).toContain("eBay alternatives");
  });

  it("keeps the compact cheaper-first report collapsed until the user expands it", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    let comparisonRequests = 0;
    const view = mountPriceLens(dom.window.document, listing, {
      onRequestComparison() {
        comparisonRequests += 1;
      }
    });

    const result: ComparisonResult = {
      requestId: "compact-report",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [
        {
          provider: "ebay_market",
          providerProductId: "new-cheaper",
          productTitle: "Example Product New",
          marketplace: "EBAY_DE",
          url: "https://www.ebay.de/itm/300000000001",
          condition: "new",
          itemPrice: {amount: 180, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 180, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        },
        {
          provider: "ebay_market",
          providerProductId: "refurb-cheaper",
          productTitle: "Example Product Refurbished",
          marketplace: "EBAY_DE",
          url: "https://www.ebay.de/itm/300000000002",
          condition: "refurbished",
          itemPrice: {amount: 150, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 150, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        },
        {
          provider: "amazon",
          providerProductId: "B0MOREEXPENSIVE",
          productTitle: "Example Product",
          marketplace: "www.amazon.de",
          url: "https://www.amazon.de/dp/B0MOREEXPENSIVE",
          condition: "new",
          itemPrice: {amount: 220, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 220, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        }
      ],
      providerStatus: [
        {provider: "ebay_market", state: "ok"},
        {provider: "amazon", state: "ok"}
      ],
      warnings: [],
      generatedAt: "2026-10-04T00:00:10Z"
    };

    view.renderComparison(result);

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const full = shadow?.querySelector<HTMLElement>("[data-price-lens-full-report]");
    const expand = shadow?.querySelector<HTMLButtonElement>("[data-price-lens-expand]");
    const text = shadow?.textContent ?? "";

    expect(text).toContain("Cheaper options found");
    expect(text).toContain("eBay Germany");
    expect(text).toContain("19,00");
    expect(text).toContain("49,00");
    expect(full?.hidden).toBe(true);
    expect(expand?.textContent).toContain("+ Show full report");
    expect(comparisonRequests).toBe(0);

    expand?.click();

    expect(full?.hidden).toBe(false);
    expect(expand?.textContent).toContain("− Hide full report");
    expect(comparisonRequests).toBe(0);
  });

  it("prioritizes same-condition cheaper offers and excludes raw cross-currency prices", () => {
    const result: ComparisonResult = {
      requestId: "compact-selection",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [
        {
          provider: "ebay_market",
          providerProductId: "pln",
          productTitle: "Polish numeric-cheap offer",
          url: "https://www.ebay.pl/itm/1",
          condition: "new",
          itemPrice: {amount: 99, currency: "PLN"},
          shipping: {amount: 0, currency: "PLN"},
          landedPrice: {amount: 99, currency: "PLN"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        },
        {
          provider: "ebay_market",
          providerProductId: "new",
          productTitle: "New cheaper",
          url: "https://www.ebay.de/itm/2",
          condition: "new",
          itemPrice: {amount: 190, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 190, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        },
        {
          provider: "ebay_market",
          providerProductId: "used",
          productTitle: "Used much cheaper",
          url: "https://www.ebay.de/itm/3",
          condition: "used",
          itemPrice: {amount: 120, currency: "EUR"},
          shipping: {amount: 0, currency: "EUR"},
          landedPrice: {amount: 120, currency: "EUR"},
          landedPriceComplete: true,
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        }
      ],
      providerStatus: [{provider: "ebay_market", state: "ok"}],
      warnings: [],
      generatedAt: "2026-10-04T00:00:00Z"
    };

    expect(selectCompactOffers(result).map((offer) => offer.providerProductId)).toEqual([
      "new",
      "used"
    ]);
  });

  it("shows an FX-normalized Polish offer in the compact report while preserving PLN provenance", () => {
    const dom = new JSDOM("<!doctype html><html><body><main></main></body></html>");
    const view = mountPriceLens(dom.window.document, listing);

    const result: ComparisonResult = {
      requestId: "fx-polish",
      listing,
      ebayLandedPrice: {amount: 199, currency: "EUR"},
      ebayLandedPriceComplete: true,
      offers: [
        {
          provider: "ebay_market",
          providerProductId: "pl-1",
          productTitle: "Example Product Polska",
          marketplace: "EBAY_PL",
          itemLocationCountry: "PL",
          url: "https://www.ebay.pl/itm/400000000001",
          condition: "new",
          itemPrice: {amount: 850, currency: "PLN"},
          shipping: {amount: 25, currency: "PLN"},
          landedPrice: {amount: 875, currency: "PLN"},
          landedPriceComplete: true,
          comparisonLandedPrice: {amount: 199 - 10, currency: "EUR"},
          fx: {
            source: "ecb_reference",
            rateDate: "2026-10-02",
            fetchedAt: "2026-10-04T00:00:00Z",
            fromCurrency: "PLN",
            toCurrency: "EUR",
            rate: 0.216
          },
          confidence: 1,
          matchMethod: "gtin",
          matchReason: "Exact EAN match.",
          fetchedAt: "2026-10-04T00:00:00Z"
        }
      ],
      bestOffer: undefined,
      marketMinimum: undefined,
      providerStatus: [{provider: "ebay_market", state: "ok"}],
      warnings: [],
      generatedAt: "2026-10-04T00:00:10Z"
    };

    view.renderComparison(result);

    const text = dom.window.document.getElementById("price-lens-root")
      ?.shadowRoot?.textContent ?? "";
    expect(text).toContain("Cheaper options found");
    expect(text).toContain("eBay Poland");
    expect(text).toContain("≈");
    expect(text).toContain("189,00");
    expect(text).toContain("875,00");
    expect(text).toContain("PLN");
    expect(text).toContain("ECB reference 2026-10-02");
    expect(text).toContain("10,00");
    expect(text).toContain("cheaper");
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
