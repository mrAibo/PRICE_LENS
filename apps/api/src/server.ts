import {createPriceLensServer} from "./app.js";
import {createAmazonCreatorsProviderFromEnv} from "./amazon-creators-provider.js";
import {createEbayBrowseEnricherFromEnv} from "./ebay-browse.js";
import {createJsonLineDiagnosticSink} from "./diagnostics.js";
import {createFixtureProvider} from "./fixture-provider.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const fixtureProviderEnabled = process.env.PRICE_LENS_FIXTURE_PROVIDER === "1";
const structuredDiagnosticsEnabled = process.env.PRICE_LENS_JSON_LOGS === "1";
const ebayEnricher = createEbayBrowseEnricherFromEnv();
const amazonProvider = createAmazonCreatorsProviderFromEnv();
const providers = [
  ...(fixtureProviderEnabled ? [createFixtureProvider()] : []),
  ...(amazonProvider ? [amazonProvider] : [])
];

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
  }
});

server.listen(port, host, () => {
  const notes = [
    fixtureProviderEnabled ? "fixture provider enabled" : undefined,
    ebayEnricher ? "eBay Browse enrichment enabled" : undefined,
    amazonProvider ? "Amazon Creators provider enabled" : undefined,
    structuredDiagnosticsEnabled ? "JSON diagnostics enabled" : undefined
  ].filter(Boolean);
  const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  process.stdout.write(`PriceLens API listening on http://${host}:${port}${suffix}\n`);
});
