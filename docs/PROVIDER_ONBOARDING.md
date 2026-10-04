# Provider Onboarding

Checked: **2026-10-04**

This document records the user/account actions that PriceLens cannot perform from
source code alone. Credentials must stay server-side and must never be committed.

## eBay

### Developer account and Sandbox keys

1. Register in the eBay Developers Program:
   https://www.developer.ebay.com/signin?tab=register
2. Accept the eBay API License Agreement.
3. In the developer portal go to **Your Account -> Application Keys**.
4. Create/select the PriceLens application.
5. Create a **Sandbox** keyset.
6. Copy:
   - App ID -> `EBAY_CLIENT_ID`
   - Cert ID -> `EBAY_CLIENT_SECRET`
7. Keep `EBAY_ENVIRONMENT=sandbox` while validating the integration.

PriceLens already implements Browse OAuth and `get_item_by_legacy_id`. It also has
an optional conservative Catalog path: when Browse has exact Brand+MPN but no GTIN/ePID,
the backend can request the Catalog read-only scope, search by MPN, locally require an
exact normalized Brand+MPN match, and accept the result only when one unique ePID
remains. Keep `EBAY_CATALOG_EPID_FALLBACK_ENABLED=0` until Sandbox behavior and
permissions are verified.

Likewise, keep `EBAY_MARKETPLACE_DETAIL_ENRICHMENT_ENABLED=0` until Browse
`getItem` return-policy fields are validated live. When enabled, detail calls happen
only after an automatic product match, are capped per report, and are optional metadata:
a detail failure must not remove an otherwise valid price offer.

Local backend configuration:

```text
EBAY_BROWSE_ENABLED=1
EBAY_ENVIRONMENT=sandbox
EBAY_MARKETPLACE_ID=EBAY_DE
EBAY_CATALOG_EPID_FALLBACK_ENABLED=0
EBAY_CATALOG_MARKETPLACE_ID=EBAY_DE
EBAY_MARKETPLACE_DETAIL_ENRICHMENT_ENABLED=0
EBAY_MARKETPLACE_DETAIL_LIMIT=5
EBAY_MARKETPLACE_DETAIL_CONCURRENCY=2
EBAY_CLIENT_ID=<Sandbox App ID>
EBAY_CLIENT_SECRET=<Sandbox Cert ID>
EBAY_BROWSE_CACHE_TTL_MS=0
```

Do not share the Cert ID / Client Secret in a GitHub issue or chat.

### Redacted live validation

After the backend is running with credentials configured, validate the real integration
through PriceLens itself rather than calling provider APIs manually:

```bash
npm run providers:live-check -- \
  --origin http://127.0.0.1:8787 \
  --ebay-item-id <REAL_EBAY_DE_ITEM_ID> \
  --country DE \
  --postal-code <POSTAL_CODE> \
  --require ebay_enrichment,ebay_market
```

For a deployed API, use its HTTPS origin. To require additional configured providers:

```bash
npm run providers:live-check -- \
  --origin https://api.your-owned-domain.de \
  --ebay-item-id <REAL_EBAY_DE_ITEM_ID> \
  --country DE \
  --require ebay_enrichment,ebay_market,amazon,fx \
  --output provider-live-check.json
```

If the API needs a pilot session for private-beta providers, put the short-lived
PriceLens session in the process environment only:

```bash
PRICE_LENS_LIVE_SESSION_TOKEN=<SHORT_LIVED_SESSION> \
npm run providers:live-check -- ...
```

Do not put the session token on the command line or in the output file.

The report is deliberately redacted. It records provider configuration/state, latency,
aggregate offer counts, whether strong identity fields were present and whether ECB FX
normalization was exercised. It does **not** record the eBay item ID, listing title,
brand/model values, GTIN/EAN/UPC/ePID values, seller names, provider product IDs,
offer URLs, request IDs, credentials or session tokens.

A required provider fails the command if it is unconfigured or returns an error.
`ebay_enrichment` additionally requires actual `ebay-browse:` enrichment evidence
with no enrichment-fallback warning. The harness is therefore suitable as durable
evidence for the current live-validation gates without committing customer/product
identifiers.

### Production

eBay documents separate Sandbox and Production credentials. For Buy API production
use, follow the current **Application Growth Check** / Buy API onboarding steps shown
in the developer portal. Be prepared to describe:

- application: PriceLens
- business model: product/price comparison browser extension
- marketplace: Germany / eBay.de
- Browse API use: identity enrichment for the eBay item currently viewed by the user
- expected daily/hourly call volume
- caching strategy
- privacy/data-retention behavior
- screenshots/end-to-end Sandbox flow

If PriceLens will monetize eBay outbound links, also register with eBay Partner
Network:
https://partnernetwork.ebay.com/solutions/joining-the-ebay-partner-network

The affiliate account and API developer keyset are separate concepts.

Official references:

- https://developer.ebay.com/api-docs/static/oauth-credentials.html
- https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application
- https://developer.ebay.com/grow/application-growth-check

## idealo

