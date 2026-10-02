# PriceLens Deployment Baseline

Status: **Cloud Run container baseline implemented / public deployment not yet approved**

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

## Backend process and container

Local development keeps:

```text
HOST=127.0.0.1
PORT=8787
```

The production container sets:

```text
HOST=0.0.0.0
PORT=8080
NODE_ENV=production
```

This matches the Cloud Run container contract: the ingress container listens on
`0.0.0.0` and accepts the platform-supplied `PORT`.

Build and run locally:

```bash
docker build -t price-lens-api .
docker run --rm -p 8080:8080 price-lens-api
curl --fail http://127.0.0.1:8080/ready
curl --fail http://127.0.0.1:8080/health
```

The image is multi-stage, runs as the unprivileged `node` user, and contains only the
API plus runtime dependencies. CI builds and starts this exact image and checks both
health endpoints.

The process handles `SIGTERM`/ `SIGINT` by stopping new connections, closing idle
keep-alives and allowing active requests up to 9 seconds to complete before a forced
shutdown. This is intentionally below Cloud Run's 10-second termination window.

Provider credentials remain process/server secrets.

## Selected production platform

The initial production target is **Google Cloud Run in `europe-west3` (Frankfurt)**.

Why this baseline fits PriceLens:

- the API is stateless and request-driven;
- scale-to-zero keeps the pre-launch cost surface small;
- Cloud Run supplies the runtime `PORT` and managed service lifecycle;
- Secret Manager can inject backend-only provider credentials;
- an external Application Load Balancer with a serverless NEG can front the service;
- Cloud Armor can apply rate limiting before requests consume provider quota;
- Cloud Run ingress can be restricted to `internal-and-cloud-load-balancing`, preventing
  normal Internet clients from bypassing the load balancer through the default service URL.

The selected public topology is:

```text
Chrome extension
      |
      v
HTTPS custom API hostname
      |
External Application Load Balancer
      |
Cloud Armor
      |
serverless NEG
      |
Cloud Run: price-lens-api
      |
approved provider APIs
```

The application container remains portable; Cloud Run-specific controls stay outside the
Node.js runtime.

### Cloud Run service baseline

Example variables:

```bash
PROJECT_ID=<gcp-project>
REGION=europe-west3
REPOSITORY=price-lens
SERVICE=price-lens-api
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:<git-sha>"
```

Build/push with your approved Artifact Registry / Cloud Build path, then deploy:

```bash
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$IMAGE" \
  --port=8080 \
  --execution-environment=gen2 \
  --allow-unauthenticated \
  --ingress=internal-and-cloud-load-balancing \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=16 \
  --min=0 \
  --set-env-vars="PRICE_LENS_MAX_CONCURRENT_COMPARISONS=16,PRICE_LENS_PROVIDER_MAX_CONCURRENCY=4,PRICE_LENS_JSON_LOGS=1"
```

Use Secret Manager bindings rather than literal command-line values for provider
credentials. Provider switches remain disabled until their access issues are approved.

Configure an HTTP startup probe against:

```text
/ready
```

and an HTTP liveness probe against:

```text
/health
```

Neither endpoint performs live provider calls, so a transient third-party outage does
not cause a healthy PriceLens instance to restart.

### Load balancer and abuse protection

Public traffic must enter through an external Application Load Balancer backed by a
serverless NEG. Keep Cloud Run ingress at `internal-and-cloud-load-balancing` so the
`run.app` endpoint cannot be used to bypass the edge policy.

Attach a Cloud Armor security policy to the load-balancer backend. Start rate-limit
thresholds in preview/observed mode and tune them from measured traffic before
enforcement. A production rule must return `429` when the chosen per-client budget is
exceeded.

The application-level comparison/provider concurrency limits remain a second independent
safety layer; Cloud Armor is not a replacement for those limits, and those limits are
not a replacement for the edge policy.

## Public exposure gate

A public PriceLens API deployment is **not yet approved** merely because an HTTPS origin
can now be built into the extension.

Before Internet exposure, the deployment must add and validate:

- TLS at the ingress/reverse proxy;
- request/body limits at the edge as well as in the app;
- abuse/rate limiting that protects provider quotas;
- HTTP startup/readiness via `/ready` and liveness via `/health`;
- structured secret injection/rotation;
- retention policy for operational logs;
- privacy/store disclosures if public distribution proceeds.

An API token embedded in a browser extension must not be treated as a secret or as
sufficient abuse protection.

## Concurrency protection

The API process applies two independent hard limits in the production entry point:

```text
PRICE_LENS_MAX_CONCURRENT_COMPARISONS=16
PRICE_LENS_PROVIDER_MAX_CONCURRENCY=4
```

Behavior:

- when the comparison limit is full, new `POST /v1/compare` requests are drained and rejected immediately with HTTP `503` plus `Retry-After: 1`;
- configured price providers are wrapped independently and reject work when their own active-call limit is reached;
- no unbounded in-process wait queue is introduced;
- existing single-flight/coalescing still deduplicates identical in-flight provider work before these limits become relevant;
- provider concurrency failures remain isolated inside `providerStatus` rather than crashing unrelated providers.

These defaults are process-level safeguards, not a substitute for edge rate limiting or provider-specific commercial quota controls.

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

## Chrome package workflow

Chrome packaging is automated without embedding a runtime-configurable endpoint.

For every normal CI run, the production-origin smoke build is zipped and the archive
layout is checked so that `manifest.json`, `background.js`, and `content.js` are at
the ZIP root.

For an actual candidate package, run the GitHub Actions workflow:

```text
Package Chrome Extension
```

It requires one manual input:

```text
api_origin=https://<deployed-price-lens-api>
```

The workflow:

1. requires the release input to use HTTPS;
2. builds the Manifest V3 extension with that exact origin;
3. runs the generated-artifact verifier;
4. creates `price-lens-chrome.zip` with `manifest.json` at the archive root;
5. validates the ZIP layout;
6. uploads the ZIP as a short-lived GitHub Actions artifact.

The workflow packages a candidate artifact only. Store submission remains blocked until
the deployed API origin, privacy/store disclosures, provider access and operational
deployment gates are approved.

## Remaining work

- create the production GCP project/Artifact Registry/Cloud Run service;
- create the external Application Load Balancer + serverless NEG;
- attach and tune Cloud Armor rate limiting from observed traffic before enforcement;
- create Secret Manager entries and document rotation owners/cadence;
- bind the final custom HTTPS API hostname;
- run the package workflow against that final production API origin;
- perform privacy/store review and provider-attribution/store-submission readiness checks.
