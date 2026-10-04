import {limitProviderConcurrency} from "@price-lens/core";
import {createPriceLensServer} from "./app.js";
import {createAmazonCreatorsProviderFromEnv} from "./amazon-creators-provider.js";
import {
  createEbayBrowseEnricherFromEnv,
  createEbayMarketplaceProvider
} from "./ebay-browse.js";
import {createEcbFxNormalizerFromEnv} from "./ecb-fx.js";
import {
  createAggregatingDiagnosticSink,
  createJsonLineDiagnosticSink,
  safeEmitDiagnostic
} from "./diagnostics.js";
import {createFixtureProvider} from "./fixture-provider.js";
import type {ProviderCacheObserver} from "./provider-cache.js";
import type {ProviderFanoutObserver} from "./provider-fanout.js";
import {installGracefulShutdown} from "./shutdown.js";
import {createSessionAuthFromEnv} from "./session-auth.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const fixtureProviderEnabled = process.env.PRICE_LENS_FIXTURE_PROVIDER === "1";
const structuredDiagnosticsEnabled = process.env.PRICE_LENS_JSON_LOGS === "1";
const metricsEmitEvery = readPositiveIntegerEnv(
  "PRICE_LENS_METRICS_EVERY",
  100
);
const maxConcurrentComparisons = readPositiveIntegerEnv(
  "PRICE_LENS_MAX_CONCURRENT_COMPARISONS",
  16
);
const providerMaxConcurrency = readPositiveIntegerEnv(
  "PRICE_LENS_PROVIDER_MAX_CONCURRENCY",
  4
);
const diagnosticAggregator = structuredDiagnosticsEnabled
  ? createAggregatingDiagnosticSink(
      createJsonLineDiagnosticSink(),
      metricsEmitEvery
    )
  : undefined;
const diagnostics = diagnosticAggregator?.sink;
const cacheObserver: ProviderCacheObserver | undefined = diagnostics
  ? (event) =>
      safeEmitDiagnostic(diagnostics, {
        type: "provider_cache",
        ...event
      })
  : undefined;

const fanoutObserver: ProviderFanoutObserver | undefined = diagnostics
  ? (event) =>
      safeEmitDiagnostic(diagnostics, {
        type: "provider_fanout",
        ...event
      })
  : undefined;

const ebayEnricher = createEbayBrowseEnricherFromEnv(process.env, {
  cacheObserver,
  fanoutObserver
});
const ebayMarketplaceProvider =
  ebayEnricher && process.env.EBAY_MARKETPLACE_COMPARISON_ENABLED === "1"
    ? createEbayMarketplaceProvider(ebayEnricher)
    : undefined;
const fxNormalizer = createEcbFxNormalizerFromEnv(process.env);
const amazonProvider = createAmazonCreatorsProviderFromEnv(process.env, {
  cacheObserver,
  fanoutObserver
});
const providers = [
  ...(fixtureProviderEnabled ? [createFixtureProvider()] : []),
  ...(ebayMarketplaceProvider ? [ebayMarketplaceProvider] : []),
  ...(amazonProvider ? [amazonProvider] : [])
].map((provider) =>
  limitProviderConcurrency(provider, providerMaxConcurrency)
);

const server = createPriceLensServer({
  providers,
  resolveProviderAccess: sessionAuth
    ? (request) => sessionAuth.resolveProviderAccess(request)
    : undefined,
  exchangeGoogleSession: sessionAuth
    ? (accessToken) => sessionAuth.exchangeGoogleAccessToken(accessToken)
    : undefined,
  diagnostics,
  enrichListing: ebayEnricher
    ? (listing) => ebayEnricher.enrich(listing)
    : undefined,
  normalizeOffers: fxNormalizer
    ? (listing, offers) => fxNormalizer.normalize(listing, offers)
    : undefined,
  enrichmentStatus: {
    ebay: ebayEnricher ? "configured" : "unconfigured",
    fx: fxNormalizer ? "configured" : "unconfigured"
  },
  maxConcurrentComparisons
});

installGracefulShutdown(server, {timeoutMs: 9_000});

server.listen(port, host, () => {
  const notes = [
    fixtureProviderEnabled ? "fixture provider enabled" : undefined,
    sessionAuth ? "pilot session auth enabled" : undefined,
    ebayEnricher ? "eBay Browse enrichment enabled" : undefined,
    ebayMarketplaceProvider ? "eBay same-product market enabled" : undefined,
    fxNormalizer ? "ECB reference FX enabled" : undefined,
    amazonProvider ? "Amazon Creators provider enabled" : undefined,
    structuredDiagnosticsEnabled
      ? `JSON diagnostics enabled, metrics every ${metricsEmitEvery} events`
      : undefined,
    `comparison concurrency ${maxConcurrentComparisons}`,
    `provider concurrency ${providerMaxConcurrency}`
  ].filter(Boolean);
  const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  process.stdout.write(`PriceLens API listening on http://${host}:${port}${suffix}\n`);
});


function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error(`${name} must be an integer between 1 and 10000.`);
  }

  return value;
}
