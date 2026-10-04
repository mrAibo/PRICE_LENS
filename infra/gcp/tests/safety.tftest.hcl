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
    condition     = length(google_iam_workload_identity_pool.github) == 0 && length(google_service_account.github_image_publisher) == 0
    error_message = "GitHub WIF publishing must remain opt-in by default."
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
    condition     = length(google_logging_metric.server_busy_rejections) == 0 && length(google_logging_metric.comparison_warnings) == 0 && length(google_logging_metric.enrichment_fallbacks) == 0
    error_message = "Phase A must not create runtime application log metrics."
  }


  assert {
    condition     = local.literal_env.PRICE_LENS_SESSION_AUTH_ENABLED == "0"
    error_message = "Pilot session auth must remain opt-in by default."
  }

  assert {
    condition     = local.literal_env.PRICE_LENS_SESSION_TTL_SECONDS == "900" && local.literal_env.PRICE_LENS_GOOGLE_VERIFY_TIMEOUT_MS == "3000"
    error_message = "Session lifetime and Google verification timeout must remain short and bounded by default."
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
    condition     = local.literal_env.EBAY_MARKETPLACE_COMPARISON_ENABLED == "0"
    error_message = "Same-product eBay marketplace comparison must remain opt-in until live API/compliance validation."
  }

  assert {
    condition     = local.literal_env.EBAY_MARKETPLACE_SEARCH_IDS == "EBAY_DE,EBAY_PL,EBAY_AT,EBAY_FR,EBAY_IT,EBAY_ES,EBAY_NL,EBAY_BE"
    error_message = "The default on-demand eBay market set must stay constrained to the approved PriceLens EU list."
  }

  assert {
    condition     = local.literal_env.EBAY_DELIVERY_COUNTRY == "DE"
    error_message = "The current Phase 3C delivery-country default must remain Germany until an explicit user destination model is implemented."
  }

  assert {
    condition     = local.literal_env.EBAY_MARKETPLACE_SEARCH_CONCURRENCY == "3"
    error_message = "eBay EU fan-out must remain bounded by the conservative default concurrency."
  }

  assert {
    condition     = local.literal_env.EBAY_CATALOG_EPID_FALLBACK_ENABLED == "0"
    error_message = "eBay Catalog ePID fallback must remain opt-in until live Catalog validation."
  }

  assert {
    condition     = local.literal_env.EBAY_CATALOG_MARKETPLACE_ID == "EBAY_DE"
    error_message = "eBay Catalog fallback must use the conservative supported EU marketplace default."
  }

  assert {
    condition     = local.literal_env.EBAY_MARKETPLACE_DETAIL_ENRICHMENT_ENABLED == "0"
    error_message = "eBay item-detail enrichment must remain opt-in until live Browse validation."
  }

  assert {
    condition     = local.literal_env.EBAY_MARKETPLACE_DETAIL_LIMIT == "5" && local.literal_env.EBAY_MARKETPLACE_DETAIL_CONCURRENCY == "2"
    error_message = "eBay item-detail enrichment must keep bounded default request volume and concurrency."
  }

  assert {
    condition     = local.literal_env.ECB_FX_ENABLED == "0"
    error_message = "ECB FX normalization must remain opt-in until live deployment validation."
  }

  assert {
    condition     = local.literal_env.ECB_FX_CACHE_TTL_MS == "21600000" && local.literal_env.ECB_FX_MAX_RATE_AGE_DAYS == "7" && local.literal_env.ECB_FX_TIMEOUT_MS == "2000"
    error_message = "ECB FX cache, freshness and timeout defaults must remain bounded."
  }

  assert {
    condition     = local.literal_env.AMAZON_CREATORS_ENABLED == "0"
    error_message = "Amazon Creators must remain opt-in by default."
  }

  assert {
    condition     = local.literal_env.AMAZON_MARKETPLACE_PARTNER_TAGS_JSON == "{}"
    error_message = "Amazon EU marketplace Partner Tags must be empty by default."
  }

  assert {
    condition     = local.literal_env.AMAZON_MARKETPLACE_SEARCH_CONCURRENCY == "2"
    error_message = "Amazon EU marketplace fan-out must remain bounded by the conservative default concurrency."
  }



  assert {
    condition     = local.literal_env.EBAY_BROWSE_CACHE_TTL_MS == "0" && local.literal_env.AMAZON_CREATORS_CACHE_TTL_MS == "0"
    error_message = "Provider product-data caches must remain disabled by default."
  }
}

run "github_wif_image_publisher_is_repo_and_main_bound" {
  command = plan

  variables {
    project_id                         = "price-lens-test"
    github_wif_image_publisher_enabled = true
  }

  assert {
    condition     = length(google_iam_workload_identity_pool.github) == 1 && length(google_iam_workload_identity_pool_provider.github) == 1
    error_message = "Explicit WIF enablement must create exactly one GitHub pool and provider."
  }

  assert {
    condition = alltrue([
      strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "assertion.repository_id == '1401433983'"),
      strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "assertion.repository_owner_id == '93589172'"),
      strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "assertion.repository == 'mrAibo/PRICE_LENS'"),
      strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "assertion.ref == 'refs/heads/main'"),
      strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, "assertion.ref_type == 'branch'")
    ])
    error_message = "GitHub WIF must be restricted to the immutable PriceLens repository identity and main branch."
  }

  assert {
    condition     = google_artifact_registry_repository_iam_member.github_image_publisher[0].role == "roles/artifactregistry.writer"
    error_message = "The GitHub image publisher must receive Artifact Registry Writer rather than broad project deployment roles."
  }

  assert {
    condition     = google_service_account_iam_member.github_image_publisher_wif[0].role == "roles/iam.workloadIdentityUser"
    error_message = "GitHub may impersonate the image-publisher service account only through Workload Identity Federation."
  }
}

