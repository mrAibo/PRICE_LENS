# eBay Browse API Enrichment

Status: **implemented; Sandbox Browse validation passed, Production approval pending**

PriceLens uses the official eBay Browse API only as optional server-side identity
enrichment. The browser extension never receives eBay developer credentials.

## What is implemented

- OAuth 2.0 client-credentials application token flow
- Sandbox and Production API base URLs
- `EBAY_DE` marketplace header by default
- `get_item_by_legacy_id` lookup for the numeric item id extracted from the eBay URL
- `fieldgroups=PRODUCT`
- OAuth token cache with an expiry safety window
- in-flight lookup coalescing
- optional item enrichment cache, disabled by default until live caching rules are approved
- one token refresh/retry after HTTP 401
- explicit HTTP 429 handling
- request timeout
- HTTP 404 treated as "no enrichment"
- conflict-safe merge: page identity wins when Browse disagrees
- direct ePID extraction when Browse product data exposes it
- optional Brand+MPN -> unique ePID Catalog fallback using the Catalog read-only OAuth scope
- optional conservative Brand+Model -> Catalog query fallback when GTIN/ePID/MPN and structured variants are absent
- Brand+Model search summaries are never trusted by title alone: bounded candidates are verified through Catalog `getProduct`
- Brand+Model accepts an ePID only when exactly one detail has exact Brand + explicit Model aspect
- ambiguous matches, missing Model aspects or incomplete detail verification produce no ePID
- concurrent identical Catalog lookups/details are coalesced without persistent product caching
- fail-open API behavior: comparison continues with page/Browse identity if Catalog or Browse fails
- mock/contract tests with no live credentials

## Configuration

The integration is opt-in.

```text
EBAY_BROWSE_ENABLED=1
EBAY_ENVIRONMENT=sandbox
EBAY_MARKETPLACE_ID=EBAY_DE
EBAY_CATALOG_EPID_FALLBACK_ENABLED=0
EBAY_CATALOG_BRAND_MODEL_FALLBACK_ENABLED=0
EBAY_CATALOG_BRAND_MODEL_CANDIDATE_LIMIT=5
EBAY_CATALOG_BRAND_MODEL_DETAIL_CONCURRENCY=2
EBAY_CATALOG_MARKETPLACE_ID=EBAY_DE
EBAY_CLIENT_ID=<Sandbox App ID / Client ID>
EBAY_CLIENT_SECRET=<Sandbox Cert ID / Client Secret>
EBAY_BROWSE_CACHE_TTL_MS=0
```

For Production, change only the environment and credentials:

```text
EBAY_ENVIRONMENT=production
```

Never put the Client Secret in the extension, repository, browser storage, screenshots,
issues, or chat logs.

## Cache safety

OAuth application tokens are cached until their expiry safety window because they are
authentication material, not product/price data.

Browse item responses are **not cached between sequential requests by default**.
`EBAY_BROWSE_CACHE_TTL_MS=0` is the safe default while eBay's live freshness and
retention rules for the approved PriceLens application are still pending.

Concurrent requests for the same item are still coalesced into one in-flight lookup.
After the provider rules are confirmed, a non-negative TTL in milliseconds may be set
explicitly. Invalid or negative TTL values fail configuration rather than silently
enabling a cache.

## Runtime behavior

When enabled, `POST /v1/compare` first attempts eBay identity enrichment. Browse data
can fill missing brand, model, MPN, GTIN/EAN/UPC and direct ePID identity fields.

When the Brand+MPN Catalog fallback is explicitly enabled and no GTIN/ePID exists,
exact Brand+MPN may be resolved to ePID only when one unique exact Catalog product
remains. PriceLens does not turn Brand+MPN into an unverified broad Browse keyword
match.

A separate Brand+Model fallback is even more restrictive. It is eligible only when
GTIN/ePID/MPN are absent. Catalog keyword search is used only for discovery; each
bounded candidate is fetched with `getProduct`, Brand must match exactly, and Model
must appear as an explicit Catalog Model aspect. Every candidate detail lookup needed
to prove uniqueness must complete; otherwise the fallback fails closed.

When the listing carries supported structured variants, the Catalog detail must also
prove them explicitly before its ePID can qualify:

- storage capacity, normalized to GB (including TB -> GB);
- RAM capacity, normalized to GB;
- screen size in inches, including comma-decimal/localized values;
- pack count.

A missing or conflicting required aspect rejects that Catalog product. Edition and
model-qualifier values may also qualify, but only through exact values in a small
allowlist of explicit Catalog aspects (for example Edition/Ausgabe and Model
Number/Modellnummer). Title text is not used as substitute evidence.

`bundleIncluded` remains ineligible for Brand+Model fallback. A seller-created bundle
is an instance/listing property and must not be inferred from an underlying catalog
product.

Enrichment does not silently overwrite an existing page identity. Conflicts produce an
extraction warning and the page value is retained.

If OAuth, Browse, timeout, permissions or rate limits fail, the normal comparison path
continues using the page-extracted listing.

## Variation limitation

An eBay item-page URL contains a legacy listing id. Multi-variation listings may require
variation-specific legacy identifiers or SKU information to identify the selected
variation through Browse.

Therefore the enrichment layer is intentionally conservative: it is used for missing
identity fields and must not override variant identity already obtained from the current
page. Future live Sandbox fixtures should verify how the selected eBay.de variations in
our target categories map through `get_item_by_legacy_id`.

## Sandbox live validation

The first credential-backed Sandbox validation passed on 2026-10-04.

Validated:

1. OAuth client-credentials token request returned HTTP 200.
2. Browse `item_summary/search` returned HTTP 200 with Sandbox data.
3. `GET /health` reported eBay enrichment configured.
4. A full PriceLens comparison using Sandbox legacy item `110590598827` added brand, model, GTIN and EAN to an otherwise empty identity.
5. The redacted live-check harness reported `ebay_enrichment=pass` and `ebay_market=pass`.
6. The same-product provider executed successfully and returned the non-error state `no_match` for that selected Sandbox item.

See [eBay Sandbox Live Validation](EBAY_SANDBOX_VALIDATION.md) for the redacted evidence.

### Catalog fallback limitation discovered live

The current Sandbox keyset successfully mints the normal application token used by Browse, but a direct token request for `commerce.catalog.readonly` returns HTTP 400 `invalid_scope`.

Therefore the optional Brand+MPN / Brand+Model Catalog fallbacks remain disabled. PriceLens must not depend on Catalog for normal comparison. The baseline remains exact Browse GTIN/EAN/UPC and direct ePID discovery. Catalog may be reconsidered only after eBay explicitly grants/clarifies the required authorization for the PriceLens use case.

### Remaining live gate

Before release:

1. broaden same-product validation across representative categories/conditions/shipping cases;
2. validate variation/group behavior where eBay Sandbox provides useful data;
3. complete EPN software/browser-extension approval and the Buy API Production approval path;
4. repeat the redacted validation in Production;
5. keep persistent product caching at TTL 0 until the approved freshness/retention rules are confirmed.

Official references:

- https://developer.ebay.com/api-docs/static/oauth-credentials.html
- https://developer.ebay.com/develop/guides/sell/authorization
- https://developer.ebay.com/develop/api/buy
- https://developer.ebay.com/api-docs/buy/static/api-browse.html
- https://developer.ebay.com/api-docs/buy/buy-requirements.html
