locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com"
  ])

  common_labels = merge(
    {
      app        = "price-lens"
      managed-by = "terraform"
    },
    var.labels
  )

  literal_env = {
    PRICE_LENS_FIXTURE_PROVIDER           = "0"
    PRICE_LENS_JSON_LOGS                  = "1"
    PRICE_LENS_METRICS_EVERY              = tostring(var.metrics_every)
    PRICE_LENS_MAX_CONCURRENT_COMPARISONS = tostring(var.max_concurrent_comparisons)
    PRICE_LENS_PROVIDER_MAX_CONCURRENCY   = tostring(var.provider_max_concurrency)

    EBAY_BROWSE_ENABLED                 = var.ebay_browse_enabled ? "1" : "0"
    EBAY_MARKETPLACE_COMPARISON_ENABLED = var.ebay_marketplace_comparison_enabled ? "1" : "0"
    EBAY_ENVIRONMENT                    = var.ebay_environment
    EBAY_MARKETPLACE_ID                 = var.ebay_marketplace_id
    EBAY_MARKETPLACE_SEARCH_IDS         = join(",", var.ebay_marketplace_search_ids)
    EBAY_DELIVERY_COUNTRY               = var.ebay_delivery_country
    EBAY_MARKETPLACE_SEARCH_CONCURRENCY = tostring(var.ebay_marketplace_search_concurrency)
    EBAY_BROWSE_CACHE_TTL_MS            = tostring(var.ebay_browse_cache_ttl_ms)

    ECB_FX_ENABLED           = var.ecb_fx_enabled ? "1" : "0"
    ECB_FX_CACHE_TTL_MS      = tostring(var.ecb_fx_cache_ttl_ms)
    ECB_FX_MAX_RATE_AGE_DAYS = tostring(var.ecb_fx_max_rate_age_days)
    ECB_FX_TIMEOUT_MS        = tostring(var.ecb_fx_timeout_ms)

    AMAZON_CREATORS_ENABLED            = var.amazon_creators_enabled ? "1" : "0"
    AMAZON_CREATORS_CREDENTIAL_VERSION = var.amazon_credential_version
    AMAZON_PARTNER_TAG                 = var.amazon_partner_tag
    AMAZON_MARKETPLACE                 = var.amazon_marketplace
    AMAZON_CREATORS_CACHE_TTL_MS       = tostring(var.amazon_creators_cache_ttl_ms)
  }

  valid_secret_versions = {
    for env_name, version in var.secret_versions :
    env_name => version
    if contains(keys(var.provider_secret_ids), env_name)
  }

  expected_api_image_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository_id}/"
  api_image_is_immutable = (
    length(trimspace(var.api_image)) > 0 &&
    startswith(var.api_image, local.expected_api_image_prefix) &&
    (
      can(regex(":[0-9a-fA-F]{7,64}$", var.api_image)) ||
      can(regex("@sha256:[0-9a-fA-F]{64}$", var.api_image))
    )
  )
}

check "runtime_inputs" {
  assert {
    condition     = !var.deploy_runtime || (length(trimspace(var.api_image)) > 0 && length(trimspace(var.api_domain)) > 0)
    error_message = "api_image and api_domain are required when deploy_runtime=true."
  }

  assert {
    condition     = !var.deploy_runtime || local.api_image_is_immutable
    error_message = "Phase B api_image must come from this deployment's Artifact Registry repository and use an immutable 7-64 hex git-SHA tag or sha256 digest."
  }

  assert {
    condition     = var.max_instances >= var.min_instances
    error_message = "max_instances must be greater than or equal to min_instances."
  }
}

check "secret_version_keys" {
  assert {
    condition = alltrue([
      for env_name in keys(var.secret_versions) :
      contains(keys(var.provider_secret_ids), env_name)
    ])
    error_message = "secret_versions contains an unknown environment-variable key."
  }
}

