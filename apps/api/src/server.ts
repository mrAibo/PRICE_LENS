import {createPriceLensServer} from "./app.js";
import {createEbayBrowseEnricherFromEnv} from "./ebay-browse.js";
import {createFixtureProvider} from "./fixture-provider.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const fixtureProviderEnabled = process.env.PRICE_LENS_FIXTURE_PROVIDER === "1";
const ebayEnricher = createEbayBrowseEnricherFromEnv();

const server = createPriceLensServer({
  providers: fixtureProviderEnabled ? [createFixtureProvider()] : [],
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
    ebayEnricher ? "eBay Browse enrichment enabled" : undefined
  ].filter(Boolean);
  const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  process.stdout.write(`PriceLens API listening on http://${host}:${port}${suffix}\n`);
});
