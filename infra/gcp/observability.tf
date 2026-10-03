locals {
  operational_observability_enabled = var.deploy_runtime && var.operational_monitoring_enabled

  operational_log_filter = join(" AND ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${var.name_prefix}-api\"",
    "jsonPayload.service=\"price-lens-api\""
  ])

  monitoring_notification_channels = var.monitoring_notification_channels

  server_busy_log_filter = join(" AND ", [
    local.operational_log_filter,
    "jsonPayload.type=\"request_rejected\"",
    "jsonPayload.reason=\"server_busy\""
  ])

  comparison_warning_log_filter = join(" AND ", [
    local.operational_log_filter,
    "jsonPayload.type=\"compare_completed\"",
    "jsonPayload.warningCount>0"
  ])

  enrichment_fallback_log_filter = join(" AND ", [
    local.operational_log_filter,
    "jsonPayload.type=\"compare_completed\"",
    "jsonPayload.enrichmentFallback=true"
  ])
}

resource "google_logging_project_bucket_config" "price_lens_ops" {
  count = local.operational_observability_enabled ? 1 : 0

  project          = var.project_id
  location         = var.operational_log_location
  bucket_id        = "${var.name_prefix}-ops"
  description      = "Privacy-minimized PriceLens operational diagnostics"
  retention_days   = var.operational_log_retention_days
  enable_analytics = false
  deletion_policy  = "ABANDON"

  depends_on = [google_project_service.required]
}

resource "google_logging_project_sink" "price_lens_ops" {
  count = local.operational_observability_enabled ? 1 : 0

  project                = var.project_id
  name                   = "${var.name_prefix}-ops"
  description            = "Route only PriceLens privacy-minimized structured diagnostics to the dedicated operational bucket"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.price_lens_ops[0].name}"
  filter                 = local.operational_log_filter
  unique_writer_identity = false

  depends_on = [
    google_project_service.required,
    google_logging_project_bucket_config.price_lens_ops
  ]
}

resource "google_logging_metric" "server_busy_rejections" {
  count = local.operational_observability_enabled ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-server-busy-rejections"
  description = "PriceLens comparison requests rejected because the application concurrency budget was exhausted"
  filter      = local.server_busy_log_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    display_name = "PriceLens server-busy rejections"
  }

  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "comparison_warnings" {
  count = local.operational_observability_enabled ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-comparison-warnings"
  description = "Completed PriceLens comparisons carrying one or more controlled warnings"
  filter      = local.comparison_warning_log_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    display_name = "PriceLens comparisons with warnings"
  }

  depends_on = [google_project_service.required]
}

resource "google_logging_metric" "enrichment_fallbacks" {
  count = local.operational_observability_enabled ? 1 : 0

  project     = var.project_id
  name        = "${var.name_prefix}-enrichment-fallbacks"
  description = "PriceLens comparisons that continued after optional eBay Browse enrichment failed"
  filter      = local.enrichment_fallback_log_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    display_name = "PriceLens enrichment fallbacks"
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_uptime_check_config" "api" {
  count = local.operational_observability_enabled ? 1 : 0

  project            = var.project_id
  display_name       = "${var.name_prefix}-api-ready"
  timeout            = "10s"
  period             = "60s"
  selected_regions   = var.uptime_check_regions
  checker_type       = "STATIC_IP_CHECKERS"
  log_check_failures = true

  http_check {
    path           = "/ready"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"

    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = var.api_domain
    }
  }

  content_matchers {
    content = "\"status\":\"ready\""
    matcher = "CONTAINS_STRING"
  }

  depends_on = [
    google_project_service.required,
    google_compute_global_forwarding_rule.api_https
  ]
}

resource "google_monitoring_alert_policy" "api_uptime" {
  count = local.operational_observability_enabled ? 1 : 0

  project      = var.project_id
  display_name = "PriceLens API availability"
  combiner     = "OR"
  enabled      = var.monitoring_alerts_enabled

  documentation {
    content = "The public PriceLens API /ready uptime check is failing. Validate DNS, managed TLS, load balancer, Cloud Armor, serverless NEG and Cloud Run readiness before changing application/provider limits."
  }

  conditions {
    display_name = "HTTPS readiness check success below 100%"

    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.\"check_id\"=\"${google_monitoring_uptime_check_config.api[0].uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.monitoring_notification_channels

  user_labels = {
    service  = "price-lens"
    severity = "critical"
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  count = local.operational_observability_enabled ? 1 : 0

  project      = var.project_id
  display_name = "PriceLens Cloud Run 5xx"
  combiner     = "OR"
  enabled      = var.monitoring_alerts_enabled

  documentation {
    content = "Cloud Run is returning sustained 5xx responses. Inspect request-correlated PriceLens diagnostics, instance health, provider isolation and deployment revisions."
  }

  conditions {
    display_name = "5xx responses above budget"

    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${var.name_prefix}-api\" AND metric.label.\"response_code_class\"=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.cloud_run_5xx_requests_threshold
      duration        = "60s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.\"service_name\""]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.monitoring_notification_channels

  user_labels = {
    service  = "price-lens"
    severity = "critical"
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "cloud_run_p95_latency" {
  count = local.operational_observability_enabled ? 1 : 0

  project      = var.project_id
  display_name = "PriceLens Cloud Run P95 latency"
  combiner     = "OR"
  enabled      = var.monitoring_alerts_enabled

  documentation {
    content = "Cloud Run successful-request P95 latency is above the configured threshold. Check provider latency, concurrency saturation, upstream rate limits and recent revisions."
  }

  conditions {
    display_name = "2xx P95 request latency above threshold"

    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${var.name_prefix}-api\" AND metric.label.\"response_code_class\"=\"2xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.cloud_run_p95_latency_ms
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.\"service_name\""]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.monitoring_notification_channels

  user_labels = {
    service  = "price-lens"
    severity = "warning"
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "server_busy" {
  count = local.operational_observability_enabled ? 1 : 0

  project      = var.project_id
  display_name = "PriceLens application overload"
  combiner     = "OR"
  enabled      = var.monitoring_alerts_enabled

  documentation {
    content = "PriceLens is rejecting comparison requests because its application concurrency budget is exhausted. Inspect Cloud Run instance saturation, PRICE_LENS_MAX_CONCURRENT_COMPARISONS, provider latency/quotas and recent traffic before raising limits."
  }

  conditions {
    display_name = "Server-busy rejections above budget"

    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.server_busy_rejections[0].name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.server_busy_rejections_threshold
      duration        = "60s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.\"service_name\""]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = local.monitoring_notification_channels

  user_labels = {
    service  = "price-lens"
    severity = "warning"
  }

  depends_on = [
    google_project_service.required,
    google_logging_metric.server_busy_rejections
  ]
}
