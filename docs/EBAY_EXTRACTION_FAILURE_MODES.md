# eBay Extraction Failure-Mode Contract

Status: **implemented regression contract**

Updated: **2026-10-02**

This document defines how the eBay.de page extractor must behave when structured data
or DOM selectors are incomplete, malformed, contradictory or absent.

The governing rule is:

> Prefer an explicit unsupported/unknown result over inventing a title, price,
> shipping amount, identifier or product variant.

The executable regression contract is:

- `apps/extension/test/extraction-failure-modes.test.ts`
- the labelled corpus in `apps/extension/test/fixtures/ebay-corpus.ts`
- lifecycle unsupported-state tests in `apps/extension/test/lifecycle.test.ts`

## Extraction precedence

### Item id

Accepted sources, in order of semantics rather than DOM layout:

1. `/itm/<numeric-id>`
2. `/itm/<slug>/<numeric-id>`
3. numeric `item` query parameter

If no 9–15 digit item id can be established, the page is not treated as a supported
single-item listing.

### Title

The extractor tries:

1. Product JSON-LD `name`
2. OpenGraph `og:title`
3. known eBay item-title selectors
4. generic `h1`

If every title source is missing, extraction returns unsupported.

### Price

The extractor tries:

1. unambiguous Product/Offer JSON-LD price
2. semantic/content price attributes
3. current rendered primary-price DOM selectors

A price is usable only when amount and currency can be determined safely.

If multiple structured offers contain different prices, structured price is rejected.
The currently rendered DOM price may still recover the selected variant. If no safe
current price exists, extraction returns unsupported.

DOM price ranges such as `EUR 99,90 bis EUR 129,90` are not reduced to the first
number.

### Shipping

Shipping is optional evidence. Unknown shipping does **not** make the listing itself
unsupported.

Rules:

- a Germany-specific structured rate is preferred;
- destination-agnostic structured shipping is accepted only when unambiguous;
- multiple conflicting structured rates remain unknown;
- DOM shipping rows are used as fallback;
- explicit free-shipping text becomes zero only when currency context is known;
- unknown/ambiguous shipping remains `undefined`, never silently zero.

The core subsequently marks the eBay landed price incomplete when shipping is unknown.

### Condition

Condition uses structured data first and DOM text second.

Recognized classes:

- new
- used
- refurbished
- open_box

Unrecognized or absent condition becomes `unknown`; it is not guessed.

### Strong identifiers

GTIN/EAN/UPC must normalize to an accepted trade-identifier length.
Placeholder values such as `N/A` or `Nicht zutreffend` are not identities.

When no GTIN/EAN/UPC/MPN survives validation, the listing remains supported but carries
the warning:

`No strong product identifier was found on the page.`

### Structured variants

Storage, RAM, screen size and pack count are extracted only from explicitly labelled
item specifics.

A value with multiple incompatible candidates, for example `256 GB / 512 GB`, is
left unknown rather than guessed.

## JSON-LD failure behavior

Malformed JSON-LD is ignored locally. It must not abort page extraction.

The extractor may continue with:

- another JSON-LD script,
- JSON-LD records inside `@graph`,
- semantic/meta attributes,
- current DOM selectors.

A valid Product nested inside an `@graph` is supported.

## Multi-offer / selected-variant safety

For multiple JSON-LD offers:

- price is accepted only when all usable structured prices are equal;
- offer condition is accepted only when unambiguous;
- structured shipping is not selected from a multi-offer set;
- current DOM state is preferred for the selected variant when structured offers
  conflict.

This prevents the first JSON-LD offer from being mistaken for the user's selected
variant.

## Unsupported state

A single-item URL becomes an explicit unsupported PriceLens state when a safe normalized
listing cannot be built, including:

- missing/invalid item id;
- no usable title;
- no unambiguous/current price.

For an eBay item URL whose page is still loading or ambiguous, the lifecycle displays
the PriceLens Unsupported card and sends **no comparison API request**.

If later DOM mutations make the listing safely extractable, the lifecycle automatically
replaces the unsupported state with the normal comparison path.

## Safe partial states

The following do not by themselves make the listing unsupported:

- unknown shipping;
- unknown condition;
- missing strong identifier;
- missing optional image;
- missing optional variant fields.

These states are represented explicitly and are handled conservatively downstream.

## Regression mapping

| Failure class | Required result |
| --- | --- |
| malformed JSON-LD + valid DOM | ignore malformed block; use DOM |
| Product inside `@graph` | extract structured Product |
| no item id | unsupported |
| no title | unsupported |
| no safe price | unsupported |
| conflicting multi-offer price + current DOM price | use current DOM |
| conflicting multi-offer price + no current price | unsupported |
| conflicting shipping rates | supported, shipping unknown |
| invalid identifier placeholders/length | omit identifier + warning |
| ambiguous variant-specific value | omit variant field |
| late-loading page becomes valid | unsupported -> normal comparison |

## What remains for Phase 1

This contract closes the **internal behavior/documentation** part of the extractor gate.

Phase 1 still requires external evidence from independently reviewed, sanitized fixtures
derived from representative real eBay.de layouts. Those fixtures must populate
`apps/extension/test/fixtures/observed/` and be measured with
`npm run evidence:ebay`.

Until reviewed observed fixtures exist, synthetic regression success must not be
reported as real-world extraction accuracy.
