# ─── Hetzner Cloud Variables ─────────────────────────────────────────────────

variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key for server access"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "ssh_public_key" {
  description = "SSH public key content (used in CI; takes precedence over ssh_public_key_path)"
  type        = string
  default     = ""
}

variable "ssh_private_key_path" {
  description = "Path to SSH private key for provisioning"
  type        = string
  default     = "~/.ssh/id_rsa"
}

# ─── Cluster Configuration ───────────────────────────────────────────────────

variable "cluster_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "jarble"
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "ash" # Ashburn, VA (US East) — alternatives: fsn1 (Germany), nbg1 (Germany), hel1 (Finland)
}

variable "network_zone" {
  description = "Hetzner network zone"
  type        = string
  default     = "us-east"
}

# ─── Server Specs ────────────────────────────────────────────────────────────

variable "master_server_type" {
  description = "Hetzner server type for K3s master node"
  type        = string
  default     = "cpx21" # 3 vCPU, 4GB RAM, 80GB disk — $7.59/mo
}

variable "os_image" {
  description = "Operating system image"
  type        = string
  default     = "ubuntu-22.04"
}

# ─── K3s Configuration ──────────────────────────────────────────────────────

variable "k3s_version" {
  description = "K3s version to install"
  type        = string
  default     = "v1.29.2+k3s1"
}

variable "k3s_token" {
  description = "Shared secret for K3s cluster join (auto-generated if empty)"
  type        = string
  default     = ""
  sensitive   = true
}

# ─── Coolify (Frontend Hosting) ──────────────────────────────────────────────

variable "enable_coolify" {
  description = "Provision a dedicated VPS for Coolify (self-hosted frontend PaaS)"
  type        = bool
  default     = true
}

variable "coolify_server_type" {
  description = "Hetzner server type for Coolify VPS"
  type        = string
  default     = "cx22" # 2 vCPU, 4GB RAM, 40GB disk — ~$5.35/mo
}

# ─── DNS ─────────────────────────────────────────────────────────────────────

variable "domain" {
  description = "Base domain for the cluster (e.g., jarble.ai)"
  type        = string
  default     = "jarble.ai"
}

# ─── Longhorn Backup Target (L-09 / L-10) ───────────────────────────────────
#
# Longhorn ships volume backups to an S3-compatible bucket. The Hetzner
# Cloud Terraform provider (~> 1.45) does NOT yet have a resource for
# Hetzner Object Storage S3 buckets — only their legacy Storage Box product
# (`hcloud_storage_box`) which is WebDAV/SSH-only and not S3-compatible.
#
# So the bucket itself MUST be created out-of-band (Hetzner Console or
# `hcloud-cli` once it adds support). This Terraform module just wires up:
#   - the cluster setting `backup-target` to point at the bucket URL
#   - the cluster setting `backup-target-credential-secret` to point at a
#     k8s Secret containing the S3 credentials
#
# The Secret itself is also created out-of-band — its values are sensitive
# and should not live in Terraform state. See docs/audits/longhorn-backup-setup.md
# for the exact `kubectl create secret` command and bucket creation steps.
#
# Leave `longhorn_backup_target = ""` (the default) to skip the backup-target
# patches entirely — useful in dev/preview clusters where you don't want
# the cron jobs trying (and failing) to ship to a missing bucket. The
# RecurringJob CRs are still created (they're cheap snapshots) but the
# weekly-backup job will log an error and move on until a target is set.

variable "longhorn_backup_target" {
  description = "Longhorn backup-target URL. For Hetzner Object Storage: s3://BUCKET_NAME@REGION/. Example: s3://jarble-longhorn-backups@fsn1/. Leave empty to skip patching the backup-target settings."
  type        = string
  default     = ""
}

variable "longhorn_backup_secret_name" {
  description = "Name of the k8s Secret in longhorn-system holding S3 credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINTS). The Secret itself must be created out-of-band — see longhorn-backup-setup.md. Only used when longhorn_backup_target is non-empty."
  type        = string
  default     = "longhorn-backup-credentials"
}

# ─── Sandbox Isolation (Track B) ─────────────────────────────────────────────

variable "enable_gvisor" {
  description = "Create gVisor RuntimeClass (install runsc on workers first — see infrastructure/scripts/install-gvisor.sh)"
  type        = bool
  default     = false
}

variable "enable_kata" {
  description = "Create Kata+CLH RuntimeClass (requires dedicated server with /dev/kvm — see infrastructure/scripts/install-kata.sh)"
  type        = bool
  default     = false
}
