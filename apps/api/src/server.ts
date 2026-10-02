import {createPriceLensServer} from "./app.js";
import {createFixtureProvider} from "./fixture-provider.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const fixtureProviderEnabled = process.env.PRICE_LENS_FIXTURE_PROVIDER === "1";

const server = createPriceLensServer({
  providers: fixtureProviderEnabled ? [createFixtureProvider()] : []
});

server.listen(port, host, () => {
  const fixtureNote = fixtureProviderEnabled ? " (fixture provider enabled)" : "";
  process.stdout.write(`PriceLens API listening on http://${host}:${port}${fixtureNote}\n`);
});
