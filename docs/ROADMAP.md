# PriceLens Roadmap

This roadmap is evidence-gated. A later phase does not require pretending an earlier external integration is solved.

## Phase 0 — Bootstrap

Status: **in progress**

Deliverables:

- monorepo structure
- contracts package
- core price/matching utilities
- eBay MV3 extension vertical slice
- API shell
- tests
- CI
- architecture and open-source policy

Exit gate: extension and API build/test from a clean checkout.

## Phase 1 — eBay extraction vertical slice

Deliverables:

- structured-data-first extractor
- robust item-id parsing
- price/currency/condition mapping
- brand/model/identifier extraction where available
- Shadow DOM PriceLens card
- fixture corpus covering representative eBay.de layouts

Exit gate: labelled fixture accuracy is measured; extractor failures degrade to an explicit unsupported state.

## Phase 2 — Matching and comparison engine

Deliverables:

- integrate `product-matcher`
- hard mismatch rules for variants/condition
- candidate confidence/reason model
- landed-price calculation
- deterministic comparison result
- fixture-backed mock providers

Exit gate: no known labelled hard-mismatch fixture is auto-matched.

## Phase 3 — eBay API enrichment

Deliverables:

- server-side eBay API credentials
- Browse API adapter
- GTIN/EPID enrichment
- rate-limit handling and cache
- fallback when API access is unavailable

Exit gate: enrichment improves coverage without becoming mandatory for page extraction.

## Phase 4 — Provider access spikes

Run independent access spikes before production adapters.

### Idealo

1. Apply/evaluate iPN publisher API access.
2. Document fields, quotas, attribution and commercial constraints.
3. If access is unavailable, evaluate a low-volume research adapter separately.

### Geizhals

1. Contact/evaluate Publisher Programme data access.
2. Document attribution, link rules and available product/price fields.
3. Treat browser scraping only as a replaceable research adapter.

### Amazon

1. Establish permitted affiliate/API route.
2. Confirm product identifier lookup and price fields.
3. Keep credentials server-side.

Exit gate: each enabled production provider has an explicit permitted data-access path.

## Phase 5 — First real provider

Deliver one complete production-quality provider before enabling all three.

Requirements:

- timeout/retry policy
- cache
- normalized offers
- match confidence
- attribution/deep links
- provider status reporting
- fixture/contract tests

## Phase 6 — Multi-provider comparison

Deliverables:

- Idealo + Geizhals + Amazon where access permits
- provider concurrency limits
- partial-result behavior
- best landed price
- source freshness indicators
- UI states for unavailable/uncertain providers

## Phase 7 — eBay search-results augmentation

Only after single-item correctness is proven.

Deliverables:

- detect eBay result cards
- batch/debounce comparisons
- visible result limit
- request deduplication
- cache-aware scrolling
- no excessive provider traffic

## Phase 8 — Deal intelligence

Potential later features:

- market median and spread
- price history
- watchlists
- Deal Score with explainable components
- seller/shipping context
- optional alerts

A Deal Score must remain explainable and must not hide match uncertainty.

## Deferred / non-goals for early MVP

- automatic buying/bidding
- resale/arbitrage execution
- aggressive anti-bot evasion
- full support for used goods versus new-retail markets
- all eBay country sites
- ML model training before deterministic matching is benchmarked
