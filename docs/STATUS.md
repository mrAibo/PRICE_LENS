# PriceLens Project Status

Updated: **2026-10-02**

Overall status: **active implementation / early MVP**

Primary integration branch: `main`

Main baseline merge: `cbf2888aa3e321bab1261d7bed6d9d977a5a4421` (PR #1)

Current implementation checkpoint: `f7e40335ef5a8690d8c91c3beabf774addf7ba25` (through PR #28)

Bootstrap PR #1 is **merged**. New implementation branches should start from the current `main`.

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
- [x] explicit user-visible unsupported extraction state with zero provider/API lookup
- [x] executable selector/JSON-LD extraction failure-mode contract
- [x] documented safe partial vs unsupported extraction states (PR #18)
- [x] ambiguous multi-offer JSON-LD protection (PR #15)
- [x] explicit storage/RAM/screen-size/pack-count extraction from item specifics
- [x] structured edition/model-qualifier/bundle extraction and fingerprinting
- [x] observed real-layout capture/anonymization tool
- [x] independent `reviewed:true` evidence gate for observed fixtures
- [x] separate synthetic vs observed per-field extraction metrics
- [x] structured variant fields participate in lifecycle fingerprinting
- [x] build-time extension API origin with HTTPS-only production policy (PR #29)
- [x] generated extension artifact verification for dev + production-origin builds

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
- [x] hard edition/bundle/model-qualifier/model-generation mismatch guards
- [x] `product-matcher` composite scoring integration
- [x] labelled 0.90/0.70 matcher calibration corpus
- [x] review-candidate confidence/method/reason diagnostics
- [x] Phase 2 zero-known-false-auto gate passed; Issue #11 closed
- [x] `GET /health`
- [x] `POST /v1/compare`
- [x] API request validation and body-size guard
- [x] opt-in local `fixture` provider for true end-to-end development without external traffic
- [x] server-side eBay Browse OAuth/enrichment client with fail-open fallback
- [x] eBay token/item cache, timeout, 401 refresh and 404/429 handling
- [x] Amazon Creators API provider scaffold with OAuth/SearchItems contract tests
- [x] Amazon offers remain landed-price incomplete when mandatory shipping is unavailable
- [x] in-flight eBay Browse legacy-item lookup + OAuth coalescing
- [x] in-flight Amazon SearchItems + OAuth coalescing with caller-local cancellation
- [x] HTTP request correlation via `x-price-lens-request-id` and `ComparisonResult.requestId`
- [x] opt-in privacy-minimized JSON diagnostics with provider latency/state aggregation
- [x] provider product/price caches disabled by default until approved freshness rules are known
- [x] explicit TTL-only provider caching with configuration validation
- [x] deep inbound eBay payload validation at the API trust boundary
- [x] eBay item URL host/id consistency checks
- [x] Amazon Germany marketplace/detail-URL allowlist
- [x] bounded API comparison concurrency with overload `503`
- [x] independent hard concurrency caps for each configured price provider

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

Status: **complete for the current labelled gate**

- [x] storage/RAM/pack-count/screen mismatch fixtures
- [x] product edition mismatch fixtures
- [x] standalone-versus-bundle mismatch fixtures
- [x] model qualifier and numeric generation mismatch fixtures
- [x] labelled `0.90/0.70` calibration corpus
- [x] review-candidate visibility/debug tooling
- [x] zero known false automatic matches in the labelled corpus

Future categories must extend the calibration corpus before thresholds are changed.

## Blocked on external access

### eBay enrichment

- [ ] eBay developer credentials / Sandbox live validation
- [x] Browse API enrichment client
- [x] server-side OAuth token lifecycle
- [x] timeout, cache, 401 refresh, 404 and rate-limit handling
- [x] fail-open page-extraction fallback
- [ ] Production Buy API / Growth Check approval as required by eBay

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

- [ ] Associates/Creators eligibility
- [ ] Creators API onboarding / live credentials
- [x] Creators OAuth/SearchItems provider scaffold
- [x] ItemInfo / OffersV2 contract parsing
- [x] unknown mandatory shipping is kept incomplete and excluded from best-offer selection
- [ ] live price-display/freshness/cache policy validation
- [ ] attribution/compliance validation with the approved account

## Not started

- [x] in-flight provider request coalescing
- [ ] provider-approved production cache/freshness policy
- [ ] persistent observability/metrics
- [ ] first approved real provider adapter
- [ ] multi-provider production comparison
- [ ] eBay search-result card augmentation
- [ ] price history
- [ ] watchlists/alerts
- [ ] explainable Deal Score

## Important merged work

- PR #1 — bootstrap architecture + safe eBay vertical slice — merged into `main`
- PR #7 — extension lifecycle hardening — incorporated through the bootstrap history
- PR #8 — provider access research — incorporated through the bootstrap history
- PR #9 — project checkpoint + local fixture provider — incorporated through the bootstrap history
- PR #15 — ambiguous multi-variant JSON-LD safety — incorporated through the bootstrap history
- PR #16 — structured variant safety guards — incorporated through the bootstrap history
- PR #17 — labelled eBay extraction corpus — incorporated through the bootstrap history
- PR #18 — explicit unsupported extraction UI/state — incorporated through the bootstrap history
- PR #19 — observed eBay capture + field metrics — merged into `main`
- PR #20 — edition/bundle/model calibration — merged into `main`
- PR #21 — eBay Browse enrichment scaffold — merged into `main`
- PR #22 — Amazon Creators provider scaffold — merged into `main`
- PR #24 — provider single-flight + request correlation — merged into `main`
- PR #25 — API/provider URL trust-boundary hardening — merged into `main`
- PR #26 — privacy-minimized structured diagnostics — merged into `main`
- PR #27 — compliance-safe provider cache defaults — merged into `main`
- PR #28 — executable eBay extraction failure-mode contract — merged into `main`
- PR #29 — build-time extension API origin configuration — merged into `main`
- PR #30 — generated extension artifact verification — merged into `main`
- PR #2 — API boundary branch — closed after equivalent/later work was incorporated into bootstrap

## Current engineering priorities

1. Issue #10 — capture and independently review representative real eBay.de layouts; publish observed field metrics.
2. Issue #12 — insert eBay Sandbox credentials and perform live Browse validation, then Production approval.
3. Issue #13 — submit idealo iPN, Geizhals Publisher and Amazon PartnerNet/Creators applications.
4. Issue #14 — live-validate the first approved real provider; Idealo/Geizhals remain documentation-gated.
5. Add provider-specific persistent cache policy only after live rules are known; in-flight coalescing is already implemented.
6. Internal Phase 1 behavior/failure-mode work is complete; collect and independently review real eBay.de layout fixtures for Issue #10.
7. Keep provider product-data cache TTL at zero until live freshness rules are approved; explicit TTL support is already implemented.
8. Continue security hardening as new provider adapters are added.
9. Add Chrome packaging after the generated artifact verification gate is established.
10. Keep server/provider concurrency defaults conservative until live provider quotas are measured.

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
2. synchronize `main`
3. inspect commits newer than the baseline/checkpoint recorded here
4. preserve all valid newer work
5. run CI-equivalent checks before and after material implementation
6. update this status whenever a roadmap gate changes

Canonical documents:

- [Architecture](ARCHITECTURE.md)
- [Technical design](TECHNICAL_DESIGN.md)
- [Roadmap](ROADMAP.md)
- [Provider access](PROVIDER_ACCESS.md)
- [Provider onboarding](PROVIDER_ONBOARDING.md)
- [Matcher calibration](MATCHER_CALIBRATION.md)
- [eBay Browse enrichment](EBAY_BROWSE_ENRICHMENT.md)
- [Amazon Creators provider](AMAZON_CREATORS_PROVIDER.md)
- [Open-source reuse](OPEN_SOURCE_REUSE.md)
