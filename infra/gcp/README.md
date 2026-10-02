# PriceLens Google Cloud Terraform baseline

This directory provisions the selected PriceLens production topology without putting
provider credential values into Git or Terraform variables.

Target topology:

```text
Chrome extension
      |
      v
https://<api-domain>
      |
Global external Application Load Balancer
      |
Cloud Armor
      |
Serverless NEG
      |
Cloud Run (europe-west3)
      |
approved provider APIs
```

The Cloud Run service uses `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, so normal
Internet clients cannot bypass the load balancer through the default Cloud Run route.
The load balancer terminates HTTPS and applies Cloud Armor before requests reach the
application.

## Why deployment is split into two phases

The repository cannot invent:

- a Google Cloud project;
- a production domain;
- provider credentials;
- Secret Manager versions;
- a pushed container image.

Terraform therefore supports a safe bootstrap phase before any of those runtime inputs
are available.

### Phase A — bootstrap

Leave:

```hcl
deploy_runtime = false
```

This creates:

- required Google Cloud API enablement;
- the Docker Artifact Registry repository;
- the dedicated PriceLens API service account;
- empty Secret Manager secret containers;
- IAM allowing only the runtime service account to read those provider secrets.

Run:

```bash
cd infra/gcp
cp terraform.tfvars.example terraform.tfvars
# edit project_id
terraform init
terraform validate
terraform plan
terraform apply
```

No provider credential value is accepted by this module.

## Add provider secret versions out-of-band

After Phase A, add values directly to Secret Manager. Example pattern:

```bash
printf '%s' "$EBAY_CLIENT_ID_VALUE" |
  gcloud secrets versions add price-lens-ebay-client-id --data-file=-

printf '%s' "$EBAY_CLIENT_SECRET_VALUE" |
  gcloud secrets versions add price-lens-ebay-client-secret --data-file=-
```

Repeat only for providers that have approved access.

Do not put these values in:

- `terraform.tfvars`;
- GitHub workflow inputs;
- Terraform variables;
- shell history.

The Terraform input `secret_versions` contains only explicit numeric version numbers,
for example `"1"`. `latest` is intentionally rejected so a credential rotation
produces a deliberate Cloud Run revision.

## Build and push the API image

After Phase A has created Artifact Registry:

```bash
PROJECT_ID=<your-project>
REGION=europe-west3
REPOSITORY=price-lens
GIT_SHA="$(git rev-parse HEAD)"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/price-lens-api:$GIT_SHA"

gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build --tag "$IMAGE" .
docker push "$IMAGE"
```

Use an immutable digest or Git-SHA tag for `api_image`; do not deploy `latest`.

## Phase B — runtime and HTTPS edge

Set at minimum:

```hcl
deploy_runtime = true
api_domain     = "api.example.com"
api_image      = "europe-west3-docker.pkg.dev/PROJECT/price-lens/price-lens-api:GIT_SHA"
```

Provider switches remain false until access is approved.

If a provider is enabled, pin its Secret Manager versions:

```hcl
secret_versions = {
  EBAY_CLIENT_ID     = "1"
  EBAY_CLIENT_SECRET = "1"
}

ebay_browse_enabled = true
ebay_environment    = "sandbox"
```

Then:

```bash
terraform plan
terraform apply
terraform output required_dns_a_record
```

Publish the returned A record in the authoritative DNS zone. Google-managed TLS
certificate activation depends on the hostname resolving to the load-balancer IP.

After DNS/TLS is active:

```bash
curl --fail "https://<api-domain>/ready"
curl --fail "https://<api-domain>/health"
```

The default `run.app` URL may optionally be disabled later with
`disable_default_run_url=true`. The service already restricts ingress to internal and
Cloud Load Balancing traffic independently; default-URL disabling is an additional
Preview control, not the primary boundary.

## Cloud Armor baseline

Two targeted rules are created before the default allow rule:

1. requests declaring `Content-Length > 65536` for `POST /v1/compare` are rejected
   at the edge; the Node API independently retains its own body-size validation;
2. comparison requests are throttled per client IP.

The rate-limit rule defaults to:

```hcl
cloud_armor_requests_per_interval = 120
cloud_armor_interval_sec          = 60
cloud_armor_rate_limit_preview    = true
```

Preview is intentional. Inspect real traffic and provider quotas before setting it to
`false`. Application/provider concurrency limits remain independent safeguards.

Requests without `Content-Length` are still bounded by the application body reader;
the edge rule is not treated as the only body-size control.

## Secret rotation

For a credential rotation:

1. add a new Secret Manager version out-of-band;
2. update only the numeric version in `secret_versions`;
3. `terraform plan && terraform apply`;
4. validate the new Cloud Run revision;
5. disable or destroy the old secret version according to the provider/security policy.

Do not use `latest` for environment-variable secrets.

## Terraform state

Production state must use an approved remote backend with access control and versioning.
A GCS backend template is provided as `backend.tf.example`.

Bootstrap the state bucket separately, then copy/rename the template to `backend.tf`
and run:

```bash
terraform init -migrate-state
```

Do not commit `backend.tf`, `terraform.tfvars`, local state or plan files.

## Outputs

Useful outputs include:

- `artifact_repository_base`;
- `api_service_account_email`;
- `provider_secret_ids`;
- `load_balancer_ip`;
- `required_dns_a_record`;
- `api_origin`.

The secret output contains secret **names only**, never credential contents.

## What this baseline intentionally does not do

It does not:

- create a Google Cloud organization/project/billing account;
- manage the authoritative DNS zone;
- create secret values;
- enable Idealo/Geizhals/Amazon/eBay access without approval;
- turn on provider product caches before provider-specific freshness rules are known;
- guess the final production hostname;
- submit the Chrome extension to the Web Store.

Those remain explicit external gates in Issues #12, #13, #14 and #33.
