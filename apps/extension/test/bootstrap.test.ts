import {JSDOM} from "jsdom";
import {describe, expect, it, vi} from "vitest";
import type {ComparisonResult} from "@price-lens/contracts";
import {bootstrapPriceLens} from "../src/bootstrap.js";
import type {CompareMessage, CompareResponse} from "../src/messages.js";
import type {ComparisonConsentStore} from "../src/privacy-consent.js";
import type {PilotAuthStatus} from "../src/pilot-session.js";
import type {BuyerDestinationStore} from "../src/buyer-destination.js";

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

function destinationStore(): {
  store: BuyerDestinationStore;
  current: () => {country: string; postalCode?: string} | undefined;
} {
  let value: {country: string; postalCode?: string} | undefined = {
    country: "DE",
    postalCode: "30159"
  };
  return {
    store: {
      async getDestination() {
        return value;
      },
      async setDestination(destination) {
        value = destination;
      },
      async clearDestination() {
        value = undefined;
      }
    },
    current: () => value
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

  it("loads, sends and persists the explicit buyer destination", async () => {
    const dom = renderPage();
    const consent = consentStore(true);
    const destination = destinationStore();
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      destinationStore: destination.store,
      sendMessage
    });

    await vi.waitFor(() => {
      const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
      expect(
        shadow?.querySelector<HTMLInputElement>("[data-price-lens-postal]")?.value
      ).toBe("30159");
    });

    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    const country = shadow?.querySelector<HTMLSelectElement>(
      "[data-price-lens-country]"
    );
    const postal = shadow?.querySelector<HTMLInputElement>(
      "[data-price-lens-postal]"
    );
    if (country) country.value = "PL";
    if (postal) postal.value = "00-001";

    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      destination: {
        country: "PL",
        postalCode: "00-001"
      }
    });
    expect(destination.current()).toEqual({
      country: "PL",
      postalCode: "00-001"
    });

    controller.stop();
  });

  it("uses an explicit private-beta sign-in to force exactly one fresh comparison", async () => {
    const dom = renderPage();
    const consent = consentStore(true);
    let authStatus: PilotAuthStatus = {enabled: true, signedIn: false};
    const getStatus = vi.fn(async () => authStatus);
    const signIn = vi.fn(async () => {
      authStatus = {
        enabled: true,
        signedIn: true,
        tier: "pilot",
        expiresAt: "2026-10-04T07:15:00Z"
      };
      return authStatus;
    });
    const signOut = vi.fn(async () => {
      authStatus = {enabled: true, signedIn: false};
      return authStatus;
    });
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> => ({
        ok: true,
        result: {
          requestId: `pilot-${sendMessage.mock.calls.length}`,
          listing: message.listing,
          ebayLandedPrice: message.listing.price,
          ebayLandedPriceComplete: true,
          offers: [],
          providerStatus:
            signIn.mock.calls.length === 0
              ? [
                  {provider: "idealo", state: "restricted"},
                  {provider: "geizhals", state: "restricted"}
                ]
              : [
                  {provider: "idealo", state: "unconfigured"},
                  {provider: "geizhals", state: "unconfigured"}
                ],
          warnings: [],
          generatedAt: "2026-10-04T00:00:00Z"
        }
      })
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      pilotAuthClient: {getStatus, signIn, signOut},
      sendMessage
    });

    expect(getStatus).toHaveBeenCalledTimes(1);
    const shadow = dom.window.document.getElementById("price-lens-root")?.shadowRoot;
    shadow?.querySelector<HTMLButtonElement>("[data-price-lens-compare]")?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(
        dom.window.document
          .getElementById("price-lens-root")
          ?.shadowRoot?.textContent
      ).toContain("Sign in with Google");
    });

    dom.window.document
      .getElementById("price-lens-root")
      ?.shadowRoot?.querySelector<HTMLButtonElement>(
        "[data-price-lens-pilot-signin]"
      )
      ?.click();

    await vi.waitFor(() => {
      expect(signIn).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledTimes(2);
    });
    expect(
      dom.window.document.getElementById("price-lens-root")?.shadowRoot?.textContent
    ).toContain("Pilot sign-in active · pilot");

    controller.stop();
  });

  it("revokes consent and stops comparison when the user disables sharing", async () => {
    const dom = renderPage();
    const consent = consentStore(true);
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const signOut = vi.fn(async () => ({
      enabled: true,
      signedIn: false
    }));
    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      pilotAuthClient: {
        async getStatus() {
          return {
            enabled: true,
            signedIn: true,
            tier: "pilot",
            expiresAt: "2026-10-04T07:15:00Z"
          };
        },
        async signIn() {
          throw new Error("not used");
        },
        signOut
      },
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
      expect(signOut).toHaveBeenCalledTimes(1);
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

  it("keeps eBay search pages inert until item-page consent already exists", async () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <ul class="srp-results">
          <li class="s-item">
            <div class="s-item__info">
              <a class="s-item__link" href="https://www.ebay.de/itm/523456789012">
                <div class="s-item__title">Sony WH-1000XM6</div>
              </a>
              <span class="s-item__price">EUR 349,00</span>
              <span class="s-item__shipping">Kostenloser Versand</span>
            </div>
          </li>
        </ul>
      </body></html>
    `, {url: "https://www.ebay.de/sch/i.html?_nkw=sony"});
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

    expect(dom.window.document.getElementById("price-lens-root")).toBeNull();
    expect(
      dom.window.document.querySelectorAll("[data-price-lens-search-root]")
    ).toHaveLength(0);
    expect(sendMessage).not.toHaveBeenCalled();
    controller.stop();
  });

  it("mounts search-card lenses after stored consent and sends only the clicked card", async () => {
    const dom = new JSDOM(`
      <!doctype html><html><body>
        <ul class="srp-results">
          <li class="s-item">
            <div class="s-item__info">
              <a class="s-item__link" href="https://www.ebay.de/itm/623456789012">
                <div class="s-item__title">Sony WH-1000XM6</div>
              </a>
              <span class="s-item__price">EUR 349,00</span>
              <span class="s-item__shipping">Kostenloser Versand</span>
              <span class="SECONDARY_INFO">Neu</span>
            </div>
          </li>
        </ul>
      </body></html>
    `, {url: "https://www.ebay.de/sch/i.html?_nkw=sony"});
    const consent = consentStore(true);
    const destination = destinationStore();
    const sendMessage = vi.fn(
      async (message: CompareMessage): Promise<CompareResponse> =>
        responseFor(message)
    );

    const controller = await bootstrapPriceLens({
      document: dom.window.document,
      window: dom.window as unknown as Window & typeof globalThis,
      consentStore: consent.store,
      destinationStore: destination.store,
      sendMessage
    });

    await vi.waitFor(() => {
      expect(
        dom.window.document.querySelectorAll("[data-price-lens-search-root]")
      ).toHaveLength(1);
    });
    expect(sendMessage).not.toHaveBeenCalled();

    dom.window.document
      .querySelector<HTMLElement>("[data-price-lens-search-root]")
      ?.shadowRoot?.querySelector<HTMLButtonElement>(
        "[data-price-lens-card-compare]"
      )
      ?.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      listing: {itemId: "623456789012"},
      destination: {country: "DE", postalCode: "30159"}
    });

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
