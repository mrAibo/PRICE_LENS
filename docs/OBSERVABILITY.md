# PriceLens Observability

Status: **privacy-minimized diagnostics + process-local aggregation implemented**

Updated: **2026-10-02**

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
- enrichment fallback count;
- per-provider observation and state counts;
- latency sample count, average and maximum;
- review-candidate count.

Snapshots intentionally omit request ids, product identity, item/title/URL and user data.

Counters reset when the Node process restarts. PriceLens does not expose a public metrics
HTTP endpoint at this stage. Durable retention, dashboards and alerts belong to the
future deployment logging/metrics backend and require an explicit retention/access
policy.

## Failure isolation

Diagnostics are non-critical. A throwing/broken diagnostic sink is swallowed and must
never alter the HTTP response path.

## Next steps

Continue extending aggregate signals rather than richer per-product logs:

- cache hit/miss counters
- rate-limit-specific counters
- latency histograms/percentiles in the external metrics backend
- match-decision counts
- unsupported-extraction counts
- durable retention and alerting in the chosen deployment platform

Any persistent telemetry requires a separate privacy review before collection.
