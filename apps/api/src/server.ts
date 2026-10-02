import {limitProviderConcurrency} from "@price-lens/core";
import {createPriceLensServer} from "./app.js";
import {createAmazonCreatorsProviderFromEnv} from "./amazon-creators-provider.js";
import {createEbayBrowseEnricherFromEnv} from "./ebay-browse.js";
import {createJsonLineDiagnosticSink} from "./diagnostics.js";
import {createFixtureProvider} from "./fixture-provider.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const fixtureProviderEnabled = process.env.PRICE_LENS_FIXTURE_PROVIDER === "1";
const structuredDiagnosticsEnabled = process.env.PRICE_LENS_JSON_LOGS === "1";
const maxConcurrentComparisons = readPositiveIntegerEnv(
  "PRICE_LENS_MAX_CONCURRENT_COMPARISONS",
  16
);
const providerMaxConcurrency = readPositiveIntegerEnv(
  "PRICE_LENS_PROVIDER_MAX_CONCURRENCY",
  4
);
const ebayEnricher = createEbayBrowseEnricherFromEnv();
const amazonProvider = createAmazonCreatorsProviderFromEnv();
const providers = [
  ...(fixtureProviderEnabled ? [createFixtureProvider()] : []),
  ...(amazonProvider ? [amazonProvider] : [])
].map((provider) =>
  limitProviderConcurrency(provider, providerMaxConcurrency)
);

const server = createPriceLensServer({
  providers,
  diagnostics: structuredDiagnosticsEnabled
    ? createJsonLineDiagnosticSink()
    : undefined,
  enrichListing: ebayEnricher
    ? (listing) => ebayEnricher.enrich(listing)
    : undefined,
  enrichmentStatus: {
    ebay: ebayEnricher ? "configured" : "unconfigured"
  },
  maxConcurrentComparisons
});

server.listen(port, host, () => {
  const notes = [
    fixtureProviderEnabled ? "fixture provider enabled" : undefined,
    ebayEnricher ? "eBay Browse enrichment enabled" : undefined,
    amazonProvider ? "Amazon Creators provider enabled" : undefined,
    structuredDiagnosticsEnabled ? "JSON diagnostics enabled" : undefined,
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
