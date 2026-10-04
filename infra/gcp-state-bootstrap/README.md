# PriceLens Terraform state bootstrap

This one-time Terraform root creates the GCS bucket used as the remote backend for
`infra/gcp`.

It is intentionally separate because Terraform cannot create the bucket that already has
to exist before its own GCS backend can initialize.

## Security baseline

The state bucket is created with:

- Object Versioning enabled;
- Uniform bucket-level access enabled;
- Public Access Prevention enforced;
- `force_destroy = false`;
- Terraform `prevent_destroy = true`;
- no IAM grant to the GitHub image-publisher service account.

Terraform state can contain infrastructure metadata and should be treated as sensitive.
Bucket access should stay limited to explicitly approved operators or a future dedicated
Terraform deployment identity.

## Bootstrap

Authenticate as an approved operator using Application Default Credentials, for example:

```bash
gcloud auth application-default login
```

Create a local, gitignored `terraform.tfvars`:

```hcl
project_id = "<your-production-gcp-project-id>"
```

Then:

```bash
terraform -chdir=infra/gcp-state-bootstrap init
terraform -chdir=infra/gcp-state-bootstrap validate
terraform -chdir=infra/gcp-state-bootstrap test
terraform -chdir=infra/gcp-state-bootstrap plan
terraform -chdir=infra/gcp-state-bootstrap apply
```

Read the outputs:

```bash
terraform -chdir=infra/gcp-state-bootstrap output -raw state_bucket_name
terraform -chdir=infra/gcp-state-bootstrap output -raw backend_prefix
```

## Initialize the main production Terraform root

For a fresh main state:

```bash
terraform -chdir=infra/gcp init \
  -backend-config="bucket=<STATE_BUCKET>" \
  -backend-config="prefix=price-lens/prod"
```

If `infra/gcp` already has a local state that must be preserved, migrate it explicitly:

```bash
terraform -chdir=infra/gcp init -migrate-state \
  -backend-config="bucket=<STATE_BUCKET>" \
  -backend-config="prefix=price-lens/prod"
```

Do not commit backend credentials or generated state files.

## Recovery

Object Versioning keeps prior generations of Terraform state objects. Recovery remains an
operator action; this module does not automatically delete old generations.

Because the bucket has `prevent_destroy = true`, intentional deletion requires a
reviewed code change before Terraform will permit it.
