# Amazon Creators API Provider

Status: **implemented scaffold / live access validation pending**

Checked against the current Amazon Creators API documentation on 2026-10-02.

## Design

PriceLens uses Amazon's current Creators API rather than starting a new legacy
Product Advertising API 5.0 integration.

The provider uses:

- OAuth 2.0 client credentials
- the credential version assigned by Amazon
- EU credential version `3.2` maps to `https://api.amazon.co.uk/auth/o2/token`
- common API endpoint `https://creatorsapi.amazon`
- `POST /catalog/v1/searchItems`
- `x-marketplace: www.amazon.de`
- a Germany Partner Tag
- `itemInfo` identity resources
- `offersV2` condition, merchant and price resources

## Security

All credentials are backend-only:

```text
AMAZON_CREATORS_ENABLED=1
AMAZON_CREATORS_CREDENTIAL_ID=<Credential ID>
AMAZON_CREATORS_CREDENTIAL_SECRET=<Credential Secret>
AMAZON_CREATORS_CREDENTIAL_VERSION=<assigned version, usually 3.2 for EU>
AMAZON_PARTNER_TAG=<Germany Partner Tag>
AMAZON_MARKETPLACE=www.amazon.de
AMAZON_CREATORS_CACHE_TTL_MS=0
```

Never store the Credential Secret in the browser extension, repository, GitHub issue,
screenshots or client-side storage.

## Matching data

The adapter can normalize:

- ASIN as the provider product id
- detail-page affiliate URL
- title
- brand
- EAN / UPC
- manufacturer part number
- model
- edition
- unit count / pack count
- offer condition
- merchant
- offer price

Those fields feed the same PriceLens deterministic matching and hard-mismatch policy
used by other providers.

## Mandatory shipping limitation

The current Creators API `OffersV2` resource intentionally does not provide the
legacy `DeliveryInfo.ShippingCharges` field.

Therefore PriceLens must not assume Amazon shipping is zero.

Amazon candidates are emitted with `shipping: undefined`. The core consequently
sets `landedPriceComplete: false`, and such an offer cannot become `bestOffer`
under the current correctness-first comparison policy.

The UI explicitly explains that offers were found but a complete landed-price
comparison cannot be shown.

This remains true even if Amazon retail commonly displays free shipping in a
particular user context; PriceLens will not infer account-, membership-, basket- or
destination-dependent shipping.

## Cache and OAuth

Implemented:

- OAuth token cache with expiry safety window
- in-flight SearchItems coalescing
- optional per-search product cache, disabled by default
- one token refresh after HTTP 401
- controlled 404 / 429 handling
- request timeout
- provider failure isolation through the core orchestrator

Product/price responses are **not cached between sequential searches by default**.
`AMAZON_CREATORS_CACHE_TTL_MS=0` remains the safe setting until the approved German
Associates/Creators account rules for freshness, display and retention are verified.

Concurrent identical searches still share one in-flight request. Once Amazon's current
rules for this account/use case are confirmed, an explicit non-negative TTL in
milliseconds can be configured. Invalid TTL values fail startup.

## Live validation gate

After Amazon Creators access is approved:

1. create a Creators API application in Amazon Associates Central;
2. add a credential and securely save Credential ID, Secret and Version;
3. use the German Partner Tag;
4. configure the backend environment variables above;
5. verify `GET /health` reports Amazon configured;
6. run SearchItems against representative product classes;
7. preserve sanitized response contract fixtures;
8. validate rate-limit/error behavior using the actual account;
9. review Amazon's current price-display, caching, attribution and linking rules
   before any public release.

## Official references

- https://affiliate-program.amazon.com/creatorsapi/docs/
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/item-info
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2
