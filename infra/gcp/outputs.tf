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
  value       = var.deploy_runtime ? module.api_lb[0].external_ip : null
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
    value = module.api_lb[0].external_ip
  } : null
}
