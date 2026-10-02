# PriceLens — Preliminary Technical Design

Status: **active preliminary design / implementation**

Date: 2026-10-02

Implementation-level decisions, configuration and delivery gates are tracked in [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md). Current progress and remaining work are tracked in [STATUS.md](STATUS.md).

## 1. Product goal

When a user opens an eBay listing, PriceLens should answer:

1. What exact product is this?
2. What is the effective eBay price?
3. What do trustworthy external sources currently charge for the same variant and condition?
4. How certain are we that the compared products are identical?
5. What is the absolute and percentage difference?

The MVP targets **eBay.de item pages** and new retail products. Used/refurbished listings are extracted and labelled, but must not be compared against new-product offers as if they were equivalent.

## 2. Design principles

- Correctness before coverage.
- Exact identifiers before fuzzy text.
- Confidence is data, not decoration.
- Browser extension contains no provider secrets.
- Provider-specific code sits behind a stable interface.
- Official/publisher APIs are preferred over scraping.
- A provider failure must not break the eBay page.
- The system must be testable without live provider traffic.
- Price comparison uses landed price when mandatory shipping is available.
- DOM parsing must have structured-data-first fallbacks and be isolated from UI code.

## 3. High-level architecture

```text
eBay item page
     |
     v
Browser extension (MV3)
  - listing extractor
  - identity preview
  - comparison UI
  - no provider secrets
     |
     v
PriceLens API
  - validation
  - cache
  - orchestration
     |
     +----------------------+
     |                      |
     v                      v
Product matcher          Providers
  exact identifiers        - Idealo
  model / variant           - Geizhals
  normalized title          - Amazon
  weighted confidence       - future providers
     |                      |
     +-----------+----------+
                 |
                 v
          Comparison result
                 |
                 v
          Extension widget
```

## 4. Repository layout

```text
apps/
  extension/        eBay browser extension
  api/              HTTP comparison API
packages/
  contracts/        shared request/response/domain types
  core/             normalization, landed-price math, matching orchestration
docs/
  ARCHITECTURE.md
  ROADMAP.md
  OPEN_SOURCE_REUSE.md
```

Provider adapters will be introduced under `packages/providers-*` only after their access strategy is proven.

## 5. Domain model

### Source listing

A normalized eBay listing contains:

- item id
- canonical URL
- title
- item price and currency
- mandatory shipping when known
- condition
- brand
- model
- MPN
- GTIN/EAN/UPC when present
- image URL
- extraction evidence

### Market offer

A provider result contains:

- provider
- provider product id
- product title
- merchant
- item price
- mandatory shipping when known
- landed price
- URL
- condition
- identifiers/specification hints
- match confidence
- match reason
- retrieval timestamp

### Comparison result

The API returns:

- normalized listing
- candidate offers that passed the acceptance threshold
- rejected/review candidates separately when useful
- best comparable market price
- eBay landed price
- absolute delta
- percentage delta
- per-provider status
- warnings

## 6. Product matching

Matching is staged. A lower stage must not override a contradictory stronger signal.

Recommended order:

1. Exact GTIN/EAN/UPC
2. Exact MPN + compatible brand
3. Exact full model + compatible brand
4. Model/base model + hard variant constraints
5. Normalized title/spec fuzzy score
6. Manual/review bucket below automatic threshold

Initial matching engine: `product-matcher` (MIT), consumed as a dependency rather than copied.

Initial decision bands:

- `auto_match`: confidence >= 0.90
- `review`: 0.70–0.899
- `reject`: < 0.70

These are bootstrap thresholds and must be calibrated against a labelled eBay/provider fixture set before production use.

### Hard mismatch rules

A candidate is rejected or downgraded when known attributes conflict, especially:

- storage capacity
- RAM
- screen size/model suffix
- console edition
- network variant
- pack count
- condition
- manufacturer part number
- materially different bundle/accessories

## 7. Price semantics

Primary comparison value:

```text
landed_price = item_price + mandatory_shipping
```

Rules:

