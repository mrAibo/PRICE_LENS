import type {
  BuyerDestination,
  ComparisonResult,
  EcommerceListing,
  ListingCondition,
  MarketOffer
} from "@price-lens/contracts";
import {extractEbayItemId} from "./ebay/extract.js";
import {parseMoneyText} from "./ebay/price.js";
import type {CompareMessage, CompareResponse} from "./messages.js";
import {selectCompactOffers} from "./ui/render.js";

const SEARCH_CARD_SELECTORS = [
  "li.s-item",
  ".srp-results .s-item",
  "[data-view*='mi:1686']"
];

export interface SearchResultsLifecycleOptions {
  document: Document;
  window: Window & typeof globalThis;
  sendMessage: (
    message: CompareMessage
  ) => Promise<CompareResponse | undefined>;
  getDestination?: () => BuyerDestination | undefined;
  debounceMs?: number;
}

export interface SearchResultsLifecycle {
  scanNow(): void;
  scheduleScan(): void;
  stop(): void;
}

interface SearchCardState {
  fingerprint: string;
  host: HTMLElement;
  result?: ComparisonResult;
  inFlight: boolean;
  expanded: boolean;
}

export function isEbaySearchResultsPage(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "ebay.de" || host.endsWith(".ebay.de")) &&
      url.pathname.startsWith("/sch/")
    );
  } catch {
    return false;
  }
}

export function extractEbaySearchCard(card: Element): EcommerceListing | undefined {
  const link =
    card.querySelector<HTMLAnchorElement>("a.s-item__link[href*='/itm/']") ??
    card.querySelector<HTMLAnchorElement>("a[href*='/itm/']");
  const rawHref = link?.href?.trim();
  if (!rawHref || !isAllowedEbayDeItemUrl(rawHref)) return undefined;

  const itemId = extractEbayItemId(rawHref);
  if (!itemId) return undefined;

  const title = cleanSearchTitle(
    readText(card, ".s-item__title") ??
      readText(card, "[role='heading']") ??
      link?.textContent
  );
  if (!title) return undefined;

  const priceText =
    readText(card, ".s-item__price") ??
    readText(card, "[data-testid='item-price']");
  const price = priceText ? parseMoneyText(priceText) : undefined;
  if (!price) return undefined;

  const evidence = [
    "search-card:url:itemId",
    "search-card:dom:title",
    "search-card:dom:price"
  ];
  const shippingText =
    readText(card, ".s-item__shipping") ??
    readText(card, ".s-item__logisticsCost");
  const shipping = shippingText
    ? parseMoneyText(shippingText, {
        fallbackCurrency: price.currency,
        allowFreeText: true
      })
    : undefined;
  if (shipping) evidence.push("search-card:dom:shipping");

  const conditionText =
    readText(card, ".SECONDARY_INFO") ??
    readText(card, ".s-item__condition");
  const condition = normalizeSearchCondition(conditionText);
  if (conditionText) evidence.push("search-card:dom:condition");

  const imageUrl =
    card.querySelector<HTMLImageElement>("img.s-item__image-img")?.src?.trim() ||
    card.querySelector<HTMLImageElement>("img")?.src?.trim() ||
    undefined;
  if (imageUrl) evidence.push("search-card:dom:image");

  return {
    source: "ebay",
    itemId,
    url: canonicalizeItemUrl(rawHref),
    title,
    price,
    ...(shipping ? {shipping} : {}),
    condition,
    identity: {},
    ...(imageUrl ? {imageUrl} : {}),
    extractionEvidence: evidence,
    extractionWarnings: [
      "Search result cards do not expose a strong product identifier; server-side eBay enrichment is required before provider matching."
    ]
  };
}

