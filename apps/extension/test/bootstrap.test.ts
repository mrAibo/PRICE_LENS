import {JSDOM} from "jsdom";
import {describe, expect, it, vi} from "vitest";
import type {ComparisonResult} from "@price-lens/contracts";
import {bootstrapPriceLens} from "../src/bootstrap.js";
import type {CompareMessage, CompareResponse} from "../src/messages.js";
import type {ComparisonConsentStore} from "../src/privacy-consent.js";

function renderPage(): JSDOM {
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
          "price":"399.99",
          "priceCurrency":"EUR",
          "itemCondition":"https://schema.org/NewCondition"
        }
      }
      </script>
    </head><body><main></main></body></html>
  `, {
    url: "https://www.ebay.de/itm/123456789012"
  });
}

function responseFor(message: CompareMessage): CompareResponse {
  const result: ComparisonResult = {
    requestId: "privacy-test",
    listing: message.listing,
    ebayLandedPrice: message.listing.price,
    ebayLandedPriceComplete: true,
    offers: [],
    providerStatus: [],
    warnings: [],
    generatedAt: "2026-10-02T00:00:00Z"
  };
  return {ok: true, result};
}

function consentStore(initial = false): {
  store: ComparisonConsentStore;
  granted: () => boolean;
} {
  let enabled = initial;
  return {
    store: {
      async hasConsent() {
        return enabled;
      },
      async grantConsent() {
        enabled = true;
      },
      async revokeConsent() {
        enabled = false;
      }
    },
    granted: () => enabled
  };
}

describe("privacy-gated PriceLens bootstrap", () => {
  it("sends no comparison data before explicit consent", async () => {
    const dom = renderPage();
    const consent = consentStore(false);
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      sendMessage
    });

    expect(sendMessage).not.toHaveBeenCalled();
    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    expect(shadow?.textContent).toContain("Enable price comparison?");

    const enable = shadow?.querySelector<HTMLButtonElement>(
      "[data-price-lens-enable]"
    );
    enable?.click();

    await vi.waitFor(() => {
      expect(consent.granted()).toBe(true);
      expect(
        dom.window.document.getElementById("price-lens-root")?.shadowRoot?.textContent
      ).toContain("Compare with PriceLens");
    });
    expect(sendMessage).not.toHaveBeenCalled();

    dom.window.document
      .getElementById("price-lens-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")
      ?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    controller.stop();
  });

  it("starts immediately when consent is already stored", async () => {
    const dom = renderPage();
    const consent = consentStore(true);
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      sendMessage
    });

    await vi.waitFor(() => {
      expect(
        dom.window.document.getElementById("price-lens-root")?.shadowRoot?.textContent
      ).toContain("Compare with PriceLens");
    });
    expect(sendMessage).not.toHaveBeenCalled();

    dom.window.document
      .getElementById("price-lens-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")
      ?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    controller.stop();
  });

  it("revokes consent and stops comparison when the user disables sharing", async () => {
    const dom = renderPage();
    const consent = consentStore(true);
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      sendMessage
    });

    await vi.waitFor(() => {
      expect(
        dom.window.document.getElementById("price-lens-root")?.shadowRoot?.textContent
      ).toContain("Compare with PriceLens");
    });
    expect(sendMessage).not.toHaveBeenCalled();

    dom.window.document
      .getElementById("price-lens-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")
      ?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    const disable = dom.window.document
      .getElementById("price-lens-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-price-lens-disable]");
    disable?.click();

    await vi.waitFor(() => {
      expect(consent.granted()).toBe(false);
      expect(
        dom.window.document.getElementById("price-lens-root")?.shadowRoot?.textContent
      ).toContain("Enable price comparison?");
    });

    const script = dom.window.document.querySelector(
      'script[type="application/ld+json"]'
    );
    script!.textContent = script!.textContent!.replace('"399.99"', '"299.99"');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("lets the user decline without persisting or sending data", async () => {
    const dom = renderPage();
    const consent = consentStore(false);
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      sendMessage
    });

    const notNow = dom.window.document
      .getElementById("price-lens-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-price-lens-not-now]");
    notNow?.click();

    expect(dom.window.document.getElementById("price-lens-root")).toBeNull();
    expect(consent.granted()).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();

    controller.stop();
  });
});
