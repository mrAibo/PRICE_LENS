# PriceLens Roadmap

Updated: **2026-10-02**

This roadmap is evidence-gated. Later phases do not require pretending an earlier external integration is solved.

## Phase overview

| Phase | Status | Exit gate |
| --- | --- | --- |
| 0 — Bootstrap | **complete** | clean checkout typechecks, tests and builds in CI |
| 1 — eBay extraction vertical slice | **in progress** | measured labelled-fixture accuracy + safe unsupported state |
| 2 — Matching/comparison engine | **complete (current labelled gate)** | zero known labelled hard-mismatch auto-matches |
| 3 — eBay API enrichment | **implementation complete; live validation blocked** | enrichment improves coverage without becoming mandatory |
| 4 — Provider access spikes | **external access in progress** | explicit permitted access path for every enabled provider |
| 5 — First real provider | **not started** | one production-quality provider end to end |
| 6 — Multi-provider comparison | **not started** | partial failures + concurrency + freshness are production-safe |
| 7 — eBay search-results augmentation | **deferred** | single-item correctness proven first |
| 8 — Deal intelligence | **future** | explainable metrics built on trustworthy matching |

## Phase 0 — Bootstrap

Status: **complete**

Delivered:

- [x] monorepo structure
- [x] contracts package
- [x] core price/matching utilities
- [x] vendored/pinned MIT `product-matcher`
- [x] eBay MV3 extension vertical slice
- [x] extension -> backend API boundary
- [x] API shell
- [x] provider interface/orchestration
- [x] tests
- [x] CI
- [x] architecture and open-source policy
- [x] provider access research
- [x] dynamic extension lifecycle hardening

Exit gate: extension and API build/test from a clean checkout.

Evidence: CI has passed on the bootstrap implementation and feature checkpoints.

## Phase 1 — eBay extraction vertical slice

Status: **in progress**

Delivered:

- [x] structured-data-first extractor
- [x] robust item-id parsing
- [x] price/currency/condition mapping
- [x] shipping extraction paths
- [x] brand/model/identifier extraction where available
- [x] Shadow DOM PriceLens card
- [x] page-transition lifecycle handling
- [x] extraction and lifecycle unit fixtures
- [x] labelled synthetic regression corpus (9 fixtures / 77 scalar labels)
- [x] explicit extraction-evidence baseline document
- [x] reject ambiguous multi-offer structured price/condition/shipping
- [x] extract explicit storage/RAM/screen-size/pack-count item specifics
- [x] observed-layout anonymization/capture command
- [x] independent review gate for real-layout fixtures
- [x] separate synthetic and observed per-field metrics

Still required:

- [ ] expand fixture corpus across representative eBay.de layouts
- [x] label expected identity/price/shipping/condition fields in the initial corpus
- [x] enforce exact per-field labels in CI for the synthetic corpus
- [ ] add representative anonymized real-layout fixtures and measure empirical field accuracy
- [x] add explicit unsupported-state result when safe normalization is impossible
- [ ] document selector/structured-data failure modes

Exit gate: labelled fixture accuracy is measured; extractor failures degrade to an explicit unsupported state.

## Phase 2 — Matching and comparison engine

Status: **complete for the current labelled gate**

Delivered:

- [x] integrate `product-matcher`
- [x] exact GTIN/EAN/UPC path
- [x] exact brand + MPN path
- [x] condition/brand/strong-identifier contradiction rules
- [x] candidate confidence/reason model
- [x] landed-price calculation
- [x] deterministic comparison result
- [x] provider timeout/error isolation
- [x] opt-in fixture provider for complete local end-to-end validation

Delivered safety/calibration:

- [x] hard mismatch rules/fixtures for storage capacity
- [x] RAM mismatches
- [x] screen-size variants from explicit structured data
- [x] pack-count variants from explicit structured data
- [x] conservative model qualifier and numeric-generation variants
- [x] console/product edition variants
- [x] explicit standalone-versus-bundle variants
- [x] labelled calibration set for automatic/review thresholds
- [x] review/debug visibility for non-auto-matched candidates

Exit gate: no known labelled hard-mismatch fixture is auto-matched.

## Phase 3 — eBay API enrichment

Status: **implementation complete; live Sandbox/Production validation blocked**

Deliverables:

