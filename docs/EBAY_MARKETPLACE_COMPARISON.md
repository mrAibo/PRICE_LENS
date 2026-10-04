# eBay Same-Product Marketplace Comparison

Status: **initial implementation complete / live Browse validation pending**

Checked against current eBay Browse API documentation on **2026-10-03**.

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
Brand+MPN keyword result is never auto-accepted. Controlled Brand+Model/title fallbacks
remain future work because they require stronger candidate verification.

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
- a direct link to the cheapest accepted listing.

Shipping-unknown offers remain visible but are labelled as incomplete and are not
treated as complete landed prices.

## Seller quality

The initial version surfaces objective eBay seller fields only. It does not create an
opaque PriceLens seller score.

Possible later inputs include:

- feedback percentage;
- feedback count;
- return policy;
- business/private seller account;
- delivery estimate;
- eBay-qualified programmes.

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
- controlled Brand + Model fallback with detail lookups before automatic matching;
- category-specific variant verification;
- configurable result limit and provider quota budgeting;
- return-policy/delivery metadata;
- richer seller context;
- separate auction section (never mixed with fixed-price comparisons);
- representative live fixtures and measured same-product precision.
