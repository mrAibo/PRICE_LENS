import type {
  ComparisonResult,
  EcommerceListing,
  ListingCondition,
  MarketOffer,
  PriceProviderId,
  ProviderStatus
} from "@price-lens/contracts";

export interface PriceLensView {
  renderComparison(result: ComparisonResult): void;
  renderError(message: string): void;
}

export interface PriceLensUiOptions {
  onDisableSharing?: () => void | Promise<void>;
}

export interface PriceLensConsentOptions {
  onEnable: () => void | Promise<void>;
  onNotNow?: () => void;
}

export function mountPriceLens(
  document: Document,
  listing: EcommerceListing,
  options: PriceLensUiOptions = {}
): PriceLensView {
  const shadow = mountHost(document);
  render(shadow, listing, "loading", undefined, undefined, options);

  return {
    renderComparison(result) {
      render(shadow, listing, "result", result, undefined, options);
    },
    renderError(message) {
      render(shadow, listing, "error", undefined, message, options);
    }
  };
}

export function mountUnsupportedPriceLens(
  document: Document,
  message: string,
  options: PriceLensUiOptions = {}
): void {
  const shadow = mountHost(document);
  shadow.innerHTML = `
    ${baseStyles()}
    <div class="card">
      <div class="head">
        <div class="brand">PriceLens</div>
        <div class="badge">Unsupported</div>
      </div>
      <div class="warn">${escapeHtml(message)}</div>
      <div class="muted" style="margin-top:6px">No market lookup was sent for this page state.</div>
      ${privacyControlMarkup(options)}
    </div>
  `;
  wireDisableSharing(shadow, options);
}

export function mountPrivacyConsent(
  document: Document,
  options: PriceLensConsentOptions
): void {
  const shadow = mountHost(document);
  shadow.innerHTML = `
    ${baseStyles()}
    <div class="card">
      <div class="head">
        <div class="brand">PriceLens</div>
        <div class="badge">Privacy</div>
      </div>
      <div class="consent-title">Enable price comparison?</div>
      <div class="muted consent-copy">
        To compare this eBay item, PriceLens sends the current item ID and URL,
        title, price and shipping, condition, product identifiers and detected
        variant details to the PriceLens API. The API may use the product identity
        to query price providers that are enabled by the operator.
      </div>
      <div class="muted consent-copy">
        PriceLens does not need your eBay cookies, password, account identifier,
        payment data, or unrelated browsing history for this feature.
      </div>
      <div class="actions">
        <button type="button" class="primary" data-price-lens-enable>
          Enable price comparison
        </button>
        <button type="button" class="secondary" data-price-lens-not-now>
          Not now
        </button>
      </div>
      <div class="error" data-price-lens-consent-error hidden></div>
    </div>
  `;

  const enableButton = shadow.querySelector<HTMLButtonElement>(
    "[data-price-lens-enable]"
  );
  const notNowButton = shadow.querySelector<HTMLButtonElement>(
    "[data-price-lens-not-now]"
  );
  const error = shadow.querySelector<HTMLElement>(
    "[data-price-lens-consent-error]"
  );

  enableButton?.addEventListener("click", () => {
    if (!enableButton) return;
    enableButton.disabled = true;
    if (notNowButton) notNowButton.disabled = true;
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    Promise.resolve(options.onEnable()).catch(() => {
      enableButton.disabled = false;
      if (notNowButton) notNowButton.disabled = false;
      if (error) {
        error.hidden = false;
        error.textContent =
          "PriceLens could not save your choice. No listing data was sent.";
      }
    });
  });

  notNowButton?.addEventListener("click", () => {
    options.onNotNow?.();
  });
}

function mountHost(document: Document): ShadowRoot {
  document.getElementById("price-lens-root")?.remove();

  const host = document.createElement("section");
  host.id = "price-lens-root";
  host.setAttribute("aria-label", "PriceLens price comparison");

  const shadow = host.attachShadow({mode: "open"});
  const mountPoint = findMountPoint(document);

  if (mountPoint.parentElement) {
    mountPoint.insertAdjacentElement("afterend", host);
  } else {
    document.body.appendChild(host);
  }

  return shadow;
}

function findMountPoint(document: Document): Element {
  return (
    document.querySelector("#RightSummaryPanel") ??
    document.querySelector('[data-testid="x-price-primary"]') ??
    document.querySelector(".x-price-primary") ??
    document.querySelector("main") ??
    document.body
  );
}

