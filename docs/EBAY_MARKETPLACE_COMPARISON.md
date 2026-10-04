# eBay Same-Product Marketplace Comparison

Status: **initial implementation complete / live Browse validation pending**

Checked against current eBay Browse API documentation on **2026-10-04**.

## Goal

When a user views an eBay.de item, PriceLens can search eBay for other fixed-price
listings of the same product and present them separately from external market
providers.

The feature is designed to answer two different questions without mixing them:

1. Is the current eBay listing expensive compared with other sellers offering the
   same product in the **same condition**?
2. Are there cheaper **open-box, refurbished or used** versions of the same product?

A used/refurbished offer must never silently become the headline comparison price for
a new item.

## Initial implementation

The first safe vertical slice uses the existing eBay Browse credentials and runs only
when:

```text
EBAY_BROWSE_ENABLED=1
EBAY_MARKETPLACE_COMPARISON_ENABLED=1
```

Search behavior:

- uses Browse `GET /buy/browse/v1/item_summary/search`;
- searches by the strongest normalized GTIN/EAN/UPC available after page extraction
  and optional eBay Browse enrichment;
- if no GTIN/EAN/UPC exists, may search by a trustworthy eBay catalog product ID
  (ePID);
- optional Catalog fallback can resolve Brand+MPN to ePID only when exactly one
  catalog product matches the normalized Brand+MPN pair; ambiguous catalog results
  are rejected;
- optional Brand+Model fallback can query Catalog only when stronger identifiers and
  structured variants are absent, then requires exact Brand + explicit Model detail
  verification through `getProduct` and a unique verified ePID;
- requests up to 25 results;
- requests `buyingOptions:{FIXED_PRICE}`;
- locally rejects non-fixed-price results if eBay returns them anyway;
- removes the listing currently being viewed, including variation REST IDs that share
  the same legacy listing ID;
- refuses broad title-only search when no strong trade identifier exists;
- never assumes missing shipping means zero.

The discovery rule remains intentionally conservative. Exact GTIN/EAN/UPC and exact
ePID are strong discovery identifiers. Brand+MPN is accepted only through the optional
eBay Catalog API path when it resolves to one unique exact catalog product; a raw
Brand+MPN keyword result is never auto-accepted. Brand+Model now has a separate
feature-gated path, but Catalog query results are discovery-only: bounded `getProduct`
details must prove exact Brand + explicit Model and uniqueness before an ePID can be
used. Title-only verification is explicitly rejected.

## Matching policy

The provider ID is:

```text
ebay_market
```

Each returned candidate still passes through the PriceLens matcher.

For this provider only, product matching may cross condition boundaries. Product
identity contradictions and variant mismatches remain hard rejects.

The actual candidate condition is preserved as one of:

- `new`
- `open_box`
- `refurbished`
- `used`
- `unknown`

Global `bestOffer` selection does **not** allow a cross-condition eBay-market offer
to replace the current listing's condition. For example, a €200 used offer cannot
become the best comparison price for a €350 new listing.

## UI

The extension renders a separate **Same product on eBay** block.

For each available condition group it shows:

- number of accepted matched listings in the returned sample;
- cheapest complete landed price;
- landed-price range and median when multiple complete prices are present;
- seller username where available;
- seller positive-feedback percentage and feedback score where available;
- business/private seller account type where eBay exposes it;
- the estimated delivery window and shipping carrier/service associated with the
  selected lowest-cost shipping option when available;
- a direct link to the cheapest accepted listing.

Shipping-unknown offers remain visible but are labelled as incomplete and are not
treated as complete landed prices.

## Seller quality

PriceLens surfaces objective eBay seller/delivery fields only. It does not create an
opaque seller score.

The current search-level context includes feedback percentage/count, business/private
seller account type, and estimated delivery window when present in the Browse response.
The delivery window is kept with the same shipping option selected for landed-price
calculation, so a faster paid method is not accidentally shown beside a cheaper/free
shipping price.

Return-policy terms use an optional post-match detail-enrichment step because the full
Browse item resource provides richer item details than search summaries.

The detail path is deliberately after PriceLens matching:

1. marketplace search returns candidate summaries;
2. PriceLens hard guards and matcher reject wrong products/variants;
3. only auto-matched candidates are eligible for detail enrichment;
4. at most `EBAY_MARKETPLACE_DETAIL_LIMIT` candidates are enriched;
5. detail requests use `EBAY_MARKETPLACE_DETAIL_CONCURRENCY`;
6. identical item + marketplace + destination detail lookups are single-flighted;
7. 404/429/timeout/detail errors leave the accepted price offer unchanged.

Production defaults remain conservative:

```text
EBAY_MARKETPLACE_DETAIL_ENRICHMENT_ENABLED=0
EBAY_MARKETPLACE_DETAIL_LIMIT=5
EBAY_MARKETPLACE_DETAIL_CONCURRENCY=2
```

The normalized return-policy summary intentionally keeps only objective terms:
whether seller-listed returns are accepted, return period, and who pays return
shipping. UI wording says **Seller return policy**; it does not imply that seller
terms replace any eBay buyer-protection rights.

Any later recommendation score must remain explainable.

## API/compliance gate

The implementation is feature-gated and disabled by default in production Terraform.

Before public release:

1. validate the search response against real eBay Sandbox/Production credentials;
2. verify condition mapping across representative eBay.de categories;
3. verify shipping semantics for the target buyer geography;
4. confirm the intended presentation with the current Buy API/Growth Check rules;
5. confirm whether additional result ordering or "cheapest" presentation constraints
   apply to the approved PriceLens use case;
6. keep provider product-data caching at TTL 0 until approved freshness rules are
   documented.

Current eBay documentation confirms that Browse search supports GTIN/product search
and fixed-price/condition filtering, but production access and UX obligations remain
an approval gate.

## Planned extensions

- live-validate direct ePID search and Catalog Brand+MPN -> unique ePID resolution;
- live-validate the controlled Brand+Model Catalog query + detail-verification path;
- category-specific variant verification;
- configurable result limit and provider quota budgeting;
- live validation of accepted-candidate return-policy detail responses;
- optional eBay-qualified programme context;
- separate auction section (never mixed with fixed-price comparisons);
- representative live fixtures and measured same-product precision.
