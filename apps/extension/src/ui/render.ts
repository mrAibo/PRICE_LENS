import type {
  ComparisonResult,
  EcommerceListing,
  ProviderStatus
} from "@price-lens/contracts";

export interface PriceLensView {
  renderComparison(result: ComparisonResult): void;
  renderError(message: string): void;
}

export function mountPriceLens(
  document: Document,
  listing: EcommerceListing
): PriceLensView {
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

  render(shadow, listing, "loading");

  return {
    renderComparison(result) {
      render(shadow, listing, "result", result);
    },
    renderError(message) {
      render(shadow, listing, "error", undefined, message);
    }
  };
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
  errorMessage?: string
): void {
  const statuses = result?.providerStatus ?? [];
  root.innerHTML = `
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
    </style>
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
    </div>
  `;
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
    : '<div class="warn">Price providers are not configured yet.</div>';

  const delta = result.delta
    ? `<div class="muted">eBay vs market: ${result.delta.percentage > 0 ? "+" : ""}${result.delta.percentage.toFixed(2)}%</div>`
    : "";

  return `${best}${delta}<div class="providers">${providerRows}</div>`;
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
