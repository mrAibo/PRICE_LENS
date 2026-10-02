# PriceLens

PriceLens is a browser extension and comparison service that adds market-price context directly to eBay listings.

The first target is **eBay.de**. For a listing, PriceLens extracts a normalized product identity and compares the landed price with matching offers from price-comparison providers such as **Idealo**, **Geizhals**, and **Amazon**.

## Status

Early architecture / MVP bootstrap.

Current scope:

- eBay.de single-item pages
- Manifest V3 browser extension
- normalized listing contract
- product matching with explicit confidence
- provider abstraction for Idealo / Geizhals / Amazon
- backend boundary so credentials never live in the extension
- tests and CI from the first implementation increment

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Open-source reuse](docs/OPEN_SOURCE_REUSE.md)

## MVP principle

PriceLens must prefer a **correct no-match** over a confident-looking wrong match.

Prices are compared as landed prices where possible:

`item price + mandatory shipping`

Condition, variant, capacity, model number and identifiers are part of product identity and must not be silently ignored.

## Development

The repository is an npm-workspaces monorepo. Bootstrap code lives in the `bootstrap/price-lens-mvp` branch until the architecture and first vertical slice pass review.

## License

MIT. Third-party dependencies and referenced projects retain their own licenses and notices.
