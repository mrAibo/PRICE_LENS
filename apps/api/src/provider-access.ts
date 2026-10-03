import type {PriceProviderId} from "@price-lens/contracts";

export type PriceLensAccessTier =
  | "anonymous"
  | "free"
  | "pilot"
  | "pro"
  | "admin";

export interface ProviderAccessContext {
  tier: PriceLensAccessTier;
  restrictedProviders: readonly PriceProviderId[];
}

export const PUBLIC_PROVIDER_ACCESS: ProviderAccessContext = Object.freeze({
  tier: "anonymous",
  restrictedProviders: Object.freeze(["idealo", "geizhals"] as PriceProviderId[])
});

export function normalizeProviderAccessContext(
  value: ProviderAccessContext | undefined
): ProviderAccessContext {
  if (!value) return PUBLIC_PROVIDER_ACCESS;

  const validTiers: PriceLensAccessTier[] = [
    "anonymous",
    "free",
    "pilot",
    "pro",
    "admin"
  ];
  if (
    !validTiers.includes(value.tier) ||
    !Array.isArray(value.restrictedProviders)
  ) {
    return PUBLIC_PROVIDER_ACCESS;
  }

  const allowedProviders = new Set<PriceProviderId>([
    "ebay_market",
    "idealo",
    "geizhals",
    "amazon",
    "fixture"
  ]);

  if (
    value.restrictedProviders.some(
      (provider) => !allowedProviders.has(provider)
    )
  ) {
    return PUBLIC_PROVIDER_ACCESS;
  }

  const restrictedProviders = new Set<PriceProviderId>(
    value.restrictedProviders
  );

  if (value.tier === "anonymous" || value.tier === "free") {
    restrictedProviders.add("idealo");
    restrictedProviders.add("geizhals");
  }

  return {
    tier: value.tier,
    restrictedProviders: [...restrictedProviders]
  };
}
