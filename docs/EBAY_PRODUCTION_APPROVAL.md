# eBay Production Approval Packet

Status: **prepared for EPN software approval + Buy API Production application**

Updated: **2026-10-05**

This document is the ready-to-adapt application packet for PriceLens. It deliberately
uses the real current product state and does not invent a company, traffic volume,
download URL or user base.

## Current readiness

- eBay Developers Program application exists.
- Sandbox OAuth `client_credentials` validated successfully.
- Sandbox Browse `item_summary/search` validated successfully for `EBAY_DE`.
- PriceLens redacted end-to-end live-check passed for eBay enrichment.
- eBay Partner Network account exists.
- PriceLens is an independent/private software project, not an incorporated company.
- Production Browse access is **not** assumed; EPN/Buy API/Growth Check approval remains required.
- Catalog fallbacks stay disabled because the current Sandbox keyset does not authorize the
  `commerce.catalog.readonly` scope.
- Initial Production approval should be scoped to **eBay Germany / EBAY_DE**. EU marketplace
  fan-out can be activated later after separate validation/approval.

## Recommended submission order

1. Keep the Sandbox integration available and reviewable.
2. Prepare a testable PriceLens Chrome build/download location.
3. Submit the EPN **Software: Applications and Downloadable Tools** form.
4. Submit the eBay **Buy API Application** and reply to its confirmation email with screenshots,
   mockups/data flow and Sandbox testing instructions.
5. After EPN business-model approval, open the required eBay Developer Support ticket.
6. Make any review changes requested by eBay and sign the required contracts.
7. Request/complete the mandatory **Application Growth Check** for restricted Production Buy APIs.
8. Only after approval, switch the backend to a Production keyset and validate with low-volume
   Production traffic.

Do not submit the Software/Downloadable Tools form until the integration is testable by eBay.

## EPN Software: Applications and Downloadable Tools

### Application/tool description and monetization

Suggested text:

> PriceLens is a browser extension for users in Germany who are viewing an item on eBay.de.
> After the user explicitly opens a PriceLens report, the extension identifies the exact item
> and variant and sends only the comparison request to the PriceLens backend. The backend uses
> eBay's official Browse API to enrich product identity and, where permitted, to find alternative
> fixed-price eBay listings for the same exact product. PriceLens does not place bids, buy items,
> automate checkout, access private eBay-account data, or redirect users automatically.
>
> The initial product is an independent/private software project. Planned monetization for eBay
> traffic is ordinary EPN affiliate commission on user-initiated outbound eBay links. PriceLens
> does not currently provide cashback, loyalty rewards or purchase incentives.

If monetization changes before submission, update this text before sending it.

### Download/distribution

Use a **real testable URL**, for example a dedicated GitHub Release/private beta download page or,
later, the Chrome Web Store listing.

Suggested text once the build URL exists:

> PriceLens is distributed as a Chrome browser extension. During approval it is available as a
> test build from: <REAL_TEST_BUILD_URL>. After approval and release-readiness review, distribution
> is planned through the Chrome Web Store. No third-party bundlers or silent installers are used.
> Installation is always user initiated.

Do not enter a placeholder URL.

### Test credentials

For the core eBay flow, PriceLens does not need an eBay user login and should not require a
PriceLens account.

Suggested text:

> No application account is required to test the core eBay comparison flow. Install the supplied
> Chrome test build, open a supported eBay.de item page, grant the explicit PriceLens comparison
> consent, and click the PriceLens lens control. If a future private-beta build requires a
> PriceLens pilot login, a dedicated reviewer account will be supplied separately.

### Cashback / incentive

Suggested answer:

> No. PriceLens does not provide cashback, loyalty points, coupons or other transaction incentives.

### User information collected

Suggested text:

