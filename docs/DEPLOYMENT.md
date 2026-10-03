# PriceLens Deployment Baseline

Status: **Cloud Run container + validated Terraform IaC baseline implemented / public resources not yet provisioned**

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

## Terraform infrastructure baseline

The production topology now has a validated Terraform definition in
[`infra/gcp/`](../infra/gcp/README.md).

The IaC is deliberately split into two phases:

1. **bootstrap** (`deploy_runtime=false`) enables required APIs and creates Artifact
   Registry, the dedicated runtime service account, and empty Secret Manager containers;
2. **runtime** (`deploy_runtime=true`) creates Cloud Run, the serverless NEG, Cloud
   Armor, the global external managed HTTP(S) load balancer, managed TLS certificate
   and HTTP-to-HTTPS redirect after a real image and API hostname exist.

CI pins Terraform 1.16.4 and Google provider 8.2.0 and runs:

```bash
terraform fmt -check -diff -recursive infra/gcp
terraform -chdir=infra/gcp init -backend=false -input=false
terraform -chdir=infra/gcp validate
```

The load balancer is expressed with native `google_compute_*` resources rather than
the `lb-http` module. The current module release constrains the Google provider to an
older major version, while PriceLens validates against the current 8.2.0 provider.

Terraform creates Secret Manager **containers and IAM only**. Credential values are
added out-of-band. Cloud Run receives only explicitly pinned numeric Secret Manager
versions; `latest` is rejected by input validation so rotations are deliberate.

The initial Cloud Armor comparison throttle remains in preview until measured traffic
and provider quotas justify enforcement. A separate edge `Content-Length` rule rejects
declared comparison bodies over 64 KiB; the Node API keeps its independent body-size
guard for requests without a usable length header.

Terraform does not manage the authoritative DNS zone. It outputs the global load
balancer address and required A record so DNS ownership is not guessed by the project.

The runtime Terraform also defines a privacy-minimized operations layer: a dedicated
30-day-default Cloud Logging bucket/sink for PriceLens structured diagnostics, an HTTPS
`/ready` uptime check, and Cloud Monitoring alert policies for availability, Cloud Run
5xx responses and successful-request P95 latency. Alert policies are created disabled
until DNS/TLS is verified, and notification-channel contact data is deliberately not
managed by this repository.


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
- retention policy for operational logs and incident alert ownership;
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

- media type, the bounded request body and the full inbound listing schema are validated before a comparison slot is reserved;
- malformed/unsupported requests therefore cannot consume the enrichment/provider comparison budget;
- when the comparison limit is full, otherwise-valid `POST /v1/compare` requests are rejected with HTTP `503` plus `Retry-After: 1`;
- configured price providers are wrapped independently and reject work when their own active-call limit is reached;
- no unbounded in-process wait queue is introduced;
- existing single-flight/coalescing still deduplicates identical in-flight provider work before these limits become relevant;
- provider concurrency failures remain isolated inside `providerStatus` rather than crashing unrelated providers.

These defaults are process-level safeguards, not a substitute for edge rate limiting or provider-specific commercial quota controls.

## CORS and extension requests

PriceLens comparison requests originate from the extension service worker, whose exact
API host permission is generated at build time.

`POST /v1/compare` requires `Content-Type: application/json` (optional charset
parameters are allowed). Missing or CORS-safelisted form/text media types are rejected
with HTTP `415` before enrichment/provider work starts. The API intentionally does not
emit permissive CORS response headers or an OPTIONS preflight success path.

This is an abuse boundary, not client authentication: non-browser HTTP clients can still
send `application/json`, so Cloud Armor and application/provider concurrency controls
remain necessary.

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

Infrastructure definitions are now versioned and schema-validated, but no live cloud
resources are claimed as provisioned.

- select/create the production GCP project, billing and remote Terraform-state bucket;
- apply Terraform Phase A to create Artifact Registry, service account and Secret Manager containers;
- add approved provider secret **versions** out-of-band and record rotation ownership/cadence;
- build/push an immutable PriceLens API image;
- choose the final API hostname and apply Terraform Phase B;
- publish the returned DNS A record and verify managed TLS;
- observe Cloud Armor preview logs and tune/enable enforcement from measured traffic/provider quotas;
- confirm operational log retention/access ownership, attach approved Monitoring notification channels, then enable/tune alerts;
- run the Chrome package workflow against the verified final HTTPS API origin;
- perform final privacy/store review and provider-attribution/store-submission readiness checks.
