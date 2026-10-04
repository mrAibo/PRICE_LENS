locals {
  state_bucket_name = length(trimspace(var.state_bucket_name)) > 0 ? trimspace(var.state_bucket_name) : "${var.project_id}-price-lens-tfstate"

  labels = merge(
    {
      app        = "price-lens"
      purpose    = "terraform-state"
      managed-by = "terraform"
    },
    var.labels
  )
}

resource "google_project_service" "storage" {
  project            = var.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "terraform_state" {
  project                     = var.project_id
  name                        = local.state_bucket_name
  location                    = upper(var.location)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.storage]
}
