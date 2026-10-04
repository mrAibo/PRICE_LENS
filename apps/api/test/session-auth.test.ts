import type {IncomingMessage} from "node:http";
import {describe, expect, it, vi} from "vitest";
import {
  PriceLensSessionAuth,
  createSessionAuthFromEnv,
  parseSubjectTiers
} from "../src/session-auth.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-10-04T01:30:00.000Z");

function requestWithBearer(token?: string): IncomingMessage {
  return {
    headers: token ? {authorization: `Bearer ${token}`} : {}
  } as IncomingMessage;
}

describe("PriceLens short-lived session auth", () => {
  it("exchanges a verified Google access token for a short-lived pilot session", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        sub: "109876543210987654321",
        email: "pilot@example.test"
      }), {
        status: 200,
        headers: {"content-type": "application/json"}
      })
    );
    const auth = new PriceLensSessionAuth({
      signingSecret: SECRET,
      subjectTiers: new Map([
        ["109876543210987654321", "pilot"]
      ]),
      sessionTtlSeconds: 900,
      now: () => NOW,
      fetchImpl
    });

    const exchange = await auth.exchangeGoogleAccessToken(
      "google-access-token-1234567890"
    );

    expect(exchange.tier).toBe("pilot");
    expect(exchange.expiresAt).toBe("2026-10-04T01:45:00.000Z");
    expect(exchange.sessionToken.split(".")).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://openidconnect.googleapis.com/v1/userinfo"
    );
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")
    ).toBe("Bearer google-access-token-1234567890");

    expect(
      auth.resolveProviderAccess(
        requestWithBearer(exchange.sessionToken)
      )
    ).toEqual({
      tier: "pilot",
      restrictedProviders: []
    });
  });

  it("issues a free session for a valid Google account not present in the pilot allowlist", async () => {
    const auth = new PriceLensSessionAuth({
      signingSecret: SECRET,
      subjectTiers: new Map(),
      now: () => NOW,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({sub: "123456789"}), {status: 200})
      )
    });

    const exchange = await auth.exchangeGoogleAccessToken(
      "google-access-token-abcdefghijk"
    );

    expect(exchange.tier).toBe("free");
    expect(
      auth.resolveProviderAccess(
        requestWithBearer(exchange.sessionToken)
      )
    ).toEqual({
      tier: "free",
      restrictedProviders: ["idealo", "geizhals"]
    });
  });

  it("re-resolves trusted entitlements on every comparison so revocation is immediate", async () => {
    const tiers = new Map<string, "pilot" | "pro" | "admin">([
      ["pilot-subject", "pilot"]
    ]);
    const auth = new PriceLensSessionAuth({
      signingSecret: SECRET,
      subjectTiers: tiers,
      now: () => NOW,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({sub: "pilot-subject"}), {status: 200})
      )
    });

    const exchange = await auth.exchangeGoogleAccessToken(
      "google-access-token-revocation-test"
    );
    expect(
      auth.resolveProviderAccess(requestWithBearer(exchange.sessionToken))
        .tier
    ).toBe("pilot");

    tiers.delete("pilot-subject");

    expect(
      auth.resolveProviderAccess(requestWithBearer(exchange.sessionToken))
    ).toEqual({
      tier: "free",
      restrictedProviders: ["idealo", "geizhals"]
    });
  });

  it("fails closed for missing, malformed, tampered and expired sessions", async () => {
    let now = NOW;
    const auth = new PriceLensSessionAuth({
      signingSecret: SECRET,
      subjectTiers: new Map([["pilot-subject", "pilot"]]),
      sessionTtlSeconds: 60,
      now: () => now,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({sub: "pilot-subject"}), {status: 200})
      )
    });

    const exchange = await auth.exchangeGoogleAccessToken(
      "google-access-token-expiry-test"
    );

    expect(auth.resolveProviderAccess(requestWithBearer())).toEqual({
      tier: "anonymous",
      restrictedProviders: ["idealo", "geizhals"]
    });
    expect(
      auth.resolveProviderAccess(requestWithBearer("not-a-session"))
    ).toEqual({
      tier: "anonymous",
      restrictedProviders: ["idealo", "geizhals"]
    });

    const parts = exchange.sessionToken.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}x`;
    expect(
      auth.resolveProviderAccess(requestWithBearer(tampered))
    ).toEqual({
      tier: "anonymous",
      restrictedProviders: ["idealo", "geizhals"]
    });

    now += 61_000;
    expect(
      auth.resolveProviderAccess(requestWithBearer(exchange.sessionToken))
    ).toEqual({
      tier: "anonymous",
      restrictedProviders: ["idealo", "geizhals"]
    });
  });

  it("rejects failed or malformed Google identity responses", async () => {
    const unauthorized = new PriceLensSessionAuth({
      signingSecret: SECRET,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({error: "invalid_token"}), {status: 401})
      )
    });
    await expect(
      unauthorized.exchangeGoogleAccessToken(
        "google-access-token-invalid-123"
      )
    ).rejects.toThrow("Google authentication failed");

    const malformed = new PriceLensSessionAuth({
      signingSecret: SECRET,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({email: "no-sub@example.test"}), {
          status: 200
        })
      )
    });
    await expect(
      malformed.exchangeGoogleAccessToken(
        "google-access-token-malformed-123"
      )
    ).rejects.toThrow("Google authentication failed");
  });
});

describe("session auth environment configuration", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(createSessionAuthFromEnv({})).toBeUndefined();
  });

  it("requires a strong server-side signing secret", () => {
    expect(() =>
      createSessionAuthFromEnv({
        PRICE_LENS_SESSION_AUTH_ENABLED: "1"
      })
    ).toThrow("PRICE_LENS_SESSION_SIGNING_SECRET");

    expect(() =>
      createSessionAuthFromEnv({
        PRICE_LENS_SESSION_AUTH_ENABLED: "1",
        PRICE_LENS_SESSION_SIGNING_SECRET: "too-short"
      })
    ).toThrow("at least 32");
  });

  it("parses only trusted pilot/pro/admin Google-subject mappings", () => {
    expect(
      [...parseSubjectTiers(JSON.stringify({
        "10001": "pilot",
        "10002": "pro",
        "10003": "admin"
      })).entries()]
    ).toEqual([
      ["10001", "pilot"],
      ["10002", "pro"],
      ["10003", "admin"]
    ]);

    expect(() =>
      parseSubjectTiers(JSON.stringify({"10001": "free"}))
    ).toThrow("pilot, pro, or admin");
    expect(() =>
      parseSubjectTiers(JSON.stringify({"bad subject": "pilot"}))
    ).toThrow("invalid Google subject");
  });

  it("validates session TTL and Google verification timeout bounds", () => {
    expect(() =>
      createSessionAuthFromEnv({
        PRICE_LENS_SESSION_AUTH_ENABLED: "1",
        PRICE_LENS_SESSION_SIGNING_SECRET: SECRET,
        PRICE_LENS_SESSION_TTL_SECONDS: "59"
      })
    ).toThrow("PRICE_LENS_SESSION_TTL_SECONDS");

    expect(() =>
      createSessionAuthFromEnv({
        PRICE_LENS_SESSION_AUTH_ENABLED: "1",
        PRICE_LENS_SESSION_SIGNING_SECRET: SECRET,
        PRICE_LENS_GOOGLE_VERIFY_TIMEOUT_MS: "200"
      })
    ).toThrow("PRICE_LENS_GOOGLE_VERIFY_TIMEOUT_MS");
  });
});
