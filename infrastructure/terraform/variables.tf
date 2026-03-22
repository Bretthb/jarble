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

variable "agent_server_type" {
  description = "Hetzner server type for K3s agent (worker) nodes"
  type        = string
  default     = "cpx21" # 3 vCPU, 4GB RAM, 80GB disk — $7.59/mo
}

variable "agent_count" {
  description = "Number of K3s agent (worker) nodes"
  type        = number
  default     = 2
}

# ─── Block Storage (Longhorn) ────────────────────────────────────────────────

variable "longhorn_volume_size" {
  description = "Size in GB of Hetzner Block Storage per worker node for Longhorn persistent data (formula: deployments_per_node x max_storage_per_deployment)"
  type        = number
  default     = 100 # 1 deployment x 100 GB max — increase for higher density
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

# ─── DNS ─────────────────────────────────────────────────────────────────────

variable "domain" {
  description = "Base domain for the cluster (e.g., jarble.ai)"
  type        = string
  default     = "jarble.ai"
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
