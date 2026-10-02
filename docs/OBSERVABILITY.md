# PriceLens Observability

Status: **initial privacy-minimized diagnostics**

Updated: **2026-10-02**

PriceLens keeps diagnostics intentionally narrow. Product browsing data is not required
for the first operational signals.

## Enable locally

```text
PRICE_LENS_JSON_LOGS=1
```

When enabled, the API writes one JSON object per line to stdout for comparison
completion and rejected requests.

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

## Failure isolation

Diagnostics are non-critical. A throwing/broken diagnostic sink is swallowed and must
never alter the HTTP response path.

## Next steps

After live-provider validation, extend this layer with aggregate counters rather than
richer per-product logs:

- cache hit/miss counters
- rate-limit counters
- provider timeout/error counters
- latency histograms
- match-decision counts
- unsupported-extraction counts

Any persistent telemetry requires a separate privacy review before collection.
