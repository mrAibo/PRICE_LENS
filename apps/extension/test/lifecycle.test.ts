import {JSDOM} from "jsdom";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {ComparisonResult, EcommerceListing} from "@price-lens/contracts";
import {
  createPriceLensLifecycle,
  listingFingerprint
} from "../src/lifecycle.js";
import type {CompareMessage, CompareResponse} from "../src/messages.js";
import type {
  PriceLensReportActions,
  PriceLensView
} from "../src/ui/render.js";

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

function view(overrides: Partial<PriceLensView> = {}): PriceLensView {
  return {
    renderLoading: vi.fn(),
    renderComparison: vi.fn(),
    renderError: vi.fn(),
    ...overrides
  };
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
  it("extracts and mounts once but sends no comparison until explicitly requested", async () => {
    const dom = renderPage();
    const source = listing();
    const sendMessage = vi.fn(async (_message: CompareMessage): Promise<CompareResponse> => ({
      ok: true,
      result: result(source)
    }));
    const mountedView = view();
    const mount = vi.fn(
      (_document: Document, _listing: EcommerceListing, _actions: PriceLensReportActions) =>
        mountedView
    );

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount
    });

    await lifecycle.refreshNow();
    await lifecycle.refreshNow();

    expect(mount).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();

    const actions = mount.mock.calls[0]![2];
    await actions.onRequestComparison();
    await actions.onRequestComparison();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(mountedView.renderLoading).toHaveBeenCalledTimes(1);
    expect(mountedView.renderComparison).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("shows an explicit unsupported state without sending a comparison request", async () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Ambiguous item">
      </head><body><main></main></body></html>
    `, {
      url: "https://www.ebay.de/itm/123456789012"
    });

    const sendMessage = vi.fn(async (): Promise<CompareResponse> => ({
      ok: false,
      error: "should not be called"
    }));
    const mount = vi.fn(() => view());
    const mountUnsupported = vi.fn();

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount,
      mountUnsupported
    });

    await lifecycle.refreshNow();

    expect(mountUnsupported).toHaveBeenCalledTimes(1);
    expect(mountUnsupported.mock.calls[0]?.[1]).toContain("cannot be compared safely");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mount).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("replaces an unsupported state with an idle report action when extraction becomes safe", async () => {
    const dom = new JSDOM(`
      <!doctype html><html><head>
        <meta property="og:title" content="Late-loading item">
      </head><body><main></main></body></html>
    `, {
      url: "https://www.ebay.de/itm/123456789012"
    });

    const sendMessage = vi.fn(async (message: CompareMessage): Promise<CompareResponse> => ({
      ok: true,
      result: result(message.listing)
    }));
    const mountedView = view();
    const mount = vi.fn(
      (_document: Document, _listing: EcommerceListing, _actions: PriceLensReportActions) =>
        mountedView
    );
    const mountUnsupported = vi.fn();

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount,
      mountUnsupported
    });

    expect(mountUnsupported).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();

    const price = dom.window.document.createElement("div");
    price.setAttribute("data-testid", "x-price-primary");
    price.textContent = "EUR 199,00";
    dom.window.document.body.appendChild(price);

    await lifecycle.refreshNow();

    expect(mount).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();

    await mount.mock.calls[0]![2].onRequestComparison();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(mountedView.renderComparison).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("requires a fresh explicit request after relevant DOM data changes", async () => {
    const dom = renderPage();
    const sendMessage = vi.fn(async (message: CompareMessage): Promise<CompareResponse> => ({
      ok: false,
      error: String(message.listing.price.amount)
    }));
    const firstView = view();
    const secondView = view();
    const mount = vi
      .fn<
        (
          document: Document,
          listing: EcommerceListing,
          actions: PriceLensReportActions
        ) => PriceLensView
      >()
      .mockReturnValueOnce(firstView)
      .mockReturnValueOnce(secondView);

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount
    });

    await lifecycle.refreshNow();
    await mount.mock.calls[0]![2].onRequestComparison();
    expect(firstView.renderError).toHaveBeenCalledWith("100");

    const script = dom.window.document.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    script!.textContent = script!.textContent!.replace('"100.00"', '"101.00"');

    await lifecycle.refreshNow();

    expect(mount).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await mount.mock.calls[1]![2].onRequestComparison();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(secondView.renderError).toHaveBeenCalledWith("101");
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

    const firstView = view();
    const secondView = view();
    const mount = vi
      .fn<
        (
          document: Document,
          listing: EcommerceListing,
          actions: PriceLensReportActions
        ) => PriceLensView
      >()
      .mockReturnValueOnce(firstView)
      .mockReturnValueOnce(secondView);

    const lifecycle = createPriceLensLifecycle({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      sendMessage,
      mount
    });

    await Promise.resolve();
    const firstRequest = mount.mock.calls[0]![2].onRequestComparison();

    const script = dom.window.document.querySelector('script[type="application/ld+json"]');
    script!.textContent = script!.textContent!.replace('"100.00"', '"102.00"');

    await lifecycle.refreshNow();
    await mount.mock.calls[1]![2].onRequestComparison();
    expect(secondView.renderError).toHaveBeenCalledWith("newer");

    resolveFirst!({ok: false, error: "stale"});
    await firstRequest;
    await Promise.resolve();

    expect(firstView.renderError).not.toHaveBeenCalled();
    expect(firstView.renderComparison).not.toHaveBeenCalled();
    lifecycle.stop();
  });
});
