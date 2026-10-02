variable "project_id" {
  description = "Google Cloud project ID that owns the PriceLens production resources."
  type        = string

  validation {
    condition     = length(trimspace(var.project_id)) > 0
    error_message = "project_id must not be empty."
  }
}

variable "region" {
  description = "Google Cloud region for Cloud Run and Artifact Registry."
  type        = string
  default     = "europe-west3"
}

variable "name_prefix" {
  description = "Stable prefix for PriceLens resources."
  type        = string
  default     = "price-lens"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,40}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be lowercase, 3-42 characters, and contain only letters, digits and hyphens."
  }
}

variable "deploy_runtime" {
  description = "Create the Cloud Run service, Cloud Armor policy and HTTPS load balancer. Leave false for phase-A bootstrap."
  type        = bool
  default     = false
}

variable "api_image" {
  description = "Immutable PriceLens API image reference. Required when deploy_runtime=true; prefer a digest or git-SHA tag."
  type        = string
  default     = ""
}

variable "api_domain" {
  description = "Production API DNS name without scheme or path, for example api.pricelens.example. Required when deploy_runtime=true."
  type        = string
  default     = ""

  validation {
    condition = (
      var.api_domain == "" ||
      (
        !strcontains(var.api_domain, "://") &&
        !strcontains(var.api_domain, "/") &&
        can(regex("^[A-Za-z0-9.-]+$", var.api_domain))
      )
    )
    error_message = "api_domain must be a hostname only, without scheme, path, query or fragment."
  }
}

variable "artifact_repository_id" {
  description = "Artifact Registry repository for PriceLens container images."
  type        = string
  default     = "price-lens"
}

variable "deletion_protection" {
  description = "Protect the Cloud Run service from accidental Terraform deletion."
  type        = bool
  default     = true
}

variable "disable_default_run_url" {
  description = "Disable the default run.app URL. This Cloud Run feature is Preview; ingress restriction remains enforced independently."
  type        = bool
  default     = false
}

variable "cloud_run_concurrency" {
  description = "Maximum concurrent requests per Cloud Run instance."
  type        = number
  default     = 16

  validation {
    condition     = var.cloud_run_concurrency >= 1 && var.cloud_run_concurrency <= 1000
    error_message = "cloud_run_concurrency must be between 1 and 1000."
  }
}

variable "min_instances" {
  description = "Minimum Cloud Run instances."
  type        = number
  default     = 0

  validation {
    condition     = var.min_instances >= 0
    error_message = "min_instances must be zero or greater."
  }
}

variable "max_instances" {
  description = "Maximum Cloud Run instances."
  type        = number
  default     = 3

  validation {
    condition     = var.max_instances >= 1
    error_message = "max_instances must be at least 1."
  }
}

variable "cpu" {
  description = "Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Cloud Run memory limit."
  type        = string
  default     = "512Mi"
}

variable "max_concurrent_comparisons" {
  description = "Application-level comparison concurrency limit."
  type        = number
  default     = 16
}

variable "provider_max_concurrency" {
  description = "Application-level per-provider concurrency limit."
  type        = number
  default     = 4
}

variable "metrics_every" {
  description = "Emit one cumulative diagnostics metrics snapshot after this many diagnostic events."
  type        = number
  default     = 100
}

variable "provider_secret_ids" {
  description = "Secret Manager secret IDs created for backend-only provider credentials. Values are names, never secret contents."
  type        = map(string)
  default = {
    EBAY_CLIENT_ID                     = "price-lens-ebay-client-id"
    EBAY_CLIENT_SECRET                 = "price-lens-ebay-client-secret"
    AMAZON_CREATORS_CREDENTIAL_ID      = "price-lens-amazon-creators-credential-id"
    AMAZON_CREATORS_CREDENTIAL_SECRET  = "price-lens-amazon-creators-credential-secret"
  }
}

variable "secret_versions" {
  description = "Pinned Secret Manager version numbers by environment variable. Values must be version numbers only; never put secret contents here."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for version in values(var.secret_versions) :
      can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "secret_versions values must be explicit positive numeric Secret Manager versions, not 'latest' or secret material."
  }
}

variable "ebay_browse_enabled" {
  description = "Enable eBay Browse enrichment after live credentials/access are approved."
  type        = bool
  default     = false
}

variable "ebay_environment" {
  description = "eBay API environment."
  type        = string
  default     = "sandbox"

  validation {
    condition     = contains(["sandbox", "production"], var.ebay_environment)
    error_message = "ebay_environment must be sandbox or production."
  }
}

variable "ebay_marketplace_id" {
  description = "eBay marketplace ID."
  type        = string
  default     = "EBAY_DE"
}

variable "ebay_browse_cache_ttl_ms" {
  description = "eBay product-data cache TTL. Keep 0 until approved freshness rules are known."
  type        = number
  default     = 0

  validation {
    condition     = var.ebay_browse_cache_ttl_ms >= 0
    error_message = "ebay_browse_cache_ttl_ms must be zero or greater."
  }
}

variable "amazon_creators_enabled" {
  description = "Enable Amazon Creators provider after approved live access exists."
  type        = bool
  default     = false
}

variable "amazon_partner_tag" {
  description = "Amazon Associates partner tag. Required when amazon_creators_enabled=true."
  type        = string
  default     = ""
}

variable "amazon_marketplace" {
  description = "Amazon marketplace hostname."
  type        = string
  default     = "www.amazon.de"
}

variable "amazon_credential_version" {
  description = "Amazon Creators credential protocol version."
  type        = string
  default     = "3.2"
}

variable "amazon_creators_cache_ttl_ms" {
  description = "Amazon product-data cache TTL. Keep 0 until approved freshness rules are known."
  type        = number
  default     = 0

  validation {
    condition     = var.amazon_creators_cache_ttl_ms >= 0
    error_message = "amazon_creators_cache_ttl_ms must be zero or greater."
  }
}

variable "cloud_armor_rate_limit_preview" {
  description = "Keep the initial Cloud Armor throttle rule in preview until real traffic is measured."
  type        = bool
  default     = true
}

variable "cloud_armor_requests_per_interval" {
  description = "Initial per-IP comparison-request budget for Cloud Armor."
  type        = number
  default     = 120

  validation {
    condition     = var.cloud_armor_requests_per_interval >= 1
    error_message = "cloud_armor_requests_per_interval must be at least 1."
  }
}

variable "cloud_armor_interval_sec" {
  description = "Cloud Armor rate-limit interval in seconds."
  type        = number
  default     = 60

  validation {
    condition     = contains([10, 30, 60, 120, 300, 600, 900, 1800, 3600], var.cloud_armor_interval_sec)
    error_message = "cloud_armor_interval_sec must use a Cloud Armor-supported interval."
  }
}

variable "edge_max_body_bytes" {
  description = "Content-Length guard at the edge for POST /v1/compare. The application independently enforces its own body limit."
  type        = number
  default     = 65536

  validation {
    condition     = var.edge_max_body_bytes >= 1024
    error_message = "edge_max_body_bytes must be at least 1024."
  }
}

variable "lb_log_sample_rate" {
  description = "External load-balancer backend log sample rate."
  type        = number
  default     = 1

  validation {
    condition     = var.lb_log_sample_rate >= 0 && var.lb_log_sample_rate <= 1
    error_message = "lb_log_sample_rate must be between 0 and 1."
  }
}

variable "labels" {
  description = "Additional labels applied where supported."
  type        = map(string)
  default     = {}
}
