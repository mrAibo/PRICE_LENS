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
    condition     = can(regex("^[a-z][a-z0-9-]{1,24}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be lowercase, 3-26 characters, and contain only letters, digits and hyphens so the derived service-account ID stays valid."
  }
}

variable "deploy_runtime" {
  description = "Create the Cloud Run service, Cloud Armor policy and HTTPS load balancer. Leave false for phase-A bootstrap."
  type        = bool
  default     = false
}

variable "api_image" {
  description = "Immutable PriceLens API image reference. Required when deploy_runtime=true; use an Artifact Registry digest or git-SHA tag."
  type        = string
  default     = ""

  validation {
    condition = (
      var.api_image == "" ||
      (
        trimspace(var.api_image) == var.api_image &&
        !endswith(lower(var.api_image), ":latest") &&
        !strcontains(lower(var.api_image), "replace-with") &&
        !strcontains(lower(var.api_image), "placeholder")
      )
    )
    error_message = "api_image must not use :latest, surrounding whitespace, or placeholder text."
  }
}

variable "api_domain" {
  description = "Production API DNS name without scheme or path. Required when deploy_runtime=true and must be a real public hostname, not an example/test placeholder."
  type        = string
  default     = ""

  validation {
    condition = (
      var.api_domain == "" ||
      (
        trimspace(var.api_domain) == var.api_domain &&
        can(regex("^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$", var.api_domain)) &&
        !contains(["example.com", "example.net", "example.org", "localhost"], lower(var.api_domain)) &&
        !endswith(lower(var.api_domain), ".invalid") &&
        !endswith(lower(var.api_domain), ".test") &&
        !endswith(lower(var.api_domain), ".example") &&
        !endswith(lower(var.api_domain), ".localhost") &&
        !endswith(lower(var.api_domain), ".example.com") &&
        !endswith(lower(var.api_domain), ".example.net") &&
        !endswith(lower(var.api_domain), ".example.org") &&
        !strcontains(lower(var.api_domain), "replace-with") &&
        !strcontains(lower(var.api_domain), "placeholder")
      )
    )
    error_message = "api_domain must be a real fully-qualified public DNS hostname without scheme/path and must not use reserved example/test/placeholder names."
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

  validation {
    condition     = var.max_concurrent_comparisons >= 1
    error_message = "max_concurrent_comparisons must be at least 1."
  }
}

variable "provider_max_concurrency" {
  description = "Application-level per-provider concurrency limit."
  type        = number
  default     = 4

  validation {
    condition     = var.provider_max_concurrency >= 1
    error_message = "provider_max_concurrency must be at least 1."
  }
}

variable "metrics_every" {
  description = "Emit one cumulative diagnostics metrics snapshot after this many diagnostic events."
  type        = number
  default     = 100

  validation {
    condition     = var.metrics_every >= 1
    error_message = "metrics_every must be at least 1."
  }
}

variable "provider_secret_ids" {
  description = "Secret Manager secret IDs created for backend-only provider credentials. Values are names, never secret contents."
  type        = map(string)
  default = {
    EBAY_CLIENT_ID                    = "price-lens-ebay-client-id"
    EBAY_CLIENT_SECRET                = "price-lens-ebay-client-secret"
    AMAZON_CREATORS_CREDENTIAL_ID     = "price-lens-amazon-creators-credential-id"
    AMAZON_CREATORS_CREDENTIAL_SECRET = "price-lens-amazon-creators-credential-secret"
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

variable "ebay_marketplace_comparison_enabled" {
  description = "Enable same-product eBay fixed-price marketplace comparison after live Browse API validation. Requires ebay_browse_enabled=true."
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

variable "ebay_marketplace_search_ids" {
  description = "EU eBay marketplaces queried by the on-demand same-product comparison."
  type        = list(string)
  default = [
    "EBAY_DE",
    "EBAY_PL",
    "EBAY_AT",
    "EBAY_FR",
    "EBAY_IT",
    "EBAY_ES",
    "EBAY_NL",
    "EBAY_BE"
  ]

  validation {
    condition = (
      length(var.ebay_marketplace_search_ids) > 0 &&
      alltrue([
        for marketplace in var.ebay_marketplace_search_ids :
        contains([
          "EBAY_DE",
          "EBAY_PL",
          "EBAY_AT",
          "EBAY_FR",
          "EBAY_IT",
          "EBAY_ES",
          "EBAY_NL",
          "EBAY_BE"
        ], marketplace)
      ])
    )
    error_message = "ebay_marketplace_search_ids must contain only supported PriceLens EU eBay marketplace IDs."
  }
}

variable "ebay_delivery_country" {
  description = "Two-letter buyer delivery country used by eBay marketplace search. Defaults to Germany."
  type        = string
  default     = "DE"

  validation {
    condition     = can(regex("^[A-Z]{2}$", var.ebay_delivery_country))
    error_message = "ebay_delivery_country must be an uppercase two-letter ISO country code."
  }
}

variable "ebay_marketplace_search_concurrency" {
  description = "Maximum number of eBay marketplace searches run in parallel within one explicit PriceLens report."
  type        = number
  default     = 3

  validation {
    condition     = floor(var.ebay_marketplace_search_concurrency) == var.ebay_marketplace_search_concurrency && var.ebay_marketplace_search_concurrency >= 1 && var.ebay_marketplace_search_concurrency <= 8
    error_message = "ebay_marketplace_search_concurrency must be an integer between 1 and 8."
  }
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

variable "ecb_fx_enabled" {
  description = "Enable ECB reference-rate normalization for cross-currency comparison estimates."
  type        = bool
  default     = false
}

variable "ecb_fx_cache_ttl_ms" {
  description = "How long the latest ECB rate table is reused before refresh."
  type        = number
  default     = 21600000

  validation {
    condition     = floor(var.ecb_fx_cache_ttl_ms) == var.ecb_fx_cache_ttl_ms && var.ecb_fx_cache_ttl_ms >= 0
    error_message = "ecb_fx_cache_ttl_ms must be a non-negative integer."
  }
}

variable "ecb_fx_max_rate_age_days" {
  description = "Maximum accepted ECB reference-rate age, allowing weekends and TARGET closing days."
  type        = number
  default     = 7

  validation {
    condition     = floor(var.ecb_fx_max_rate_age_days) == var.ecb_fx_max_rate_age_days && var.ecb_fx_max_rate_age_days >= 1
    error_message = "ecb_fx_max_rate_age_days must be a positive integer."
  }
}

variable "ecb_fx_timeout_ms" {
  description = "Network timeout for refreshing ECB reference rates."
  type        = number
  default     = 2000

  validation {
    condition     = floor(var.ecb_fx_timeout_ms) == var.ecb_fx_timeout_ms && var.ecb_fx_timeout_ms >= 1
    error_message = "ecb_fx_timeout_ms must be a positive integer."
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

variable "operational_monitoring_enabled" {
  description = "Create the dedicated operational log bucket, HTTPS uptime check and Cloud Monitoring alert policies with the runtime."
  type        = bool
  default     = true
}

variable "monitoring_alerts_enabled" {
  description = "Enable alert policies after the production DNS/TLS endpoint has been verified. Keep false during initial Phase-B provisioning."
  type        = bool
  default     = false

  validation {
    condition = (
      !var.monitoring_alerts_enabled ||
      (
        var.deploy_runtime &&
        var.operational_monitoring_enabled &&
        length(var.monitoring_notification_channels) > 0
      )
    )
    error_message = "monitoring_alerts_enabled=true requires deploy_runtime=true, operational_monitoring_enabled=true, and at least one approved monitoring_notification_channels entry."
  }
}

variable "monitoring_notification_channels" {
  description = "Existing Cloud Monitoring notification-channel resource names. Keep empty until operational recipients are approved."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for channel in var.monitoring_notification_channels :
      can(regex("^projects/[^/]+/notificationChannels/[^/]+$", channel))
    ])
    error_message = "monitoring_notification_channels entries must use projects/<project>/notificationChannels/<id> resource names."
  }
}

variable "uptime_check_regions" {
  description = "Cloud Monitoring public checker regions for the HTTPS /ready probe."
  type        = list(string)
  default     = ["EUROPE", "USA", "ASIA_PACIFIC"]

  validation {
    condition = length(var.uptime_check_regions) > 0 && alltrue([
      for region in var.uptime_check_regions :
      contains([
        "USA",
        "EUROPE",
        "SOUTH_AMERICA",
        "ASIA_PACIFIC",
        "USA_OREGON",
        "USA_IOWA",
        "USA_VIRGINIA"
      ], region)
    ])
    error_message = "uptime_check_regions must contain supported Cloud Monitoring uptime-check region identifiers."
  }
}

variable "operational_log_location" {
  description = "Cloud Logging bucket location for privacy-minimized PriceLens operational diagnostics."
  type        = string
  default     = "europe-west3"

  validation {
    condition     = length(trimspace(var.operational_log_location)) > 0
    error_message = "operational_log_location must not be empty."
  }
}

variable "operational_log_retention_days" {
  description = "Retention period for the dedicated PriceLens operational log bucket."
  type        = number
  default     = 30

  validation {
    condition     = var.operational_log_retention_days >= 1 && var.operational_log_retention_days <= 3650
    error_message = "operational_log_retention_days must be between 1 and 3650."
  }
}

variable "server_busy_rejections_threshold" {
  description = "Alert when the five-minute aligned PriceLens application-level server_busy rejection count stays above this threshold."
  type        = number
  default     = 5

  validation {
    condition     = var.server_busy_rejections_threshold >= 0
    error_message = "server_busy_rejections_threshold must be zero or greater."
  }
}

variable "cloud_run_5xx_requests_threshold" {
  description = "Alert when the five-minute aligned Cloud Run 5xx request count stays above this threshold."
  type        = number
  default     = 5

  validation {
    condition     = var.cloud_run_5xx_requests_threshold >= 0
    error_message = "cloud_run_5xx_requests_threshold must be zero or greater."
  }
}

variable "cloud_run_p95_latency_ms" {
  description = "Alert threshold for successful Cloud Run P95 request latency in milliseconds."
  type        = number
  default     = 5000

  validation {
    condition     = var.cloud_run_p95_latency_ms >= 100
    error_message = "cloud_run_p95_latency_ms must be at least 100 ms."
  }
}

variable "labels" {
  description = "Additional labels applied where supported."
  type        = map(string)
  default     = {}
}
