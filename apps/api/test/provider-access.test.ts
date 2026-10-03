import {describe, expect, it} from "vitest";
import {
  PUBLIC_PROVIDER_ACCESS,
  normalizeProviderAccessContext
} from "../src/provider-access.js";

describe("provider access context", () => {
  it("restricts Idealo and Geizhals for the default public audience", () => {
    expect(PUBLIC_PROVIDER_ACCESS).toEqual({
      tier: "anonymous",
      restrictedProviders: ["idealo", "geizhals"]
    });
  });

  it("preserves a server-resolved pilot policy", () => {
    expect(
      normalizeProviderAccessContext({
        tier: "pilot",
        restrictedProviders: []
      })
    ).toEqual({
      tier: "pilot",
      restrictedProviders: []
    });
  });

  it("never lets anonymous/free tiers remove private-beta restrictions", () => {
    expect(
      normalizeProviderAccessContext({
        tier: "free",
        restrictedProviders: []
      })
    ).toEqual({
      tier: "free",
      restrictedProviders: ["idealo", "geizhals"]
    });
  });

  it("fails closed when a resolver returns an unknown provider", () => {
    expect(
      normalizeProviderAccessContext({
        tier: "pilot",
        restrictedProviders: ["not-a-provider" as never]
      })
    ).toBe(PUBLIC_PROVIDER_ACCESS);
  });

  it("deduplicates valid provider restrictions", () => {
    expect(
      normalizeProviderAccessContext({
        tier: "free",
        restrictedProviders: ["idealo", "idealo", "geizhals"]
      })
    ).toEqual({
      tier: "free",
      restrictedProviders: ["idealo", "geizhals"]
    });
  });
});
