import {JSDOM} from "jsdom";
import {describe, expect, it, vi} from "vitest";
import type {
  ComparisonResult,
  EcommerceListing,
  MarketOffer
} from "@price-lens/contracts";
import type {CompareMessage, CompareResponse} from "../src/messages.js";
import {
  createSearchResultsLifecycle,
  extractEbaySearchCard,
  isEbaySearchResultsPage
} from "../src/search-results.js";

function renderSearchPage(): JSDOM {
  return new JSDOM(`
    <!doctype html><html><body>
      <ul class="srp-results">
        ${cardHtml("123456789012", "Sony WH-1000XM6", "EUR 349,00", "Kostenloser Versand", "Neu")}
        ${cardHtml("223456789012", "Apple AirPods Pro 3", "EUR 279,00", "EUR 4,99 Versand", "Neu")}
      </ul>
    </body></html>
  `, {
    url: "https://www.ebay.de/sch/i.html?_nkw=headphones"
  });
}

function cardHtml(
  itemId: string,
  title: string,
  price: string,
  shipping: string,
  condition: string
): string {
  return `
    <li class="s-item">
      <div class="s-item__info">
        <a class="s-item__link" href="https://www.ebay.de/itm/${itemId}?hash=test">
          <div class="s-item__title">Neues Angebot ${title}</div>
        </a>
        <span class="s-item__price">${price}</span>
        <span class="s-item__shipping">${shipping}</span>
        <span class="SECONDARY_INFO">${condition}</span>
      </div>
    </li>
  `;
}

function offer(
  id: string,
  amount: number,
  condition: MarketOffer["condition"] = "new"
): MarketOffer {
  return {
    provider: "ebay_market",
    providerProductId: id,
    productTitle: "Sony WH-1000XM6",
    marketplace: "EBAY_DE",
    url: `https://www.ebay.de/itm/${id}`,
    condition,
    itemPrice: {amount, currency: "EUR"},
    shipping: {amount: 0, currency: "EUR"},
    landedPrice: {amount, currency: "EUR"},
    landedPriceComplete: true,
    confidence: 1,
    matchMethod: "gtin",
    matchReason: "Exact EAN match.",
    fetchedAt: "2026-10-04T00:00:00Z"
  };
}

function resultFor(listing: EcommerceListing): ComparisonResult {
  const offers = [
    offer("300000000001", 300),
    offer("300000000002", 310),
    offer("300000000003", 320, "refurbished"),
    offer("300000000004", 330, "used")
  ];
  return {
    requestId: "search-card-report",
    listing,
    ebayLandedPrice: {
      amount: listing.price.amount + (listing.shipping?.amount ?? 0),
      currency: listing.price.currency
    },
    ebayLandedPriceComplete: listing.shipping !== undefined,
    offers,
    bestOffer: offers[0],
    marketMinimum: offers[0]?.landedPrice,
    providerStatus: [{provider: "ebay_market", state: "ok"}],
    warnings: [],
    generatedAt: "2026-10-04T00:00:10Z"
  };
}

describe("eBay search-page detection and extraction", () => {
  it("recognizes only eBay.de search-result URLs", () => {
    expect(
      isEbaySearchResultsPage("https://www.ebay.de/sch/i.html?_nkw=sony")
    ).toBe(true);
    expect(
      isEbaySearchResultsPage("https://www.ebay.de/itm/123456789012")
    ).toBe(false);
    expect(
      isEbaySearchResultsPage("https://evil.example/sch/i.html")
    ).toBe(false);
  });

  it("extracts only the visible search-card fields conservatively", () => {
    const dom = renderSearchPage();
    const card = dom.window.document.querySelector(".s-item");
    expect(card).not.toBeNull();

    const listing = extractEbaySearchCard(card!);

    expect(listing).toMatchObject({
      source: "ebay",
      itemId: "123456789012",
      url: "https://www.ebay.de/itm/123456789012",
      title: "Sony WH-1000XM6",
      price: {amount: 349, currency: "EUR"},
      shipping: {amount: 0, currency: "EUR"},
      condition: "new",
      identity: {}
    });
    expect(listing?.extractionWarnings[0]).toContain(
      "server-side eBay enrichment"
    );
  });

  it("rejects non-eBay item links and ambiguous prices", () => {
    const evil = new JSDOM(`
      <li class="s-item">
        <a class="s-item__link" href="https://evil.example/itm/123456789012">
          <div class="s-item__title">Sony WH-1000XM6</div>
        </a>
        <span class="s-item__price">EUR 300,00</span>
      </li>
    `);
    expect(
      extractEbaySearchCard(evil.window.document.querySelector(".s-item")!)
    ).toBeUndefined();

    const ambiguous = new JSDOM(`
      <li class="s-item">
        <a class="s-item__link" href="https://www.ebay.de/itm/123456789012">
          <div class="s-item__title">Sony WH-1000XM6</div>
        </a>
        <span class="s-item__price">EUR 300,00 bis EUR 350,00</span>
      </li>
    `);
    expect(
      extractEbaySearchCard(ambiguous.window.document.querySelector(".s-item")!)
    ).toBeUndefined();
  });
});