export function createSearchResultsLifecycle(
  options: SearchResultsLifecycleOptions
): SearchResultsLifecycle {
  const debounceMs = options.debounceMs ?? 250;
  const stateByCard = new WeakMap<Element, SearchCardState>();
  let stopped = false;
  let timer: number | undefined;

  const observer = new options.window.MutationObserver(() => scheduleScan());
  observer.observe(options.document.documentElement, {
    childList: true,
    subtree: true
  });

  function scanNow(): void {
    if (stopped) return;

    for (const card of collectSearchCards(options.document)) {
      const listing = extractEbaySearchCard(card);
      if (!listing) continue;

      const fingerprint = searchCardFingerprint(listing);
      const existing = stateByCard.get(card);
      if (
        existing &&
        existing.fingerprint === fingerprint &&
        existing.host.isConnected
      ) {
        continue;
      }

      existing?.host.remove();
      const state: SearchCardState = {
        fingerprint,
        host: mountSearchCardAction(card, listing),
        inFlight: false,
        expanded: false
      };
      stateByCard.set(card, state);
      wireCardAction(state, listing);
    }
  }

  function wireCardAction(
    state: SearchCardState,
    listing: EcommerceListing
  ): void {
    const shadow = state.host.shadowRoot;
    if (!shadow) return;

    shadow.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof options.window.Element)) return;
      const button = target.closest("[data-price-lens-card-compare]");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      if (state.result) {
        state.expanded = !state.expanded;
        renderSearchCardResult(shadow, state.result, state.expanded);
        return;
      }
      if (state.inFlight) return;

      state.inFlight = true;
      renderSearchCardLoading(shadow);

      const destination = options.getDestination?.();
      const message: CompareMessage = {
        type: "PRICE_LENS_COMPARE",
        listing,
        ...(destination ? {destination} : {})
      };

      void options.sendMessage(message)
        .then((response) => {
          if (stopped || !state.host.isConnected) return;
          if (!response) {
            renderSearchCardError(
              shadow,
              "No comparison response was returned."
            );
            return;
          }
          if (!response.ok) {
            renderSearchCardError(shadow, response.error);
            return;
          }

          state.result = response.result;
          state.expanded = false;
          renderSearchCardResult(shadow, response.result, false);
        })
        .catch(() => {
          if (stopped || !state.host.isConnected) return;
          renderSearchCardError(shadow, "Comparison service is unavailable.");
        })
        .finally(() => {
          state.inFlight = false;
        });
    });
  }

  function scheduleScan(): void {
    if (stopped) return;
    if (timer !== undefined) {
      options.window.clearTimeout(timer);
    }
    timer = options.window.setTimeout(() => {
      timer = undefined;
      scanNow();
    }, debounceMs);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (timer !== undefined) {
      options.window.clearTimeout(timer);
      timer = undefined;
    }
    for (const host of options.document.querySelectorAll(
      "[data-price-lens-search-root]"
    )) {
      host.remove();
    }
  }

  scanNow();

  return {
    scanNow,
    scheduleScan,
    stop
  };
}

function collectSearchCards(document: Document): Element[] {
  const cards = new Set<Element>();
  for (const selector of SEARCH_CARD_SELECTORS) {
    for (const card of document.querySelectorAll(selector)) {
      cards.add(card);
    }
  }
  return [...cards];
}

function mountSearchCardAction(
  card: Element,
  listing: EcommerceListing
): HTMLElement {
  const host = card.ownerDocument.createElement("span");
  host.setAttribute("data-price-lens-search-root", listing.itemId);
  const shadow = host.attachShadow({mode: "open"});
  renderSearchCardIdle(shadow);

  const target =
    card.querySelector(".s-item__info") ??
    card.querySelector(".s-item__details") ??
    card;
  target.appendChild(host);
  return host;
}

function renderSearchCardIdle(root: ShadowRoot): void {
  root.innerHTML = `
    ${searchCardStyles()}
    <button type="button" class="lens" data-price-lens-card-compare
      title="Compare this item with PriceLens" aria-label="Compare this item with PriceLens">
      ◉ PriceLens
    </button>
  `;
}

function renderSearchCardLoading(root: ShadowRoot): void {
  root.innerHTML = `
    ${searchCardStyles()}
    <button type="button" class="lens" disabled>
      ◌ Comparing…
    </button>
  `;
}

function renderSearchCardError(root: ShadowRoot, message: string): void {
  root.innerHTML = `
    ${searchCardStyles()}
    <button type="button" class="lens error-button" data-price-lens-card-compare>
      Retry PriceLens
    </button>
    <div class="result error">${escapeHtml(message)}</div>
  `;
}

function renderSearchCardResult(
  root: ShadowRoot,
  result: ComparisonResult,
  expanded: boolean
): void {
  const compact = selectCompactOffers(result, 3);
  const completeCount = result.offers.filter((offer) => offer.landedPriceComplete)
    .length;

  let body: string;
  if (!result.ebayLandedPriceComplete) {
    body = `
      <div class="result muted">
        Current shipping is unknown. Open the item page for a safe delivered-price ranking.
      </div>
    `;
  } else if (compact.length === 0) {
    body = `
      <div class="result muted">No cheaper complete offer found.</div>
    `;
  } else {
    const visible = expanded ? result.offers : compact;
    body = `
      <div class="result">
        <div class="result-title">Cheaper options</div>
        ${visible.map((offer) => renderOfferRow(result, offer)).join("")}
        ${renderExpandHint(result, compact, expanded)}
      </div>
    `;
  }

  root.innerHTML = `
    ${searchCardStyles()}
    <button type="button" class="lens active" data-price-lens-card-compare
      title="${expanded ? "Collapse PriceLens result" : "Expand PriceLens result"}">
      ◉ PriceLens ${completeCount > 0 ? `· ${completeCount}` : ""}
    </button>
    ${body}
  `;
}

function renderExpandHint(
  result: ComparisonResult,
  compact: MarketOffer[],
  expanded: boolean
): string {
  if (result.offers.length <= compact.length) return "";
  const hidden = result.offers.length - compact.length;
  return `
    <div class="expand-hint">
      ${expanded ? "Click PriceLens to collapse" : `+ ${hidden} more accepted offer${hidden === 1 ? "" : "s"}`}
    </div>
  `;
}

