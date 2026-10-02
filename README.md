# PriceLens

PriceLens is a browser extension and comparison service that adds market-price context directly to eBay listings.

The first target is **eBay.de**. For a listing, PriceLens extracts a normalized product identity and compares the landed price with matching offers from price-comparison providers such as **Idealo**, **Geizhals**, and **Amazon**.

## Status

Active early-MVP implementation.

Current scope:

- eBay.de single-item pages
- Manifest V3 browser extension
- normalized listing contract
- strict product matching with explicit confidence
- provider abstraction for Idealo / Geizhals / Amazon
- backend boundary so credentials never live in the extension
- extension-to-API comparison flow
- dynamic eBay page lifecycle handling
- explicit dev-only fixture provider for local end-to-end testing
- tests and CI from the first implementation increment

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Preliminary technical design](docs/TECHNICAL_DESIGN.md)
- [Roadmap](docs/ROADMAP.md)
- [Current project status](docs/STATUS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [eBay extraction evidence](docs/EXTRACTION_EVIDENCE.md)
- [eBay extraction failure modes](docs/EBAY_EXTRACTION_FAILURE_MODES.md)
- [Open-source reuse](docs/OPEN_SOURCE_REUSE.md)
- [Provider access research](docs/PROVIDER_ACCESS.md)
- [Provider onboarding steps](docs/PROVIDER_ONBOARDING.md)
- [Matcher calibration](docs/MATCHER_CALIBRATION.md)
- [eBay Browse enrichment](docs/EBAY_BROWSE_ENRICHMENT.md)
- [Amazon Creators provider](docs/AMAZON_CREATORS_PROVIDER.md)
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

Start the local API:

```bash
npm run start -w @price-lens/api
```

For a complete local comparison without external provider traffic, enable the explicit fixture provider:

```bash
PRICE_LENS_FIXTURE_PROVIDER=1 npm run start -w @price-lens/api
```

The fixture source is labelled `fixture` / `PriceLens Fixture Shop` and is never represented as Idealo, Geizhals or Amazon data.

Then load `apps/extension/dist` as an unpacked extension in a Chromium-compatible browser. The development extension talks to `http://127.0.0.1:8787`. The production deployment target is Cloud Run behind an external load balancer and Cloud Armor; the final public HTTPS API origin is intentionally unset until those resources are provisioned.

The repository is an npm-workspaces monorepo. The tested early-MVP baseline is now on `main`; new work should branch from the current `main`.

## External providers

Live provider activation is access-gated. The eBay Browse enrichment client and Amazon Creators provider scaffold are implemented server-side with mock contract tests; Idealo and Geizhals remain intentionally documentation-gated until their publisher teams supply the permitted machine-readable contract.

See [Provider access research](docs/PROVIDER_ACCESS.md) and [provider onboarding steps](docs/PROVIDER_ONBOARDING.md).

## License

MIT. Third-party dependencies and referenced projects retain their own licenses and notices.
