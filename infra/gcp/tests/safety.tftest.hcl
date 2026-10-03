mock_provider "google" {}

run "phase_a_bootstrap_has_no_public_runtime" {
  command = plan

  variables {
    project_id = "price-lens-test"
  }

  assert {
    condition     = length(google_cloud_run_v2_service.api) == 0
    error_message = "Phase A must not create the Cloud Run runtime."
  }

  assert {
    condition     = length(google_compute_security_policy.api) == 0
    error_message = "Phase A must not create the public edge policy."
  }

  assert {
    condition     = length(google_compute_global_forwarding_rule.api_https) == 0
    error_message = "Phase A must not create a public HTTPS forwarding rule."
  }

  assert {
    condition     = length(google_monitoring_uptime_check_config.api) == 0
    error_message = "Phase A must not create runtime uptime monitoring."
  }

  assert {
    condition     = local.literal_env.PRICE_LENS_FIXTURE_PROVIDER == "0"
    error_message = "The fixture provider must remain disabled in the production environment map."
  }

  assert {
    condition     = local.literal_env.EBAY_BROWSE_ENABLED == "0"
    error_message = "eBay Browse must remain opt-in by default."
  }

  assert {
    condition     = local.literal_env.AMAZON_CREATORS_ENABLED == "0"
    error_message = "Amazon Creators must remain opt-in by default."
  }

  assert {
    condition     = local.literal_env.EBAY_BROWSE_CACHE_TTL_MS == "0" && local.literal_env.AMAZON_CREATORS_CACHE_TTL_MS == "0"
    error_message = "Provider product-data caches must remain disabled by default."
  }
}

run "phase_b_runtime_preserves_safe_defaults" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.example.com"
    api_image      = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:test-sha"
  }

  assert {
    condition     = length(google_cloud_run_v2_service.api) == 1
    error_message = "Phase B must create exactly one Cloud Run API service."
  }

  assert {
    condition     = google_cloud_run_v2_service.api[0].ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
    error_message = "Cloud Run must remain restricted to internal/load-balancer ingress."
  }

  assert {
    condition     = google_cloud_run_v2_service.api[0].invoker_iam_disabled
    error_message = "Cloud Run must keep IAM invoker checks disabled only in combination with the restricted ingress/load-balancer design."
  }

  assert {
    condition     = google_compute_backend_service.api[0].enable_cdn == false
    error_message = "The PriceLens API backend must not enable CDN caching."
  }

  assert {
    condition = one([
      for rule in google_compute_security_policy.api[0].rule :
      rule.preview
      if rule.priority == 200
    ])
    error_message = "The initial Cloud Armor rate-limit rule must remain in preview by default."
  }

  assert {
    condition     = google_logging_project_bucket_config.price_lens_ops[0].retention_days == 30
    error_message = "The dedicated operational diagnostics bucket must default to 30-day retention."
  }

  assert {
    condition     = google_monitoring_alert_policy.api_uptime[0].enabled == false
    error_message = "Uptime paging must stay disabled until production DNS/TLS and recipients are verified."
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_run_5xx[0].enabled == false
    error_message = "5xx paging must stay disabled until production DNS/TLS and recipients are verified."
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_run_p95_latency[0].enabled == false
    error_message = "Latency paging must stay disabled until production DNS/TLS and recipients are verified."
  }

  assert {
    condition     = length(var.monitoring_notification_channels) == 0
    error_message = "No operational recipient/contact channel may be committed as a default."
  }

  assert {
    condition     = local.literal_env.PRICE_LENS_FIXTURE_PROVIDER == "0"
    error_message = "The fixture provider must never be enabled by the production Terraform default."
  }

  assert {
    condition     = local.literal_env.EBAY_BROWSE_ENABLED == "0" && local.literal_env.AMAZON_CREATORS_ENABLED == "0"
    error_message = "External providers must remain disabled until explicitly approved and configured."
  }
}

run "alert_enablement_without_runtime_or_recipient_is_rejected" {
  command = plan

  variables {
    project_id                = "price-lens-test"
    monitoring_alerts_enabled = true
  }

  expect_failures = [
    var.monitoring_alerts_enabled
  ]
}

run "phase_b_alerting_accepts_an_explicit_approved_channel" {
  command = plan

  variables {
    project_id                = "price-lens-test"
    deploy_runtime            = true
    api_domain                = "api.example.com"
    api_image                 = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:test-sha"
    monitoring_alerts_enabled = true
    monitoring_notification_channels = [
      "projects/price-lens-test/notificationChannels/1234567890"
    ]
  }

  assert {
    condition     = google_monitoring_alert_policy.api_uptime[0].enabled
    error_message = "Uptime alerts should enable only after an explicit notification channel is supplied."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.api_uptime[0].notification_channels) == 1
    error_message = "Enabled uptime alerts must carry the explicitly configured notification channel."
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_run_5xx[0].enabled && google_monitoring_alert_policy.cloud_run_p95_latency[0].enabled
    error_message = "All runtime alert policies should share the explicit enablement gate."
  }
}

