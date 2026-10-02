# PriceLens Project Status

Updated: **2026-10-02**

Overall status: **active implementation / early MVP**

Primary integration branch: `bootstrap/price-lens-mvp`

Current merged checkpoint: `9daecba4d14938840b4b78022333ae6ca48d30cb` (PR #9)

Main bootstrap PR: **#1 — feat: bootstrap PriceLens MVP architecture and eBay vertical slice** (draft, target `main`)

## Completed

### Repository and delivery

- [x] npm-workspaces monorepo
- [x] TypeScript/Node.js 22 baseline
- [x] CI for typecheck, tests and build
- [x] MIT project license
- [x] third-party notices and open-source reuse policy
- [x] pinned vendored MIT `product-matcher` snapshot

### Browser extension

- [x] Manifest V3 extension
- [x] eBay.de item-page content script
- [x] service-worker API boundary
- [x] localhost development API client
- [x] Shadow DOM widget
- [x] structured-data-first extraction with DOM fallbacks
- [x] item id, title, price, shipping, condition and identity extraction paths
- [x] dynamic page lifecycle handling
- [x] debounced DOM/navigation refresh
- [x] listing fingerprint deduplication
- [x] stale async response protection
- [x] extraction/lifecycle unit tests

### Core/API

- [x] shared contracts
- [x] landed-price calculation
- [x] comparison delta and best-offer selection
- [x] `PriceProvider` interface
- [x] concurrent provider orchestration
- [x] per-provider timeout/failure isolation
- [x] deterministic match decision layer
- [x] exact GTIN/EAN/UPC match path
- [x] exact brand + MPN match path
- [x] hard condition/brand/identifier mismatch guards
- [x] `product-matcher` composite scoring integration
- [x] `GET /health`
- [x] `POST /v1/compare`
- [x] API request validation and body-size guard
- [x] opt-in local `fixture` provider for true end-to-end development without external traffic

### Provider/access research

- [x] eBay official Browse API chosen for enrichment
- [x] Idealo merchant PWS rejected as the wrong API class for PriceLens
- [x] Idealo iPN/publisher path identified
- [x] Geizhals Publisher Programme identified as preferred access path
- [x] Amazon Creators API chosen instead of new PA-API 5.0 work
- [x] scraping explicitly limited to research/fallback evaluation

## In progress

### Phase 1 — eBay extraction gate

Still required:

- [ ] larger labelled eBay.de fixture corpus
- [ ] explicit extraction accuracy report
- [ ] coverage for representative shipping layouts
- [ ] coverage for variant/item-specific layouts
- [ ] explicit unsupported-state behavior for pages that cannot be normalized safely

### Phase 2 — matcher/comparison gate

Still required:

- [ ] hard mismatch fixtures for storage/capacity
- [ ] RAM mismatch fixtures
- [ ] console/product edition mismatch fixtures
- [ ] pack-count/bundle mismatch fixtures
- [ ] model suffix / screen-size mismatch fixtures
- [ ] labelled calibration set for `0.90/0.70` thresholds
- [ ] review-candidate visibility/debug tooling

## Blocked on external access

### eBay enrichment

- [ ] eBay developer credentials
- [ ] Browse API adapter
- [ ] server-side token lifecycle
- [ ] rate-limit/cache behavior

### Idealo

- [ ] publisher/iPN access decision
- [ ] API documentation/credentials
- [ ] allowed caching/freshness rules
- [ ] attribution/deep-link requirements

### Geizhals

- [ ] publisher data-access confirmation
- [ ] identifier lookup contract
- [ ] price/shipping fields
- [ ] caching/rate-limit rules
- [ ] attribution/deep-link requirements

### Amazon Germany

- [ ] Associates eligibility
- [ ] Creators API onboarding
- [ ] price-display/freshness rules
- [ ] credentials
- [ ] attribution requirements

## Not started

- [ ] production cache/coalescing
- [ ] persistent observability/metrics
- [ ] first approved real provider adapter
- [ ] multi-provider production comparison
- [ ] eBay search-result card augmentation
- [ ] price history
- [ ] watchlists/alerts
- [ ] explainable Deal Score

## Important merged work

- PR #7 — extension lifecycle hardening — merged into `bootstrap/price-lens-mvp`
- PR #8 — provider access research — merged into `bootstrap/price-lens-mvp`
- PR #2 — API boundary branch — closed after equivalent/later work was incorporated into bootstrap

## Current engineering priorities

1. Keep PR #1 as the umbrella bootstrap review until the initial vertical slice is accepted.
2. Issue #10 — complete the eBay fixture corpus and publish extraction evidence.
3. Issue #11 — complete hard-variant mismatch tests before broadening fuzzy matching.
4. Use the opt-in fixture provider to validate the browser/API UI path locally.
5. Issue #12 — add eBay Browse API enrichment when credentials are available.
6. Issue #13 — obtain official Idealo/Geizhals/Amazon access in parallel.
7. Issue #14 — implement one approved real provider completely before enabling all providers.

## Local verification

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run API without providers:

```bash
npm run start -w @price-lens/api
```

Run API with explicit development fixture data:

```bash
PRICE_LENS_FIXTURE_PROVIDER=1 npm run start -w @price-lens/api
```

Load `apps/extension/dist` as an unpacked Chromium extension and open an eBay.de item page.

## Resume instructions

For a new development session:

1. inspect this file first
2. synchronize `bootstrap/price-lens-mvp`
3. inspect commits newer than the baseline/checkpoint recorded here
4. preserve all valid newer work
5. run CI-equivalent checks before and after material implementation
6. update this status whenever a roadmap gate changes

Canonical documents:

- [Architecture](ARCHITECTURE.md)
- [Technical design](TECHNICAL_DESIGN.md)
- [Roadmap](ROADMAP.md)
- [Provider access](PROVIDER_ACCESS.md)
- [Open-source reuse](OPEN_SOURCE_REUSE.md)
