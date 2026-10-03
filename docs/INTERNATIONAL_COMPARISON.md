# International Comparison

Status: **Phase 3C implementation in progress / live provider validation pending**

Updated: **2026-10-04**

## Product rule

PriceLens international comparison is **explicitly user-triggered**.

Opening or scrolling an eBay page may perform safe local extraction after consent, but
must not fan out provider requests. The eBay EU marketplace search begins only after the
user presses **Compare with PriceLens**.

## Initial eBay EU market set

The current implementation supports the bounded configurable set:

```text
EBAY_DE
EBAY_PL
EBAY_AT
EBAY_FR
EBAY_IT
EBAY_ES
EBAY_NL
EBAY_BE
```

The default buyer delivery country is Germany:

```text
EBAY_DELIVERY_COUNTRY=DE
```

This is an operator-side Phase 3C default, not an IP inference. A later slice will add
an explicit user-controlled delivery country/postal-code preference.

## Search behavior

Each requested report:

1. derives the strongest safe GTIN/EAN/UPC already available;
2. searches the configured eBay marketplaces with bounded concurrency;
3. requests fixed-price listings deliverable to the configured buyer country;
4. passes buyer country as eBay contextual location;
5. validates that returned item URLs belong to the marketplace that was queried;
6. excludes the current listing;
7. rejects auctions defensively;
8. normalizes condition, price, shipping, seller and marketplace metadata;
9. deduplicates the same eBay item returned through multiple marketplaces;
10. passes every candidate through the normal PriceLens product matcher.

A failure in one marketplace does not discard successful results from another
marketplace. If every configured marketplace fails, the eBay marketplace provider
fails normally and remains isolated from other PriceLens providers.

## Fan-out protection

Marketplace requests inside one report are bounded independently:

```text
EBAY_MARKETPLACE_SEARCH_CONCURRENCY=3
```

This is in addition to the existing API comparison concurrency limit and per-provider
orchestration limit.

The multi-market search therefore does not convert page scrolling into provider traffic,
and one explicit report cannot open an unbounded number of concurrent eBay requests.

## Shipping semantics

PriceLens asks eBay only for listings eligible for the configured delivery country and
passes contextual buyer country information.

Shipping is still conservative:

- a returned shipping amount is included only when its currency matches the item price;
- missing shipping remains unknown;
- unknown shipping never becomes zero;
- only complete landed prices may participate in savings ranking.

The later user-destination slice should add an optional postal code because calculated
shipping can depend on postcode.

## Currency safety

International offers preserve their original currency.

Example:

```text
eBay Germany   309 EUR + 0 EUR shipping
eBay Poland    1199 PLN + 45 PLN shipping
```

Until an explicit FX source/rate/timestamp model exists, PriceLens must **not** compare
the numbers 309 and 1244 directly.

Current behavior:

- same-currency complete offers can participate in headline/compact ranking;
- other-currency offers remain available in the full report;
- cross-currency savings are not calculated;
- original marketplace and currency metadata are preserved for the future FX layer.

## URL trust boundary

The current allowlist maps marketplace IDs to eBay-owned domains:

```text
EBAY_DE -> ebay.de
EBAY_PL -> ebay.pl
EBAY_AT -> ebay.at
EBAY_FR -> ebay.fr
EBAY_IT -> ebay.it
EBAY_ES -> ebay.es
EBAY_NL -> ebay.nl
EBAY_BE -> ebay.be
```

HTTPS is required and subdomains are allowed. A result returned under the wrong
marketplace hostname is discarded.

## Still required

- real Sandbox/Production response validation;
- representative DE/PL/AT/FR/IT/ES/NL/BE fixtures;
- explicit user destination country and postal code;
- FX provider/rate provenance/timestamp;
- EUR-normalized comparison while retaining original prices;
- EU versus non-EU tax/import-cost model;
- Amazon multi-market support with marketplace-specific approved Partner Tags;
- provider quota/latency measurements under real traffic;
- eBay Production/Growth Check confirmation for the final presentation.
