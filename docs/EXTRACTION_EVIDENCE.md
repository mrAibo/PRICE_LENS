# eBay Extraction Evidence

Status: **initial synthetic regression corpus**

Updated: **2026-10-02**

This document records measurable evidence for the eBay.de extractor. It deliberately distinguishes regression-fixture accuracy from real-world production accuracy.

## Current corpus

Location:

- `apps/extension/test/fixtures/ebay-corpus.ts`
- enforced by `apps/extension/test/fixture-corpus.test.ts`

Current gate:

- **9 labelled fixtures**
- **77 labelled scalar field checks**
- CI rejects any mismatch
- CI also rejects accidental corpus shrinkage below 9 fixtures / 70 labelled fields

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

A green CI run means **100% of the labelled checks in this synthetic corpus passed**.

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
4. selector/structured-data failure modes are documented.

The synthetic corpus is the foundation for that gate, not the final evidence.
