mock_provider "google" {}

run "state_bucket_has_recovery_and_access_safety" {
  command = plan

  variables {
    project_id = "price-lens-test"
  }

  assert {
    condition     = google_storage_bucket.terraform_state.name == "price-lens-test-price-lens-tfstate"
    error_message = "The default state bucket name must be derived deterministically from the project ID."
  }

  assert {
    condition     = google_storage_bucket.terraform_state.location == "EUROPE-WEST3"
    error_message = "The state bucket must default to the Frankfurt production region."
  }

  assert {
    condition     = google_storage_bucket.terraform_state.uniform_bucket_level_access
    error_message = "Terraform state must use uniform bucket-level access."
  }

  assert {
    condition     = google_storage_bucket.terraform_state.public_access_prevention == "enforced"
    error_message = "Terraform state must enforce Public Access Prevention."
  }

  assert {
    condition     = google_storage_bucket.terraform_state.force_destroy == false
    error_message = "Terraform state bucket destruction must never force-delete state objects."
  }

  assert {
    condition     = google_storage_bucket.terraform_state.versioning[0].enabled
    error_message = "Terraform state bucket Object Versioning must remain enabled."
  }
}

run "explicit_state_bucket_and_eu_location_are_supported" {
  command = plan

  variables {
    project_id        = "price-lens-test"
    state_bucket_name = "price-lens-test-tfstate-custom"
    location          = "EU"
    backend_prefix    = "price-lens/staging"
  }

  assert {
    condition     = google_storage_bucket.terraform_state.name == "price-lens-test-tfstate-custom"
    error_message = "An explicit globally unique state bucket name must override the derived default."
  }

  assert {
    condition     = google_storage_bucket.terraform_state.location == "EU"
    error_message = "The state bootstrap may use the EU multi-region when explicitly selected."
  }

  assert {
    condition     = var.backend_prefix == "price-lens/staging"
    error_message = "The backend prefix must remain explicit and independent from the bucket name."
  }
}
