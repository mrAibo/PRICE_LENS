# PriceLens Privacy Baseline

Status: **release draft — technical behavior verified, publisher/legal fields still required**

Updated: **2026-10-04**

This document describes the privacy behavior implemented by PriceLens. It is the source
for the future public privacy policy and Chrome Web Store privacy disclosures.

It is not ready to publish unchanged until the publisher identity, contact address,
production hosting/log-retention details, final provider list and public privacy-policy
URL are filled in.

## Single purpose

PriceLens has one user-facing purpose:

> Add trustworthy market-price context to the eBay.de item or search result the user
> explicitly chooses to compare.

PriceLens does not use eBay page data for advertising, user profiling, unrelated
analytics, resale, credit decisions, or behavioral targeting.

## Consent before comparison data leaves the page

The production extension requires an explicit first-use choice before PriceLens
comparison features become active. Item pages can present that consent UI; eBay search
pages remain inert unless consent was already stored.

Before consent, PriceLens:

- does not start eBay product extraction;
- does not send a comparison request to the PriceLens API;
- does not contact price providers.

After consent, PriceLens may normalize the supported item locally in the browser and
render an idle **Compare with PriceLens** control. On supported eBay search pages it may
also identify eligible result cards locally and render a small PriceLens lens on each
eligible card. Local recognition, scrolling and lens rendering alone send no comparison
request.

The normalized listing leaves the page only when the user explicitly presses the
PriceLens report control. Provider lookups happen only as part of that requested
report.

When the user selects **Enable PriceLens**, the extension stores a local consent flag
in `chrome.storage.local`. If the user enters a delivery destination, PriceLens can
also store the selected country and optional postal code locally so it can be reused
on later item pages.

The user can select **Disable PriceLens data sharing** in the PriceLens card. That:

1. stops the active page lifecycle;
2. removes the local consent flag; and
3. returns PriceLens to the consent state.

Selecting **Not now** sends no listing data and stores no consent.

## eBay item data processed for comparison

When comparison is enabled and the user is on a supported
`https://www.ebay.de/itm/*` item page or `https://www.ebay.de/sch/*` search page,
PriceLens may process the selected item locally. A normalized listing is sent to the
PriceLens API only after the user explicitly presses the item-page report control or a
specific search-card lens.

The comparison request can contain an explicit buyer destination consisting of a
two-letter country code and an optional postal code. This value is entered/selected by
the user; PriceLens does not infer it from IP geolocation. It is used only to improve
shipping eligibility/calculation for the requested report.

The listing contract can contain:

- eBay item ID;
- current eBay item URL;
- product title;
- item price and currency;
- mandatory shipping when it can be determined safely;
- listing condition;
- product brand and model;
- MPN;
- GTIN, EAN or UPC when present;
- structured variant information such as storage, RAM, screen size, pack count,
  edition, model qualifier and bundle status;
- product image URL when exposed by supported structured data;
- extraction evidence labels and controlled extraction warnings.

PriceLens deliberately prefers a missing field or unsupported state over fabricating
product data.

## Data PriceLens does not need for its comparison purpose

The extension is not designed to collect or transmit:

- eBay passwords;
- authentication cookies or session tokens;
- eBay account/user identifiers;
- payment-card or bank information;
- personal messages;
- contact lists;
- form contents unrelated to product comparison;
- unrelated page contents;
- general browsing history outside the supported eBay.de item/search-page scope.

The extension content script is scoped to:

```text
https://www.ebay.de/itm/*
https://www.ebay.de/sch/*
```

It does not request `<all_urls>`.

## Why data is sent to the PriceLens API

The API receives the normalized current listing only to provide the comparison feature.

Depending on which integrations have been approved and enabled, the backend may derive
provider searches from the product identity. Current implementation work includes:

- optional eBay Browse API enrichment;
- an Amazon Creators API provider scaffold;
- future Idealo / Geizhals adapters only after an approved publisher data path exists.

A production release must list the actually enabled third-party providers and their role
before publication.

Provider credentials remain backend-only and are never included in the extension.

## Local extension storage

The extension currently uses the Chrome `storage` permission for:

```text
priceLensComparisonConsent.v1 = true
priceLensBuyerDestination.v1 = { country, postalCode? }
```

These are local preferences, not advertising identifiers or account IDs. The
destination contains no street address and is transmitted only when the user explicitly
requests a report.

An opt-in Chrome pilot build can additionally use `chrome.storage.session` for:

```text
priceLensPilotSession.v1 = { sessionToken, expiresAt, tier }
```