run "session_auth_requires_pinned_server_secrets" {
  command = plan

  variables {
    project_id           = "price-lens-test"
    session_auth_enabled = true
  }

  expect_failures = [
    check.provider_enablement
  ]
}

run "session_auth_accepts_pinned_server_secrets" {
  command = plan

  variables {
    project_id           = "price-lens-test"
    session_auth_enabled = true
    secret_versions = {
      PRICE_LENS_SESSION_SIGNING_SECRET    = "1"
      PRICE_LENS_GOOGLE_SUBJECT_TIERS_JSON = "1"
    }
  }

  assert {
    condition     = local.literal_env.PRICE_LENS_SESSION_AUTH_ENABLED == "1"
    error_message = "Session auth should enable only after pinned backend secrets are supplied."
  }
}

run "ebay_catalog_fallback_requires_browse_enablement" {
  command = plan

  variables {
    project_id                         = "price-lens-test"
    ebay_catalog_epid_fallback_enabled = true
  }

  expect_failures = [
    check.provider_enablement
  ]
}

run "ebay_detail_enrichment_requires_marketplace_comparison" {
  command = plan

  variables {
    project_id                                 = "price-lens-test"
    ebay_browse_enabled                        = true
    ebay_marketplace_detail_enrichment_enabled = true
    secret_versions = {
      EBAY_CLIENT_ID     = "1"
      EBAY_CLIENT_SECRET = "1"
    }
  }

  expect_failures = [
    check.provider_enablement
  ]
}

run "ebay_marketplace_comparison_requires_browse_enablement" {
  command = plan

  variables {
    project_id                          = "price-lens-test"
    ebay_marketplace_comparison_enabled = true
  }

  expect_failures = [
    check.provider_enablement
  ]
}

run "amazon_creators_requires_credentials_and_partner_tag" {
  command = plan

  variables {
    project_id              = "price-lens-test"
    amazon_creators_enabled = true
  }

  expect_failures = [
    check.provider_enablement
  ]
}

run "amazon_locale_map_satisfies_partner_tag_requirement" {
  command = plan

  variables {
    project_id              = "price-lens-test"
    amazon_creators_enabled = true
    amazon_marketplace_partner_tags = {
      "www.amazon.de" = "de-tag-21"
      "www.amazon.pl" = "pl-tag-21"
    }
    secret_versions = {
      AMAZON_CREATORS_CREDENTIAL_ID     = "1"
      AMAZON_CREATORS_CREDENTIAL_SECRET = "1"
    }
  }

  assert {
    condition     = local.literal_env.AMAZON_CREATORS_ENABLED == "1"
    error_message = "Amazon Creators should be enabled for the explicit locale-map test."
  }

  assert {
    condition     = can(jsondecode(local.literal_env.AMAZON_MARKETPLACE_PARTNER_TAGS_JSON)["www.amazon.pl"])
    error_message = "Amazon locale Partner Tags must be serialized into the Cloud Run environment."
  }
}

run "phase_b_runtime_preserves_safe_defaults" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.pricelens-demo.de"
    api_image      = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:0123456789abcdef0123456789abcdef01234567"
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
      !rule.preview
      if rule.priority == 150
    ])
    error_message = "The session-exchange rate limit must be enforced rather than preview-only."
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
    condition     = length(google_logging_metric.server_busy_rejections) == 1 && length(google_logging_metric.comparison_warnings) == 1 && length(google_logging_metric.enrichment_fallbacks) == 1
    error_message = "Phase B monitoring must create the privacy-minimized PriceLens application log metrics."
  }

  assert {
    condition     = google_monitoring_alert_policy.server_busy[0].enabled == false
    error_message = "Application-overload paging must stay disabled until production DNS/TLS and recipients are verified."
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
    api_domain                = "api.pricelens-demo.de"
    api_image                 = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:0123456789abcdef0123456789abcdef01234567"
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
    condition     = google_monitoring_alert_policy.cloud_run_5xx[0].enabled && google_monitoring_alert_policy.cloud_run_p95_latency[0].enabled && google_monitoring_alert_policy.server_busy[0].enabled
    error_message = "All runtime alert policies should share the explicit enablement gate."
  }
}


run "phase_b_rejects_reserved_example_domain" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.pricelens.invalid"
    api_image      = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:0123456789abcdef0123456789abcdef01234567"
  }

  expect_failures = [
    var.api_domain
  ]
}

run "phase_b_rejects_latest_image_tag" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.pricelens-demo.de"
    api_image      = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:latest"
  }

  expect_failures = [
    var.api_image
  ]
}

run "phase_b_rejects_mutable_semantic_image_tag" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.pricelens-demo.de"
    api_image      = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api:production"
  }

  expect_failures = [
    check.runtime_inputs
  ]
}

run "phase_b_rejects_image_from_another_registry_prefix" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.pricelens-demo.de"
    api_image      = "europe-west3-docker.pkg.dev/another-project/price-lens/price-lens-api:0123456789abcdef0123456789abcdef01234567"
  }

  expect_failures = [
    check.runtime_inputs
  ]
}

run "phase_b_accepts_immutable_digest_image" {
  command = plan

  variables {
    project_id     = "price-lens-test"
    deploy_runtime = true
    api_domain     = "api.pricelens-demo.de"
    api_image      = "europe-west3-docker.pkg.dev/price-lens-test/price-lens/price-lens-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }

  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].containers[0].image == var.api_image
    error_message = "A pinned sha256 Artifact Registry digest must remain accepted for Phase B."
  }
}