describe("eBay search-card PriceLens lifecycle", () => {
  it("mounts local lens actions without provider traffic and compares only the clicked card", async () => {
    const dom = renderSearchPage();
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> => ({
        ok: true,
        result: resultFor(message.listing)
      })
    );

    const lifecycle = createSearchResultsLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      getDestination: () => ({country: "DE", postalCode: "30159"})
    });

    const roots = dom.window.document.querySelectorAll(
      "[data-price-lens-search-root]"
    );
    expect(roots).toHaveLength(2);
    expect(sendMessage).not.toHaveBeenCalled();

    const firstRoot = roots[0] as HTMLElement;
    const firstButton = firstRoot.shadowRoot?.querySelector<HTMLButtonElement>(
      "[data-price-lens-card-compare]"
    );
    firstButton?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(firstRoot.shadowRoot?.textContent).toContain("Cheaper options");
    });

    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      listing: {itemId: "123456789012"},
      destination: {country: "DE", postalCode: "30159"}
    });
    expect(firstRoot.shadowRoot?.textContent).toContain("eBay DE");
    expect(firstRoot.shadowRoot?.textContent).toContain("+ 1 more accepted offer");

    firstRoot.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-price-lens-card-compare]")
      ?.click();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(firstRoot.shadowRoot?.textContent).toContain(
      "Click PriceLens to collapse"
    );

    lifecycle.scanNow();
    expect(
      dom.window.document.querySelectorAll("[data-price-lens-search-root]")
    ).toHaveLength(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    lifecycle.stop();
    expect(
      dom.window.document.querySelectorAll("[data-price-lens-search-root]")
    ).toHaveLength(0);
  });

  it("discovers newly appended infinite-scroll cards without sending a lookup", () => {
    const dom = renderSearchPage();
    const sendMessage = vi.fn(async (): Promise<CompareResponse> => ({
      ok: false,
      error: "not expected"
    }));
    const lifecycle = createSearchResultsLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage
    });

    const list = dom.window.document.querySelector(".srp-results");
    list?.insertAdjacentHTML(
      "beforeend",
      cardHtml(
        "323456789012",
        "Samsung Galaxy S26",
        "EUR 799,00",
        "Kostenloser Versand",
        "Neu"
      )
    );
    lifecycle.scanNow();

    expect(
      dom.window.document.querySelectorAll("[data-price-lens-search-root]")
    ).toHaveLength(3);
    expect(sendMessage).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("explains partial, private-beta and review-only provider states per card", async () => {
    const dom = renderSearchPage();
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> => {
        const result = resultFor(message.listing);
        result.providerStatus = [
          {
            provider: "ebay_market",
            state: "ok",
            reviewCandidates: [
              {
                providerProductId: "review-1",
                productTitle: "Sony WH-1000XM6 possible variant",
                confidence: 0.72,
                matchMethod: "fuzzy",
                reason: "Variant evidence is not strong enough for automatic matching."
              }
            ]
          },
          {
            provider: "amazon",
            state: "unavailable",
            message: "Amazon request timed out."
          },
          {provider: "idealo", state: "restricted"},
          {provider: "geizhals", state: "restricted"}
        ];
        return {ok: true, result};
      }
    );
    const lifecycle = createSearchResultsLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage
    });

    const root = dom.window.document.querySelector<HTMLElement>(
      "[data-price-lens-search-root]"
    );
    root?.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-price-lens-card-compare]")
      ?.click();

    await vi.waitFor(() => {
      const text = root?.shadowRoot?.textContent ?? "";
      expect(text).toContain("Partial results: Amazon unavailable");
      expect(text).toContain("Private beta: Idealo, Geizhals");
      expect(text).toContain("1 possible match excluded as uncertain");
    });

    root?.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-price-lens-card-compare]")
      ?.click();

    const expanded = root?.shadowRoot?.textContent ?? "";
    expect(expanded).toContain("Amazon request timed out.");
    expect(expanded).toContain("possible match excluded");
    expect(expanded).toContain("72%");
    expect(expanded).toContain("fuzzy");
    expect(expanded).toContain(
      "Variant evidence is not strong enough for automatic matching."
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("does not claim a delivered-price saving when current-card shipping is unknown", async () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <ul class="srp-results">
          <li class="s-item">
            <div class="s-item__info">
              <a class="s-item__link" href="https://www.ebay.de/itm/423456789012">
                <div class="s-item__title">Sony WH-1000XM6</div>
              </a>
              <span class="s-item__price">EUR 349,00</span>
              <span class="SECONDARY_INFO">Neu</span>
            </div>
          </li>
        </ul>
      </body></html>
    `, {
      url: "https://www.ebay.de/sch/i.html?_nkw=sony"
    });
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> => ({
        ok: true,
        result: resultFor(message.listing)
      })
    );
    const lifecycle = createSearchResultsLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage
    });

    const root = dom.window.document.querySelector<HTMLElement>(
      "[data-price-lens-search-root]"
    );
    root?.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-price-lens-card-compare]")
      ?.click();

    await vi.waitFor(() => {
      expect(root?.shadowRoot?.textContent).toContain(
        "Current shipping is unknown"
      );
    });
    expect(root?.shadowRoot?.textContent).not.toContain("Cheaper options");
    lifecycle.stop();
  });
});
