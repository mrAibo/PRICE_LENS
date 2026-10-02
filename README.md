# PriceLens

PriceLens is a browser extension and comparison service that adds market-price context directly to eBay listings.

The first target is **eBay.de**. For a listing, PriceLens extracts a normalized product identity and compares the landed price with matching offers from price-comparison providers such as **Idealo**, **Geizhals**, and **Amazon**.

## Status

Early architecture / MVP bootstrap.

Current scope:

- eBay.de single-item pages
- Manifest V3 browser extension
- normalized listing contract
- strict product matching with explicit confidence
- provider abstraction for Idealo / Geizhals / Amazon
- backend boundary so credentials never live in the extension
- extension-to-API comparison flow
- tests and CI from the first implementation increment

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Open-source reuse](docs/OPEN_SOURCE_REUSE.md)
- [Provider access research](docs/PROVIDER_ACCESS.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## MVP principle

PriceLens must prefer a **correct no-match** over a confident-looking wrong match.

Prices are compared as landed prices where possible:

`item price + mandatory shipping`

Condition, variant, capacity, model number and identifiers are part of product identity and must not be silently ignored.

## Development

Requirements: Node.js 22+.

```bash
npm install
npm run typecheck
npm test
npm run build
```

Start the bootstrap API:

```bash
npm run start -w @price-lens/api
```

Then load `apps/extension/dist` as an unpacked extension in a Chromium-compatible browser. The bootstrap extension talks to `http://127.0.0.1:8787`; production API configuration is intentionally deferred until deployment is defined.

The repository is an npm-workspaces monorepo. Bootstrap code lives in the `bootstrap/price-lens-mvp` branch until the architecture and first vertical slice pass review.

## License

MIT. Third-party dependencies and referenced projects retain their own licenses and notices.