> PriceLens does not request or read the user's eBay account, purchase history, messages, payment
> data or private seller/buyer data. On a supported public eBay.de page, after consent, the extension
> extracts public listing fields needed for product matching (for example item ID, title, displayed
> price, shipping state, condition and available product identifiers/variant fields). Provider/API
> lookups run only after an explicit user action.
>
> A user may optionally set a delivery country and postal code for shipping calculations. These
> preferences are stored locally in the extension and are sent to the PriceLens backend only when
> the user explicitly requests a report. Operational backend logging is privacy-minimized and does
> not persist listing titles, GTIN/EAN/UPC values, seller names or provider product identifiers.

### Affiliate disclosure

Suggested text:

> PriceLens will clearly disclose when an outbound eBay link is an affiliate/advertising link.
> The disclosure will be visible in or immediately adjacent to the PriceLens comparison/report UI
> before the user follows the link. PriceLens does not rewrite unrelated page links or navigate the
> user automatically. The project's privacy/about documentation will also explain the affiliate
> relationship.

Before approval submission, make sure this disclosure is present in the actual test build.

## Buy API Production application

### Product name

**PriceLens**

### Applicant/business description

Suggested text:

> Independent software project / browser-extension publisher operated by an individual developer
> in Germany. PriceLens is currently in private/early MVP validation and is not operated through an
> incorporated company.

Use the registrant's real legal/contact details in account fields.

### Use case

Suggested text:

> PriceLens is a user-triggered product-comparison browser extension for eBay.de. The extension
> reads only the public eBay item currently visible to the user. The backend uses the official
> Browse API to enrich product identity from the eBay item ID and to query same-product fixed-price
> alternatives using strong product identifiers such as GTIN/EAN/UPC or an approved eBay product
> identifier path. PriceLens keeps conditions separate, rejects known variant mismatches, excludes
> incomplete landed-cost offers from misleading best-price claims, and never performs bidding,
> purchasing or checkout.

### Marketplace

Initial approval scope:

> Germany / eBay.de / EBAY_DE

Do not request the full EU fan-out in the first Production approval unless eBay explicitly asks for
all planned marketplaces. The code supports it, but Production can be configured DE-only first.

### User action / request trigger

> No provider search happens automatically when a page loads or when the user scrolls. A Browse
> comparison request is generated only when the user explicitly clicks the PriceLens lens/report
> control. Opening/closing already loaded UI does not create another provider request. A separate
> Refresh action is explicit.

### Identity / matching safety

> PriceLens prefers exact trade identifiers and verified product identifiers. It applies hard
> mismatch rules for condition, strong identifiers, storage, RAM, screen size, pack count,
> edition, bundle state, model qualifier and model generation before fuzzy/composite matching.
> Review-only candidates are not treated as automatic same-product matches.

### Shipping / price behavior

> PriceLens distinguishes item price from mandatory shipping and does not silently convert unknown
> shipping to zero. Offers with incomplete landed cost remain visible only with the appropriate
> uncertainty state and do not become a misleading best-price winner. Cross-currency ranking is
> blocked unless an explicit normalized comparison price is available.

### Caching

Current safe policy:

> Persistent provider product/price caching is disabled by default (TTL 0) until provider-approved
> freshness rules are documented. PriceLens coalesces identical concurrent requests in memory to
> reduce duplicate API traffic. OAuth application tokens are cached only for their validity period.

### Initial pilot API volume estimate

Use this as a **planning estimate**, not as a claim about existing traffic.

Recommended initial Production configuration:

- marketplace search: `EBAY_DE` only
- Catalog fallback: disabled
- post-match detail enrichment: disabled until separately live-validated
- comparison lookup: explicit user action only

Pilot planning assumption:

- up to **1,000 explicit PriceLens reports/day**
- expected peak: up to **100 reports/hour**
- typical eBay calls/report in the initial DE-only configuration:
  - 1 Browse item enrichment call
  - up to 1 same-product Browse search call when strong identity is available
- planning total: approximately **2,000 Browse calls/day**
- planning peak: approximately **200 Browse calls/hour**
- OAuth token calls are much lower because application tokens are reused until near expiry
- in-flight request coalescing reduces duplicate calls

Before submitting the Growth Check, replace these planning numbers if real pilot telemetry supports a
better estimate.

### Privacy / retention

Suggested text:

