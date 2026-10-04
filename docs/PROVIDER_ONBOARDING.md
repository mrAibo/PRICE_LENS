# Provider Onboarding

Checked: **2026-10-04**

This document records the user/account actions that PriceLens cannot perform from
source code alone. Credentials must stay server-side and must never be committed.

## Immediate account actions

These are the external actions that currently unblock live provider validation:

1. **eBay** — create/confirm the Developer Program account and Sandbox keyset first. For
   production Buy/Browse access, also prepare the eBay Partner Network / Buy API
   application and Application Growth Check; a Production keyset alone does not grant
   restricted Buy API production access.
2. **idealo** — apply as an iPN/premium publisher and explicitly request the publisher
   API/data contract for a browser-extension comparison use case. Do not use merchant
   PWS 2.0 for PriceLens unless idealo instructs us to.
3. **Geizhals** — submit the Publisher Programme partnership request and ask Business
   Development for machine-readable API/feed terms, lookup identifiers, shipping fields,
   tracking/deeplink rules, cache/freshness rules and browser-extension permission.
4. **Amazon DE** — do not invent a website or company. Join Amazon PartnerNet/Associates only with a real public property you own (website/social/mobile app), obtain final acceptance and the qualifying sales required for Creators API signup, then create Creators API credentials under **Tools -> Creators API**. Because PriceLens is a browser extension, also request Amazon's express prior written approval before Amazon content/Partner Links are enabled in the extension.

When any credential becomes available, put it only in the backend/local secret
environment or deployed Secret Manager. Do not paste secrets into chat, GitHub issues,
PRs or the browser extension.

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
with no enrichment-fallback warning. `fx` passes only when the checked report actually
contains at least one complete foreign-currency offer and every such offer is
FX-normalized; merely enabling ECB FX is not enough.

The harness is therefore suitable as durable evidence for the current live-validation
gates without committing customer/product identifiers.

#### GitHub Actions live gate

The repository also contains the manual **Provider live validation** workflow. It uses
a protected GitHub Environment named `production-live-validation` and does not require
provider credentials in GitHub.

Configure that environment with:

- Variable `PRICE_LENS_LIVE_API_ORIGIN`: deployed PriceLens HTTPS origin.
- Variable `PRICE_LENS_LIVE_COUNTRY`: optional, defaults to `DE`.
- Secret `PRICE_LENS_LIVE_EBAY_ITEM_ID`: representative real eBay.de item ID. It is
  stored as a secret to prevent the validation source item from appearing in workflow
  logs/metadata even though it is not a provider credential.
- Secret `PRICE_LENS_LIVE_POSTAL_CODE`: optional delivery postcode.
- Secret `PRICE_LENS_LIVE_SESSION_TOKEN`: optional short-lived PriceLens session;
  update it immediately before a private-beta validation run because sessions expire.

Then use **Actions -> Provider live validation -> Run workflow**. The workflow accepts
only non-sensitive gate names and timeout as dispatch inputs, runs the same redacted
harness, and uploads `provider-live-check.json` for 7 days. Provider secrets remain
inside the deployed backend / Secret Manager.

The evidence artifact is uploaded even when a provider requirement fails, as long as
the comparison completed and a redacted report could be produced. Connection-level
failures before any report exists naturally have no evidence file.

### EPN for the PriceLens browser extension

Use **EPN**, not eBay Ambassador. Ambassador is the social-first creator program; PriceLens is a technical/downloadable-software integration.

EPN explicitly treats installed software, extensions and plug-ins as a special promotional method that requires prior written approval. After the EPN account is accepted, submit the **Software: Applications and Downloadable Tools** approval form when PriceLens is fully integrated or can be made testable within about a week. Be ready to provide:

- a description of PriceLens and how eBay is integrated/monetized;
- the download/test distribution location;
- test credentials if needed;
- whether user data is collected;
- affiliate-disclosure behavior.

An individual can join EPN; a selling business account is not required merely because the affiliate project is commercial. Keep all registration/contact information accurate.

### Production approval packet

A ready-to-adapt EPN Software/Downloadable Tools + Buy API Production/Growth Check packet is maintained in [EBAY_PRODUCTION_APPROVAL.md](EBAY_PRODUCTION_APPROVAL.md). It includes application text, data flow, Sandbox evidence, privacy/caching language, reviewer test instructions and conservative pilot API-volume estimates.

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

### Before Creators API: real publisher property and extension permission

Do not enter placeholder/example URLs or invented company data. Amazon reviews the declared websites/apps/social properties after qualifying sales and expects public original content. A legitimate PriceLens companion website can satisfy the website side only if it is a real owned site with substantive original content; it is not a workaround for extension approval.

For Germany, Amazon's current participation rules require express prior written approval before Partner Links or Amazon advertising content are used through client-side software such as browser plug-ins/extensions. Therefore:

1. keep the Amazon provider disabled in PriceLens extension releases;
2. if desired, build a genuine public PriceLens companion site and use it for Associates onboarding/content;
3. obtain Associates acceptance and the required qualifying sales;
4. request written approval describing PriceLens honestly as a browser extension;
5. enable Amazon in the extension only after that approval and Creators API access are both documented.

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
