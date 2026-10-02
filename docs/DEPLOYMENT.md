# PriceLens Deployment Baseline

Status: **configuration implemented / public deployment not yet approved**

Updated: **2026-10-02**

PriceLens has two separately deployable surfaces:

1. the Manifest V3 browser extension;
2. the PriceLens API/backend.

The extension never receives eBay, Amazon, Idealo or Geizhals provider credentials.

## Local development

The default extension build targets:

```text
http://127.0.0.1:8787
```

Build:

```bash
npm run build -w @price-lens/extension
```

The generated `dist/manifest.json` receives exactly:

```json
{
  "host_permissions": [
    "http://127.0.0.1:8787/*"
  ]
}
```

Plain HTTP is accepted only for loopback hosts:

- `127.0.0.1`
- `localhost`
- `[::1]`

## Production extension build

Set one build-time origin:

```bash
PRICE_LENS_API_ORIGIN=https://api.example.invalid \
  npm run build -w @price-lens/extension
```

The origin validator requires:

- an absolute URL;
- HTTPS for any non-loopback host;
- no path;
- no query string;
- no fragment;
- no embedded username/password.

The generated manifest gets only the corresponding host permission:

```text
https://api.example.invalid/*
```

PriceLens does not request `<all_urls>` and does not support a runtime arbitrary API
URL supplied by a web page or content-script message.

## Why this is build-time

A runtime-selectable arbitrary origin would expand the extension trust boundary and
could turn the background service worker into a generic cross-origin request bridge.

The API origin is therefore fixed during packaging together with the matching manifest
permission.

## Backend process

The API process currently uses:

```text
HOST=127.0.0.1
PORT=8787
```

Provider credentials remain process/server secrets.

For a future production deployment, the Node process should remain behind a TLS
terminating reverse proxy or managed ingress. The backend application itself should not
be used as the Internet-facing TLS terminator.

## Public exposure gate

A public PriceLens API deployment is **not yet approved** merely because an HTTPS origin
can now be built into the extension.

Before Internet exposure, the deployment must add and validate:

- TLS at the ingress/reverse proxy;
- request/body limits at the edge as well as in the app;
- abuse/rate limiting that protects provider quotas;
- bounded backend/provider concurrency;
- health/readiness behavior appropriate to the hosting platform;
- structured secret injection/rotation;
- retention policy for operational logs;
- privacy/store disclosures if public distribution proceeds.

An API token embedded in a browser extension must not be treated as a secret or as
sufficient abuse protection.

## CORS and extension requests

PriceLens comparison requests originate from the extension service worker, whose exact
API host permission is generated at build time.

Do not broaden the API into an arbitrary browser-facing CORS service unless a separate
use case and security review require it.

## Release invariant

A release artifact is valid only when:

1. the bundled API origin;
2. `dist/manifest.json` host permission; and
3. the intended deployed API origin

all refer to the same origin.

The build script derives the first two from the same validated value to prevent drift.

CI now verifies the generated artifact twice:

1. the default loopback development build;
2. a representative HTTPS production build using `https://api.pricelens.invalid`.

The verifier checks:

- Manifest V3;
- exactly one API host permission matching the selected build origin;
- no `<all_urls>`;
- content-script scope remains `https://www.ebay.de/itm/*`;
- required `background.js` and `content.js` artifacts exist;
- the expected API origin is present in the background bundle;
- known backend credential environment-key names are absent from extension JavaScript.

Local verification after a build:

```bash
npm run verify-artifact -w @price-lens/extension
```

## Remaining work

- choose the production hosting/ingress platform;
- implement/verify edge abuse protection;
- implement bounded server/provider concurrency;
- define secret-management/rotation;
- add Chrome release packaging;
- perform privacy/store review.
