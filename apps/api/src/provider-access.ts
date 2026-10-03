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
  if (!validTiers.includes(value.tier)) {
    return PUBLIC_PROVIDER_ACCESS;
  }

  const allowedProviders = new Set<PriceProviderId>([
    "ebay_market",
    "idealo",
    "geizhals",
    "amazon",
    "fixture"
  ]);
  const restrictedProviders = [...new Set(value.restrictedProviders)].filter(
    (provider): provider is PriceProviderId => allowedProviders.has(provider)
  );

  return {
    tier: value.tier,
    restrictedProviders
  };
}
