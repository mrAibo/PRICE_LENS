output "deployment_phase" {
  description = "Current Terraform deployment phase."
  value       = var.deploy_runtime ? "runtime" : "bootstrap"
}

output "artifact_repository_base" {
  description = "Base Artifact Registry path for PriceLens images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.api.repository_id}"
}

output "api_service_account_email" {
  description = "Cloud Run runtime service account."
  value       = google_service_account.api.email
}

output "provider_secret_ids" {
  description = "Secret Manager containers created for provider credentials. These outputs contain names only, never secret values."
  value = {
    for env_name, secret in google_secret_manager_secret.provider :
    env_name => secret.secret_id
  }
}

output "cloud_run_service_name" {
  description = "Cloud Run service name when runtime deployment is enabled."
  value       = var.deploy_runtime ? google_cloud_run_v2_service.api[0].name : null
}

output "cloud_armor_policy_name" {
  description = "Cloud Armor policy when runtime deployment is enabled."
  value       = var.deploy_runtime ? google_compute_security_policy.api[0].name : null
}

output "load_balancer_ip" {
  description = "Public IPv4 address to publish in DNS when runtime deployment is enabled."
  value       = var.deploy_runtime ? google_compute_global_address.api[0].address : null
}

output "api_origin" {
  description = "Production extension API origin when runtime deployment is enabled."
  value       = var.deploy_runtime ? "https://${var.api_domain}" : null
}

output "required_dns_a_record" {
  description = "A record that must be created in the authoritative DNS zone before the managed certificate can become active."
  value = var.deploy_runtime ? {
    name  = var.api_domain
    type  = "A"
    value = google_compute_global_address.api[0].address
  } : null
}

output "operational_log_bucket_name" {
  description = "Dedicated privacy-minimized operational log bucket when runtime monitoring is enabled."
  value       = local.operational_observability_enabled ? google_logging_project_bucket_config.price_lens_ops[0].name : null
}

output "api_uptime_check_id" {
  description = "Cloud Monitoring uptime-check ID for the public HTTPS /ready endpoint."
  value       = local.operational_observability_enabled ? google_monitoring_uptime_check_config.api[0].uptime_check_id : null
}

output "monitoring_alert_policy_names" {
  description = "Cloud Monitoring alert-policy resource names for PriceLens runtime health."
  value = local.operational_observability_enabled ? {
    uptime        = google_monitoring_alert_policy.api_uptime[0].name
    cloud_run_5xx = google_monitoring_alert_policy.cloud_run_5xx[0].name
    p95_latency   = google_monitoring_alert_policy.cloud_run_p95_latency[0].name
  } : {}
}

output "monitoring_alerts_enabled" {
  description = "Whether PriceLens Cloud Monitoring alert policies are enabled."
  value       = local.operational_observability_enabled ? var.monitoring_alerts_enabled : false
}



output "github_wif_provider" {
  description = "Full GitHub Actions Workload Identity Provider resource name for google-github-actions/auth."
  value = var.github_wif_image_publisher_enabled ? google_iam_workload_identity_pool_provider.github[0].name : null
}

output "github_image_publisher_service_account_email" {
  description = "Keyless GitHub Actions service account that can push images to the PriceLens Artifact Registry repository."
  value = var.github_wif_image_publisher_enabled ? google_service_account.github_image_publisher[0].email : null
}
