import type {
  BuyerDestination,
  ComparisonResult,
  EcommerceListing,
  ListingCondition,
  MarketOffer,
  PriceProviderId,
  ProviderStatus
} from "@price-lens/contracts";
import {
  normalizeBuyerDestination,
  SUPPORTED_BUYER_COUNTRIES
} from "../buyer-destination.js";

export interface PriceLensView {
  renderLoading(): void;
  renderComparison(result: ComparisonResult): void;
  renderError(message: string): void;
}

export interface PriceLensComparisonRequestOptions {
  forceRefresh?: boolean;
}

export interface PriceLensReportActions {
  onRequestComparison: (
    destination?: BuyerDestination,
    options?: PriceLensComparisonRequestOptions
  ) => void | Promise<void>;
}

export interface PriceLensUiOptions {
  onDisableSharing?: () => void | Promise<void>;
  onRequestComparison?: (
    destination?: BuyerDestination,
    options?: PriceLensComparisonRequestOptions
  ) => void | Promise<void>;
  initialDestination?: BuyerDestination;
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
  render(shadow, listing, "idle", undefined, undefined, options);

  return {
    renderLoading() {
      render(shadow, listing, "loading", undefined, undefined, options);
    },
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
        PriceLens can recognize supported eBay item details locally. It sends the
        current item to the PriceLens API only after you explicitly request a report.
        The report may query price providers enabled by the operator.
      </div>
      <div class="muted consent-copy">
        PriceLens does not need your eBay cookies, password, account identifier,
        payment data, or unrelated browsing history for this feature.
      </div>
      <div class="actions">
        <button type="button" class="primary" data-price-lens-enable>
          Enable PriceLens
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
  state: "idle" | "loading" | "result" | "error",
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
        <div class="badge">${state === "result" ? "Report" : "Ready"}</div>
      </div>
      <div class="price">${escapeHtml(formatMoney(listing.price.amount, listing.price.currency))}</div>
      <div class="muted">${escapeHtml(listing.title)}</div>
      ${state === "idle" ? renderIdleAction(options) : ""}
      ${state === "loading" ? renderLoadingState() : ""}
      ${state === "error" ? renderErrorState(errorMessage, options) : ""}
      ${state === "result" ? renderResult(result, statuses, options) : ""}
      ${privacyControlMarkup(options)}
    </div>
  `;

  wireRequestComparison(root, options);
  wireRefreshComparison(root, options);
  wireFullExpansion(root);
  wireDisableSharing(root, options);
}

function renderIdleAction(options: PriceLensUiOptions): string {
  const destination =
    normalizeBuyerDestination(options.initialDestination) ?? {country: "DE"};
  const countryOptions = SUPPORTED_BUYER_COUNTRIES
    .map(
      (country) =>
        `<option value="${country}"${country === destination.country ? " selected" : ""}>${countryLabel(country)}</option>`
    )
    .join("");

  return `
    <div class="destination-box">
      <div class="section-title">Delivery destination</div>
      <div class="destination-fields">
        <label>
          <span class="field-label">Country</span>
          <select data-price-lens-country>${countryOptions}</select>
        </label>
        <label class="postal-field">
          <span class="field-label">Postal code</span>
          <input
            type="text"
            inputmode="text"
            autocomplete="postal-code"
            maxlength="16"
            placeholder="e.g. 30159"
            value="${escapeHtml(destination.postalCode ?? "")}"
            data-price-lens-postal
          />
        </label>
      </div>
      <div class="muted action-note">
        Postal code is optional but improves calculated shipping. It is sent only when you request this report.
      </div>
      <div class="error" data-price-lens-destination-error hidden></div>
    </div>
    <div class="report-action">
      <button type="button" class="primary compare-button" data-price-lens-compare>
        <span class="lens-icon" aria-hidden="true">◉</span>
        Compare with PriceLens
      </button>
      <div class="muted action-note">
        No provider request has been sent. The report starts only when you press this button.
      </div>
    </div>
  `;
}

function renderLoadingState(): string {
  return `
    <div class="report-action">
      <button type="button" class="primary compare-button" disabled>
        <span class="lens-icon loading-lens" aria-hidden="true">◌</span>
        Comparing…
      </button>
      <div class="muted action-note">Finding trustworthy alternatives and delivered prices.</div>
    </div>
  `;
}

function renderErrorState(
  errorMessage: string | undefined,
  options: PriceLensUiOptions
): string {
  const destination =
    normalizeBuyerDestination(options.initialDestination) ?? {country: "DE"};
  return `
    <div class="error">${escapeHtml(errorMessage ?? "Comparison failed.")}</div>
    <div class="muted action-note">
      Retry destination: ${escapeHtml(countryLabel(destination.country))}
      ${destination.postalCode ? ` · ${escapeHtml(destination.postalCode)}` : ""}
    </div>
    <div class="report-action">
      <button type="button" class="secondary compare-button" data-price-lens-compare>
        Try again
      </button>
    </div>
  `;
}

function renderResult(
  result: ComparisonResult | undefined,
  statuses: ProviderStatus[],
  options: PriceLensUiOptions
): string {
  if (!result) return "";

  const compactOffers = selectCompactOffers(result);
  const compact = renderCompactReport(result, compactOffers);
  const full = renderFullReport(result, statuses);
  const expandable =
    result.offers.length > compactOffers.length ||
    statuses.some((status) => status.reviewCandidates?.length) ||
    statuses.some((status) => status.state !== "ok");

  return `
    ${compact}
    ${renderReportRefresh(result, options)}
    ${renderRestrictedSources(statuses)}
    ${expandable ? `
      <button type="button" class="expand-button" data-price-lens-expand>
        + Show full report${result.offers.length > 0 ? ` (${result.offers.length} matched offers)` : ""}
      </button>
      <div data-price-lens-full-report hidden>
        ${full}
      </div>
    ` : full}
  `;
}

export function selectCompactOffers(
  result: ComparisonResult,
  maxOffers = 5
): MarketOffer[] {
  if (
    !Number.isInteger(maxOffers) ||
    maxOffers < 1 ||
    !result.ebayLandedPriceComplete
  ) {
    return [];
  }

  const currency = result.ebayLandedPrice.currency.toUpperCase();
  const cheaper = result.offers.filter((offer) => {
    const price = comparableOfferPrice(offer, currency);
    return (
      price !== undefined &&
      Number.isFinite(price.amount) &&
      price.amount < result.ebayLandedPrice.amount
    );
  });

  const byPrice = (left: MarketOffer, right: MarketOffer) =>
    comparableOfferPrice(left, currency)!.amount -
      comparableOfferPrice(right, currency)!.amount ||
    right.confidence - left.confidence;

  const selected: MarketOffer[] = [];
  const seen = new Set<string>();
  const add = (offer: MarketOffer | undefined) => {
    if (!offer || selected.length >= maxOffers) return;
    const key = `${offer.provider}:${offer.providerProductId ?? offer.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(offer);
  };

  cheaper
    .filter((offer) => offer.condition === result.listing.condition)
    .sort(byPrice)
    .slice(0, 3)
    .forEach(add);

  const alternateConditions: ListingCondition[] = [
    "open_box",
    "refurbished",
    "used",
    "unknown"
  ];

  for (const condition of alternateConditions) {
    if (condition === result.listing.condition) continue;
    add(
      cheaper
        .filter((offer) => offer.condition === condition)
        .sort(byPrice)[0]
    );
  }

  cheaper
    .slice()
    .sort(byPrice)
    .forEach(add);

  return selected;
}

function renderCompactReport(
  result: ComparisonResult,
  offers: MarketOffer[]
): string {
  if (!result.ebayLandedPriceComplete) {
    return `
      <div class="compact-report">
        <div class="compact-title">PriceLens report</div>
        <div class="warn">
          The current delivered price is incomplete, so savings cannot be ranked safely yet.
        </div>
      </div>
    `;
  }

  if (offers.length === 0) {
    const otherCurrency = result.offers.some(
      (offer) =>
        offer.landedPriceComplete &&
        comparableOfferPrice(
          offer,
          result.ebayLandedPrice.currency
        ) === undefined
    );
    return `
      <div class="compact-report">
        <div class="compact-title">PriceLens report</div>
        <div class="muted">No cheaper complete offer was found in this report.</div>
        ${otherCurrency
          ? '<div class="muted compact-note">Offers in other currencies are not ranked until explicit FX normalization is enabled.</div>'
          : ""}
      </div>
    `;
  }

  const rows = offers.map((offer) => renderCompactOffer(result, offer)).join("");
  return `
    <div class="compact-report">
      <div class="compact-title">Cheaper options found</div>
      <div class="muted compact-note">
        Best actionable results first. Different conditions stay clearly labelled.
      </div>
      <div class="compact-offers">${rows}</div>
    </div>
  `;
}

function renderCompactOffer(
  result: ComparisonResult,
  offer: MarketOffer
): string {
  const comparisonPrice = comparableOfferPrice(
    offer,
    result.ebayLandedPrice.currency
  )!;
  const saving = result.ebayLandedPrice.amount - comparisonPrice.amount;
  const savingPercent =
    result.ebayLandedPrice.amount > 0
      ? (saving / result.ebayLandedPrice.amount) * 100
      : 0;
  const seller = marketplaceSellerSummary(offer);

  return `
    <div class="compact-offer">
      <div class="offer-head">
        <strong>${escapeHtml(conditionLabel(offer.condition))}</strong>
        <span class="muted">${escapeHtml(offerSourceLabel(offer))}</span>
      </div>
      <a class="offer-link offer-price" href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">
        ${offer.fx ? "≈ " : ""}${escapeHtml(formatMoney(comparisonPrice.amount, comparisonPrice.currency))}
      </a>
      ${renderFxOriginalPrice(offer)}
      <div class="saving">
        ${escapeHtml(formatMoney(saving, comparisonPrice.currency))} cheaper
        · ${savingPercent.toFixed(1)}%
      </div>
      ${seller ? `<div class="muted">${escapeHtml(seller)}</div>` : ""}
    </div>
  `;
}

function renderRestrictedSources(statuses: ProviderStatus[]): string {
  const restricted = statuses.filter((status) => status.state === "restricted");
  if (restricted.length === 0) return "";

  return `
    <div class="restricted-box">
      <strong>Private beta sources</strong>
      <div class="muted">
        ${escapeHtml(
          restricted.map((status) => providerLabel(status.provider)).join(" · ")
        )} — not available in the public plan yet.
      </div>
    </div>
  `;
}

function renderFullReport(
  result: ComparisonResult,
  statuses: ProviderStatus[]
): string {
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
        Best comparable market price: ${result.marketMinimum
          ? `${bestOffer.fx ? "≈ " : ""}${escapeHtml(
              formatMoney(result.marketMinimum.amount, result.marketMinimum.currency)
            )}`
          : "unavailable"}
      </div>
      <div class="muted source-meta">
        ${escapeHtml(offerSourceLabel(bestOffer))}
        ${bestOffer.merchant ? ` · ${escapeHtml(bestOffer.merchant)}` : ""}
        ${formatFreshness(bestOffer.fetchedAt, result.generatedAt)
          ? ` · ${escapeHtml(formatFreshness(bestOffer.fetchedAt, result.generatedAt)!)}`
          : ""}
      </div>
    `
    : result.offers.length > 0
      ? '<div class="warn">Offers were found, but no complete same-currency landed-price comparison is available.</div>'
      : statuses.some((status) => status.state !== "unconfigured")
        ? '<div class="warn">No complete comparable market offer was found.</div>'
        : '<div class="warn">Price providers are not configured yet.</div>';

  const partialWarning = degraded.length > 0
    ? `<div class="warn">Some price sources are currently unavailable (${escapeHtml(
        degraded.map((status) => providerLabel(status.provider)).join(", ")
      )}). Results are based only on the sources that responded.</div>`
    : "";

  const delta = result.delta
    ? `<div class="muted">eBay vs comparable market: ${result.delta.percentage > 0 ? "+" : ""}${result.delta.percentage.toFixed(2)}%</div>`
    : "";

  return `
    <div class="full-report">
      <div class="full-title">Full report</div>
      ${renderAllOffers(result)}
      ${renderEbayMarketplace(result)}
      ${best}
      ${delta}
      ${partialWarning}
      ${renderReviewCandidates(statuses)}
      <div class="providers">${providerRows}</div>
    </div>
  `;
}

function renderAllOffers(result: ComparisonResult): string {
  if (result.offers.length === 0) return "";

  const conditionRank = new Map<ListingCondition, number>([
    ["new", 0],
    ["open_box", 1],
    ["refurbished", 2],
    ["used", 3],
    ["unknown", 4]
  ]);

  const sorted = result.offers
    .slice()
    .sort((left, right) => {
      const conditionDifference =
        (conditionRank.get(left.condition) ?? 99) -
        (conditionRank.get(right.condition) ?? 99);
      if (conditionDifference !== 0) return conditionDifference;
      const leftComparable = comparableOfferPrice(
        left,
        result.ebayLandedPrice.currency
      );
      const rightComparable = comparableOfferPrice(
        right,
        result.ebayLandedPrice.currency
      );
      if (leftComparable && rightComparable) {
        return leftComparable.amount - rightComparable.amount;
      }
      if (leftComparable !== undefined || rightComparable !== undefined) {
        return leftComparable ? -1 : 1;
      }
      const currencyDifference = left.landedPrice.currency.localeCompare(
        right.landedPrice.currency
      );
      if (currencyDifference !== 0) return currencyDifference;
      if (left.landedPriceComplete !== right.landedPriceComplete) {
        return left.landedPriceComplete ? -1 : 1;
      }
      return left.landedPrice.amount - right.landedPrice.amount;
    });

  const rows = sorted.map((offer) => {
    const seller = marketplaceSellerSummary(offer);
    const comparisonPrice = comparableOfferPrice(
      offer,
      result.ebayLandedPrice.currency
    );
    const price = offer.landedPriceComplete
      ? comparisonPrice
        ? `${offer.fx ? "≈ " : ""}${formatMoney(
            comparisonPrice.amount,
            comparisonPrice.currency
          )}`
        : formatMoney(offer.landedPrice.amount, offer.landedPrice.currency)
      : `${formatMoney(offer.itemPrice.amount, offer.itemPrice.currency)} + shipping unknown`;
    return `
      <div class="all-offer-row">
        <div class="offer-head">
          <strong>${escapeHtml(conditionLabel(offer.condition))}</strong>
          <span class="muted">${escapeHtml(offerSourceLabel(offer))}</span>
        </div>
        <a class="offer-link" href="${escapeHtml(offer.url)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(price)}
        </a>
        ${renderFxOriginalPrice(offer)}
        ${seller ? `<div class="muted">${escapeHtml(seller)}</div>` : ""}
      </div>
    `;
  }).join("");

  return `
    <div class="all-offers">
      <div class="section-title">All accepted offers</div>
      ${rows}
    </div>
  `;
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
        .filter(
          (offer) =>
            comparableOfferPrice(
              offer,
              result.ebayLandedPrice.currency
            ) !== undefined
        )
        .slice()
        .sort(
          (left, right) =>
            comparableOfferPrice(left, result.ebayLandedPrice.currency)!.amount -
            comparableOfferPrice(right, result.ebayLandedPrice.currency)!.amount
        );
      const best = complete[0] ?? group[0]!;
      const priceSummary = complete.length > 0
        ? marketplacePriceSummary(
            complete,
            result.ebayLandedPrice.currency
          )
        : "no complete comparable landed price";
      const seller = marketplaceSellerSummary(best);

      return `
        <div class="market-row">
          <div>
            <strong>${escapeHtml(conditionLabel(condition))}</strong>
            <span class="muted"> · ${group.length} matched</span>
          </div>
          <div class="muted">${escapeHtml(priceSummary)}${seller ? ` · ${escapeHtml(seller)}` : ""}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="market-box">
      <div class="market-title">eBay market summary</div>
      <div class="muted">
        Fixed-price listings only. Conditions remain separate.
      </div>
      ${rows}
    </div>
  `;
}

function marketplacePriceSummary(
  offers: MarketOffer[],
  comparisonCurrency: string
): string {
  const prices = offers
    .map((offer) => comparableOfferPrice(offer, comparisonCurrency))
    .filter((price): price is {amount: number; currency: string} => price !== undefined);
  const amounts = prices
    .map((price) => price.amount)
    .sort((left, right) => left - right);
  const currency = comparisonCurrency;
  const minimum = amounts[0]!;
  const maximum = amounts[amounts.length - 1]!;
  const middle = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 === 0
    ? (amounts[middle - 1]! + amounts[middle]!) / 2
    : amounts[middle]!;

  if (amounts.length === 1) {
    return formatMoney(minimum, currency);
  }

  return `${formatMoney(minimum, currency)}–${formatMoney(maximum, currency)} · median ${formatMoney(median, currency)}`;
}

function comparableOfferPrice(
  offer: MarketOffer,
  comparisonCurrency: string
): {amount: number; currency: string} | undefined {
  if (!offer.landedPriceComplete) return undefined;
  const target = comparisonCurrency.trim().toUpperCase();

  if (
    offer.comparisonLandedPrice &&
    offer.comparisonLandedPrice.currency.trim().toUpperCase() === target
  ) {
    return offer.comparisonLandedPrice;
  }

  if (offer.landedPrice.currency.trim().toUpperCase() === target) {
    return offer.landedPrice;
  }

  return undefined;
}

function renderFxOriginalPrice(offer: MarketOffer): string {
  if (!offer.fx || !offer.comparisonLandedPrice) return "";
  return `
    <div class="muted fx-meta">
      ${escapeHtml(formatMoney(offer.landedPrice.amount, offer.landedPrice.currency))}
      delivered · ECB reference ${escapeHtml(offer.fx.rateDate)}
    </div>
  `;
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
        are not used for the best-price calculation.
      </div>
      ${rows}
    </div>
  `;
}

function renderReportRefresh(
  result: ComparisonResult,
  options: PriceLensUiOptions
): string {
  if (!options.onRequestComparison) return "";

  const generated = formatReportGeneratedAt(result.generatedAt);
  return `
    <div class="report-refresh">
      <div class="muted">
        ${generated ? `Report generated ${escapeHtml(generated)}.` : "Recent report."}
        Reopening the same item can reuse the recent result in this tab.
      </div>
      <button type="button" class="secondary refresh-button" data-price-lens-refresh>
        Refresh report
      </button>
    </div>
  `;
}

function formatReportGeneratedAt(generatedAt: string): string | undefined {
  const value = Date.parse(generatedAt);
  if (!Number.isFinite(value)) return undefined;

  try {
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return undefined;
  }
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

function wireRequestComparison(
  root: ShadowRoot,
  options: PriceLensUiOptions
): void {
  if (!options.onRequestComparison) return;
  const button = root.querySelector<HTMLButtonElement>(
    "[data-price-lens-compare]"
  );
  button?.addEventListener("click", () => {
    if (!button) return;

    const destination = readBuyerDestinationFromUi(
      root,
      options.initialDestination
    );
    if (!destination) {
      const error = root.querySelector<HTMLElement>(
        "[data-price-lens-destination-error]"
      );
      if (error) {
        error.hidden = false;
        error.textContent =
          "Enter a valid postal code using letters, numbers, spaces or hyphens.";
      }
      return;
    }

    options.initialDestination = destination;
    button.disabled = true;
    Promise.resolve(options.onRequestComparison?.(destination)).catch(() => {
      button.disabled = false;
    });
  });
}

function wireRefreshComparison(
  root: ShadowRoot,
  options: PriceLensUiOptions
): void {
  if (!options.onRequestComparison) return;

  const button = root.querySelector<HTMLButtonElement>(
    "[data-price-lens-refresh]"
  );
  button?.addEventListener("click", () => {
    if (!button) return;
    button.disabled = true;
    Promise.resolve(
      options.onRequestComparison?.(
        normalizeBuyerDestination(options.initialDestination) ?? {country: "DE"},
        {forceRefresh: true}
      )
    ).catch(() => {
      button.disabled = false;
    });
  });
}

function readBuyerDestinationFromUi(
  root: ShadowRoot,
  fallback: BuyerDestination | undefined
): BuyerDestination | undefined {
  const country = root.querySelector<HTMLSelectElement>(
    "[data-price-lens-country]"
  );
  const postal = root.querySelector<HTMLInputElement>(
    "[data-price-lens-postal]"
  );

  if (!country) {
    return normalizeBuyerDestination(fallback) ?? {country: "DE"};
  }

  return normalizeBuyerDestination({
    country: country.value,
    postalCode: postal?.value ?? ""
  });
}

function wireFullExpansion(root: ShadowRoot): void {
  const button = root.querySelector<HTMLButtonElement>(
    "[data-price-lens-expand]"
  );
  const full = root.querySelector<HTMLElement>(
    "[data-price-lens-full-report]"
  );
  if (!button || !full) return;

  button.addEventListener("click", () => {
    const willOpen = full.hidden;
    full.hidden = !willOpen;
    button.textContent = willOpen
      ? "− Hide full report"
      : `+ Show full report${fullOfferCount(root)}`;
  });
}

function fullOfferCount(root: ShadowRoot): string {
  const count = root.querySelectorAll(".all-offer-row").length;
  return count > 0 ? ` (${count} matched offers)` : "";
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
        max-width: 440px;
      }
      .head, .offer-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .brand { font-weight:750; font-size:16px; }
      .badge { border-radius:999px; padding:3px 8px; background:#f1f3f5; font-size:12px; }
      .price { margin-top:10px; font-size:20px; font-weight:750; }
      .muted { color:#5c5f62; }
      .warn { margin-top:10px; color:#8a4b00; }
      .restricted-box {
        margin-top:10px;
        padding:9px 10px;
        border:1px dashed #c9ccd1;
        border-radius:8px;
        background:#fafbfc;
      }
      .error { margin-top:10px; color:#a40000; }
      .report-action { margin-top:12px; }
      .report-refresh {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-top:10px;
        padding-top:9px;
        border-top:1px solid #eceef0;
      }
      .refresh-button { flex:0 0 auto; }
      .destination-box {
        margin-top:12px;
        padding:10px;
        border:1px solid #e3e6ea;
        border-radius:9px;
        background:#fafbfc;
      }
      .destination-fields {
        display:grid;
        grid-template-columns:minmax(120px,.8fr) minmax(150px,1.2fr);
        gap:8px;
        margin-top:8px;
      }
      .field-label {
        display:block;
        margin-bottom:4px;
        color:#5c5f62;
        font-size:12px;
      }
      select, input {
        box-sizing:border-box;
        width:100%;
        border:1px solid #c9ccd1;
        border-radius:7px;
        padding:7px 8px;
        background:#fff;
        color:#191919;
        font:inherit;
      }
      .action-note, .compact-note { margin-top:6px; }
      .compare-button { display:inline-flex; align-items:center; gap:8px; }
      .lens-icon { font-size:17px; line-height:1; }
      .compact-report {
        margin-top:12px;
        padding:11px;
        border:1px solid #c7d6cc;
        border-radius:9px;
        background:#f7fbf8;
      }
      .compact-title, .full-title, .section-title { font-weight:750; }
      .compact-offers { margin-top:8px; display:grid; gap:8px; }
      .compact-offer {
        padding-top:8px;
        border-top:1px solid #e2ebe5;
      }
      .compact-offer:first-child { border-top:0; padding-top:0; }
      .offer-price { display:inline-block; margin-top:2px; font-size:16px; }
      .saving { color:#176b35; font-weight:700; }
      .fx-meta { margin-top:2px; font-size:12px; }
      .expand-button {
        width:100%;
        margin-top:10px;
        border:1px solid #c9ccd1;
        border-radius:8px;
        padding:8px 10px;
        background:#fff;
        color:#263238;
        text-align:left;
      }
      .full-report { margin-top:12px; padding-top:10px; border-top:1px solid #e5e7eb; }
      .all-offers { margin-top:10px; }
      .all-offer-row { margin-top:8px; padding-top:8px; border-top:1px solid #eceef0; }
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
      button { font: inherit; cursor: pointer; }
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

function countryLabel(country: string): string {
  const labels: Record<string, string> = {
    DE: "Germany",
    AT: "Austria",
    BE: "Belgium",
    FR: "France",
    IT: "Italy",
    ES: "Spain",
    NL: "Netherlands",
    PL: "Poland"
  };
  return labels[country] ?? country;
}

function offerSourceLabel(offer: MarketOffer): string {
  const marketplace = offer.marketplace?.trim();
  if (!marketplace) return providerLabel(offer.provider);

  const labels: Record<string, string> = {
    EBAY_DE: "eBay Germany",
    EBAY_PL: "eBay Poland",
    EBAY_AT: "eBay Austria",
    EBAY_FR: "eBay France",
    EBAY_IT: "eBay Italy",
    EBAY_ES: "eBay Spain",
    EBAY_NL: "eBay Netherlands",
    EBAY_BE: "eBay Belgium",
    "www.amazon.de": "Amazon Germany",
    "www.amazon.pl": "Amazon Poland",
    "www.amazon.fr": "Amazon France",
    "www.amazon.it": "Amazon Italy",
    "www.amazon.es": "Amazon Spain",
    "www.amazon.nl": "Amazon Netherlands",
    "www.amazon.com.be": "Amazon Belgium"
  };

  return labels[marketplace] ?? `${providerLabel(offer.provider)} · ${marketplace}`;
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
    case "restricted":
      return "private beta";
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
