# Matcher Calibration

Updated: **2026-10-02**

Status: **Phase 2 labelled gate passed**

PriceLens uses a two-threshold fuzzy policy:

- automatic match: `confidence >= 0.90`
- review: `0.70 <= confidence < 0.90`
- reject below review threshold or on a hard contradiction

Exact compatible GTIN/EAN/UPC and brand+MPN paths remain deterministic strong signals.

## Why the calibration changed

Before the Phase 2 calibration work, structured storage/RAM/screen values extracted
from eBay were used for hard mismatch checks but were not passed to the vendored
`product-matcher` composite scorer. Consequently, an otherwise identical product
without an exact ID could remain around the review boundary.

The core now maps structured:

- RAM
- storage
- screen size

into the product-matcher spec input. A richly structured same-product candidate can
therefore clear the 0.90 automatic threshold, while an under-specified otherwise
identical candidate remains in review.

## Hard contradictions

Automatic matching is blocked before fuzzy scoring by known contradictions including:

- condition
- brand
- GTIN/EAN/UPC
- MPN
- storage
- RAM
- screen size
- pack count
- explicit edition
- explicit model qualifier
- explicit bundle/standalone state
- clear Digital Edition vs Disc Edition title signals
- clear Body Only / standalone vs Bundle / Kit title signals
- known model qualifiers such as Pro / Max / Plus / Ultra / Mini / Air / Slim
  when the underlying model base is otherwise the same
- conflicting trailing numeric model generation within the same model family

Rules are intentionally conservative. PriceLens prefers a review/no-match to
inventing variant equivalence.

## Labelled calibration corpus

`packages/core/test/matcher-calibration.test.ts` currently contains labelled
automatic/review/reject cases for:

- rich structured same product
- exact GTIN
- exact brand + MPN
- under-specified same product
- condition mismatch
- storage mismatch
- edition mismatch
- bundle mismatch
- model-qualifier mismatch
- model-generation mismatch
- unrelated product from the same brand

The gate asserts:

- policy thresholds remain exactly 0.90 / 0.70
- zero known false automatic matches
- every labelled case receives its expected decision

## Review diagnostics

Provider orchestration preserves up to 10 review candidates per provider, including:

- provider product id
- product title
- confidence
- match method
- reason

This makes threshold tuning observable without allowing review candidates into the
automatic offer set.

## Change policy

Do not lower the automatic threshold merely to increase coverage.

Any future threshold or scoring-weight change must first add representative positive
and negative cases to the calibration corpus and demonstrate that known hard variants
cannot auto-match.
