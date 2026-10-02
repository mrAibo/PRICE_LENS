# Firefox Compatibility

Status: **technical build/package baseline implemented; AMO signing and live-browser validation pending**

Updated: **2026-10-03**

PriceLens keeps one TypeScript implementation for Chrome and Firefox, but generates a
browser-specific Manifest V3 artifact where the browsers still differ.

## Current compatibility decisions

### Background execution

Firefox does not currently support `background.service_worker` for WebExtensions
Manifest V3. Chrome requires a service worker.

PriceLens therefore generates:

Chrome:

```json
{
  "background": {
    "service_worker": "background.js"
  }
}
```

Firefox:

```json
{
  "background": {
    "scripts": ["background.js"]
  }
}
```

The application code is identical; only the generated manifest differs.

Official reference:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background

### WebExtension API calls

Firefox supports the `chrome.*` namespace as a porting aid, but cross-browser
asynchronous behavior is most predictable when callback-compatible forms are used.

PriceLens wraps callback-based:

- `chrome.storage.local.get/set/remove`
- `chrome.runtime.sendMessage`

into application-level Promises in `src/browser-api.ts`.

This avoids introducing a WebExtension polyfill and avoids relying on one browser's
Promise-overload details.

Official references:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension

## Firefox-specific manifest metadata

The generated Firefox artifact contains:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "price-lens@mraibo.github",
      "strict_min_version": "140.0",
      "data_collection_permissions": {
        "required": [
          "browsingActivity",
          "websiteContent"
        ]
      }
    }
  }
}
```

The ID is the intended stable PriceLens Gecko ID. AMO must still confirm uniqueness when
the add-on is signed for the first time.

Manifest V3 signing requires a Gecko extension ID, and new Firefox submissions must
declare data collection/transmission permissions.

PriceLens declares:

- `browsingActivity` because the current eBay item URL is transmitted;
- `websiteContent` because visible product title/price/shipping/condition/identity data
  from the current eBay page is transmitted to the PriceLens API after consent.

It does not declare unrelated categories such as authentication, financial/payment,
location, personal communications or search terms.

Official references:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/

## Consent model

Firefox built-in data consent is an install-level permission gate.

PriceLens intentionally retains its existing in-page consent control as well:

```text
install Firefox extension
  -> Firefox built-in data-collection consent
  -> user opens eBay item
  -> PriceLens in-page disclosure
  -> explicit Enable price comparison
  -> extraction + API request allowed
```

The second gate is kept for cross-browser consistency, local revocation and a clear
feature-specific explanation immediately before the first PriceLens comparison.

## Host/content permissions

The Firefox artifact keeps the same narrow scope as Chrome:

- `storage` API permission;
- one build-time PriceLens API host permission;
- content script only on `https://www.ebay.de/itm/*`;
- no `<all_urls>`.

Firefox supports Manifest V3 `host_permissions` and content-script match patterns.
Users can also inspect/revoke host permissions through Firefox permission controls.

Official references:

- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts

## Build and verify

Development/local API:

```bash
npm run build:firefox -w @price-lens/extension
npm run verify-artifact:firefox -w @price-lens/extension
```

Production candidate:

```bash
PRICE_LENS_API_ORIGIN=https://api.example.invalid \
  npm run build:firefox -w @price-lens/extension

PRICE_LENS_API_ORIGIN=https://api.example.invalid \
  npm run verify-artifact:firefox -w @price-lens/extension
```

Output:

```text
apps/extension/dist-firefox/
```

CI builds/verifies and smoke-packages this artifact independently from the Chrome
artifact.

## Manual release workflow

GitHub Actions now provides:

```text
Package Firefox Extension
```

Input:

```text
api_origin=https://<final-price-lens-api>
```

The workflow:

1. installs the committed npm lockfile with `npm ci`;
2. runs the dependency-license gate;
3. requires an HTTPS production origin;
4. builds the Firefox-specific manifest/bundles;
5. runs the artifact verifier;
6. creates `price-lens-firefox.zip`;
7. uploads the candidate as a GitHub Actions artifact.

The workflow does **not** submit or sign the extension with AMO.

## Remaining Firefox release gates

Before calling Firefox distribution production-ready:

- [ ] install the generated artifact in a current Firefox desktop build and perform a
  real eBay page comparison smoke test;
- [ ] confirm the provisional Gecko ID is accepted/unique at AMO;
- [ ] run AMO validation/signing with the actual publisher account;
- [ ] publish/finalize the same privacy-policy URL used for Chrome;
- [ ] confirm the Firefox listing disclosures match the two declared data categories;
- [ ] package against the real production HTTPS PriceLens API origin;
- [ ] decide whether Firefox for Android is in scope.

Android is intentionally not enabled now: the manifest does not contain
`browser_specific_settings.gecko_android`.

## Scope conclusion

No source-level blocker was found for Firefox desktop.

The remaining browser-specific implementation difference is the background manifest,
which is handled at build time. Live Firefox/AMO validation remains a release gate,
not an unresolved architecture issue.
