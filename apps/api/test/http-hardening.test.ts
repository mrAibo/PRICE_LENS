import {createServer} from "node:http";
import {describe, expect, it} from "vitest";
import {
  configureHttpServerReceptionLimits,
  DEFAULT_HTTP_SERVER_RECEPTION_LIMITS,
  readHttpServerReceptionLimits
} from "../src/http-hardening.js";

describe("HTTP server reception hardening", () => {
  it("uses bounded production defaults", () => {
    expect(readHttpServerReceptionLimits({})).toEqual(
      DEFAULT_HTTP_SERVER_RECEPTION_LIMITS
    );
  });

  it("reads explicit bounded environment overrides", () => {
    expect(
      readHttpServerReceptionLimits({
        PRICE_LENS_REQUEST_TIMEOUT_MS: "20000",
        PRICE_LENS_HEADERS_TIMEOUT_MS: "7000",
        PRICE_LENS_MAX_HEADERS_COUNT: "80"
      })
    ).toEqual({
      requestTimeoutMs: 20_000,
      headersTimeoutMs: 7_000,
      maxHeadersCount: 80
    });
  });

  it.each([
    [
      "request timeout below minimum",
      {PRICE_LENS_REQUEST_TIMEOUT_MS: "999"}
    ],
    [
      "request timeout above maximum",
      {PRICE_LENS_REQUEST_TIMEOUT_MS: "120001"}
    ],
    [
      "headers timeout above maximum",
      {PRICE_LENS_HEADERS_TIMEOUT_MS: "60001"}
    ],
    [
      "non-integer header count",
      {PRICE_LENS_MAX_HEADERS_COUNT: "64.5"}
    ]
  ])("rejects %s", (_label, env) => {
    expect(() => readHttpServerReceptionLimits(env)).toThrow();
  });

  it("rejects a header deadline longer than the full request deadline", () => {
    expect(() =>
      readHttpServerReceptionLimits({
        PRICE_LENS_REQUEST_TIMEOUT_MS: "5000",
        PRICE_LENS_HEADERS_TIMEOUT_MS: "6000"
      })
    ).toThrow(
      "PRICE_LENS_HEADERS_TIMEOUT_MS must not exceed PRICE_LENS_REQUEST_TIMEOUT_MS"
    );
  });

  it("applies limits to the Node HTTP server", () => {
    const server = createServer();

    configureHttpServerReceptionLimits(server, {
      requestTimeoutMs: 15_000,
      headersTimeoutMs: 10_000,
      maxHeadersCount: 64
    });

    expect(server.requestTimeout).toBe(15_000);
    expect(server.headersTimeout).toBe(10_000);
    expect(server.maxHeadersCount).toBe(64);
  });
});
