import {describe, expect, it} from "vitest";
import {
  DEFAULT_PRICE_LENS_API_ORIGIN,
  hostPermissionForOrigin,
  normalizeApiOrigin
} from "../build-config.mjs";

describe("extension API origin build configuration", () => {
  it("defaults to the local loopback API", () => {
    expect(normalizeApiOrigin()).toBe(DEFAULT_PRICE_LENS_API_ORIGIN);
  });

  it("accepts HTTPS production origins and normalizes a trailing slash", () => {
    expect(normalizeApiOrigin("https://api.pricelens.example/")).toBe(
      "https://api.pricelens.example"
    );
    expect(hostPermissionForOrigin("https://api.pricelens.example")).toBe(
      "https://api.pricelens.example/*"
    );
  });

  it.each([
    "http://api.pricelens.example",
    "ftp://api.pricelens.example",
    "https://user:pass@api.pricelens.example",
    "https://api.pricelens.example/v1",
    "https://api.pricelens.example?x=1",
    "https://api.pricelens.example#fragment"
  ])("rejects unsafe or non-origin value %s", (value) => {
    expect(() => normalizeApiOrigin(value)).toThrow();
  });

  it.each([
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://[::1]:8787"
  ])("allows plain HTTP only for loopback development: %s", (value) => {
    expect(normalizeApiOrigin(value)).toBe(value);
  });
});
