variable "project_id" {
  description = "Google Cloud project that will own the PriceLens Terraform-state bucket."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID."
  }
}

variable "state_bucket_name" {
  description = "Optional globally unique GCS bucket name. Leave empty to derive <project_id>-price-lens-tfstate."
  type        = string
  default     = ""

  validation {
    condition = (
      length(trimspace(var.state_bucket_name)) == 0 ||
      can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", trimspace(var.state_bucket_name)))
    )
    error_message = "state_bucket_name must be empty or a valid 3-63 character GCS bucket name."
  }
}

variable "location" {
  description = "GCS bucket location for PriceLens Terraform state."
  type        = string
  default     = "EUROPE-WEST3"

  validation {
    condition     = contains(["EUROPE-WEST3", "EU"], upper(var.location))
    error_message = "location must be EUROPE-WEST3 or EU for the PriceLens production state baseline."
  }
}

variable "backend_prefix" {
  description = "Object prefix used by the main infra/gcp GCS backend."
  type        = string
  default     = "price-lens/prod"

  validation {
    condition = (
      length(trimspace(var.backend_prefix)) > 0 &&
      !startswith(trimspace(var.backend_prefix), "/") &&
      !endswith(trimspace(var.backend_prefix), "/") &&
      !strcontains(trimspace(var.backend_prefix), "..")
    )
    error_message = "backend_prefix must be a non-empty relative object prefix without leading/trailing slash or '..'."
  }
}

variable "labels" {
  description = "Additional labels applied to the state bucket."
  type        = map(string)
  default     = {}
}
