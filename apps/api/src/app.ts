import {randomUUID} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import type {
  ComparisonRequest,
  EcommerceListing,
  ListingCondition,
  Money,
  ProductIdentity,
  ProductVariant
} from "@price-lens/contracts";
import {
  compareWithProviders,
  type PriceProvider
} from "@price-lens/core";

const MAX_BODY_BYTES = 64 * 1024;

export interface PriceLensApiOptions {
  providers?: PriceProvider[];
  enrichListing?: (listing: EcommerceListing) => Promise<EcommerceListing>;
  enrichmentStatus?: Record<string, string>;
  requestIdFactory?: () => string;
}

export function createPriceLensServer(
  options: PriceLensApiOptions = {}
): Server {
  const providers = options.providers ?? [];

  return createServer(async (request, response) => {
    const requestId = options.requestIdFactory?.() ?? randomUUID();
    setJsonHeaders(response);
    response.setHeader("x-price-lens-request-id", requestId);

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "price-lens-api",
        providers: providerConfiguration(providers),
        enrichment: options.enrichmentStatus ?? {ebay: "unconfigured"}
      });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/compare") {
      try {
        const payload = await readJsonBody(request);
        if (!isComparisonRequest(payload)) {
          sendJson(response, 400, {
            error: "invalid_request",
            message: "Expected a valid eBay listing payload.",
            requestId
          });
          return;
        }

        let listing = payload.listing;
        if (options.enrichListing) {
          try {
            listing = await options.enrichListing(listing);
          } catch {
            listing = {
              ...listing,
              extractionWarnings: [
                ...listing.extractionWarnings,
                "eBay API enrichment is currently unavailable; page extraction was used."
              ]
            };
          }
        }

        const result = await compareWithProviders(listing, providers, {
          requestId
        });
        sendJson(response, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid request";
        const status = message.includes("too large") ? 413 : 400;
        sendJson(response, status, {
          error: status === 413 ? "payload_too_large" : "invalid_json",
          message,
          requestId
        });
      }
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
      message: "Route not found",
      requestId
    });
  });
}

function providerConfiguration(providers: PriceProvider[]): Record<string, string> {
  const configured = new Set(providers.map((provider) => provider.id));
  const status: Record<string, string> = {
    idealo: configured.has("idealo") ? "configured" : "unconfigured",
    geizhals: configured.has("geizhals") ? "configured" : "unconfigured",
    amazon: configured.has("amazon") ? "configured" : "unconfigured"
  };

  if (configured.has("fixture")) {
    status.fixture = "configured";
  }

  return status;
}

function setJsonHeaders(response: ServerResponse): void {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new Error("Request body is empty");
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isComparisonRequest(value: unknown): value is ComparisonRequest {
  if (!value || typeof value !== "object") return false;
  return isEbayListing((value as {listing?: unknown}).listing);
}

function isEbayListing(value: unknown): value is EcommerceListing {
  if (!isRecord(value)) return false;

  const source = value.source;
  const itemId = value.itemId;
  const url = value.url;
  const title = value.title;

  return (
    source === "ebay" &&
    typeof itemId === "string" &&
    /^\d{9,15}$/.test(itemId) &&
    typeof url === "string" &&
    url.length <= 4096 &&
    isTrustedEbayItemUrl(url, itemId) &&
    typeof title === "string" &&
    title.trim().length > 0 &&
    title.length <= 2048 &&
    isMoney(value.price) &&
    (value.shipping === undefined || isMoney(value.shipping)) &&
    isListingCondition(value.condition) &&
    isProductIdentity(value.identity) &&
    (value.imageUrl === undefined || isSafeHttpsUrl(value.imageUrl, 4096)) &&
    isStringArray(value.extractionEvidence, 100, 1024) &&
    isStringArray(value.extractionWarnings, 100, 2048)
  );
}

function isTrustedEbayItemUrl(value: string, itemId: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname !== "ebay.de" && !hostname.endsWith(".ebay.de")) {
      return false;
    }

    const pathMatch = url.pathname.match(
      /\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?#]|$)/i
    );
    const queryItem = url.searchParams.get("item");
    const urlItemId = pathMatch?.[1] ?? (
      queryItem && /^\d{9,15}$/.test(queryItem) ? queryItem : undefined
    );

    return urlItemId === itemId;
  } catch {
    return false;
  }
}

function isMoney(value: unknown): value is Money {
  if (!isRecord(value)) return false;
  return (
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.amount >= 0 &&
    typeof value.currency === "string" &&
    /^[A-Za-z]{3}$/.test(value.currency.trim())
  );
}

function isListingCondition(value: unknown): value is ListingCondition {
  return (
    value === "new" ||
    value === "used" ||
    value === "refurbished" ||
    value === "open_box" ||
    value === "unknown"
  );
}

function isProductIdentity(value: unknown): value is ProductIdentity {
  if (!isRecord(value)) return false;

  return (
    isOptionalString(value.brand, 512) &&
    isOptionalString(value.model, 512) &&
    isOptionalString(value.mpn, 512) &&
    isOptionalTradeIdentifier(value.gtin) &&
    isOptionalTradeIdentifier(value.ean) &&
    isOptionalTradeIdentifier(value.upc) &&
    (value.variant === undefined || isProductVariant(value.variant))
  );
}

function isProductVariant(value: unknown): value is ProductVariant {
  if (!isRecord(value)) return false;

  return (
    isOptionalPositiveNumber(value.storageGb, 100_000) &&
    isOptionalPositiveNumber(value.ramGb, 100_000) &&
    isOptionalPositiveNumber(value.screenSizeInches, 1_000) &&
    isOptionalPositiveInteger(value.packCount, 10_000) &&
    isOptionalString(value.edition, 256) &&
    isOptionalString(value.modelQualifier, 256) &&
    (value.bundleIncluded === undefined ||
      typeof value.bundleIncluded === "boolean")
  );
}

function isOptionalTradeIdentifier(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const digits = value.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) && digits === value;
}

function isOptionalString(value: unknown, maxLength: number): boolean {
  return (
    value === undefined ||
    (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= maxLength
    )
  );
}

function isOptionalPositiveNumber(
  value: unknown,
  maxValue: number
): boolean {
  return (
    value === undefined ||
    (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= maxValue
    )
  );
}

function isOptionalPositiveInteger(
  value: unknown,
  maxValue: number
): boolean {
  return (
    value === undefined ||
    (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= maxValue
    )
  );
}

function isSafeHttpsUrl(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string" || value.length > maxLength) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length <= maxItemLength
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