- [ ] server-side eBay Sandbox credentials/live validation
- [x] Browse API client/enrichment adapter
- [x] brand/model/MPN/GTIN/EAN/UPC enrichment paths
- [x] OAuth token lifecycle
- [x] rate-limit/error handling
- [x] token/item cache
- [x] fallback when API access is unavailable
- [ ] measure enrichment coverage on live representative items
- [ ] complete required Production approval / Growth Check

Exit gate: enrichment improves coverage without becoming mandatory for page extraction.

## Phase 4 — Provider access spikes

Status: **research complete; access/onboarding pending**

Run independent access spikes before production adapters.

### Idealo

- [x] identify iPN/publisher API as preferred route
- [x] separate it from merchant PWS 2.0
- [ ] apply/evaluate publisher access
- [ ] document fields, quotas, attribution and commercial constraints
- [ ] confirm identifier lookup and shipping-price semantics

### Geizhals

- [x] identify Publisher Programme as preferred route
- [ ] confirm API/feed/machine-readable access with Business Development
- [ ] document identifier lookup
- [ ] document offer/shipping fields
- [ ] document refresh/cache rules
- [ ] document attribution/tracking-link requirements

### Amazon Germany

- [x] select Creators API instead of new PA-API 5.0 work
- [x] implement OAuth/SearchItems provider scaffold and contract tests
- [x] preserve incomplete landed-price semantics because OffersV2 lacks mandatory shipping charges
- [ ] verify Associates/Creators eligibility
- [ ] complete onboarding/live credentials
- [ ] confirm current price/freshness/cache rules with approved access
- [ ] confirm attribution/display requirements in the intended extension flow

Exit gate: each enabled production provider has an explicit permitted data-access path.

## Phase 5 — First real provider

Status: **provider scaffold available; live provider gate not yet passed**

Deliver one complete production-quality provider before enabling all three.

Requirements:

- [ ] approved live credentials/access
- [x] backend-only environment configuration
- [x] timeout policy
- [x] controlled auth refresh/error behavior
- [ ] live-approved cache/freshness policy
- [x] normalized Amazon offer scaffold
- [x] match confidence/reason through shared matcher
- [ ] live attribution/display policy validation
- [x] provider status reporting
- [x] fixture/contract tests
- [x] disable/fallback behavior
- [x] local and CI-safe testing without live credentials
- [ ] one provider with complete mandatory-shipping semantics and live validation

Exit gate: one real provider satisfies its contract and can fail independently without breaking PriceLens.

## Phase 6 — Multi-provider comparison

Status: **not started**

Deliverables:

- [ ] Idealo + Geizhals + Amazon where access permits
- [ ] provider concurrency limits
- [ ] request coalescing
- [ ] partial-result behavior
- [ ] best landed price
- [ ] source freshness indicators
- [ ] UI states for unavailable/uncertain providers
- [ ] provider-specific cache rules

Exit gate: partial outages and rate limits degrade gracefully and never produce a misleading best-price claim.

## Phase 7 — eBay search-results augmentation

Status: **deferred until single-item gates pass**

Deliverables:

- [ ] detect eBay result cards
- [ ] batch/debounce comparisons
- [ ] visible result limit
- [ ] request deduplication
- [ ] cache-aware scrolling
- [ ] no excessive provider traffic
- [ ] per-card uncertainty state

## Phase 8 — Deal intelligence

Status: **future**

Potential features:

- market median and spread
- price history
- watchlists
- Deal Score with explainable components
- seller/shipping context
- optional alerts

A Deal Score must remain explainable and must not hide match uncertainty.

## Cross-cutting work

### Security/privacy

- [x] no provider secrets in extension
- [x] no arbitrary URL fetch endpoint
- [x] request validation
- [ ] production HTTPS/deployment configuration
- [ ] outbound provider allowlist enforcement
- [ ] structured secret management
- [ ] privacy review before any telemetry

### Reliability/observability

- [x] provider timeout isolation
- [x] provider status model
- [ ] request correlation logging
- [ ] cache hit/miss metrics
- [ ] provider latency metrics
- [ ] match-decision diagnostics
- [ ] structured warning taxonomy

### Distribution

- [ ] production API deployment model
- [ ] environment/configuration strategy
- [ ] Chrome packaging
- [ ] Firefox compatibility evaluation
- [ ] dependency-license inventory for release
- [ ] privacy policy / store disclosures if public distribution proceeds

## Deferred / non-goals for early MVP

- automatic buying/bidding
- resale/arbitrage execution
- aggressive anti-bot evasion
- full support for used goods versus new-retail markets
- all eBay country sites
- ML model training before deterministic matching is benchmarked
