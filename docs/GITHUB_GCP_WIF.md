# GitHub Actions → Google Cloud WIF

Status: **implementation ready / live GCP bootstrap not yet applied**

Updated: **2026-10-04**

PriceLens uses Workload Identity Federation (WIF) for GitHub Actions rather than a
downloaded Google Cloud service-account JSON key.

The first automated cloud capability is deliberately narrow:

> GitHub Actions may publish an immutable PriceLens API container image to the one
> PriceLens Artifact Registry repository. It may not read Secret Manager values, alter
> Cloud Run, change project IAM, or apply the production Terraform runtime.

This creates a useful deployment primitive without turning the CI identity into a
project administrator.

## Trust boundary

WIF is opt-in:

```hcl
github_wif_image_publisher_enabled = true
```

The provider accepts GitHub OIDC tokens only when all of the following are true:

```text
repository_id       = 1401433983
repository_owner_id = 93589172
repository          = mrAibo/PRICE_LENS
ref                 = refs/heads/main
ref_type            = branch
```

The numeric repository and owner IDs are immutable GitHub identifiers and are checked
in addition to the human-readable repository name.

The OIDC issuer is fixed to:

```text
https://token.actions.githubusercontent.com
```

No GitHub Actions secret contains a Google service-account private key.

## Google Cloud identities

Phase A can create:

```text
Workload Identity Pool
  price-lens-github

OIDC Provider
  price-lens-repo

Service Account
  price-lens-image-publisher@<project>.iam.gserviceaccount.com
```

The federated GitHub identity receives only:

```text
roles/iam.workloadIdentityUser
  on the image-publisher service account

roles/artifactregistry.writer
  on the PriceLens Artifact Registry repository
```

The image-publisher service account receives no Secret Manager accessor/admin role and
no Cloud Run/Compute/project IAM role.

## One-time bootstrap

WIF cannot authenticate the workflow before the WIF resources themselves exist.
Therefore the first Phase-A apply is an operator bootstrap using an already authorized
Google Cloud identity (for example Cloud Shell or a locally authenticated `gcloud`
session).

In `infra/gcp/terraform.tfvars`:

```hcl
project_id = "<your-gcp-project-id>"
deploy_runtime = false

github_wif_image_publisher_enabled = true
```

Then:

```bash
terraform -chdir=infra/gcp init
terraform -chdir=infra/gcp validate
terraform -chdir=infra/gcp test
terraform -chdir=infra/gcp plan
terraform -chdir=infra/gcp apply
```

After apply, read:

```bash
terraform -chdir=infra/gcp output -raw github_wif_provider
terraform -chdir=infra/gcp output -raw github_image_publisher_service_account_email
```

## GitHub repository variables

Configure these as **repository variables**, not secrets:

```text
GCP_PROJECT_ID
GCP_WIF_PROVIDER
GCP_IMAGE_PUBLISHER_SERVICE_ACCOUNT
```

Values:

```text
GCP_PROJECT_ID
  <your project ID>

GCP_WIF_PROVIDER
  projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/price-lens-github/providers/price-lens-repo

GCP_IMAGE_PUBLISHER_SERVICE_ACCOUNT
  price-lens-image-publisher@<PROJECT_ID>.iam.gserviceaccount.com
```

These identifiers are not credentials. The actual Google credential is minted
temporarily from the GitHub OIDC token during each workflow run.

## Publish workflow

Run the manual GitHub Actions workflow:

```text
Publish API Image
```

from `main`.

The job has only:

```yaml
permissions:
  contents: read
  id-token: write
```

It authenticates with `google-github-actions/auth@v3`, configures the Google Cloud
SDK, builds the existing production Dockerfile and pushes:

```text
europe-west3-docker.pkg.dev/<PROJECT_ID>/price-lens/price-lens-api/<...>
```

using the immutable Git commit as the Docker tag:

```text
europe-west3-docker.pkg.dev/<PROJECT_ID>/price-lens/price-lens-api:<40-char-GITHUB_SHA>
```

The workflow verifies that Artifact Registry returns a `sha256` digest and writes the
exact `api_image = "..."` value to the job summary for Terraform Phase B.

The workflow itself cannot deploy that image to Cloud Run.

## Credential-file hygiene

`google-github-actions/auth` can create a temporary `gha-creds-*.json` credential
configuration file for downstream Google tooling.

PriceLens excludes that pattern from both:

- `.gitignore`;
- `.dockerignore`.

This prevents an ephemeral credential file from entering Git or the Docker build
context.

## Why Terraform apply is not delegated yet

The current production Terraform module manages Cloud Run, load balancing, Cloud Armor,
IAM bindings, Secret Manager containers and monitoring.

Giving one GitHub service account enough project-wide permissions to apply all of those
resources would materially widen the compromise blast radius. In particular, broad
Secret Manager administration can include secret-payload access.

The next infrastructure gate is therefore:

1. establish the production project and remote Terraform-state bucket;
2. decide which Terraform operations should remain operator-approved;
3. if CI apply is desired, create a separate narrowly scoped Terraform deploy identity
   rather than expanding the image publisher;
4. keep secret-value insertion out-of-band.

## Live activation checklist

- [ ] production GCP project exists and billing is linked;
- [ ] remote Terraform state bucket exists;
- [ ] Phase A is applied with `github_wif_image_publisher_enabled=true`;
- [ ] WIF provider output copied to GitHub repository variables;
- [ ] image-publisher service-account output copied to GitHub repository variables;
- [ ] first `Publish API Image` run from `main` succeeds;
- [ ] published SHA-tag/digest is used in a reviewed Phase-B Terraform plan.
