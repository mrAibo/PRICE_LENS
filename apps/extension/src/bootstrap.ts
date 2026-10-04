import type {
  BuyerDestination,
  EcommerceListing
} from "@price-lens/contracts";
import {
  createPriceLensLifecycle,
  type PriceLensLifecycle
} from "./lifecycle.js";
import {
  createSearchResultsLifecycle,
  isEbaySearchResultsPage,
  type SearchResultsLifecycle
} from "./search-results.js";
import type {CompareMessage, CompareResponse} from "./messages.js";
import type {ComparisonConsentStore} from "./privacy-consent.js";
import type {BuyerDestinationStore} from "./buyer-destination.js";
import {
  mountPriceLens,
  mountPrivacyConsent,
  mountUnsupportedPriceLens
} from "./ui/render.js";

export interface PriceLensBootstrapOptions {
  document: Document;
  window: Window & typeof globalThis;
  consentStore: ComparisonConsentStore;
  destinationStore?: BuyerDestinationStore;
  sendMessage: (
    message: CompareMessage
  ) => Promise<CompareResponse | undefined>;
}

export interface PriceLensBootstrapController {
  stop(): void;
}

export async function bootstrapPriceLens(
  options: PriceLensBootstrapOptions
): Promise<PriceLensBootstrapController> {
  let lifecycle: PriceLensLifecycle | SearchResultsLifecycle | undefined;
  let stopped = false;
  let buyerDestination: BuyerDestination = {country: "DE"};

  if (options.destinationStore) {
    try {
      buyerDestination =
        (await options.destinationStore.getDestination()) ?? buyerDestination;
    } catch {
      buyerDestination = {country: "DE"};
    }
  }

  async function disableSharing(): Promise<void> {
    lifecycle?.stop();
    lifecycle = undefined;
    await options.consentStore.revokeConsent();
    if (options.destinationStore) {
      try {
        await options.destinationStore.clearDestination();
      } catch {
        // Revocation still succeeds if local preference cleanup is unavailable.
      }
    }
    buyerDestination = {country: "DE"};
    if (!stopped) showConsent();
  }

  function startLifecycle(): void {
    if (stopped) return;
    lifecycle?.stop();

    if (isEbaySearchResultsPage(options.window.location.href)) {
      lifecycle = createSearchResultsLifecycle({
        document: options.document,
        window: options.window,
        sendMessage: options.sendMessage,
        getDestination: () => buyerDestination
      });
      return;
    }

    lifecycle = createPriceLensLifecycle({
      document: options.document,
      window: options.window,
      sendMessage: options.sendMessage,
      mount(document: Document, listing: EcommerceListing, actions) {
        return mountPriceLens(document, listing, {
          onDisableSharing: disableSharing,
          initialDestination: buyerDestination,
          async onRequestComparison(destination, requestOptions) {
            buyerDestination = destination ?? {country: "DE"};
            if (options.destinationStore) {
              try {
                await options.destinationStore.setDestination(buyerDestination);
              } catch {
                // A local storage failure must not block an explicit comparison.
              }
            }
            await actions.onRequestComparison(buyerDestination, requestOptions);
          }
        });
      },
      mountUnsupported(document: Document, message: string) {
        mountUnsupportedPriceLens(document, message, {
          onDisableSharing: disableSharing
        });
      }
    });
  }

  function showConsent(): void {
    if (stopped) return;

    lifecycle?.stop();
    lifecycle = undefined;
    mountPrivacyConsent(options.document, {
      async onEnable() {
        await options.consentStore.grantConsent();
        if (!stopped) startLifecycle();
      },
      onNotNow() {
        options.document.getElementById("price-lens-root")?.remove();
      }
    });
  }

  let hasConsent = false;
  try {
    hasConsent = await options.consentStore.hasConsent();
  } catch {
    hasConsent = false;
  }

  if (hasConsent) {
    startLifecycle();
  } else if (!isEbaySearchResultsPage(options.window.location.href)) {
    showConsent();
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      lifecycle?.stop();
      lifecycle = undefined;
      options.document.getElementById("price-lens-root")?.remove();
    }
  };
}
