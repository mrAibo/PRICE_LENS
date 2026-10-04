# eBay Extraction Evidence

Status: **synthetic regression corpus + growing independently reviewed observed-layout corpus**

Updated: **2026-10-04**

This document records measurable evidence for the eBay.de extractor. It deliberately distinguishes regression-fixture accuracy from real-world production accuracy.

## Current corpus

Location:

- `apps/extension/test/fixtures/ebay-corpus.ts`
- enforced by `apps/extension/test/fixture-corpus.test.ts`
- failure-mode contract enforced by `apps/extension/test/extraction-failure-modes.test.ts`
- documented in `docs/EBAY_EXTRACTION_FAILURE_MODES.md`

Current gate:

- synthetic regression: **9 fixtures / 77 labelled scalar field checks**
- observed reviewed: **3 real eBay.de fixtures / 54 labelled scalar field checks**
- observed classes: used + paid domestic shipping; refurbished + free domestic shipping; selected multi-variant phone with explicit 128 GB storage
- CI rejects any mismatch
- CI also rejects accidental synthetic corpus shrinkage below 9 fixtures / 70 labelled fields

Current fixture classes:

| Fixture | Main evidence |
| --- | --- |
| JSON-LD new product | product identity, EUR price, Germany-specific shipping |
| German DOM + variants | brand/model/MPN/EAN, free shipping, storage/RAM/screen/pack |
| content-attribute price | fallback price with intentionally incomplete identity |
| multi-offer variant | ambiguous JSON-LD falls back to current DOM variant |
| ambiguous price | unsafe multi-offer price without current DOM is unsupported |
| used + paid shipping | German used condition and mandatory shipping |
| open box | German open-box condition mapping |
| refurbished | German refurbished condition mapping |
| ambiguous storage | multi-value storage is not guessed |

## Current measured result

A green CI run means **100% of the labelled checks in the synthetic regression corpus passed**.

The independently reviewed observed corpus currently reports **54/54 labelled fields passing across 3 real layouts**. These captures exposed and permanently fixed three real gaps: `https://schema.org/UsedCondition` normalization, HTML character references inside live JSON-LD titles, and selected SKU storage values that were previously missed when only the generic item-specific/title state was available.

That number is a regression metric only. It must **not** be described as 100% eBay extraction accuracy.

The corpus is intentionally synthetic/controlled so that:

- parsing semantics are deterministic
- sensitive/user-specific HTML is not committed
- edge cases can be reproduced forever
- correctness fixes get permanent regression coverage

## Phase 1 evidence still required

Before Phase 1 can be called complete, add representative fixture classes derived from observed eBay.de layouts, with sensitive/user-specific data removed or replaced.

Target evidence should include at minimum:

- standard Buy It Now product
- variant listing with selected option
- listing with shipping included/free
- listing with paid domestic shipping
- listing where shipping is unknown until destination selection
- used listing
- refurbished/open-box listing
- item specifics rendered in alternate markup
- JSON-LD absent or incomplete
- multiple JSON-LD blocks / graph form
- seller title noise
- weak/no identifier listing
- category-specific variant fields
- unsupported price ranges / auction-like price semantics where applicable

For each fixture, label the expected normalized fields rather than merely asserting that extraction returns a value.

## Accuracy reporting

The future report should publish per-field metrics, not only a single aggregate number:

| Field family | Metric |
| --- | --- |
| item id | exact accuracy |
| title | normalized exact accuracy |
| item price | exact amount/currency accuracy |
| mandatory shipping | exact / unknown classification accuracy |
| condition | class accuracy |
| brand/model | exact normalized accuracy |
| GTIN/EAN/UPC/MPN | precision first, then coverage |
| structured variant | precision first, then coverage |
| supported/unsupported | classification accuracy |

For identifiers and variants, **precision is more important than coverage**. Missing a field is preferable to inventing one.

## Safety rules represented in the corpus

1. Conflicting multi-offer JSON-LD values are not resolved by picking the first offer.
2. Ambiguous numeric variant values are not guessed.
3. Unknown shipping is not silently converted to zero.
4. Condition is part of comparison identity.
5. Explicit structured variant conflicts can later reject a provider candidate before fuzzy matching.

## Next gate

Issue #10 remains open until:

