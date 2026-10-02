import type {
  ComparisonResult,
  EcommerceListing,
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

  const providerRows = statuses
    .map((status) => `
      <div class="row">
        <span>${escapeHtml(capitalize(status.provider))}</span>
        <span class="muted">${escapeHtml(status.state)}</span>
      </div>
    `)
    .join("");

  const best = result.bestOffer
    ? `<div class="delta">Best market price: ${escapeHtml(
        formatMoney(result.bestOffer.landedPrice.amount, result.bestOffer.landedPrice.currency)
      )}</div>`
    : result.offers.length > 0
      ? '<div class="warn">Offers were found, but mandatory shipping is unavailable, so no complete landed-price comparison is shown.</div>'
      : statuses.some((status) => status.state !== "unconfigured")
        ? '<div class="warn">No complete comparable market offer was found.</div>'
        : '<div class="warn">Price providers are not configured yet.</div>';

  const delta = result.delta
    ? `<div class="muted">eBay vs market: ${result.delta.percentage > 0 ? "+" : ""}${result.delta.percentage.toFixed(2)}%</div>`
    : "";

  return `${best}${delta}<div class="providers">${providerRows}</div>`;
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
