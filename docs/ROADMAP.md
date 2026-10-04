# PriceLens Roadmap

Updated: **2026-10-04**

This roadmap is evidence-gated. Later phases do not require pretending an earlier external integration is solved.

## Phase overview

| Phase | Status | Exit gate |
| --- | --- | --- |
| 0 — Bootstrap | **complete** | clean checkout typechecks, tests and builds in CI |
| 1 — eBay extraction vertical slice | **complete (current observed gate)** | measured labelled-fixture accuracy + safe unsupported state |
| 2 — Matching/comparison engine | **complete (current labelled gate)** | zero known labelled hard-mismatch auto-matches |
| 3 — eBay API enrichment | **implementation complete; live validation blocked** | enrichment improves coverage without becoming mandatory |
| 3B — eBay same-product marketplace | **initial implementation complete; live validation blocked** | exact same-product alternatives remain condition-separated and trustworthy |
| 3C — On-demand international comparison UX | **in progress** | explicit user action produces a compact best-value report; full list is optional |
| 4 — Provider access spikes | **external access in progress** | explicit permitted access path for every enabled provider |
| 5 — First real provider | **not started** | one production-quality provider end to end |
| 6 — Multi-provider comparison | **internal plumbing complete; live activation blocked** | partial failures + concurrency + approved freshness are production-safe |
| 7 — eBay search-results augmentation | **initial implementation complete; live-layout validation pending** | user-triggered cards remain traffic-safe and evidence-validated |
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

Status: **complete for the current observed-layout gate**

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

Delivered evidence gate:

- [x] expand fixture corpus across representative eBay.de layouts
- [x] label expected identity/price/shipping/condition fields in the initial corpus
- [x] enforce exact per-field labels in CI for the synthetic corpus
- [x] add representative anonymized real-layout fixtures and measure empirical field accuracy (6 reviewed fixtures / 108 labelled fields)
- [x] cover paid/free/unknown/unavailable shipping, selected variants, used/refurbished, weak identity and incomplete Product JSON-LD identity with safe DOM fallback
- [x] add explicit unsupported-state result when safe normalization is impossible
- [x] document and regression-test selector/structured-data failure modes

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

Status: **implementation + Sandbox validation complete; Production approval/live validation pending**

Deliverables:

- [x] server-side eBay Sandbox credentials/live validation
- [x] Browse API client/enrichment adapter
- [x] brand/model/MPN/GTIN/EAN/UPC enrichment paths
- [x] OAuth token lifecycle
- [x] rate-limit/error handling
- [x] token/item cache
- [x] fallback when API access is unavailable
- [ ] measure enrichment coverage on live representative items
- [ ] complete required Production approval / Growth Check

Exit gate: enrichment improves coverage without becoming mandatory for page extraction.

## Phase 3B — eBay same-product marketplace comparison

Status: **initial implementation complete; live Browse/compliance validation blocked**

Delivered:

- [x] dedicated `ebay_market` provider behind an explicit runtime feature gate
- [x] Browse `item_summary/search` by strongest GTIN/EAN/UPC
- [x] fixed-price-only request + defensive local auction rejection
- [x] current eBay listing exclusion
- [x] no broad title-only search when a strong identifier is absent
- [x] same-product matching reuses PriceLens hard identity/variant guards
- [x] cross-condition matching only for this provider
- [x] NEW / OPEN BOX / REFURBISHED / USED remain separate
- [x] cross-condition offers cannot become the headline best price for the current condition
- [x] landed-price completeness preserved; unknown shipping is never zero-filled
- [x] seller feedback fields exposed when available
- [x] UI shows per-condition cheapest offer, accepted count, range and median
- [x] feature disabled by default in Terraform

Still required:

- [x] redacted end-to-end live provider validation harness
- [x] protected manual GitHub workflow that uploads redacted provider-validation evidence
- [ ] live Sandbox/Production response validation
- [ ] representative condition-id/category fixtures from live eBay.de data
- [ ] approved shipping/delivery semantics for the intended buyer geography
- [x] ePID fallback where a trustworthy product ID is available
- [x] exact Brand + MPN fallback through unique eBay Catalog ePID resolution
- [x] controlled Brand + Model Catalog fallback with exact detail verification
- [x] verify storage/RAM/screen/pack variants against Catalog detail before Brand+Model ePID acceptance
- [x] verify edition and model-qualifier through exact allowlisted Catalog aspects
- [ ] keep seller bundle state excluded until it can be verified from listing-level evidence rather than product catalog
- [ ] live-validate Brand+Model Catalog search/detail behavior
- [x] seller account type + estimated delivery window from eBay search metadata
- [x] return-policy context via bounded accepted-candidate detail lookup
- [ ] live-validate eBay item-detail return terms across representative EU listings
- [ ] production Buy API/Growth Check UX/compliance confirmation
- [ ] measured same-product precision/recall on representative products

