# Chrome Web Store Release Checklist

Status: **technical release baseline — submission not yet approved**

Updated: **2026-10-03**

This checklist maps the current PriceLens implementation to Chrome Web Store release
requirements. It is intentionally conservative because the extension handles data from
the eBay item page.

## 1. Single-purpose statement

Recommended store-listing statement:

> PriceLens adds market-price context to the eBay.de item page you are viewing by
> identifying the product and comparing its current eBay landed price with matching
> offers from enabled price-comparison providers.

Do not add unrelated browsing, rewards, advertising, shopping-history or account
features to the release without a new single-purpose/privacy review.

## 2. Prominent data disclosure

Before the first comparison, the extension now displays an in-page consent card before
starting extraction or network traffic.

The implemented disclosure states that PriceLens sends the current:

- eBay item ID and URL;
- title;
- price and shipping;
- condition;
- product identifiers;
- detected variant details

to the PriceLens API and may use product identity to query enabled price providers.

It also states that PriceLens does not need eBay cookies, passwords, account identifiers,
payment data or unrelated browsing history.

Release review must compare the displayed text against the actual current
`EcommerceListing` contract and provider behavior.

## 3. Consent behavior

Required invariant:

```text
no stored consent
    -> disclosure card
    -> no extractor lifecycle
    -> no /v1/compare request

Enable price comparison
    -> local consent flag
    -> extractor lifecycle starts
    -> comparison request permitted

Disable PriceLens data sharing
    -> lifecycle stops
    -> consent flag removed
    -> disclosure card returns
```

CI tests must keep this invariant executable.

## 4. Chrome permissions and justifications

### `storage`

Purpose:

> Stores one local boolean indicating whether the user explicitly enabled PriceLens
> comparison data sharing. It is also used to revoke that preference.

No sync/account storage is required.

### eBay item content-script scope

Required match:

```text
https://www.ebay.de/itm/*
```

Purpose:

> Read the current eBay product page fields needed to identify the product and render
> PriceLens comparison UI on that page.

The extension must not request `<all_urls>`.

### PriceLens API host permission

Release builds contain exactly one build-time API origin:

```text
https://<final-price-lens-api>/*
```

Purpose:

> Allow the extension service worker to send the user-approved current listing to the
> PriceLens comparison API.

The host is fixed at build time. A web page cannot turn the service worker into an
arbitrary cross-origin request proxy.

## 5. Privacy-practices dashboard

Before submission, review the exact dashboard categories available at that time.

Conservatively treat the current eBay URL/page data as website content / browsing
activity for disclosure purposes. Do not claim that the extension handles no user data:
Chrome policy explicitly treats website content and browsing activity as user data
categories.

The dashboard, store listing, in-extension disclosure and public privacy policy must
describe the same behavior.

## 6. Remote code

Current release expectation:

- no remote JavaScript/WASM is downloaded for execution;
- extension behavior is bundled into `background.js` and `content.js`;
- the PriceLens backend returns comparison data, not executable extension code.

Re-verify this before every store submission.

## 7. Data-use declarations

Current implemented purpose:

- provide the price-comparison feature requested by the user.

Current prohibited/nonexistent uses:

- personalized or retargeted advertising;
- sale of eBay page data;
- unrelated behavioral profiling;
- credit/lending decisions;
- collecting unrelated browsing activity.

Any future telemetry or persistent user/product history requires a new privacy review
before collection starts.

## 8. Public privacy policy

Before store submission:

- [ ] fill publisher/legal identity;
- [ ] fill contact details;
- [ ] list actual production hosting/security subprocessors where required;
- [ ] document infrastructure-log retention;
- [ ] list actual enabled providers/data recipients;
- [ ] confirm provider contractual attribution language;
- [ ] publish `docs/PRIVACY.md`-derived policy at a stable HTTPS URL;
- [ ] place that URL in the Chrome Web Store Developer Dashboard;
- [ ] verify that the URL is publicly reachable without login.

## 9. Provider/commercial gate

Store release remains blocked until enabled providers allow the intended use.

For each enabled provider confirm:

- current product/price data may be displayed in the extension;
- required attribution/branding is present;
- deep-link/tracking requirements are satisfied;
- cache/freshness rules are enforced;
- mandatory shipping semantics are not misrepresented.

Do not enable a provider in the public build solely because its code scaffold exists.

## 10. Backend/deployment gate

Before final packaging:

- [ ] Cloud Run service is provisioned;
- [ ] external load balancer/serverless NEG is provisioned;
- [ ] Cloud Armor policy is attached and tuned;
- [ ] Secret Manager bindings/rotation are defined;
- [ ] final custom HTTPS API hostname is live;
- [ ] direct ingress bypass is blocked by the selected Cloud Run ingress mode;
- [ ] operational log access/retention is documented;
- [ ] live providers remain disabled unless separately approved.

## 11. Candidate package gate

Run the GitHub workflow:

```text
Package Chrome Extension
```

with:

```text
api_origin=https://<final-price-lens-api>
```

Before upload to Chrome Web Store verify:

- [ ] `npm run licenses:check` passes against the committed lockfile;
- [ ] artifact verifier passes;
- [ ] manifest is V3;
- [ ] only `storage` is present in `permissions`;
- [ ] exactly one API origin exists in `host_permissions`;
- [ ] eBay content-script scope is still only `https://www.ebay.de/itm/*`;
- [ ] no `<all_urls>`;
- [ ] no backend credentials/secrets in extension JavaScript;
- [ ] ZIP root contains `manifest.json`, `background.js`, `content.js`;
- [ ] API origin is the real deployed HTTPS origin, not a placeholder;
- [ ] privacy/store disclosure text matches the packaged behavior.

## 12. Policy-change gate

Chrome announced stricter user-data rules on July 1, 2026, enforced beginning
August 1, 2026:

- collected user data must be strictly necessary for the disclosed single purpose;
- all data collection must be prominently disclosed;
- changes to data-handling practices must be proactively disclosed.

Before each release, review the current Chrome Web Store policies rather than relying on
this document alone.

Official references:

- https://developer.chrome.com/blog/cws-policy-updates-2026
- https://developer.chrome.com/docs/webstore/user_data
- https://developer.chrome.com/docs/webstore/troubleshooting
- https://developer.chrome.com/docs/webstore