- compare only the same currency in MVP (EUR)
- do not silently treat unknown shipping as zero
- preserve raw item and shipping amounts
- clearly mark incomplete landed prices
- coupons, memberships, trade-ins and financing are excluded from MVP unless explicitly normalized

## 8. Extension design

Manifest V3.

Initial permissions should stay minimal:

- content script on `https://www.ebay.de/*`
- storage only if user preferences are introduced

The extension extracts eBay data using this priority:

1. JSON-LD / structured product data
2. stable semantic/meta fields
3. narrowly scoped DOM selectors
4. URL parsing for the item id

A DOM selector change can then break one adapter test rather than the whole extension.

The UI is injected into a dedicated Shadow DOM root to avoid CSS collisions.

## 9. API boundary

Initial endpoints:

```text
GET  /health
POST /v1/compare
```

Example request:

```json
{
  "listing": {
    "source": "ebay",
    "itemId": "123456789012",
    "url": "https://www.ebay.de/itm/123456789012",
    "title": "Example product",
    "price": { "amount": 199.99, "currency": "EUR" },
    "condition": "new",
    "identity": {
      "brand": "Example",
      "model": "Model X",
      "gtin": "1234567890123"
    }
  }
}
```

The bootstrap API returns a valid empty comparison while providers are unconfigured. Provider integration will not change the extension contract.

## 10. Provider strategy

### eBay

Use eBay Browse API for enrichment/search when API access is configured. The Browse API supports keyword and GTIN search. The extension still extracts page-visible data so basic operation does not depend on an eBay API round-trip.

### Idealo

Preferred production path: publisher/iPN API access if PriceLens qualifies. Idealo's normal merchant PWS API is for merchant offer submission, not a general consumer comparison API.

A scraper may be used only as a local technical spike and only after terms/access constraints are reviewed. It must never become an implicit permanent dependency.

### Geizhals

Preferred production path: Geizhals Publisher Programme / agreed data access.

A browser-backed scraper is a research fallback only. Cloudflare behavior makes it operationally expensive and brittle, and no anti-bot bypass strategy belongs in the core product architecture.

### Amazon

Preferred production path: Amazon **Creators API**, the current supported successor to Product Advertising API 5.0. PriceLens must use the Amazon Associates/Creators onboarding path for the German marketplace and keep credentials server-side. PA-API 5.0 must not be used for new implementation work.

## 11. Cache

Comparison traffic is highly cacheable by product identity.

Initial cache key priority:

```text
GTIN -> brand+MPN -> brand+model+variant -> normalized-title hash
```

Bootstrap TTL: 10–30 minutes for provider search results. Exact TTL becomes provider-specific.

Negative results should also be cached briefly to prevent repeated expensive lookups.

## 12. Security and privacy

- no API secret in extension bundles
- HTTPS only outside local development
- validate extension payloads server-side
- strict outbound provider allowlist
- request timeout and size limits
- no arbitrary URL fetch endpoint
- no collection of eBay account identifiers
- no purchase automation
- telemetry opt-in if introduced later

## 13. Observability

Each comparison should be traceable with:

- request id
- extraction version
- provider latency/status
- cache hit/miss
- candidate count
- accepted match reason/confidence
- final warnings

Never log provider secrets or full browser cookies.

## 14. Testing strategy

Three layers:

1. Pure unit tests — price math, normalization, identifiers, match decisions.
2. DOM fixture tests — saved/synthetic eBay page fragments for extraction.
3. Contract tests — provider adapters map external responses into the stable MarketOffer model.

Live provider tests must be opt-in and must not run on every CI build.

## 15. MVP acceptance criteria

The first user-testable MVP is complete when:

- unpacked extension loads on Chrome-compatible browsers
- an eBay.de item page is recognized
- item id/title/price/condition are extracted without throwing
- the PriceLens widget renders without modifying eBay's own controls
- extension can request `/v1/compare`
- API validates the request and returns a contract-compliant response
- at least one provider can return a real or approved fixture-backed market offer
- matching confidence and reason are visible
- shipping is included where known
- no provider credentials are exposed in extension output
- CI runs typecheck, unit tests and builds
