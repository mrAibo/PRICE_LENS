# Provider Access Research

Status: **research gate / no production credentials configured**

Verified: **2026-10-02**

PriceLens does not treat public HTML scraping as the default production integration path. A provider is production-enabled only after the project documents an explicit permitted access route, required attribution, rate limits, caching restrictions and credential handling.

## Decision summary

| Provider | Preferred production path | Current status | Implementation decision |
| --- | --- | --- | --- |
| Idealo | iPN / premium publisher API | Application/access required | Do not confuse with merchant PWS 2.0. Keep scraping research-only. |
| Geizhals | Publisher Programme / agreed product-data access | Partnership details required | Ask Business Development for machine-readable feed/API terms before production adapter. |
| Amazon DE | Amazon Associates + Creators API | Provider scaffold implemented; live eligibility/onboarding required | Creators API OAuth/SearchItems implemented. OffersV2 shipping remains incomplete. |
| eBay | Official Browse API for enrichment | Client implemented; live Sandbox/Production credentials still required | Page extraction stays functional without API enrichment. |

## Idealo

### What is confirmed

Idealo documents two materially different integration families:

1. Merchant/business interfaces such as **PWS 2.0**, used by merchants to submit and maintain their own offers.
2. The **idealo Private Network (iPN)** for premium publishers. Idealo states that iPN offers technically experienced publishers additional advertising options and **API access**.

The merchant PWS 2.0 API is therefore **not** the consumer price-search API PriceLens needs.

### PriceLens decision

Production order of preference:

1. Apply for / evaluate iPN publisher access.
2. Obtain API documentation and confirm searchable identifiers, current-price fields, shipping fields, attribution/deep-link rules, quotas and caching policy.
3. Build `IdealoProvider` only against the approved contract.
4. If access is unavailable, any HTML parser remains an isolated, low-volume research spike and is not silently promoted to the production architecture.

Official references:

- https://partner.idealo.com/de/affiliate-marketing-programm
- https://partner.idealo.com/partner-idealo-com/de/idealo-academy/faqs/faq-technische-anbindung

## Geizhals

### What is confirmed

Geizhals offers a **Publisher Programme** and advertises access to millions of products/product data for partner projects, including an affiliate toolkit/plugin. The public page does not by itself establish a generic unrestricted search API contract.

### PriceLens decision

Before writing the production adapter, ask Geizhals Business Development to confirm:

- API, feed or other machine-readable product-data access
- lookup by EAN/GTIN/MPN/model
- offer/merchant/shipping fields
- refresh limits and caching requirements
- required attribution and outbound tracking links
- whether a browser-extension price-comparison use case is permitted

Until that is confirmed, browser automation/scraping is a replaceable research adapter only.

Official reference:

- https://unternehmen.geizhals.at/publisher/

## Amazon Germany

### What is confirmed

Amazon now documents **Creators API** as the supported product-catalog API for publishers/affiliate partners and provides a migration path from Product Advertising API. Amazon explicitly marks **PA-API 5.0 as deprecated**.

The Creators API supports operations including product search and item retrieval. Germany is a supported marketplace and uses EUR by default.

Amazon's current documentation also states that access requires Amazon Associates participation and Creators API onboarding; the current introduction lists a qualifying-sales requirement for API access.

### PriceLens decision

1. Target **Creators API**, not a new PA-API 5.0 implementation.
2. The backend Creators OAuth/SearchItems provider scaffold is implemented and covered by mock contract tests.
3. Complete/verify German Amazon Associates/Creators eligibility before live validation.
4. Keep Credential ID / Credential Secret exclusively in the backend.
5. Amazon OffersV2 no longer exposes legacy shipping charges, so PriceLens keeps those landed prices incomplete and excludes them from `bestOffer`.
6. Confirm current price-display, freshness/caching and attribution rules with the approved account before public release.
7. Keep the provider optional so missing Amazon eligibility never blocks other comparisons.

Official references:

- https://partnernet.amazon.de/creatorsapi/docs/en-us/introduction
- https://partnernet.amazon.de/creatorsapi/docs/en-us/onboarding/register-for-creators-api
- https://partnernet.amazon.de/creatorsapi/docs/en-us/get-started/using-curl
- https://partnernet.amazon.de/creatorsapi/docs/en-us/api-reference/resources/offersV2

## Provider implementation gate

A real provider adapter may move from research to production only when all boxes are answered:

- [ ] access approved / credentials available
- [ ] permitted PriceLens use case documented
- [ ] identifier lookup documented
- [ ] price + mandatory shipping semantics documented
- [ ] rate limits documented
- [ ] cache/freshness restrictions documented
- [ ] attribution/deep-link requirements documented
- [ ] secrets remain backend-only
- [ ] fixture/contract tests exist
- [ ] timeout/error behavior exists
- [ ] provider can be disabled without breaking comparison

## Research fallback policy

Scraping code, if created for a technical spike, must:

- live behind the same `PriceProvider` interface
- never require credentials/cookies copied from a user's browser
- use conservative request rates
- be independently removable
- not implement anti-bot bypass as a core product feature
- not be described as production-ready until terms/access are resolved

This separation lets PriceLens validate matching and UI behavior while keeping external-access risk out of the core architecture.


## Account onboarding

Exact user/account steps and the server-side environment variables are maintained in
[PROVIDER_ONBOARDING.md](PROVIDER_ONBOARDING.md). Idealo and Geizhals production
adapters remain intentionally unwritten until their publisher teams provide the
machine-readable data contract and permitted-use terms needed by PriceLens.