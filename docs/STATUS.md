# PriceLens Project Status

Updated: **2026-10-05**

Overall status: **active implementation / early MVP**

Primary integration branch: `main`

Main baseline merge: `cbf2888aa3e321bab1261d7bed6d9d977a5a4421` (PR #1)

Current implementation checkpoint: `831fd2bf6da70681e850d8e08946edb63a22fdce` (PR #92). New implementation branches should start from the current `main`.

## Completed

### Repository and delivery

- [x] npm-workspaces monorepo
- [x] TypeScript/Node.js 22 baseline
- [x] CI for typecheck, tests and build
- [x] Terraform 1.16.4 fmt/init/validate gate for production GCP IaC
- [x] Google provider 8.2.0 production infrastructure schema baseline
- [x] MIT project license
- [x] third-party notices and open-source reuse policy
- [x] pinned vendored MIT `product-matcher` snapshot
- [x] committed npm lockfile; CI and Docker use deterministic `npm ci`
- [x] generated dependency-license inventory + CI allowlist gate

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
- [x] independently reviewed real eBay.de item-page corpus: 6 fixtures / 108 labelled fields
- [x] real-layout `schema.org/UsedCondition` normalization defect fixed from observed evidence
- [x] live JSON-LD title character-reference decoding fixed from observed evidence
- [x] selected eBay SKU storage values override ambiguous generic item-specific values
- [x] observed capture pipeline preserves newer direct `dt/dd` Brand/Model item-specifics while excluding unrelated seller data
- [x] local-pickup-only listings keep shipping unknown/unavailable instead of treating pickup as EUR 0 shipping
- [x] observed weak-identity media listing proves Brand/Model/MPN/GTIN/EAN/UPC are not invented from title text
- [x] destination-specific unknown shipping stays incomplete instead of becoming zero
- [x] international listing keeps visible primary GBP price when eBay JSON-LD exposes only an approximate EUR conversion
- [x] observed fixture anonymizer rewrites embedded source item IDs to synthetic IDs and strips live navigation/tracking attributes
- [x] structured variant fields participate in lifecycle fingerprinting
- [x] build-time extension API origin with HTTPS-only production policy (PR #29)
- [x] generated extension artifact verification for dev + production-origin builds
- [x] Chrome ZIP smoke packaging in CI
- [x] manual HTTPS production-origin Chrome package workflow
- [x] explicit first-use privacy consent before eBay extraction/network traffic
- [x] local consent revocation control
- [x] public release artifacts enforce minimal `storage` permission; opt-in Chrome pilot artifact adds only `identity` + `openid`
- [x] behavior-derived privacy baseline and Chrome Web Store release checklist
- [x] Firefox-specific MV3 build/verify/package baseline
- [x] callback-compatible storage/runtime adapters for Chrome + Firefox
- [x] Firefox Gecko ID + built-in data-collection manifest declaration

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
- [x] JSON-only comparison media-type boundary; no permissive browser CORS preflight
- [x] opt-in local `fixture` provider for true end-to-end development without external traffic
- [x] server-side eBay Browse OAuth/enrichment client with fail-open fallback
- [x] feature-gated eBay same-product fixed-price marketplace provider using exact GTIN/EAN/UPC or trustworthy ePID search
- [x] optional exact Brand+MPN -> unique ePID Catalog fallback, disabled by default
- [x] Catalog ePID lookup uses separate readonly OAuth scope and concurrent single-flight without persistent product caching
- [x] condition-separated eBay alternatives (new/open-box/refurbished/used) with current-listing exclusion
- [x] eBay search-level seller account type + lowest-cost-shipping delivery window context
- [x] optional post-match eBay item-detail enrichment exposes seller return terms only for a bounded set of auto-matched offers
- [x] eBay detail enrichment defaults off, caps candidates at 5, uses concurrency 2, single-flights identical item/destination lookups, and fails open
- [x] eBay alternatives UI with accepted count, cheapest complete landed price, range/median and seller feedback context
- [x] cross-condition eBay alternatives cannot replace same-condition global best price
- [x] eBay token/item cache, timeout, 401 refresh and 404/429 handling
- [x] Amazon Creators API provider scaffold with OAuth/SearchItems contract tests
- [x] Amazon offers remain landed-price incomplete when mandatory shipping is unavailable
- [x] in-flight eBay Browse legacy-item lookup + OAuth coalescing
- [x] in-flight Amazon SearchItems + OAuth coalescing with caller-local cancellation
- [x] HTTP request correlation via `x-price-lens-request-id` and `ComparisonResult.requestId`
- [x] opt-in privacy-minimized JSON diagnostics with provider latency/state aggregation
- [x] periodic cumulative operational metrics snapshots (provider states + avg/max latency + rejection reasons)
- [x] structured comparison warning taxonomy aggregated without parsing human-readable warning text
- [x] accepted/review match-method aggregate diagnostics without product identifiers
- [x] eBay/Amazon product-cache hit/miss/coalesced aggregate metrics without cache keys or lookup terms
- [x] durable GCP log-based application counters + overload alert IaC for server_busy/warnings/enrichment fallback (live apply pending)
- [x] GCP IaC for dedicated privacy-minimized operational-log retention
- [x] GCP HTTPS readiness uptime check + Cloud Run 5xx/P95 alert-policy baseline
- [x] credential-free Terraform Phase A/Phase B safety-invariant tests in CI
- [x] Terraform alert enablement guard requires runtime monitoring + explicit approved notification channel
- [x] Terraform Phase B rejects reserved/placeholder API domains and mutable/wrong-registry runtime images
- [x] Chrome/Firefox candidate packaging rejects placeholder release origins and live-probes `/ready` + `/health` before building
- [x] provider product/price caches disabled by default until approved freshness rules are known
- [x] explicit TTL-only provider caching with configuration validation
- [x] deep inbound eBay payload validation at the API trust boundary
- [x] eBay item URL host/id consistency checks
- [x] Amazon Germany marketplace/detail-URL allowlist
- [x] bounded API comparison concurrency with overload `503`
- [x] independent hard concurrency caps for each configured price provider
- [x] partial-provider outage UI with available-source qualification
- [x] best-offer provider/merchant + fetched-at freshness indicator
- [x] review-only provider candidates shown as excluded uncertainty with confidence/reason
- [x] production multi-stage API Docker image, non-root runtime
- [x] deployment readiness endpoint (`GET /ready`)
- [x] bounded graceful SIGTERM/SIGINT shutdown
- [x] CI builds and smoke-runs the production API container
- [x] two-phase GCP Terraform baseline: APIs/Artifact Registry/service account/Secret Manager bootstrap
- [x] native Terraform Cloud Run + serverless NEG + EXTERNAL_MANAGED HTTPS LB resources
- [x] Cloud Armor 64 KiB declared-body guard + per-IP throttle in preview by default
- [x] pinned Secret Manager version injection; no provider secret values accepted by Terraform
- [x] opt-in GitHub Actions WIF image-publisher IaC bound to immutable PriceLens repo/owner IDs + main branch
- [x] WIF image publisher has Artifact Registry Writer only; no Secret Manager/Cloud Run/project-admin role
- [x] manual keyless GitHub workflow builds/pushes immutable GITHUB_SHA API images
- [x] separate GCS Terraform-state bootstrap enforces versioning, uniform bucket-level access, Public Access Prevention and non-destructive defaults
- [x] production Terraform root uses a configurable GCS backend; CI validates it with backend disabled
- [x] GitHub image publisher receives no Terraform-state bucket IAM grant
- [ ] live state-bucket apply + production backend initialization/migration remains pending
- [ ] live WIF Phase-A apply + GitHub repository-variable configuration remains pending

### Provider/access research

- [x] eBay official Browse API chosen for enrichment
- [x] Idealo merchant PWS rejected as the wrong API class for PriceLens
- [x] Idealo iPN/publisher path identified
- [x] Geizhals Publisher Programme identified as preferred access path
- [x] Amazon Creators API chosen instead of new PA-API 5.0 work
- [x] Amazon browser-extension use explicitly gated on prior written Amazon approval
- [x] scraping explicitly limited to research/fallback evaluation

## In progress

### Phase 7 — user-triggered eBay search-result cards

Initial implementation now exists behind the same stored comparison consent:

- [x] content script scope includes only `ebay.de/itm/*` and `ebay.de/sch/*`
- [x] no search-card extraction or UI is activated before stored consent exists
- [x] eligible `.s-item` cards are recognized locally from item URL/title/price
- [x] card shipping/condition are used only when they can be parsed safely
- [x] scrolling/DOM discovery mounts lens controls without API/provider traffic
- [x] only the clicked card sends a comparison request
- [x] repeated clicks after a loaded result expand/collapse local data without another request
- [x] newly appended infinite-scroll cards can be discovered incrementally
- [x] incomplete current shipping suppresses delivered-price savings claims
- [x] compact cheaper-first results are bounded; additional accepted offers stay locally expandable
- [x] per-card partial/private-beta/review-only uncertainty is surfaced and expands locally
- [x] observed search-layout capture/anonymization tool
- [x] independent review gate before observed search fixtures count as evidence
- [x] separate observed search-card field metrics
- [ ] real eBay.de search-layout fixtures and live-layout validation remain pending

Search-card extraction intentionally carries no invented GTIN/MPN. It relies on the
existing server-side eBay enrichment path before any provider can auto-match the item.



### Phase 3C — on-demand / compact-first comparison

Accepted product direction:

- [x] safe page extraction may run locally, but provider/API lookup waits for explicit user action
- [x] lens/eye control triggers the first comparison
- [x] initial report shows only a bounded set of cheaper/actionable offers
- [x] same-condition savings are prioritized over used/refurbished alternatives
- [x] full returned offer list is hidden behind a `+` expansion control
- [x] UI expansion/collapse must not create another provider request
- [x] explicit Refresh report action bypasses any reusable report and performs a fresh comparison
- [x] bounded in-memory tab-session report reuse exists for listing + destination
- [x] tab-session report reuse defaults to TTL 0 until provider-specific cache/freshness terms permit reuse
- [x] eBay international comparison fans out across configurable EU marketplaces with deliveryCountry=DE and bounded concurrency
- [x] raw multi-currency ranking is blocked unless an explicit normalized comparison price exists
- [x] optional ECB reference FX normalizer preserves original PLN/etc. prices and adds EUR comparison prices
- [ ] live ECB FX retrieval/cache/freshness validation remains pending
- [x] backend delivery country is explicit and not inferred from IP
- [x] user-controlled destination country/postal-code preference is stored locally and sent only with explicit report requests
- [x] Amazon EU provider supports bounded DE/PL/FR/IT/ES/NL/BE fan-out with locale-specific Partner Tags
- [x] Amazon mandatory shipping remains unknown, so Amazon cannot become delivered-price winner
- [ ] Amazon EU live locale activation remains blocked on marketplace-specific Associates/Creators approval **and** explicit prior written approval for browser-extension use
- [x] privacy-safe aggregate eBay/Amazon fan-out telemetry records calls/report, success/failure and latency without product/user/destination fields
- [x] eBay item-origin country is retained when Browse provides it
- [x] known EU-origin -> EU-destination offers remain comparable when shipping is complete
- [x] known non-EU cross-customs offers are excluded from ranking until import charges are confirmed
- [x] unknown-origin offers remain visible but are excluded from best/cheaper ranking
- [x] current listing customs risk can suppress misleading savings when a non-EU origin is known
- [x] landed-cost uncertainty is surfaced in UI and aggregate diagnostics without logging origin/destination values

This phase is now the active implementation priority before broad search-results augmentation.



### Provider entitlement foundation

- [x] anonymous/free policy marks Idealo and Geizhals as restricted/private beta
- [x] restricted providers are skipped before adapter/network execution
- [x] comparison payload cannot self-assign pilot/pro/admin access
- [x] access resolver failures and malformed contexts fail closed to public restrictions
- [x] UI shows restricted providers as Private beta rather than outage/unconfigured
- [x] backend Google identity exchange verifies an explicit OAuth access token through Google userinfo
- [x] backend issues HMAC-signed PriceLens sessions with a 15-minute default lifetime
- [x] pilot/pro/admin entitlement uses a pinned server-side Google-subject map, never email/client claims
- [x] entitlement is re-resolved on every comparison, so pilot revocation takes effect immediately
- [x] missing/tampered/expired sessions fail closed to anonymous/private-beta restrictions
- [x] Terraform requires pinned Secret Manager versions before session auth can enable
- [x] Cloud Armor enforces a dedicated per-IP session-exchange request budget
- [x] Chrome extension interactive Google sign-in client is implemented as a build-time opt-in pilot artifact
- [x] public Chrome/Firefox artifacts retain storage-only permission and no OAuth manifest
- [x] pilot Chrome artifact requests only identity + openid and stores only the short-lived PriceLens session in chrome.storage.session
- [ ] live Chrome OAuth client registration / stable extension-ID validation remains pending
- [ ] Idealo/Geizhals live adapters remain separately blocked on provider approval/contracts

### Phase 1 — eBay extraction gate

Status: **complete for the current observed-layout gate**

Completed:

- [x] initial labelled synthetic eBay.de fixture corpus
- [x] initial regression-evidence report (synthetic corpus)
- [x] representative anonymized real-layout fixture corpus (**6 reviewed real fixtures / 108 labelled fields**)
- [x] empirical field-level extraction accuracy report over representative layouts (**6-fixture observed report / 108 labelled fields**)
- [x] coverage for representative shipping layouts (**paid domestic + free + local-pickup/no-shipping + destination-dependent unknown covered**)
- [x] initial coverage for variant/item-specific layouts
- [x] broaden initial variant/item-specific live coverage (**selected multi-variant storage covered on a live phone listing; future categories extend the corpus as needed**)
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

### eBay enrichment + same-product marketplace

- [x] redacted `providers:live-check` harness probes /ready, /health and a real user-triggered /v1/compare without persisting product/seller/request identifiers
- [x] protected manual GitHub provider-validation workflow uploads the redacted report artifact while keeping provider credentials exclusively in the backend
- [x] eBay developer credentials / Sandbox live validation (`EBAY_DE`, OAuth 200, Browse search 200, enrichment gate pass)
- [x] Browse API enrichment client
- [x] server-side OAuth token lifecycle
- [x] timeout, cache, 401 refresh, 404 and rate-limit handling
- [x] fail-open page-extraction fallback
- [x] same-product marketplace search implementation behind `EBAY_MARKETPLACE_COMPARISON_ENABLED=0` default
- [x] exact ePID discovery/matching path and opt-in Catalog Brand+MPN -> unique ePID fallback
- [x] feature-gated Brand+Model Catalog query fallback with bounded exact `getProduct` verification and fail-closed uniqueness
- [x] Brand+Model fallback verifies storage/RAM/screen/pack Catalog aspects; missing/conflicting aspects reject the ePID
- [x] edition/modelQualifier use exact allowlisted Catalog aspect verification; missing/conflicting values reject the ePID
- [ ] bundleIncluded remains excluded because seller bundle state is not safely inferable from product Catalog data
- [ ] Catalog fallback permission/authorization validation: current Sandbox keyset returns OAuth `invalid_scope` for `commerce.catalog.readonly`; keep Catalog fallbacks disabled
- [ ] live same-product search validation across representative conditions/categories (**Sandbox characterized: current DE test corpus is too small for accepted same-product pairs/precision-recall; Production evidence still required**)
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

### Amazon EU

- [ ] Associates/Creators eligibility for each intended locale
- [ ] Creators API onboarding / live credentials
- [x] shared EU OAuth/SearchItems provider scaffold
- [x] DE/PL/FR/IT/ES/NL/BE locale fan-out with marketplace-specific Partner Tags
- [x] bounded locale concurrency and partial-failure isolation
- [x] marketplace-specific Amazon URL trust boundary
- [x] ItemInfo / OffersV2 contract parsing
- [x] unknown mandatory shipping is kept incomplete and excluded from best-offer selection
- [ ] live price-display/freshness/cache policy validation per activated locale
- [ ] attribution/compliance validation with the approved accounts/tags

## Not started

- [x] in-flight provider request coalescing
- [ ] provider-approved production cache/freshness policy
- [ ] live-apply durable GCP observability, approve notification channels and tune alert thresholds
- [ ] first approved real provider adapter
- [ ] multi-provider production comparison
- [x] eBay search-result card augmentation — initial user-triggered implementation complete; real-layout validation pending
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
- PR #31 — bounded API/provider concurrency — merged into `main`
- PR #32 — Chrome extension packaging workflow — merged into `main`
- PR #35 — Cloud Run production container/deployment baseline — merged into `main`
- PR #36 — Chrome privacy consent + Web Store release baseline — merged into `main`
- PR #37 — partial-provider result + source freshness UI — merged into `main`
- PR #38 — review-only match uncertainty UI — merged into `main`
- PR #39 — validated GCP Terraform production baseline — merged into `main`
- PR #40 — reproducible npm lockfile + dependency-license release gate — merged into `main`
- PR #41 — Firefox desktop compatibility baseline — merged into `main`
- PR #42 — GCP operational observability baseline — merged into `main`
- PR #43 — Terraform deployment safety-invariant tests — merged into `main`
- PR #44 — alert enablement requires approved notification recipient — merged into `main`
- PR #45 — JSON-only comparison media-type / non-CORS abuse boundary — merged into `main`
- PR #46 — validate requests before reserving comparison concurrency — merged into `main`
- PR #47 — production release preflight + immutable Phase B inputs — merged into `main`
- PR #48 — structured warning + match-decision aggregate diagnostics — merged into `main`
- PR #49 — privacy-safe provider cache hit/miss/coalescing metrics — merged into `main`
- PR #50 — durable application log metrics + overload alert IaC — merged into `main`
- PR #51 — same-product eBay fixed-price marketplace comparison — merged into `main`
- PR #53 — on-demand compact-first comparison UX + cross-currency safety — merged into `main`
- PR #54 — bounded eBay EU marketplace fan-out + Germany delivery context — merged into `main`
- PR #55 — ECB reference FX normalization + provenance/fail-open ranking — merged into `main`
- PR #56 — explicit buyer destination country/postal-code + eBay shipping context — merged into `main`
- PR #57 — Amazon EU marketplace fan-out + locale-specific Partner Tag gating — merged into `main`
- PR #58 — server-owned private-beta provider entitlements + public placeholders — merged into `main`
- PR #59 — privacy-safe international fan-out telemetry — merged into `main`
- PR #64 — opt-in Chrome pilot Google sign-in + session-only bearer storage — merged into `main`
- PR #65 — keyless GitHub WIF API image publisher — merged into `main`
- PR #71 — verified eBay Catalog Brand+Model fallback — merged into `main`
- PR #72 — eBay Catalog structured-variant verification for Brand+Model fallback — merged into `main`
- PR #73 — exact Catalog edition/modelQualifier verification — merged into `main`
- PR #74 — redacted provider live-validation harness — merged into `main`
- PR #75 — protected GitHub provider live-validation workflow — merged into `main`
- PR #76 — observed eBay search-layout capture/review/metrics pipeline — merged into `main`
- PR #77 — end-to-end search capture anonymization test — merged into `main`
- PR #78 — external provider onboarding clarification + minimum observed item-layout evidence corpus — merged into `main`
- PR #79 — eBay/Amazon extension affiliate compliance gates — merged into `main`
- PR #80 — first reviewed real eBay item fixture + `UsedCondition` fix — merged into `main`
- PR #81 — credential-backed eBay Sandbox validation evidence — merged into `main`
- PR #82 — second real eBay fixture + JSON-LD title entity decoding — merged into `main`
- PR #83 — selected eBay SKU extraction + third reviewed real fixture — merged into `main`
- PR #84 — direct `dt/dd` item-specific capture + local-pickup/no-shipping observed fixture — merged into `main`
- PR #85 — fifth reviewed weak-identity real eBay fixture — merged into `main`
- PR #86 — destination-dependent shipping-unknown real eBay fixture + anonymizer hardening — merged into `main`
- PR #87 — Phase 1 observed extraction evidence gate closed — merged into `main`
- PR #88 — eBay Production approval packet (EPN software + Buy API/Growth Check) — merged into `main`
- PR #89 — credential-backed eBay Sandbox corpus characterization for same-product search — merged into `main`
- PR #90 — PriceLens companion site content (15 HTML pages) — merged into `main`
- PR #92 — privacy-safe GitHub Pages publication pipeline with generated Impressum/Datenschutz — merged into `main`
- PR #2 — API boundary branch — closed after equivalent/later work was incorporated into bootstrap

## Current engineering priorities

1. Phase 1 / Issue #10 — complete for the current observed gate. Six reviewed real fixtures / 108 labelled fields cover used+paid shipping, refurbished+free shipping, selected multi-variant storage, direct `dt/dd` Brand/Model, weak identity/no invention, local-pickup/no-shipping, destination-dependent shipping unknown, and incomplete Product JSON-LD identity with safe DOM fallback.
2. Issue #12 Sandbox credential/Browse-enrichment gate is complete and EPN account exists. Sandbox corpus characterization confirms only sparse test inventory, mostly new + fixed/free shipping, with no accepted exact-GTIN alternative pairs in the checked sample. Continue Issue #52 in Production after Software/Downloadable Tools approval, Buy API Production approval and Growth Check; keep Catalog fallbacks disabled until eBay grants/clarifies Catalog authorization.
3. Issue #91 — PriceLens companion site content plus manual GitHub Pages publication pipeline are merged. GitHub Pages is enabled in workflow mode with HTTPS at `https://mraibo.github.io/PRICE_LENS/`, but no deployment has been triggered. Required operator/contact data is injected from GitHub Actions secrets into generated Impressum/Datenschutz pages and never needs to enter Git history. Remaining step: load the real public operator details, run the manual Pages workflow, verify the published URL/legal pages, then use that genuine URL in provider/publisher applications.
4. Issue #13 — submit idealo iPN and Geizhals Publisher applications using the real PriceLens site once published; for Amazon, request explicit written permission before enabling Amazon in the browser extension.
5. Issue #14 — live-validate the first approved real provider; Idealo/Geizhals remain documentation-gated.
6. Add provider-specific persistent cache policy only after live rules are known; in-flight coalescing is already implemented.
7. Keep provider product-data cache TTL at zero until live freshness rules are approved; explicit TTL support is already implemented.
8. Continue security hardening as new provider adapters are added.
9. Issue #33 — release-preflight, immutable runtime-input guards, durable application metrics and alert IaC are implemented; remaining work is external deployment: Phase A apply, approved secret versions/image/domain, Phase B apply, DNS/TLS verification, Cloud Armor tuning, notification-channel approval and alert enablement before store packaging.
10. Keep server/provider concurrency defaults conservative until live provider quotas are measured.

## Local verification

```bash
npm ci
npm run licenses:check
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
- [eBay same-product marketplace](EBAY_MARKETPLACE_COMPARISON.md)
- [Technical design](TECHNICAL_DESIGN.md)
- [Roadmap](ROADMAP.md)
- [Provider access](PROVIDER_ACCESS.md)
- [Provider onboarding](PROVIDER_ONBOARDING.md)
- [Matcher calibration](MATCHER_CALIBRATION.md)
- [eBay Browse enrichment](EBAY_BROWSE_ENRICHMENT.md)
- [Amazon Creators provider](AMAZON_CREATORS_PROVIDER.md)
- [Observability](OBSERVABILITY.md)
- [Open-source reuse](OPEN_SOURCE_REUSE.md)
- [Firefox compatibility](FIREFOX_COMPATIBILITY.md)
