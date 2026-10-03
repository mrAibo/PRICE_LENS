import type {Server} from "node:http";

export interface HttpServerReceptionLimits {
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  maxHeadersCount: number;
}

export const DEFAULT_HTTP_SERVER_RECEPTION_LIMITS: HttpServerReceptionLimits = {
  requestTimeoutMs: 15_000,
  headersTimeoutMs: 10_000,
  maxHeadersCount: 64
};

export function readHttpServerReceptionLimits(
  env: NodeJS.ProcessEnv = process.env
): HttpServerReceptionLimits {
  const requestTimeoutMs = readBoundedPositiveInteger(
    env.PRICE_LENS_REQUEST_TIMEOUT_MS,
    DEFAULT_HTTP_SERVER_RECEPTION_LIMITS.requestTimeoutMs,
    1_000,
    120_000,
    "PRICE_LENS_REQUEST_TIMEOUT_MS"
  );
  const headersTimeoutMs = readBoundedPositiveInteger(
    env.PRICE_LENS_HEADERS_TIMEOUT_MS,
    DEFAULT_HTTP_SERVER_RECEPTION_LIMITS.headersTimeoutMs,
    1_000,
    60_000,
    "PRICE_LENS_HEADERS_TIMEOUT_MS"
  );
  const maxHeadersCount = readBoundedPositiveInteger(
    env.PRICE_LENS_MAX_HEADERS_COUNT,
    DEFAULT_HTTP_SERVER_RECEPTION_LIMITS.maxHeadersCount,
    16,
    256,
    "PRICE_LENS_MAX_HEADERS_COUNT"
  );

  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error(
      "PRICE_LENS_HEADERS_TIMEOUT_MS must not exceed PRICE_LENS_REQUEST_TIMEOUT_MS."
    );
  }

  return {
    requestTimeoutMs,
    headersTimeoutMs,
    maxHeadersCount
  };
}

export function configureHttpServerReceptionLimits(
  server: Server,
  limits: HttpServerReceptionLimits
): void {
  validateLimits(limits);
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = limits.headersTimeoutMs;
  server.maxHeadersCount = limits.maxHeadersCount;
}

function validateLimits(limits: HttpServerReceptionLimits): void {
  assertBoundedInteger(
    limits.requestTimeoutMs,
    1_000,
    120_000,
    "requestTimeoutMs"
  );
  assertBoundedInteger(
    limits.headersTimeoutMs,
    1_000,
    60_000,
    "headersTimeoutMs"
  );
  assertBoundedInteger(
    limits.maxHeadersCount,
    16,
    256,
    "maxHeadersCount"
  );

  if (limits.headersTimeoutMs > limits.requestTimeoutMs) {
    throw new Error("headersTimeoutMs must not exceed requestTimeoutMs.");
  }
}

function readBoundedPositiveInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string
): number {
  if (!raw?.trim()) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function assertBoundedInteger(
  value: number,
  min: number,
  max: number,
  name: string
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}
