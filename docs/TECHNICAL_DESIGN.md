# PriceLens — Preliminary Technical Design

Status: **active implementation baseline**

Date: 2026-10-02

This document is the implementation-oriented companion to [ARCHITECTURE.md](ARCHITECTURE.md). The architecture document explains the stable system shape and principles; this document records concrete module boundaries, runtime flows, contracts, configuration, testing gates and near-term implementation decisions.

## 1. Scope

The first user-testable target is:

- Chromium-compatible browser
- eBay.de single-item pages
- a local PriceLens API during development
- exact/safe product matching before broad fuzzy coverage
- external market offers from approved providers when credentials/access exist
- a clearly labelled fixture provider for local end-to-end development before external provider access is available

Early non-goals:

- purchase or bidding automation
- hidden/background collection of eBay account data
- aggressive anti-bot bypass
- search-results augmentation before single-item correctness is measured
- automatic comparison of used/refurbished listings against new retail stock
- production dependence on unapproved HTML scraping

## 2. Runtime topology

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│                                                             │
│  eBay.de item page                                          │
│      │                                                      │
│      v                                                      │
│  MV3 content script                                         │
│  - page lifecycle                                           │
│  - listing extraction                                       │
│  - Shadow DOM widget                                        │
│      │ chrome.runtime message                               │
│      v                                                      │
│  MV3 service worker                                         │
│  - API client                                               │
└──────┼──────────────────────────────────────────────────────┘
       │ POST /v1/compare
       v
┌─────────────────────────────────────────────────────────────┐
│ PriceLens API                                               │
│  - payload validation                                       │
│  - provider orchestration                                   │
│  - timeout/error isolation                                  │
│  - future cache/observability                               │
│      │                                                      │
│      +--> product matcher / hard mismatch rules             │
│      │                                                      │
│      +--> eBay Browse enricher (implemented, access-gated) │
│      +--> IdealoProvider       (planned, docs/access-gated) │
│      +--> GeizhalsProvider     (planned, docs/access-gated) │
│      +--> AmazonProvider       (implemented, access-gated)  │
│      +--> FixtureProvider      (dev-only, opt-in)           │
└─────────────────────────────────────────────────────────────┘
```

The extension never contains provider credentials. Provider-specific network traffic belongs to the API/backend side.

## 3. Repository boundaries

```text
apps/
  extension/
    src/
      api/          extension -> PriceLens API client
      ebay/         eBay extraction only
      ui/           Shadow DOM rendering only
      lifecycle.ts  navigation/DOM-change control
      content.ts    composition root
      background.ts MV3 service worker

  api/
    src/
      app.ts              HTTP server/application boundary
      server.ts           process/configuration entry point
      fixture-provider.ts         dev-only provider
      ebay-browse.ts              optional eBay identity enrichment
      amazon-creators-provider.ts optional Amazon.de provider
    test/

packages/
  contracts/        shared browser/backend domain contract
  core/
    comparison.ts   landed-price and comparison math
    matching.ts     PriceLens matching policy
    providers.ts    provider interface + orchestration
  product-matcher/  pinned vendored MIT upstream snapshot

docs/
  ARCHITECTURE.md
  TECHNICAL_DESIGN.md
  ROADMAP.md
  STATUS.md
  PROVIDER_ACCESS.md
  OPEN_SOURCE_REUSE.md