function renderOfferRow(
  result: ComparisonResult,
  offer: MarketOffer
): string {
  const comparable = comparableOfferPrice(
    offer,
    result.ebayLandedPrice.currency
  );
  if (!comparable) {
    return `
      <div class="offer-row">
        <span>${escapeHtml(sourceLabel(offer))}</span>
        <span>${escapeHtml(formatMoney(
          offer.landedPrice.amount,
          offer.landedPrice.currency
        ))}</span>
      </div>
    `;
  }

  const saving = result.ebayLandedPrice.amount - comparable.amount;
  const prefix = offer.fx ? "≈ " : "";
  return `
    <a class="offer-row offer-link" href="${escapeHtml(offer.url)}"
      target="_blank" rel="noopener noreferrer">
      <span>${escapeHtml(sourceLabel(offer))} · ${escapeHtml(conditionLabel(offer.condition))}</span>
      <span>
        ${prefix}${escapeHtml(formatMoney(comparable.amount, comparable.currency))}
        ${saving > 0 ? ` · −${escapeHtml(formatMoney(saving, comparable.currency))}` : ""}
      </span>
    </a>
  `;
}

function comparableOfferPrice(
  offer: MarketOffer,
  comparisonCurrency: string
): {amount: number; currency: string} | undefined {
  if (!offer.landedPriceComplete) return undefined;
  const target = comparisonCurrency.trim().toUpperCase();
  if (
    offer.comparisonLandedPrice?.currency.trim().toUpperCase() === target
  ) {
    return offer.comparisonLandedPrice;
  }
  if (offer.landedPrice.currency.trim().toUpperCase() === target) {
    return offer.landedPrice;
  }
  return undefined;
}

function sourceLabel(offer: MarketOffer): string {
  const labels: Record<string, string> = {
    EBAY_DE: "eBay DE",
    EBAY_PL: "eBay PL",
    EBAY_AT: "eBay AT",
    EBAY_FR: "eBay FR",
    EBAY_IT: "eBay IT",
    EBAY_ES: "eBay ES",
    EBAY_NL: "eBay NL",
    EBAY_BE: "eBay BE",
    "www.amazon.de": "Amazon DE",
    "www.amazon.pl": "Amazon PL",
    "www.amazon.fr": "Amazon FR",
    "www.amazon.it": "Amazon IT",
    "www.amazon.es": "Amazon ES",
    "www.amazon.nl": "Amazon NL",
    "www.amazon.com.be": "Amazon BE"
  };
  return labels[offer.marketplace ?? ""] ??
    (offer.provider === "ebay_market" ? "eBay" : offer.provider);
}

function conditionLabel(condition: ListingCondition): string {
  switch (condition) {
    case "new":
      return "New";
    case "open_box":
      return "Open box";
    case "refurbished":
      return "Refurbished";
    case "used":
      return "Used";
    case "unknown":
      return "Unknown";
  }
}

function normalizeSearchCondition(raw: string | undefined): ListingCondition {
  if (!raw) return "unknown";
  const value = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/refurb|generaluberholt|erneuert/.test(value)) return "refurbished";
  if (/open\s*box|geoffnet|wie\s+neu|neuwertig/.test(value)) return "open_box";
  if (/gebraucht|\bused\b/.test(value)) return "used";
  if (/\bneu\b|\bnew\b/.test(value)) return "new";
  return "unknown";
}

function searchCardFingerprint(listing: EcommerceListing): string {
  return JSON.stringify({
    itemId: listing.itemId,
    title: listing.title,
    price: listing.price,
    shipping: listing.shipping ?? null,
    condition: listing.condition
  });
}

function isAllowedEbayDeItemUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "ebay.de" || host.endsWith(".ebay.de")) &&
      extractEbayItemId(raw) !== null
    );
  } catch {
    return false;
  }
}

function canonicalizeItemUrl(raw: string): string {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function cleanSearchTitle(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^neues angebot\s*/i, "")
    .replace(/^new listing\s*/i, "")
    .trim();
  return cleaned || undefined;
}

function readText(root: Element, selector: string): string | undefined {
  return root.querySelector(selector)?.textContent?.trim() || undefined;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function searchCardStyles(): string {
  return `
    <style>
      :host { all: initial; display:block; margin-top:8px; }
      .lens {
        border:1px solid #b8bdc5;
        border-radius:999px;
        padding:5px 9px;
        background:#fff;
        color:#27313a;
        font:600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        cursor:pointer;
      }
      .lens:hover { background:#f5f7f9; }
      .lens:disabled { cursor:default; opacity:.65; }
      .lens.active { border-color:#8ba997; background:#f5faf7; }
      .error-button { border-color:#d7a7a7; }
      .result {
        box-sizing:border-box;
        margin-top:6px;
        padding:7px 8px;
        border:1px solid #dfe3e7;
        border-radius:8px;
        background:#fff;
        color:#202428;
        font:12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .result-title { margin-bottom:4px; font-weight:700; }
      .muted { color:#62676d; }
      .error { color:#a40000; }
      .offer-row {
        display:flex;
        justify-content:space-between;
        gap:8px;
        padding:4px 0;
        border-top:1px solid #edf0f2;
      }
      .offer-row:first-of-type { border-top:0; }
      .offer-link { color:#174ea6; text-decoration:none; }
      .offer-link:hover { text-decoration:underline; }
      .expand-hint { margin-top:4px; color:#5b6268; }
    </style>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