function render(
  root: ShadowRoot,
  listing: EcommerceListing,
  state: "loading" | "result" | "error",
  result?: ComparisonResult,
  errorMessage?: string,
  options: PriceLensUiOptions = {}
): void {
  const statuses = result?.providerStatus ?? [];
  root.innerHTML = `
    ${baseStyles()}
    <div class="card">
      <div class="head">
        <div class="brand">PriceLens</div>
        <div class="badge">MVP</div>
      </div>
      <div class="price">${escapeHtml(formatMoney(listing.price.amount, listing.price.currency))}</div>
      <div class="muted">${escapeHtml(listing.title)}</div>
      ${state === "loading" ? '<div class="muted" style="margin-top:10px">Preparing comparison…</div>' : ""}
      ${state === "error" ? `<div class="error">${escapeHtml(errorMessage ?? "Comparison failed.")}</div>` : ""}
      ${state === "result" ? renderResult(result, statuses) : ""}
      ${privacyControlMarkup(options)}
    </div>
  `;
  wireDisableSharing(root, options);
}

function renderResult(
  result: ComparisonResult | undefined,
  statuses: ProviderStatus[]
): string {
  if (!result) return "";

  const degraded = statuses.filter(
    (status) => status.state === "error" || status.state === "unavailable"
  );
  const providerRows = statuses
    .map((status) => {
      const reviews = status.reviewCandidates?.length ?? 0;
      const reviewSuffix = reviews > 0
        ? ` · ${reviews} need${reviews === 1 ? "s" : ""} review`
        : "";
      return `
        <div class="row">
          <span>${escapeHtml(providerLabel(status.provider))}</span>
          <span class="muted">${escapeHtml(providerStateLabel(status.state) + reviewSuffix)}</span>
        </div>
      `;
    })
    .join("");

  const bestOffer = result.bestOffer;
  const best = bestOffer
    ? `
      <div class="delta">
        Best available market price: ${escapeHtml(
          formatMoney(bestOffer.landedPrice.amount, bestOffer.landedPrice.currency)
        )}
      </div>
      <div class="muted source-meta">
        ${escapeHtml(providerLabel(bestOffer.provider))}
        ${bestOffer.merchant ? ` · ${escapeHtml(bestOffer.merchant)}` : ""}
        ${formatFreshness(bestOffer.fetchedAt, result.generatedAt)
          ? ` · ${escapeHtml(formatFreshness(bestOffer.fetchedAt, result.generatedAt)!)}`
          : ""}
      </div>
    `
    : result.offers.length > 0
      ? '<div class="warn">Offers were found, but mandatory shipping is unavailable, so no complete landed-price comparison is shown.</div>'
      : statuses.some((status) => status.state !== "unconfigured")
        ? '<div class="warn">No complete comparable market offer was found.</div>'
        : '<div class="warn">Price providers are not configured yet.</div>';

  const partialWarning = degraded.length > 0
    ? `<div class="warn">Some price sources are currently unavailable (${escapeHtml(
        degraded.map((status) => providerLabel(status.provider)).join(", ")
      )}). Results are based only on the sources that responded.</div>`
    : "";

  const delta = result.delta
    ? `<div class="muted">eBay vs available market: ${result.delta.percentage > 0 ? "+" : ""}${result.delta.percentage.toFixed(2)}%</div>`
    : "";

  const reviewNotice = renderReviewCandidates(statuses);

  const ebayMarketplace = renderEbayMarketplace(result);

  return `${ebayMarketplace}${best}${delta}${partialWarning}${reviewNotice}<div class="providers">${providerRows}</div>`;
}

