import {JSDOM} from "jsdom";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {ComparisonResult, EcommerceListing} from "@price-lens/contracts";
import {
  createPriceLensLifecycle,
  listingFingerprint
} from "../src/lifecycle.js";
import type {CompareMessage, CompareResponse} from "../src/messages.js";
import type {PriceLensView} from "../src/ui/render.js";

afterEach(() => {
  vi.useRealTimers();
});

function listing(itemId = "123456789012", amount = 100): EcommerceListing {
  return {
    source: "ebay",
    itemId,
    url: `https://www.ebay.de/itm/${itemId}`,
    title: "Sony WH-1000XM6",
    price: {amount, currency: "EUR"},
    shipping: {amount: 0, currency: "EUR"},
    condition: "new",
    identity: {
      brand: "Sony",
      model: "WH-1000XM6",
      gtin: "4548736162657"
    },
    extractionEvidence: ["fixture"],
    extractionWarnings: []
  };
}

function result(source: EcommerceListing): ComparisonResult {
  return {
    requestId: "req-" + source.itemId,
    listing: source,
    ebayLandedPrice: source.price,
    ebayLandedPriceComplete: true,
    offers: [],
    providerStatus: [],
    warnings: [],
    generatedAt: "2026-10-02T00:00:00Z"
  };
}

function renderPage(itemId = "123456789012", amount = "100.00"): JSDOM {
  return new JSDOM(`
    <!doctype html><html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"Sony WH-1000XM6",
        "brand":{"@type":"Brand","name":"Sony"},
        "model":"WH-1000XM6",
        "gtin13":"4548736162657",
        "offers":{
          "@type":"Offer",
          "price":"${amount}",
          "priceCurrency":"EUR",
          "itemCondition":"https://schema.org/NewCondition"
        }
      }
      </script>
    </head><body><main></main></body></html>
  `, {
    url: `https://www.ebay.de/itm/${itemId}`
  });
}

describe("listing fingerprint", () => {
  it("is stable for non-comparison metadata", () => {
    const first = listing();
    const second = {
      ...first,
      extractionEvidence: ["different evidence"],
      extractionWarnings: ["different warning"]
    };

    expect(listingFingerprint(first)).toBe(listingFingerprint(second));
  });

  it("changes when the effective listing price changes", () => {
    expect(listingFingerprint(listing("123456789012", 100)))
      .not.toBe(listingFingerprint(listing("123456789012", 101)));
  });

  it("changes when a structured product variant changes", () => {
    const first = listing();
    first.identity.variant = {storageGb: 256, ramGb: 16};

    const second = listing();
    second.identity.variant = {storageGb: 512, ramGb: 16};

    expect(listingFingerprint(first)).not.toBe(listingFingerprint(second));
  });
});

describe("PriceLens content lifecycle", () => {
  it("deduplicates repeated refreshes of the same listing", async () => {
    const dom = renderPage();
    const source = listing();
    const sendMessage = vi.fn(async (_message: CompareMessage): Promise<CompareResponse> => ({
      ok: true,
      result: result(source)
    }));
    const renderComparison = vi.fn();
    const mount = vi.fn((): PriceLensView => ({
      renderComparison,
      renderError: vi.fn()
    }));

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount
    });

    await lifecycle.refreshNow();
    await lifecycle.refreshNow();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(renderComparison).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("refreshes after relevant DOM data changes", async () => {
    const dom = renderPage();
    const sendMessage = vi.fn(async (message: CompareMessage): Promise<CompareResponse> => ({
      ok: false,
      error: String(message.listing.price.amount)
    }));
    const renderError = vi.fn();
    const mount = vi.fn((): PriceLensView => ({
      renderComparison: vi.fn(),
      renderError
    }));

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount
    });

    await lifecycle.refreshNow();

    const script = dom.window.document.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    script!.textContent = script!.textContent!.replace('"100.00"', '"101.00"');

    await lifecycle.refreshNow();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(renderError).toHaveBeenLastCalledWith("101");
    lifecycle.stop();
  });

  it("ignores stale async responses after a newer listing refresh", async () => {
    const dom = renderPage();
    let resolveFirst: ((value: CompareResponse) => void) | undefined;
    const firstResponse = new Promise<CompareResponse>((resolve) => {
      resolveFirst = resolve;
    });

    const sendMessage = vi
      .fn<(message: CompareMessage) => Promise<CompareResponse>>()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({ok: false, error: "newer"});

    const firstRender = vi.fn();
    const secondRender = vi.fn();
    const mount = vi
      .fn<() => PriceLensView>()
      .mockReturnValueOnce({
        renderComparison: firstRender,
        renderError: firstRender
      })
      .mockReturnValueOnce({
        renderComparison: secondRender,
        renderError: secondRender
      });

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount
    });

    await Promise.resolve();

    const script = dom.window.document.querySelector('script[type="application/ld+json"]');
    script!.textContent = script!.textContent!.replace('"100.00"', '"102.00"');

    await lifecycle.refreshNow();
    expect(secondRender).toHaveBeenCalledWith("newer");

    resolveFirst!({ok: false, error: "stale"});
    await firstResponse;
    await Promise.resolve();

    expect(firstRender).not.toHaveBeenCalled();
    lifecycle.stop();
  });
});