Exit gate: PriceLens can surface alternate fixed-price eBay listings for the same
product without mixing conditions, variants or incomplete shipping into a misleading
best-price claim.

## Phase 3C — On-demand international comparison UX

Status: **in progress**

Product rule:

> Opening or scrolling an eBay page must not automatically fan out provider searches.
> A comparison report is generated only after the user explicitly requests it.

Compact-first UX:

- [x] render an idle PriceLens lens/eye control after safe local extraction
- [x] send zero comparison/provider requests until the user presses the control
- [x] show a loading state only after explicit request
- [x] show only materially useful cheaper offers in the initial report
- [x] prioritize cheaper offers in the same condition as the current listing
- [x] show refurbished/used alternatives separately
- [x] cap the compact report to a small number of actionable offers
- [x] add a `+` control to expand the complete returned offer list
- [x] collapsing/reopening the already loaded report must not trigger a new provider request
- [x] add an explicit Refresh report action that always bypasses report reuse

International foundation:

- [x] add marketplace/source-country metadata to normalized offers
- [x] make comparison currency-safe before multi-currency marketplace fan-out
- [x] model buyer destination country explicitly at backend configuration level (default DE; no IP inference)
- [x] add user-controlled delivery country/postal-code preference in the extension
- [x] add eBay EU marketplace fan-out, starting with DE/PL/AT/FR/IT/ES/NL/BE
- [x] pass buyer destination country and optional postal code where the provider supports shipping calculation
- [x] deduplicate the same eBay item returned by multiple marketplaces
- [x] preserve original marketplace currency and block raw cross-currency ranking
- [x] add explicit ECB reference FX normalization before cross-currency savings ranking
- [ ] live-validate ECB refresh/freshness behavior in deployed runtime
- [x] distinguish EU from non-EU landed-cost semantics; exclude unconfirmed import costs from ranking
- [x] implement Amazon EU marketplace fan-out keyed by marketplace-specific Partner Tags
- [ ] activate each Amazon EU marketplace only after its Partner Tag/access is approved
- [x] keep Amazon offers out of delivered-price ranking while mandatory shipping is unknown

Traffic/scale rules:

- [x] provider concurrency and API overload caps already exist
- [x] provider caches default off pending approved freshness terms
- [x] no eager per-card provider calls on eBay search-result pages
- [ ] future search-result augmentation is user-triggered per card by default
- [x] implement bounded in-memory tab-session report reuse keyed by listing + destination
- [ ] enable a positive tab-session reuse TTL only after every active provider's cache/freshness rules permit it
- [x] measure aggregate eBay/Amazon marketplace-call count, success/failure and fan-out latency for compact reports

Exit gate: a user can explicitly request one PriceLens report, immediately see the few
offers that can actually save money, optionally expand the full list, and do so without
automatic page-load provider traffic or unsafe cross-currency ranking.

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

## Phase 4A — Provider entitlement gating

Status: **public/private-beta foundation implemented; authenticated identity pending**

- [x] represent restricted providers separately from unconfigured/error states
- [x] default anonymous/free access restricts Idealo and Geizhals
- [x] skip restricted adapters before any provider network request
- [x] ignore client-supplied tier/entitlement claims
- [x] fail closed when server access resolution is missing, malformed or unavailable
- [x] expose a Private beta placeholder in the extension UI
- [x] keep pilot/pro/admin access as a server-resolved context
- [x] connect server-side Google identity verification/session exchange
- [x] issue/verify short-lived server-signed user sessions
- [x] persist pilot/pro/admin Google-subject entitlements in pinned trusted Secret Manager data
- [x] connect the Chrome extension interactive Google sign-in client
- [ ] enable Idealo/Geizhals only after both entitlement and provider-contract gates pass

Exit gate: public users cannot invoke restricted provider adapters, while an authenticated
pilot can be granted access without embedding a shared secret in the extension.

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

Status: **internal orchestration/UI complete; live multi-provider activation blocked on approved provider access and freshness rules**

Deliverables:

- [ ] Idealo + Geizhals + Amazon where access permits
- [x] provider concurrency limits
- [x] API comparison overload limit
- [x] request coalescing
- [x] partial-result behavior
- [x] best landed price
- [x] source freshness indicators
- [x] UI states for unavailable providers
- [x] richer uncertainty presentation for review-only candidates
- [x] provider caches default disabled pending approved rules
- [ ] provider-specific approved cache TTL rules