This bearer session is issued by the PriceLens backend, is short-lived (15 minutes by
default), is not a provider credential and is not written to `chrome.storage.local`.
Expired/malformed sessions are removed instead of being sent.

The Google OAuth access token used to create that session is transient: the extension
does not write it to PriceLens storage. Pilot Chrome builds request the `identity`
permission and only the `openid` scope. Public Chrome and Firefox builds do not contain
that OAuth configuration and remain anonymous/free.

Selecting **Disable PriceLens data sharing** revokes consent, clears the saved buyer
destination preference and clears any active short-lived PriceLens pilot session.

Comparison reports are not written to Chrome local storage. The content-script lifecycle
contains a bounded in-memory tab-session reuse capability keyed by the normalized
listing and explicit buyer destination. Its production/default TTL is **0 ms** until
the enabled providers' cache/freshness rules permit non-zero reuse. If a positive TTL
is explicitly enabled later, entries remain memory-only, are bounded in count, expire
by TTL and are cleared when the PriceLens lifecycle stops.

## Backend application storage

PriceLens currently has no user account database and no persistent product-history
database.

Provider product/price caches default to disabled until provider-specific freshness and
retention terms are approved. Explicit cache implementations are process-local and
TTL-bounded.

This section must be reviewed again before any persistent database, price history,
watchlist, account system or durable per-product cache is introduced.

## Operational diagnostics

Built-in PriceLens diagnostics deliberately omit:

- eBay item ID;
- product title;
- listing URL;
- provider product URL;
- provider search/query terms;
- browser cookies;
- request headers;
- buyer delivery country or postal code;
- authorization headers;
- OAuth tokens;
- provider credentials.

Operational events contain controlled request/result counters, durations, provider
states and aggregate metrics. See [OBSERVABILITY.md](OBSERVABILITY.md).

The future production hosting platform, load balancer, security service and logging
backend may generate infrastructure metadata such as source IP address, timestamps and
request status. The public privacy policy must disclose the final production logging
configuration, subprocessors and retention period before store release.

## Security

The release architecture requires:

- HTTPS for the production PriceLens API origin;
- an exact build-time API host permission rather than arbitrary remote origins;
- backend-only provider credentials;
- input validation at the API boundary;
- bounded request/provider concurrency;
- TLS-terminating managed ingress;
- edge abuse protection before public release.

## Advertising and sale of data

PriceLens does not currently contain advertising functionality.

The implemented product does not sell eBay item-page data or use it for personalized,
retargeted or interest-based advertising.

Any future change to this statement requires a separate product/privacy review and an
updated disclosure before collection begins.

## User choices

Current controls:

- **Enable PriceLens** — grants local consent for supported item recognition and
  user-requested comparison.
- **Compare with PriceLens** — explicitly sends the current normalized item to request
  a report; simply opening the item page does not do so.
- **+ Show full report** — expands results already returned to the extension and does
  not trigger another provider/API request.
- **Refresh report** — explicitly requests a fresh comparison and bypasses any eligible
  in-memory tab-session report reuse.
- **Sign in with Google** — present only in an explicitly configured Chrome pilot build
  when private-beta sources are restricted; starts an interactive Google OAuth flow and
  exchanges the access token for a short-lived PriceLens session.
- **Sign out of pilot access** — clears the short-lived PriceLens session and refreshes
  the report under public restrictions.
- **Not now** — performs no comparison and stores no consent.
- **Disable PriceLens data sharing** — revokes the local consent flag and stops the
  PriceLens lifecycle on the page.

Uninstalling the extension also removes its local extension storage according to browser
behavior.

## Required fields before publication

The public privacy policy must add:

- publisher/legal entity name;
- publisher contact email/address as required;
- public privacy-policy URL;
- production hosting/subprocessor list;
- operational/security log retention period;
- final list of enabled price-data providers;
- provider-specific attribution/data-sharing disclosures required by their approved
  contracts;
- effective date and policy-change contact/process.

## Change control

A release that changes the categories of data collected, purpose of processing,
third-party recipients, persistent storage, or telemetry must:

1. update this document and the public privacy policy;
2. update Chrome Web Store privacy disclosures;
3. update the in-extension prominent disclosure before new collection begins;
4. pass a new privacy review.

The Chrome Web Store announced in July 2026 that collected user data must be strictly
necessary for the disclosed single purpose and that all data collection must be
prominently disclosed. Enforcement began August 1, 2026.

Reference material:

- https://developer.chrome.com/blog/cws-policy-updates-2026
- https://developer.chrome.com/docs/webstore/user_data
- https://developer.chrome.com/docs/webstore/troubleshooting
