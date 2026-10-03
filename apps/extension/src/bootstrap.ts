import type {EcommerceListing} from "@price-lens/contracts";
import {
  createPriceLensLifecycle,
  type PriceLensLifecycle
} from "./lifecycle.js";
import type {CompareMessage, CompareResponse} from "./messages.js";
import type {ComparisonConsentStore} from "./privacy-consent.js";
import {
  mountPriceLens,
  mountPrivacyConsent,
  mountUnsupportedPriceLens
} from "./ui/render.js";

export interface PriceLensBootstrapOptions {
  document: Document;
  window: Window & typeof globalThis;
  consentStore: ComparisonConsentStore;
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
  let lifecycle: PriceLensLifecycle | undefined;
  let stopped = false;

  async function disableSharing(): Promise<void> {
    lifecycle?.stop();
    lifecycle = undefined;
    await options.consentStore.revokeConsent();
    if (!stopped) showConsent();
  }

  function startLifecycle(): void {
    if (stopped) return;
    lifecycle?.stop();

    lifecycle = createPriceLensLifecycle({
      document: options.document,
      window: options.window,
      sendMessage: options.sendMessage,
      mount(document: Document, listing: EcommerceListing, actions) {
        return mountPriceLens(document, listing, {
          onDisableSharing: disableSharing,
          onRequestComparison: actions.onRequestComparison
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
  } else {
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