Exit gate: partial outages and rate limits degrade gracefully and never produce a misleading best-price claim.

## Phase 7 — eBay search-results augmentation

Status: **initial user-triggered implementation in progress; live-layout validation pending**

Default interaction: **user-triggered per result card; no eager provider lookup while scrolling.**

Deliverables:

- [x] detect eBay result cards locally
- [x] render a small PriceLens lens/eye action per eligible card
- [x] send a comparison request only for a card the user explicitly opens
- [x] request deduplication
- [x] cache/session-aware reopening
- [x] no excessive provider traffic
- [x] compact cheaper-first result with optional full expansion
- [x] per-card uncertainty/provider-degradation state
- [x] anonymized real-search capture tool with deterministic synthetic item IDs
- [x] independent reviewed-fixture gate for observed search layouts
- [x] observed search-card field metrics command
- [ ] representative anonymized real eBay.de search-layout fixtures
- [ ] live-layout validation for infinite scroll / sponsored-result variants

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
- [x] deep request validation
- [x] eBay inbound URL host/item-id trust checks
- [x] Amazon Germany marketplace/detail-URL allowlist
- [x] extension production API origin requires HTTPS
- [x] production deployment topology selected: Cloud Run + external load balancer + Cloud Armor
- [x] production API container + readiness/graceful shutdown contract
- [x] validated Terraform definitions for Cloud Run + HTTPS LB + Cloud Armor
- [x] Terraform Phase B rejects reserved/placeholder API hostnames
- [x] Terraform Phase B requires an immutable git-SHA/digest image from the configured Artifact Registry
- [x] Secret Manager container/IAM/pinned-version injection + rotation procedure in IaC
- [ ] apply production HTTPS ingress/custom API hostname in the selected GCP project
- [ ] extend outbound allowlists to future providers
- [ ] add approved live secret versions and validate the rotation process
- [x] explicit first-use comparison consent + local revoke control
- [x] Chrome privacy/store disclosure baseline
- [ ] final publisher/legal/privacy review before public release

### Reliability/observability

- [x] provider timeout isolation
- [x] provider status model
- [x] bounded comparison concurrency with explicit overload rejection
- [x] independent provider concurrency caps
- [x] in-flight eBay/Amazon request coalescing
- [x] stable HTTP/result request correlation id
- [x] privacy-minimized structured request correlation logging
- [x] cache hit/miss/coalescing metrics without cache keys
- [x] per-request provider latency diagnostics
- [x] aggregate provider state/latency metrics snapshots
- [x] durable privacy-minimized metrics persistence/alerting IaC (live apply pending)
- [x] match-decision aggregate diagnostics
- [x] structured warning taxonomy

### Distribution

- [x] production API deployment model selected (Cloud Run, europe-west3)
- [x] production API Docker image verified in CI
- [x] GCP Terraform IaC validated in CI (provider 8.2.0)
- [x] two-phase bootstrap/runtime infrastructure workflow documented
- [x] keyless GitHub Actions WIF image-publisher IaC with immutable repository/main trust boundary
- [x] manual GitHub workflow publishes Git-SHA API images to Artifact Registry without service-account keys
- [x] separate protected GCS Terraform-state bootstrap with versioning, uniform access and Public Access Prevention
- [x] production Terraform root declares configurable GCS backend; CI remains credential-free with `-backend=false`
- [ ] apply remote-state bootstrap in the production GCP project and initialize/migrate `infra/gcp`
- [ ] apply WIF bootstrap in the production GCP project and configure GitHub repository variables
- [x] extension build-time API-origin configuration
- [x] generated extension artifact verification in CI
- [x] backend production runtime/environment contract
- [ ] actual Terraform apply: Cloud Run/load-balancer/Cloud Armor/Secret Manager resources
- [x] Chrome packaging workflow + CI ZIP smoke test
- [x] Chrome/Firefox candidate release preflight rejects placeholder origins and requires live `/ready` + `/health`
- [x] Firefox desktop compatibility evaluation + browser-specific build/package baseline
- [ ] Firefox live desktop smoke test + AMO signing validation
- [x] committed npm lockfile + CI-enforced dependency-license inventory for release
- [x] privacy-policy technical draft + Chrome Web Store release checklist
- [ ] publish final privacy policy URL and complete Developer Dashboard disclosures

## Deferred / non-goals for early MVP

- automatic buying/bidding
- resale/arbitrage execution
- aggressive anti-bot evasion
- full support for used goods versus new-retail markets
- all eBay country sites
- ML model training before deterministic matching is benchmarked