> PriceLens credentials are backend-only. The browser extension never receives the eBay Client
> Secret or OAuth application token. Provider responses are used to construct the current
> user-requested comparison result. Product/price cache TTL is currently zero. Operational logs are
> privacy-minimized and designed not to store listing titles, product identifiers, seller names,
> destination values or provider product IDs.

### Failure behavior

> If eBay enrichment or same-product search fails, PriceLens fails open to the safe page-extraction
> result and surfaces provider degradation instead of fabricating data. Provider failures are
> isolated and cannot make another provider's response appear as eBay data.

## Data flow for the review email / attachment

Use this sequence in a diagram or screenshot set:

```text
User opens public eBay.de item page
        |
        v
PriceLens extension
  - local safe extraction
  - no provider traffic yet
        |
        | user clicks PriceLens lens
        v
PriceLens backend over HTTPS
        |
        +--> eBay OAuth application token (server only)
        |
        +--> Browse item enrichment by current eBay item ID
        |
        +--> same-product Browse search only with strong/verified identity
        |
        v
PriceLens matcher / landed-cost safety rules
        |
        v
Compact comparison report in extension
        |
        | voluntary user click
        v
eBay destination / affiliate-tracked outbound link
```

Secrets never enter the extension.

## Sandbox evidence already available

Validated on 2026-10-05:

- OAuth application token: HTTP 200
- token lifetime returned: 7200 seconds
- Browse `item_summary/search`: HTTP 200
- Sandbox `EBAY_DE` returned a test item
- PriceLens `/ready`: pass
- PriceLens `/health`: pass
- PriceLens `/v1/compare`: pass
- `ebayBrowseEvidence=true`
- enrichment added Brand + Model + GTIN + EAN
- enrichment fallback: false
- redacted `ebay_enrichment` live requirement: pass
- redacted `ebay_market` live requirement: pass

The Sandbox data set is very small. This proves access and end-to-end integration, not Production
same-product precision/recall.

## Screenshots / artifacts to prepare before submission

Prepare these from the real test build:

1. eBay.de item page before opening PriceLens.
2. PriceLens idle lens control showing no automatic lookup.
3. User-triggered loading state.
4. Completed report showing eBay source attribution.
5. Example of condition separation / uncertainty handling.
6. Affiliate disclosure in the report.
7. Privacy/consent screen.
8. Optional backend architecture/data-flow diagram.
9. Test-build download URL and concise installation instructions.

Do not include Client IDs, Client Secrets, OAuth tokens, Google session secrets or other credentials
in screenshots.

## Developer Support ticket after EPN approval

Suggested subject:

> Buy API Production Access (<EBAY_USER_ID>)

Suggested body:

> Hello eBay Developer Support,
>
> EPN has approved the PriceLens business model for Buy API Production access. PriceLens is a
> user-triggered browser-extension comparison tool for eBay.de.
>
> EPN registered eBay user ID: <EBAY_USER_ID>
> Developer application: PRICE_LENS
> Marketplace: EBAY_DE
> APIs requested: Browse API for item identity enrichment and same-product fixed-price search
>
> Sandbox testing:
> 1. Install the test build from <REAL_TEST_BUILD_URL>.
> 2. Open <SANDBOX_TEST_PAGE_OR_INSTRUCTIONS>.
> 3. Grant PriceLens comparison consent.
> 4. Click the PriceLens lens control.
> 5. Verify the comparison report and eBay attribution.
>
> The EPN approval email is attached. The application uses backend-only OAuth credentials,
> user-triggered requests, conservative product matching and fail-open provider isolation.
>
> Please let me know if you require additional screenshots, data-flow documentation or changes.

## Production go-live guard

Do not switch `EBAY_ENVIRONMENT=production` merely because a Production keyset exists.

Production activation requires all applicable approvals/contracts plus Growth Check access for the
restricted Buy APIs. After approval, start with `EBAY_DE` only and low traffic, run the existing
redacted provider live-check, validate real condition/shipping behavior, and only then consider
wider EU marketplace fan-out.