Use the **publisher/affiliate** path, not merchant PWS 2.0.

Official publisher page:
https://partner.idealo.com/de/affiliate-marketing-programm

idealo states that its iPN platform is for premium publishers and includes API access.
The public merchant PWS 2.0 documentation is for sending a merchant's own offer data
to idealo and is therefore not PriceLens's comparison-data API.

### Application request

Use **Zur iPN-Bewerbung** on the publisher page. If the form does not expose the
required technical-access fields, contact:

`affiliate@idealo.de`

Suggested technical description:

> PriceLens is a browser extension for Germany. When a user views a product on
> eBay.de, PriceLens identifies the exact product and wants to show permitted
> idealo market offers for the same variant. We request publisher/API access for
> product lookup by EAN/GTIN/MPN/model, offer price, mandatory shipping cost,
> deeplink/attribution, freshness/cache rules and rate limits. Credentials will
> remain on our backend and no idealo scraping is planned for production.

Ask idealo to confirm in writing:

- exact API/feed intended for an iPN publisher
- authentication mechanism
- lookup identifiers supported
- variant/product fields
- offer price and mandatory shipping fields
- cache/freshness restrictions
- request limits
- required deeplink/tracking parameters
- attribution/display requirements
- whether browser-extension placement is permitted

Do **not** create a merchant PWS integration unless idealo explicitly instructs us to
use it for this publisher use case.

## Geizhals

Official Publisher Programme:
https://unternehmen.geizhals.at/publisher/

Use **Partnerschaft anfragen**. The page also lists Business Development:

`bd@geizhals.at`

Suggested request:

> PriceLens is a browser extension for the German-speaking market. It identifies
> the exact product/variant currently viewed on eBay.de and wants to show permitted
> Geizhals comparison offers. We request publisher access to machine-readable
> product/offer data (API or feed) including EAN/GTIN/MPN/model lookup, variant
> identity, price, mandatory shipping, deeplink/tracking, freshness/cache policy
> and rate limits. Production scraping is not planned.

Ask Geizhals to provide/confirm:

- API/feed documentation
- credentials/authentication
- DE/AT marketplace coverage
- EAN/GTIN/MPN/model lookup
- variant fields
- price + mandatory shipping fields
- deeplink/affiliate tracking format
- refresh/cache TTL rules
- quotas/rate limits
- browser-extension usage/display conditions

No Geizhals adapter should be guessed before these publisher docs are supplied.

## Amazon EU / Creators API

### PartnerNet / Associates

Register or sign in:
https://partnernet.amazon.de/

PriceLens needs Associates/Creators eligibility for every Amazon marketplace it plans
to activate. A Partner Tag is locale-specific: do not reuse the German tag for Poland,
France, Italy, Spain, the Netherlands or Belgium.

The backend can use the common EU Creators credential flow, while PriceLens activates
only marketplaces whose own Partner Tag and access have been approved.

### Creators API

After final Associates acceptance and eligibility:

1. Sign in as the **primary account owner**.
2. Go to **Tools -> Creators API**.
3. Select **Create Application**.
4. Give it a PriceLens application name.
5. Select **Add New Credential**.
6. Securely save:
   - Credential ID
   - Credential Secret
   - Version
7. Record the Germany Partner Tag.

Amazon says the Secret is shown as credential material and must be stored securely.
The assigned Version determines the OAuth token endpoint. Current EU credentials are
version 3.2.

Backend configuration:

```text
AMAZON_CREATORS_ENABLED=1
AMAZON_CREATORS_CREDENTIAL_ID=<Credential ID>
AMAZON_CREATORS_CREDENTIAL_SECRET=<Credential Secret>
AMAZON_CREATORS_CREDENTIAL_VERSION=<assigned Version>
AMAZON_PARTNER_TAG=<Germany Partner Tag>
AMAZON_MARKETPLACE=www.amazon.de
AMAZON_CREATORS_CACHE_TTL_MS=0
```

PriceLens already implements OAuth, SearchItems, identity/offer parsing, in-flight
request coalescing and optional provider-local caching. Product/price cache TTL stays
at `0` until Amazon's approved-account freshness/retention rules are validated.
No credential should ever enter the extension.

### Important Amazon shipping limitation

The current Creators API OffersV2 documentation marks legacy
`DeliveryInfo.ShippingCharges` as **Not Available**. PriceLens therefore keeps
Amazon landed prices incomplete and does not use an Amazon offer as `bestOffer`
when mandatory shipping is unknown.

Official references:

- https://partnernet.amazon.de/
- https://partnernet.amazon.de/creatorsapi/docs/en-us/onboarding/register-for-creators-api
- https://partnernet.amazon.de/creatorsapi/docs/en-us/get-started/using-curl
- https://partnernet.amazon.de/creatorsapi/docs/en-us/api-reference/resources/offersV2

## Credential handoff rule

When credentials become available, configure them directly in the local/server secret
environment. Do not commit a filled `.env` file and do not paste Client Secrets into
GitHub issues, pull requests or chat.

The repository's `.env.example` contains only the names and safe placeholders.
