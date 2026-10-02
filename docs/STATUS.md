# PriceLens Project Status

Updated: **2026-10-02**

Overall status: **active implementation / early MVP**

Primary integration branch: `bootstrap/price-lens-mvp`

Current merged checkpoint: `466b28a77fd1610912e19b4dc387565ae3c3fc8b` (PR #18)

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
- [x] labelled synthetic extraction corpus: 9 fixtures / 77 scalar labels (PR #17)
- [x] extraction evidence baseline in `docs/EXTRACTION_EVIDENCE.md`
- [x] explicit user-visible unsupported extraction state with zero provider/API lookup (PR #18)
- [x] ambiguous multi-offer JSON-LD protection (PR #15)
- [x] explicit storage/RAM/screen-size/pack-count extraction from item specifics
- [x] structured variant fields participate in lifecycle fingerprinting

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
- [x] hard storage/RAM/screen-size/pack-count mismatch guards
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

- [x] initial labelled synthetic eBay.de fixture corpus
- [x] initial regression-evidence report (synthetic corpus)
- [ ] representative anonymized real-layout fixture corpus
- [ ] empirical field-level extraction accuracy report over representative layouts
- [ ] coverage for representative shipping layouts
- [x] initial coverage for variant/item-specific layouts
- [ ] broaden variant/item-specific fixture coverage across categories
- [x] explicit unsupported-state behavior for pages that cannot be normalized safely

### Phase 2 — matcher/comparison gate

Still required:

- [x] hard mismatch fixtures for storage/capacity
- [x] RAM mismatch fixtures
- [x] pack-count mismatch fixtures
- [x] screen-size mismatch fixtures
- [ ] console/product edition mismatch fixtures
- [ ] materially different bundle/accessory mismatch fixtures
- [ ] model-suffix mismatch fixtures beyond explicit screen-size data
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
- PR #9 — project checkpoint + local fixture provider — merged into `bootstrap/price-lens-mvp`
- PR #15 — ambiguous multi-variant JSON-LD safety — merged into `bootstrap/price-lens-mvp`
- PR #16 — structured variant safety guards — merged into `bootstrap/price-lens-mvp`
- PR #17 — labelled eBay extraction corpus — merged into `bootstrap/price-lens-mvp`
- PR #18 — explicit unsupported extraction UI/state — merged into `bootstrap/price-lens-mvp`
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
