import type {EcommerceListing} from "@price-lens/contracts";
import {extractEbayItemId, extractEbayListing} from "./ebay/extract.js";
import type {CompareMessage, CompareResponse} from "./messages.js";
import {
  mountPriceLens,
  mountUnsupportedPriceLens,
  type PriceLensView
} from "./ui/render.js";

export interface PriceLensLifecycleOptions {
  document: Document;
  window: Window & typeof globalThis;
  getPageUrl?: () => string;
  sendMessage: (message: CompareMessage) => Promise<CompareResponse | undefined>;
  mount?: (document: Document, listing: EcommerceListing) => PriceLensView;
  mountUnsupported?: (document: Document, message: string) => void;
  debounceMs?: number;
}

export interface PriceLensLifecycle {
  refreshNow(): Promise<void>;
  scheduleRefresh(): void;
  stop(): void;
}

export function createPriceLensLifecycle(
  options: PriceLensLifecycleOptions
): PriceLensLifecycle {
  const getPageUrl = options.getPageUrl ?? (() => options.window.location.href);
  const mount = options.mount ?? mountPriceLens;
  const mountUnsupported = options.mountUnsupported ?? mountUnsupportedPriceLens;
  const debounceMs = options.debounceMs ?? 250;

  let stopped = false;
  let timer: number | undefined;
  let lastFingerprint: string | undefined;
  let lastItemId: string | undefined;
  let generation = 0;

  const observer = new options.window.MutationObserver(() => scheduleRefresh());
  observer.observe(options.document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  const navigationListener = () => scheduleRefresh();
  options.window.addEventListener("popstate", navigationListener);
  options.window.addEventListener("hashchange", navigationListener);

  async function refreshNow(): Promise<void> {
    if (stopped) return;

    const pageUrl = getPageUrl();
    const urlItemId = extractEbayItemId(pageUrl) ?? undefined;
    const listing = extractEbayListing(options.document, pageUrl);

    if (!listing) {
      if (urlItemId) {
        const unsupportedFingerprint = `unsupported:${urlItemId}`;
        if (lastFingerprint === unsupportedFingerprint) return;

        generation += 1;
        lastFingerprint = unsupportedFingerprint;
        lastItemId = urlItemId;
        mountUnsupported(
          options.document,
          "This eBay listing cannot be compared safely because its current title or price is missing or ambiguous."
        );
        return;
      }

      if (lastFingerprint !== undefined || lastItemId !== undefined) {
        generation += 1;
        lastFingerprint = undefined;
        lastItemId = undefined;
        options.document.getElementById("price-lens-root")?.remove();
      }
      return;
    }

    const fingerprint = listingFingerprint(listing);
    if (fingerprint === lastFingerprint) return;

    lastFingerprint = fingerprint;
    lastItemId = listing.itemId;
    generation += 1;
    const refreshGeneration = generation;

    const view = mount(options.document, listing);
    const message: CompareMessage = {
      type: "PRICE_LENS_COMPARE",
      listing
    };

    try {
      const response = await options.sendMessage(message);
      if (stopped || generation !== refreshGeneration) return;

      if (!response) {
        view.renderError("No comparison response was returned.");
        return;
      }

      if (!response.ok) {
        view.renderError(response.error);
        return;
      }

      view.renderComparison(response.result);
    } catch {
      if (stopped || generation !== refreshGeneration) return;
      view.renderError("Comparison service is unavailable.");
    }
  }

  function scheduleRefresh(): void {
    if (stopped) return;
    if (timer !== undefined) {
      options.window.clearTimeout(timer);
    }
    timer = options.window.setTimeout(() => {
      timer = undefined;
      void refreshNow();
    }, debounceMs);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    generation += 1;
    observer.disconnect();
    options.window.removeEventListener("popstate", navigationListener);
    options.window.removeEventListener("hashchange", navigationListener);
    if (timer !== undefined) {
      options.window.clearTimeout(timer);
      timer = undefined;
    }
  }

  void refreshNow();

  return {
    refreshNow,
    scheduleRefresh,
    stop
  };
}

export function listingFingerprint(listing: EcommerceListing): string {
  const identity = listing.identity;
  return JSON.stringify({
    itemId: listing.itemId,
    title: listing.title,
    price: listing.price,
    shipping: listing.shipping ?? null,
    condition: listing.condition,
    identity: {
      brand: identity.brand ?? null,
      model: identity.model ?? null,
      mpn: identity.mpn ?? null,
      gtin: identity.gtin ?? null,
      ean: identity.ean ?? null,
      upc: identity.upc ?? null,
      variant: {
        storageGb: identity.variant?.storageGb ?? null,
        ramGb: identity.variant?.ramGb ?? null,
        screenSizeInches: identity.variant?.screenSizeInches ?? null,
        packCount: identity.variant?.packCount ?? null
      }
    }
  });
}
