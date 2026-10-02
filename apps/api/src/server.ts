import {createPriceLensServer} from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";

const server = createPriceLensServer();

server.listen(port, host, () => {
  process.stdout.write(`PriceLens API listening on http://${host}:${port}\n`);
});
