output "state_bucket_name" {
  description = "GCS bucket to pass to the main PriceLens Terraform backend."
  value       = google_storage_bucket.terraform_state.name
}

output "backend_prefix" {
  description = "Recommended object prefix for the main PriceLens Terraform backend."
  value       = var.backend_prefix
}

output "backend_init_command" {
  description = "Command template for initializing the main PriceLens Terraform root against this bucket."
  value       = "terraform -chdir=infra/gcp init -backend-config=bucket=${google_storage_bucket.terraform_state.name} -backend-config=prefix=${var.backend_prefix}"
}
