# PriceLens Observability

Status: **privacy-minimized diagnostics + durable GCP retention/alerting IaC implemented; live apply pending**

Updated: **2026-10-03**

PriceLens keeps diagnostics intentionally narrow. Product browsing data is not required
for the first operational signals.

## Enable locally

```text
PRICE_LENS_JSON_LOGS=1
PRICE_LENS_METRICS_EVERY=100
```

When enabled, the API writes JSON objects per line to stdout for comparison
completion and rejected requests, plus a cumulative `metrics_snapshot` after every
`PRICE_LENS_METRICS_EVERY` diagnostic events.

## Correlation

Every HTTP request receives an `x-price-lens-request-id` response header.
Successful comparison responses carry the same value in
`ComparisonResult.requestId`.

This id is the join key for diagnostics and user-visible error reports.

## Logged fields

Successful comparison diagnostics may contain:

- timestamp
- service name
- request id
- route
- HTTP status
- total request duration
- offer count
- warning count
- structured warning-category counts (`extraction_warning`, `ebay_shipping_unknown`, `enrichment_fallback`)
- accepted match-method counts (`gtin`, `mpn`, `model`, `fuzzy`, etc.)
- review-only match-method counts
- whether optional eBay enrichment fell back
- provider id
- provider state
- provider latency when available
- review-candidate count

Rejected-request diagnostics contain only:

- timestamp
- service name
- request id
- route
- HTTP status
- controlled rejection reason
- duration

## Deliberately not logged

The built-in diagnostic events do **not** contain:

- eBay item id
- product title
- listing URL
- provider product URL
- query/search terms
- browser cookies
- request headers
- Authorization headers
- OAuth tokens
- client ids/secrets
- Amazon credential material
- eBay Cert ID / client secret
- provider raw error bodies

Provider status messages are also omitted from diagnostics so a future provider cannot
accidentally leak raw response text into logs.

## Aggregate metrics snapshots

The process-local aggregator emits cumulative counters without product/listing fields.

A `metrics_snapshot` contains:

- sample count;
- completed and rejected request counts;
- rejection counts by controlled reason;
- offer and warning totals;
- warning totals by controlled category;
- accepted/review match-decision counts by method;
- enrichment fallback count;
- per-provider observation and state counts;
- latency sample count, average and maximum;
- review-candidate count.

Snapshots intentionally omit request ids, product identity, item/title/URL and user data.

Counters reset when the Node process restarts. PriceLens does not expose a public metrics
HTTP endpoint.

For the selected GCP production target, Terraform now defines a durable operational
baseline:

- a dedicated Cloud Logging bucket with 30-day default retention;
- a sink that routes only Cloud Run JSON entries carrying
  `jsonPayload.service="price-lens-api"`;
- an HTTPS `/ready` uptime check;
- Cloud Monitoring alert policies for uptime failure, Cloud Run 5xx volume and
  successful-request P95 latency.

The alert policies are created disabled by default until the production DNS name and
managed TLS certificate are verified. Notification channels are supplied only as
existing Cloud Monitoring resource names and are not created from contact details in
this repository.

This infrastructure is versioned but has not yet been applied to a production GCP
project. Thresholds and retention must still be reviewed against live traffic,
provider quotas and the final operational/privacy policy.

## Failure isolation

Diagnostics are non-critical. A throwing/broken diagnostic sink is swallowed and must
never alter the HTTP response path.

## Next steps

Continue extending aggregate signals rather than richer per-product logs:

- cache hit/miss counters where provider policy permits persistent caches;
- provider/rate-limit-specific counters;
- unsupported-extraction counts;
- production dashboards after the first live deployment;
- threshold tuning from real traffic rather than guessed request rates.

Before enabling persistent production collection, confirm the final log-retention,
access-control and privacy/store disclosures.
