# eBay Browse API Enrichment

Status: **implemented, live credential validation pending**

PriceLens uses the official eBay Browse API only as optional server-side identity
enrichment. The browser extension never receives eBay developer credentials.

## What is implemented

- OAuth 2.0 client-credentials application token flow
- Sandbox and Production API base URLs
- `EBAY_DE` marketplace header by default
- `get_item_by_legacy_id` lookup for the numeric item id extracted from the eBay URL
- `fieldgroups=PRODUCT`
- token cache with an expiry safety window
- item enrichment cache
- one token refresh/retry after HTTP 401
- explicit HTTP 429 handling
- request timeout
- HTTP 404 treated as "no enrichment"
- conflict-safe merge: page identity wins when Browse disagrees
- fail-open API behavior: comparison continues with page extraction if enrichment fails
- mock/contract tests with no live credentials

## Configuration

The integration is opt-in.

```text
EBAY_BROWSE_ENABLED=1
EBAY_ENVIRONMENT=sandbox
EBAY_MARKETPLACE_ID=EBAY_DE
EBAY_CLIENT_ID=<Sandbox App ID / Client ID>
EBAY_CLIENT_SECRET=<Sandbox Cert ID / Client Secret>
```

For Production, change only the environment and credentials:

```text
EBAY_ENVIRONMENT=production
```

Never put the Client Secret in the extension, repository, browser storage, screenshots,
issues, or chat logs.

## Runtime behavior

When enabled, `POST /v1/compare` first attempts eBay identity enrichment. Browse data
can fill missing brand, model, MPN and GTIN/EAN/UPC identity fields.

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

## Live validation gate

Once Sandbox credentials exist:

1. set the five `EBAY_*` environment values;
2. start the API;
3. verify `GET /health` reports `enrichment.ebay = configured`;
4. run comparisons against representative Sandbox items;
5. add sanitized response contract fixtures for success, 404, 401, 429 and
   variation/group behavior;
6. only after Sandbox validation, proceed with eBay's Production approval process.

Official references:

- https://developer.ebay.com/api-docs/static/oauth-credentials.html
- https://developer.ebay.com/develop/guides/sell/authorization
- https://developer.ebay.com/develop/api/buy
- https://developer.ebay.com/api-docs/buy/static/api-browse.html
- https://developer.ebay.com/api-docs/buy/buy-requirements.html
