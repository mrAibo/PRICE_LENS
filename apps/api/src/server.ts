import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {ComparisonRequest, EcommerceListing} from "@price-lens/contracts";
import {createComparisonShell} from "@price-lens/core";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;

const server = createServer(async (request, response) => {
  setJsonHeaders(response);

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "price-lens-api",
      providers: {idealo: "unconfigured", geizhals: "unconfigured", amazon: "unconfigured"}
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/compare") {
    try {
      const payload = await readJsonBody(request);
      if (!isComparisonRequest(payload)) {
        sendJson(response, 400, {
          error: "invalid_request",
          message: "Expected a valid eBay listing payload."
        });
        return;
      }
      sendJson(response, 200, createComparisonShell(payload.listing));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      const status = message.includes("too large") ? 413 : 400;
      sendJson(response, status, {
        error: status === 413 ? "payload_too_large" : "invalid_json",
        message
      });
    }
    return;
  }

  sendJson(response, 404, {error: "not_found", message: "Route not found"});
});

server.listen(port, host, () => {
  process.stdout.write(`PriceLens API listening on http://${host}:${port}\n`);
});

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
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error("Request body is empty");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isComparisonRequest(value: unknown): value is ComparisonRequest {
  if (!value || typeof value !== "object") return false;
  return isEbayListing((value as {listing?: unknown}).listing);
}

function isEbayListing(value: unknown): value is EcommerceListing {
  if (!value || typeof value !== "object") return false;
  const listing = value as Partial<EcommerceListing>;
  return (
    listing.source === "ebay" &&
    typeof listing.itemId === "string" &&
    listing.itemId.length > 0 &&
    typeof listing.url === "string" &&
    listing.url.startsWith("https://") &&
    typeof listing.title === "string" &&
    listing.title.length > 0 &&
    !!listing.price &&
    Number.isFinite(listing.price.amount) &&
    typeof listing.price.currency === "string" &&
    !!listing.identity &&
    Array.isArray(listing.extractionEvidence) &&
    Array.isArray(listing.extractionWarnings)
  );
}