check "provider_enablement" {
  assert {
    condition = (
      !var.ebay_browse_enabled ||
      (
        contains(keys(var.secret_versions), "EBAY_CLIENT_ID") &&
        contains(keys(var.secret_versions), "EBAY_CLIENT_SECRET")
      )
    )
    error_message = "eBay Browse requires pinned EBAY_CLIENT_ID and EBAY_CLIENT_SECRET secret versions."
  }

  assert {
    condition     = !var.ebay_marketplace_comparison_enabled || var.ebay_browse_enabled
    error_message = "eBay marketplace comparison requires ebay_browse_enabled=true so the same approved Browse credentials are used."
  }

  assert {
    condition = (
      !var.amazon_creators_enabled ||
      (
        length(trimspace(var.amazon_partner_tag)) > 0 &&
        contains(keys(var.secret_versions), "AMAZON_CREATORS_CREDENTIAL_ID") &&
        contains(keys(var.secret_versions), "AMAZON_CREATORS_CREDENTIAL_SECRET")
      )
    )
    error_message = "Amazon Creators requires amazon_partner_tag and pinned credential secret versions."
  }
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "api" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "PriceLens production container images"
  format        = "DOCKER"
  labels        = local.common_labels

  depends_on = [google_project_service.required]
}

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-api"
  display_name = "PriceLens API runtime"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "provider" {
  for_each = var.provider_secret_ids

  project   = var.project_id
  secret_id = each.value
  labels    = local.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "api" {
  for_each = google_secret_manager_secret.provider

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service" "api" {
  count = var.deploy_runtime ? 1 : 0

  project  = var.project_id
  name     = "${var.name_prefix}-api"
  location = var.region
  labels   = local.common_labels

  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  invoker_iam_disabled = true
  deletion_protection  = var.deletion_protection
  default_uri_disabled = var.disable_default_run_url
  launch_stage         = var.disable_default_run_url ? "BETA" : null

  template {
    service_account                  = google_service_account.api.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = var.cloud_run_concurrency

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      name  = "api"
      image = var.api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }

        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.literal_env

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.valid_secret_versions

        content {
          name = env.key

          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.provider[env.key].secret_id
              version = env.value
            }
          }
        }
      }

      startup_probe {
        failure_threshold     = 5
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 3

        http_get {
          path = "/ready"
          port = 8080
        }
      }

      liveness_probe {
        failure_threshold     = 3
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 30

        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = length(trimspace(var.api_image)) > 0
      error_message = "api_image must be set before the Cloud Run runtime is deployed."
    }

    precondition {
      condition     = length(trimspace(var.api_domain)) > 0
      error_message = "api_domain must be set before the public runtime is deployed."
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.api
  ]
}

resource "google_compute_region_network_endpoint_group" "api" {
  count = var.deploy_runtime ? 1 : 0

  project               = var.project_id
  name                  = "${var.name_prefix}-api"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.api[0].name
  }

  depends_on = [google_project_service.required]
}

resource "google_compute_security_policy" "api" {
  count = var.deploy_runtime ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-api-edge"
  description = "PriceLens API edge request controls"
  type        = "CLOUD_ARMOR"

  rule {
    action      = "deny(403)"
    priority    = 100
    description = "Reject declared comparison bodies above the application limit"

    match {
      expr {
        expression = "request.path == '/v1/compare' && request.method == 'POST' && has(request.headers['content-length']) && int(request.headers['content-length']) > ${var.edge_max_body_bytes}"
      }
    }
  }

  rule {
    action      = "throttle"
    priority    = 200
    description = "Per-IP comparison request budget"
    preview     = var.cloud_armor_rate_limit_preview

    match {
      expr {
        expression = "request.path == '/v1/compare' && request.method == 'POST'"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.cloud_armor_requests_per_interval
        interval_sec = var.cloud_armor_interval_sec
      }
    }
  }

  rule {
    action   = "allow"
    priority = 2147483647

    match {
      versioned_expr = "SRC_IPS_V1"

      config {
        src_ip_ranges = ["*"]
      }
    }

    description = "Default allow after targeted controls"
  }

  depends_on = [google_project_service.required]
}

resource "google_compute_global_address" "api" {
  count = var.deploy_runtime ? 1 : 0

  project      = var.project_id
  name         = "${var.name_prefix}-api"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}

resource "google_compute_backend_service" "api" {
  count = var.deploy_runtime ? 1 : 0

  project               = var.project_id
  name                  = "${var.name_prefix}-api"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30
  enable_cdn            = false
  security_policy       = google_compute_security_policy.api[0].self_link

  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }

  log_config {
    enable      = true
    sample_rate = var.lb_log_sample_rate
  }

  depends_on = [google_project_service.required]
}

resource "google_compute_url_map" "api" {
  count = var.deploy_runtime ? 1 : 0

  project         = var.project_id
  name            = "${var.name_prefix}-api"
  default_service = google_compute_backend_service.api[0].id
}

resource "google_compute_managed_ssl_certificate" "api" {
  count = var.deploy_runtime ? 1 : 0

  project = var.project_id
  name    = "${var.name_prefix}-api"

  managed {
    domains = [var.api_domain]
  }
}

resource "google_compute_target_https_proxy" "api" {
  count = var.deploy_runtime ? 1 : 0

  project          = var.project_id
  name             = "${var.name_prefix}-api"
  url_map          = google_compute_url_map.api[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.api[0].id]
}

resource "google_compute_global_forwarding_rule" "api_https" {
  count = var.deploy_runtime ? 1 : 0

  project               = var.project_id
  name                  = "${var.name_prefix}-api-https"
  target                = google_compute_target_https_proxy.api[0].id
  ip_address            = google_compute_global_address.api[0].address
  port_range            = "443"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

resource "google_compute_url_map" "http_redirect" {
  count = var.deploy_runtime ? 1 : 0

  project = var.project_id
  name    = "${var.name_prefix}-api-http-redirect"

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  count = var.deploy_runtime ? 1 : 0

  project = var.project_id
  name    = "${var.name_prefix}-api-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "api_http" {
  count = var.deploy_runtime ? 1 : 0

  project               = var.project_id
  name                  = "${var.name_prefix}-api-http"
  target                = google_compute_target_http_proxy.http_redirect[0].id
  ip_address            = google_compute_global_address.api[0].address
  port_range            = "80"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}
