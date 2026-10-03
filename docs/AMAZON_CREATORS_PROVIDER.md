# Amazon Creators API Provider

Status: **EU multi-market implementation complete / live access validation pending**

Updated: **2026-10-04**

PriceLens uses Amazon's current Creators API rather than starting a new legacy
Product Advertising API 5.0 integration.

## EU marketplace model

The initial PriceLens EU set is:

```text
www.amazon.de      EUR
www.amazon.pl      PLN
www.amazon.fr      EUR
www.amazon.it      EUR
www.amazon.es      EUR
www.amazon.nl      EUR
www.amazon.com.be  EUR
```

The Creators API credentials are backend-only and can be shared by the configured
regional integration, but each marketplace lookup is enabled only when PriceLens has
a valid Partner Tag for that specific marketplace/locale.

A German Partner Tag is therefore **not** reused for Poland, France, Italy, Spain,
the Netherlands or Belgium.

Preferred configuration:

```text
AMAZON_CREATORS_ENABLED=1
AMAZON_CREATORS_CREDENTIAL_ID=<Credential ID>
AMAZON_CREATORS_CREDENTIAL_SECRET=<Credential Secret>
AMAZON_CREATORS_CREDENTIAL_VERSION=3.2
AMAZON_MARKETPLACE_PARTNER_TAGS_JSON={"www.amazon.de":"de-tag-21","www.amazon.pl":"pl-tag-21"}
AMAZON_MARKETPLACE_SEARCH_CONCURRENCY=2
AMAZON_CREATORS_CACHE_TTL_MS=0
```

Only marketplaces present in the JSON map are queried. This lets production activate
locales gradually as the corresponding Associates/Creators eligibility and Partner
Tags are approved.

For backward compatibility a Germany-only pilot can still use:

```text
AMAZON_PARTNER_TAG=<Germany Partner Tag>
AMAZON_MARKETPLACE=www.amazon.de
```

when the marketplace-tag JSON map is empty.

## Request architecture

One explicit PriceLens report can fan out to the configured Amazon marketplaces with
bounded concurrency.

For every locale PriceLens sends:

- the same backend OAuth credential;
- the locale-specific `partnerTag`;
- the locale-specific `marketplace`;
- matching `x-marketplace` header;
- locale currency preference (for example EUR for Germany and PLN for Poland);
- the same deterministic product search identity and matching rules.

The EU credential version `3.2` uses:

```text
https://api.amazon.co.uk/auth/o2/token
```

The catalog endpoint remains:

```text
https://creatorsapi.amazon/catalog/v1/searchItems
```

OAuth token minting is shared/coalesced across locale searches. Marketplace requests
themselves are independently bounded by:

```text
AMAZON_MARKETPLACE_SEARCH_CONCURRENCY=2
```

A failure in one Amazon locale does not discard successful results from another
configured locale. If every configured locale fails, the Amazon provider reports a
normal provider failure and remains isolated from other PriceLens providers.

## URL trust boundary

Amazon product URLs are accepted only when they use HTTPS and remain on the root domain
for the marketplace that was queried.

Examples:

```text
www.amazon.de      -> amazon.de
www.amazon.pl      -> amazon.pl
www.amazon.fr      -> amazon.fr
www.amazon.it      -> amazon.it
www.amazon.es      -> amazon.es
www.amazon.nl      -> amazon.nl
www.amazon.com.be  -> amazon.com.be
```

A response for one locale cannot inject a product link on another Amazon or non-Amazon
domain.

## Matching data

The adapter normalizes:

- ASIN as provider product id;
- detail-page affiliate URL;
- marketplace hostname;
- title;
- brand;
- EAN / UPC;
- manufacturer part number;
- model;
- edition;
- unit count / pack count;
- offer condition;
- merchant;
- offer price and original currency.

Those fields feed the same deterministic PriceLens matcher and hard-mismatch rules used
by the other providers.

## Mandatory shipping limitation

The current Creators API `OffersV2` resource does not provide a reliable mandatory
shipping charge suitable for PriceLens landed-price ranking.

Therefore PriceLens keeps:

```text
shipping: undefined
landedPriceComplete: false
```

for Amazon offers in every marketplace.

Consequences:

- Amazon Germany cannot become the headline delivered-price winner merely because its
  item price is low;
- Amazon Poland cannot become the winner merely after PLN→EUR FX normalization;
- Prime/member/account/basket-dependent shipping is never assumed to be zero;
- Amazon offers can still be displayed in the full report as incomplete landed prices.

This correctness rule remains in force until Amazon provides an approved, reliable
mandatory-shipping source for the actual buyer context.

## Cache, OAuth and traffic safety

Implemented:

- shared OAuth token cache with expiry safety window;
- shared token refresh after HTTP 401;
- per-market SearchItems cache keys;
- in-flight request coalescing;
- bounded locale fan-out;
- optional product cache, disabled by default;
- controlled 404 / 429 / HTTP failure handling;
- per-locale partial-failure isolation;
- request timeout;
- provider-level concurrency limits in the normal PriceLens orchestrator.

`AMAZON_CREATORS_CACHE_TTL_MS=0` remains the safe default until the approved
Associates/Creators rules for freshness, display and retention are verified for the
actual PriceLens accounts/locales.

## Security

Never place the credential secret in:

- the browser extension;
- source control;
- GitHub issues;
- client-side storage;
- logs;
- screenshots or chat.

Production credentials belong in GCP Secret Manager. Partner Tags are configuration
identifiers, but locale activation must still be limited to marketplaces for which the
operator has the required Associates/Creators approval.

## Live validation gate

Before enabling a locale in production:

1. confirm Associates/Creators eligibility for that marketplace;
2. obtain the marketplace-specific Partner Tag;
3. confirm the existing Creators credential is authorized for the intended region;
4. add only that locale/tag to the server-side map;
5. validate representative SearchItems responses and affiliate URLs;
6. preserve sanitized response fixtures;
7. verify price currency and condition normalization;
8. validate rate-limit/error behavior;
9. review current attribution, price-display, caching and linking requirements;
10. keep Amazon out of delivered-price ranking while mandatory shipping is unknown.

## Official references

- https://affiliate-program.amazon.com/creatorsapi/docs/
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items
- https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2