1. representative layout fixtures are added,
2. field-level metrics are generated from the labelled corpus,
3. known unsupported layouts produce an explicit user-visible unsupported state,
4. selector/structured-data failure modes remain covered by the executable contract.

The synthetic corpus is the foundation for that gate, not the final evidence.


## Capturing observed real-layout fixtures

The repository now contains a review-gated capture tool. Save a real public eBay.de
item page as HTML in the browser, then run:

```bash
npm run capture:ebay -- \
  --html /path/to/saved-page.html \
  --url "https://www.ebay.de/itm/REAL_ITEM_ID" \
  --id "observed-phone-buy-it-now" \
  --layout-class "buy-it-now"
```

The generated JSON goes to `apps/extension/test/fixtures/observed/` by default.

The capture deliberately does **not** persist the original URL. It stores a SHA-256
digest for provenance/deduplication, uses a synthetic item id in the fixture, and
keeps only extractor-relevant JSON-LD, price, condition and whitelisted item-specific
markup. Seller/account areas are excluded by construction.

Every captured fixture starts as `reviewed: false`. The generated `expected`
object is only a draft produced by the current extractor. A person must independently
compare it with the live page or a screenshot, correct any wrong expected values, and
only then set `reviewed: true`.

This review gate is critical: otherwise the extractor would be grading its own output.

## Minimum observed corpus to close Issue #10

The first independently reviewed real-layout batch should contain at least these
classes before the issue is closed:

| Suggested fixture id | Required live layout evidence |
| --- | --- |
| `observed-bin-free-shipping` | Buy It Now, free domestic shipping |
| `observed-bin-paid-shipping` | Buy It Now, explicit paid DE shipping |
| `observed-shipping-unknown` | shipping unresolved until destination/selection |
| `observed-selected-variant` | multi-variant listing with one visibly selected option |
| `observed-used` | used condition |
| `observed-refurbished-or-open-box` | refurbished or opened-box condition |
| `observed-jsonld-incomplete` | incomplete/absent structured data with safe DOM fallback |
| `observed-weak-identity` | no trustworthy GTIN/MPN and no identity invention |

Add category-specific variant examples (phone/laptop/console/camera or equivalent)
when available. Every observed fixture must be generated from a saved live public
eBay.de item page, independently checked against the saved page/screenshot, and only
then changed to `reviewed:true`.

A zero-size `observed-reviewed` corpus is an explicit blocked state, not a passing
metric.

## Per-field metrics command

Run:

```bash
npm run evidence:ebay
```

The command reports exact labelled accuracy separately for:

- supported / unsupported classification
- listing identity fields
- price
- mandatory shipping / unknown shipping
- condition
- strong identity fields
- structured variant fields

It prints two independent corpora:

1. `synthetic-regression` — deterministic regression protection;
2. `observed-reviewed` — only independently reviewed fixtures derived from real
   eBay.de pages.

An unreviewed observed fixture is intentionally excluded from real-layout metrics.

At this checkpoint the infrastructure for real-layout measurement is complete and
three reviewed observed fixtures are committed. Their 54/54 result is evidence for
those specific layouts only, not a general real-world accuracy claim. Shipping-unknown,
incomplete/absent JSON-LD fallback, weak-identity and broader category layouts still
need observed evidence before Issue #10 can close.

## Search-result layout evidence

Phase 7 search-card extraction has a separate observed-layout evidence path because
search pages expose a different, smaller field set than item pages.

Capture a saved real public eBay.de search page with:

```bash
npm run capture:ebay-search -- \
  --html /path/to/saved-search-page.html \
  --url "https://www.ebay.de/sch/i.html?_nkw=headphones" \
  --id "observed-search-headphones" \
  --layout-class "desktop-list"
```

The generated fixture is written under
`apps/extension/test/fixtures/observed-search/` and starts with
`reviewed:false`.

The capture keeps only PriceLens-relevant card fields, replaces real item ids/URLs with
deterministic synthetic ids, excludes seller/account/image/tracking markup, and retains
only a SHA-256 digest of the original search URL.

A fixture counts as evidence only after independent verification against the saved live
page or screenshots and an explicit `reviewed:true`.

Run the observed search-layout evidence report with:

```bash
npm run evidence:ebay-search
```

Metrics are reported separately for supportability, listing identity, price, shipping
and condition. An empty reviewed corpus reports zero labelled fields and does not imply
that the live-layout gate has passed.
