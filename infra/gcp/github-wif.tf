resource "google_service_account" "github_image_publisher" {
  count = var.github_wif_image_publisher_enabled ? 1 : 0

  project      = var.project_id
  account_id   = "${var.name_prefix}-image-publisher"
  display_name = "PriceLens GitHub image publisher"
  description  = "Keyless GitHub Actions identity for pushing immutable PriceLens API images only."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool" "github" {
  count = var.github_wif_image_publisher_enabled ? 1 : 0

  project                   = var.project_id
  workload_identity_pool_id = var.github_wif_pool_id
  display_name              = "PriceLens GitHub"
  description               = "GitHub Actions identities trusted only for the PriceLens repository."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count = var.github_wif_image_publisher_enabled ? 1 : 0

  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = var.github_wif_provider_id
  display_name                       = "PriceLens repository"
  description                        = "GitHub OIDC provider restricted to the immutable PriceLens repository identity and main branch."

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.repository_owner_id == '${var.github_repository_owner_id}'",
    "assertion.repository == '${var.github_repository}'",
    "assertion.ref == 'refs/heads/main'",
    "assertion.ref_type == 'branch'"
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_image_publisher_wif" {
  count = var.github_wif_image_publisher_enabled ? 1 : 0

  service_account_id = google_service_account.github_image_publisher[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repository}"
}

resource "google_artifact_registry_repository_iam_member" "github_image_publisher" {
  count = var.github_wif_image_publisher_enabled ? 1 : 0

  project    = var.project_id
  location   = google_artifact_registry_repository.api.location
  repository = google_artifact_registry_repository.api.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.github_image_publisher[0].email}"
}