function renderEbayMarketplace(result: ComparisonResult): string {
  const offers = result.offers.filter(
    (offer) => offer.provider === "ebay_market"
  );
  if (offers.length === 0) return "";

  const conditions: ListingCondition[] = [
    "new",
    "open_box",
    "refurbished",
    "used",
    "unknown"
  ];
  const rows = conditions
    .map((condition) => {
      const group = offers.filter((offer) => offer.condition === condition);
      if (group.length === 0) return "";

      const complete = group
        .filter((offer) => offer.landedPriceComplete)
        .slice()
        .sort((left, right) => left.landedPrice.amount - right.landedPrice.amount);
      const best = complete[0] ?? group[0]!;
      const priceSummary = complete.length > 0
        ? marketplacePriceSummary(complete)
        : "shipping unknown";
      const seller = marketplaceSellerSummary(best);
      const savings =
        condition === result.listing.condition &&
        result.ebayLandedPriceComplete &&
        best.landedPriceComplete &&
        best.landedPrice.currency === result.ebayLandedPrice.currency &&
        best.landedPrice.amount < result.ebayLandedPrice.amount
          ? ` · ${escapeHtml(formatMoney(
              result.ebayLandedPrice.amount - best.landedPrice.amount,
              best.landedPrice.currency
            ))} cheaper`
          : "";

      return `
        <div class="market-row">
          <div>
            <strong>${escapeHtml(conditionLabel(condition))}</strong>
            <span class="muted"> · ${group.length} matched</span>
          </div>
          <div>
            <a class="offer-link" href="${escapeHtml(best.url)}" target="_blank" rel="noopener noreferrer">
              ${best.landedPriceComplete
                ? escapeHtml(formatMoney(best.landedPrice.amount, best.landedPrice.currency))
                : escapeHtml(formatMoney(best.itemPrice.amount, best.itemPrice.currency)) + " + shipping"}
            </a>
            <span class="muted">${savings}</span>
          </div>
          <div class="muted">${escapeHtml(priceSummary)}${seller ? ` · ${escapeHtml(seller)}` : ""}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="market-box">
      <div class="market-title">Same product on eBay</div>
      <div class="muted">
        Fixed-price listings only. New, open-box, refurbished and used offers are kept separate.
      </div>
      ${rows}
    </div>
  `;
}

function marketplacePriceSummary(offers: MarketOffer[]): string {
  const amounts = offers
    .map((offer) => offer.landedPrice.amount)
    .sort((left, right) => left - right);
  const currency = offers[0]!.landedPrice.currency;
  const minimum = amounts[0]!;
  const maximum = amounts[amounts.length - 1]!;
  const middle = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 === 0
    ? (amounts[middle - 1]! + amounts[middle]!) / 2
    : amounts[middle]!;

  if (amounts.length === 1) {
    return "complete landed price";
  }

  return `${formatMoney(minimum, currency)}–${formatMoney(maximum, currency)} · median ${formatMoney(median, currency)}`;
}

function marketplaceSellerSummary(offer: MarketOffer): string {
  const parts: string[] = [];
  if (offer.merchant) parts.push(offer.merchant);
  if (offer.sellerFeedbackPercentage !== undefined) {
    parts.push(`${offer.sellerFeedbackPercentage.toFixed(1)}% positive`);
  }
  if (offer.sellerFeedbackScore !== undefined) {
    parts.push(`${Math.round(offer.sellerFeedbackScore)} feedback`);
  }
  return parts.join(" · ");
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
      return "Condition unknown";
  }
}

function renderReviewCandidates(statuses: ProviderStatus[]): string {
  const groups = statuses
    .map((status) => ({
      provider: status.provider,
      candidates: (status.reviewCandidates ?? [])
        .slice()
        .sort((left, right) => right.confidence - left.confidence)
    }))
    .filter((group) => group.candidates.length > 0);

  if (groups.length === 0) return "";

  const rows = groups
    .map((group) => {
      const best = group.candidates[0]!;
      const additional = group.candidates.length - 1;
      const confidence = Math.round(
        Math.min(1, Math.max(0, best.confidence)) * 100
      );
      return `
        <div class="review-row">
          <div>
            <strong>${escapeHtml(providerLabel(group.provider))}</strong>:
            ${escapeHtml(best.productTitle)}
          </div>
          <div class="muted">
            ${confidence}% confidence · ${escapeHtml(best.matchMethod)}
            ${additional > 0 ? ` · +${additional} more` : ""}
          </div>
          <div class="muted review-reason">${escapeHtml(best.reason)}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="review-box">
      <div class="review-title">Possible matches excluded from price comparison</div>
      <div class="muted">
        These candidates did not meet the automatic-match threshold, so their prices
        are not used for the best-price or eBay-delta calculation.
      </div>
      ${rows}
    </div>
  `;
}

function privacyControlMarkup(options: PriceLensUiOptions): string {
  if (!options.onDisableSharing) return "";
  return `
    <div class="privacy-control">
      <button type="button" class="link-button" data-price-lens-disable>
        Disable PriceLens data sharing
      </button>
    </div>
  `;
}

function wireDisableSharing(
  root: ShadowRoot,
  options: PriceLensUiOptions
): void {
  if (!options.onDisableSharing) return;
  const button = root.querySelector<HTMLButtonElement>(
    "[data-price-lens-disable]"
  );
  button?.addEventListener("click", () => {
    if (!button) return;
    button.disabled = true;
    Promise.resolve(options.onDisableSharing?.()).catch(() => {
      button.disabled = false;
    });
  });
}

function baseStyles(): string {
  return `
    <style>
      :host { all: initial; }
      .card {
        box-sizing: border-box;
        margin: 16px 0;
        padding: 16px;
        border: 1px solid #d7d9dc;
        border-radius: 12px;
        background: #fff;
        color: #191919;
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,.06);
        max-width: 420px;
      }
      .head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .brand { font-weight:750; font-size:16px; }
      .badge { border-radius:999px; padding:3px 8px; background:#f1f3f5; font-size:12px; }
      .price { margin-top:10px; font-size:20px; font-weight:750; }
      .muted { color:#5c5f62; }
      .warn { margin-top:10px; color:#8a4b00; }
      .error { margin-top:10px; color:#a40000; }
      .providers { margin-top:12px; display:grid; gap:6px; }
      .row { display:flex; justify-content:space-between; gap:12px; }
      .delta { margin-top:10px; font-weight:650; }
      .source-meta { margin-top:3px; }
      .review-box {
        margin-top:12px;
        padding:10px;
        border:1px solid #e0c36b;
        border-radius:8px;
        background:#fffaf0;
      }
      .market-box {
        margin-top:12px;
        padding:10px;
        border:1px solid #cdd8ff;
        border-radius:8px;
        background:#f7f9ff;
      }
      .market-title { font-weight:700; color:#243b7a; }
      .market-row { margin-top:9px; }
      .offer-link { color:#174ea6; font-weight:700; text-decoration:none; }
      .offer-link:hover { text-decoration:underline; }
      .review-title { font-weight:700; color:#6f4d00; }
      .review-row { margin-top:8px; }
      .review-reason { margin-top:2px; }
      .consent-title { margin-top:12px; font-size:16px; font-weight:700; }
      .consent-copy { margin-top:8px; }
      .actions { margin-top:14px; display:flex; flex-wrap:wrap; gap:8px; }
      button {
        font: inherit;
        cursor: pointer;
      }
      button:disabled { cursor: default; opacity: .65; }
      .primary, .secondary {
        border-radius:8px;
        padding:8px 12px;
      }
      .primary {
        border:1px solid #191919;
        background:#191919;
        color:#fff;
      }
      .secondary {
        border:1px solid #c9ccd1;
        background:#fff;
        color:#191919;
      }
      .privacy-control { margin-top:14px; padding-top:10px; border-top:1px solid #eceef0; }
      .link-button {
        border:0;
        padding:0;
        background:transparent;
        color:#4a5568;
        text-decoration:underline;
      }
    </style>
  `;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("de-DE", {style: "currency", currency}).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function providerLabel(provider: PriceProviderId): string {
  switch (provider) {
    case "ebay_market":
      return "eBay alternatives";
    case "idealo":
      return "Idealo";
    case "geizhals":
      return "Geizhals";
    case "amazon":
      return "Amazon";
    case "fixture":
      return "Fixture";
  }
}

function providerStateLabel(state: ProviderStatus["state"]): string {
  switch (state) {
    case "ok":
      return "available";
    case "unconfigured":
      return "not configured";
    case "unavailable":
      return "unavailable";
    case "no_match":
      return "no match";
    case "error":
      return "temporarily unavailable";
  }
}

export function formatFreshness(
  fetchedAt: string,
  generatedAt: string
): string | undefined {
  const fetched = Date.parse(fetchedAt);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(fetched) || !Number.isFinite(generated)) return undefined;

  const ageMs = Math.max(0, generated - fetched);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "fetched just now";
  if (minutes < 60) return `fetched ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `fetched ${hours} h ago`;

  const days = Math.floor(hours / 24);
  return `fetched ${days} d ago`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
