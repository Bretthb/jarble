# variables.tf - Configuration for K3s cluster

# ============================================
# REQUIRED VARIABLES
# ============================================

variable "hetzner_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "ssh_private_key_path" {
  description = "Path to SSH private key"
  type        = string
  default     = "~/.ssh/id_rsa"
}

# ============================================
# CLUSTER CONFIGURATION
# ============================================

variable "cluster_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "jarble"
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "fsn1"  # Falkenstein, Germany (cheapest)
  # Options: fsn1, nbg1, hel1 (EU) | ash (US) | sin (Singapore)
}

variable "control_plane_type" {
  description = "Server type for control plane"
  type        = string
  default     = "cx32"  # 4 vCPU, 8GB RAM - good for control plane + some bots
}

variable "worker_type" {
  description = "Server type for worker nodes"
  type        = string
  default     = "cx43"  # 8 vCPU, 16GB RAM - fits 4 bots each
}

variable "worker_count" {
  description = "Number of worker nodes"
  type        = number
  default     = 2
}

# ============================================
# BACKUP CONFIGURATION (Optional)
# ============================================

variable "backup_s3_endpoint" {
  description = "S3-compatible endpoint for Longhorn backups (e.g., R2)"
  type        = string
  default     = ""
}

variable "backup_s3_bucket" {
  description = "S3 bucket name for backups"
  type        = string
  default     = ""
}

variable "backup_s3_region" {
  description = "S3 region for backups"
  type        = string
  default     = "auto"
}

variable "backup_s3_access_key" {
  description = "S3 access key for backups"
  type        = string
  default     = ""
  sensitive   = true
}

variable "backup_s3_secret_key" {
  description = "S3 secret key for backups"
  type        = string
  default     = ""
  sensitive   = true
}