```

Dependency direction:

```text
extension ---> contracts
api -------> contracts + core
core ------> contracts + product-matcher
product-matcher ---> no PriceLens package
```

Provider adapters must depend inward on the contracts/core abstractions; core must not depend on provider implementations.

## 4. eBay extraction pipeline

Priority order:

1. JSON-LD / structured product data
2. semantic/meta fields
3. narrowly scoped DOM selectors
4. URL parsing for item id

Normalized output is `EcommerceListing`.

Extraction evidence and warnings are first-class data. Missing optional fields must not become fabricated values.

The page lifecycle layer must:

- debounce mutation bursts
- re-extract after effective page/listing changes
- fingerprint normalized listings to avoid duplicate requests
- ignore stale asynchronous responses
- render an explicit unsupported state when an item page cannot be normalized safely
- send no comparison/API request for an unsupported extraction state
- automatically replace the unsupported state when later DOM data becomes safely extractable
- remove stale UI when navigation leaves an item page

## 5. Extension-to-API contract

Development endpoint:

```text
POST http://127.0.0.1:8787/v1/compare
```

Request:

```json
{
  "listing": {
    "source": "ebay",
    "itemId": "123456789012",
    "url": "https://www.ebay.de/itm/123456789012",
    "title": "Example product",
    "price": {"amount": 199.99, "currency": "EUR"},
    "shipping": {"amount": 0, "currency": "EUR"},
    "condition": "new",
    "identity": {
      "brand": "Example",
      "model": "X",
      "mpn": "EX-X",
      "gtin": "1234567890123"
    },
    "extractionEvidence": ["jsonld"],
    "extractionWarnings": []
  }
}
```

The API rejects malformed payloads and bodies above the configured request-size guard.

The response is always a `ComparisonResult`; external provider failures are represented in per-provider status rather than surfacing as a total request failure where possible.

## 6. Product matching policy

Matching is deterministic and confidence-bearing.

Order of trust:

1. exact compatible GTIN/EAN/UPC
2. exact brand + MPN
3. model/brand/spec composite matching
4. normalized-title fuzzy evidence

Current decision bands:

- `auto_match >= 0.90`
- `review >= 0.70 && < 0.90`
- `reject < 0.70`

Hard contradictions override fuzzy similarity. Current hard checks include:

- condition mismatch
- brand conflict
- conflicting GTIN/EAN/UPC
- conflicting MPN
- conflicting structured storage capacity
- conflicting structured RAM
- conflicting structured screen size
- conflicting structured pack count
- conflicting explicit edition
- conflicting explicit model qualifier
- conflicting explicit bundle/standalone state
- conservative Digital-vs-Disc and Body-Only-vs-Kit title signals
- conservative same-family model qualifier / numeric-generation conflicts

Structured RAM/storage/screen fields now feed the composite scorer as well as hard mismatch checks. The labelled calibration corpus verifies that a rich same-product match can clear `0.90`, while an under-specified otherwise-identical match remains at the `0.70` review boundary.

Provider status preserves up to 10 review candidates with confidence, method and reason. See [MATCHER_CALIBRATION.md](MATCHER_CALIBRATION.md).

## 7. Price semantics

Primary value:

```text
landed_price = item_price + mandatory_shipping
```

Rules:

- MVP compares EUR only
- unknown shipping is not silently treated as zero
- incomplete landed prices remain visible as incomplete
- the best market offer must have a complete landed price
- coupons, financing, memberships and trade-ins are excluded until explicitly modelled

## 8. Provider interface

All providers implement:

```ts
interface PriceProvider {
  readonly id: PriceProviderId;
  search(input: {
    listing: EcommerceListing;
    signal?: AbortSignal;
  }): Promise<ProviderCandidate[]>;
}
```

The orchestrator is responsible for:

- per-provider timeout
- failure isolation
- candidate -> match-policy evaluation
- accepted offer normalization
- provider status reporting

Production adapters must additionally define:

- credentials/configuration source
- timeout/retry policy
- cache policy and permitted freshness
- attribution/deep-link rules
- contract fixtures
- disable/fallback behavior

## 9. Dev fixture provider

The fixture provider exists only to validate the complete local pipeline before external provider access is approved.

Enable it with:

```bash
PRICE_LENS_FIXTURE_PROVIDER=1 npm run start -w @price-lens/api
```

Properties:

- provider id is explicitly `fixture`
- merchant is explicitly `PriceLens Fixture Shop`
- URL uses `example.invalid`
- identity and condition mirror the source listing
- no external request is performed
- default fixture price is a deterministic discount from the eBay item price
- it is disabled unless the environment flag equals `1`

No UI or log should represent fixture data as Idealo, Geizhals or Amazon data.

## 10. Provider-access decisions

Production preference:

- eBay enrichment: official Browse API
- Idealo: iPN / approved publisher API access
- Geizhals: Publisher Programme / agreed machine-readable access
- Amazon Germany: Associates + Creators API

See [PROVIDER_ACCESS.md](PROVIDER_ACCESS.md) for the verified access gate and [PROVIDER_ONBOARDING.md](PROVIDER_ONBOARDING.md) for the exact account/application steps.

Scrapers may be used only as replaceable research spikes unless terms and operational constraints are explicitly resolved.

## 11. Cache design

Authentication-token caches exist for eBay and Amazon with expiry safety windows.
In-flight duplicate product lookups are coalesced.

**Product/price response caching is disabled between sequential requests by default.**
The default provider product-data TTL is `0 ms` until the live, approved provider
account rules establish the permitted freshness and retention behavior.

Explicit configuration:

```text
EBAY_BROWSE_CACHE_TTL_MS=0
AMAZON_CREATORS_CACHE_TTL_MS=0
```

A positive TTL may be enabled only after the applicable provider policy is validated.
The configuration rejects negative, fractional or unsafe integer TTL values.

Future persistent/shared cache key priority:

```text
GTIN
-> brand + MPN
-> brand + model + hard variant
-> normalized title fingerprint
```

Required behavior:

- provider-specific TTL derived from approved rules, never a generic guessed TTL
- shorter negative-result TTL only where the provider rules permit it
- request coalescing for concurrent identical lookups
- cache key must include any identity field that changes product variant semantics
- cache storage remains server-side
- stale entries are removed rather than reused

## 12. Security and privacy

Required:

- no provider secret in extension bundle
- HTTPS for non-local API traffic
- strict request validation
- outbound provider allowlist
- provider timeouts
- no arbitrary URL fetch endpoint
- no browser cookies forwarded to providers
- no eBay account identifier collection
- telemetry disabled by default unless later introduced as explicit opt-in

## 13. Observability

Planned per-comparison fields:

- request id
- extraction version
- lookup fingerprint
- provider latency
- cache hit/miss
- candidate count
- match decision/reason/confidence
- warning set

Never log secrets, auth headers or browser cookies.

## 14. Test pyramid

### Unit

- money/landed-price math
- identifier normalization
- hard mismatch policy
- provider timeout/error isolation
- fixture provider behavior

### DOM fixtures

- labelled synthetic regression corpus (currently 9 fixtures / 77 scalar labels)
- representative anonymized eBay.de item layouts
- structured-data presence/absence
- shipping variants
- condition variants
- identity fields
- dynamic page transitions

### Contract fixtures

For each real provider:

- search response -> `ProviderCandidate`
- missing/invalid fields
- rate-limit/error response
- partial shipping
- no-match behavior

Live provider tests are opt-in only.

## 15. CI gate

Every implementation checkpoint must pass:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Current GitHub Actions performs typecheck, tests and build. Provider live traffic is not required for normal CI.

## 16. Near-term implementation sequence

1. Capture and independently review representative real eBay.de layout fixtures; publish observed per-field metrics.
2. Live-validate the implemented eBay Browse enrichment with Sandbox credentials and complete Production approval.
3. Submit/complete Idealo iPN, Geizhals Publisher and Amazon Associates/Creators onboarding.
4. Live-validate Amazon Creators responses and program rules; Amazon remains excluded from best landed price while mandatory shipping is unknown.
5. Implement Idealo/Geizhals only against the publisher contracts they provide.
6. Keep product-data cache TTL at zero until live provider constraints are known; in-flight coalescing and privacy-minimized observability are already implemented.
7. Expand to eBay search-result cards only after the single-item evidence gates pass.

## 17. Definition of the first real MVP

The first real-provider MVP is complete when:

- eBay.de listing extraction is measured against a labelled fixture corpus
- the extension survives dynamic page transitions
- API boundary and validation remain stable
- matcher has zero known hard-mismatch auto-matches in the labelled gate set
- at least one provider uses an explicitly permitted access path
- price + mandatory shipping semantics are correct
- provider credentials remain server-side
- provider failures degrade to partial/unavailable UI
- CI is green
- documentation/status reflect the exact delivered checkpoint
