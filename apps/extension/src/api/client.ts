import type {
  BuyerDestination,
  ComparisonRequest,
  ComparisonResult,
  EcommerceListing
} from "@price-lens/contracts";

declare const __PRICE_LENS_API_ORIGIN__: string | undefined;

export const DEFAULT_PRICE_LENS_API_URL =
  typeof __PRICE_LENS_API_ORIGIN__ === "string"
    ? __PRICE_LENS_API_ORIGIN__
    : "http://127.0.0.1:8787";
export const DEFAULT_API_TIMEOUT_MS = 4000;

export interface ComparisonClientOptions {
  apiUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  destination?: BuyerDestination;
}

export async function requestComparison(
  listing: EcommerceListing,
  options: ComparisonClientOptions = {}
): Promise<ComparisonResult> {
  const apiUrl = (options.apiUrl ?? DEFAULT_PRICE_LENS_API_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const body: ComparisonRequest = {
    listing,
    ...(options.destination ? {destination: options.destination} : {})
  };

  try {
    const response = await fetchImpl(`${apiUrl}/v1/compare`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `PriceLens API returned HTTP ${response.status} ${response.statusText}`.trim()
      );
    }

    const payload: unknown = await response.json();
    if (!isComparisonResult(payload)) {
      throw new Error("PriceLens API returned an invalid comparison payload.");
    }

    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`PriceLens API timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isComparisonResult(value: unknown): value is ComparisonResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ComparisonResult>;

  return (
    typeof result.requestId === "string" &&
    !!result.listing &&
    result.listing.source === "ebay" &&
    !!result.ebayLandedPrice &&
    typeof result.ebayLandedPrice.amount === "number" &&
    typeof result.ebayLandedPrice.currency === "string" &&
    Array.isArray(result.offers) &&
    Array.isArray(result.providerStatus) &&
    Array.isArray(result.warnings) &&
    typeof result.generatedAt === "string"
  );
}
