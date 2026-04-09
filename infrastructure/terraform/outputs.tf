# ─── Outputs ─────────────────────────────────────────────────────────────────

output "master_ip" {
  description = "Public IP of the K3s master node"
  value       = hcloud_server.master.ipv4_address
}

output "master_private_ip" {
  description = "Private IP of the K3s master node"
  value       = "10.0.1.10"
}

output "ingress_ip" {
  description = "Floating IP for ingress (point DNS here)"
  value       = hcloud_primary_ip.ingress.ip_address
}

output "k3s_token" {
  description = "K3s cluster join token (sensitive)"
  value       = local.k3s_token
  sensitive   = true
}

output "kubeconfig_command" {
  description = "Command to fetch kubeconfig from master"
  value       = "scp root@${hcloud_server.master.ipv4_address}:/etc/rancher/k3s/k3s.yaml ./kubeconfig.yaml && sed -i 's/127.0.0.1/${hcloud_server.master.ipv4_address}/g' ./kubeconfig.yaml"
}

output "ssh_master" {
  description = "SSH command to connect to master"
  value       = "ssh root@${hcloud_server.master.ipv4_address}"
}

output "dns_records" {
  description = "DNS records to create"
  value = {
    "api.${var.domain}" = hcloud_server.master.ipv4_address
    "*.${var.domain}"   = hcloud_server.master.ipv4_address
  }
}

# ─── Firewall IDs (for nodeManager.ts auto-scaling) ─────────────────────────

output "agent_egress_firewall_id" {
  description = "ID of the agent_egress firewall — set as HETZNER_AGENT_EGRESS_FIREWALL_ID env var on the API deployment so nodeManager.ts attaches it to auto-scaled agent VPSes."
  value       = hcloud_firewall.agent_egress.id
}

output "cluster_firewall_id" {
  description = "ID of the shared cluster firewall — set as HETZNER_FIREWALL_ID env var on the API deployment."
  value       = hcloud_firewall.cluster.id
}

# ─── Longhorn Backup Configuration (L-09 / L-10) ────────────────────────────

output "longhorn_backups_enabled" {
  description = "True iff a backup-target URL is configured. When false, RecurringJob CRs still install (snapshots work) but the weekly off-cluster backup job will log an error until a target is set."
  value       = var.longhorn_backup_target != ""
}

output "longhorn_backup_target" {
  description = "Configured Longhorn backup-target URL (empty if disabled). The bucket must exist out-of-band — see docs/audits/longhorn-backup-setup.md."
  value       = var.longhorn_backup_target
}

output "longhorn_backup_secret_name" {
  description = "Name of the k8s Secret in longhorn-system holding S3 credentials. Create it out-of-band BEFORE setting longhorn_backup_target — see docs/audits/longhorn-backup-setup.md."
  value       = var.longhorn_backup_secret_name
}

# ─── Coolify (Frontend Hosting) ─────────────────────────────────────────────

output "coolify_ip" {
  description = "Public IP of the Coolify VPS (point jarble.ai DNS here)"
  value       = var.enable_coolify ? hcloud_server.coolify[0].ipv4_address : null
}

output "coolify_private_ip" {
  description = "Private IP of the Coolify VPS"
  value       = var.enable_coolify ? "10.0.1.30" : null
}

output "coolify_ssh" {
  description = "SSH command to connect to Coolify VPS"
  value       = var.enable_coolify ? "ssh root@${hcloud_server.coolify[0].ipv4_address}" : null
}

output "coolify_dashboard" {
  description = "Coolify dashboard URL (after install)"
  value       = var.enable_coolify ? "http://${hcloud_server.coolify[0].ipv4_address}:8000" : null
}

# ─── Sandbox Isolation ──────────────────────────────────────────────────────

output "runtime_classes" {
  description = "Available Kubernetes RuntimeClasses for sandbox isolation"
  value = compact([
    var.enable_gvisor ? "gvisor" : "",
    var.enable_kata ? "kata-clh" : "",
  ])
}

output "gvisor_install_command" {
  description = "Command to install gVisor on a worker node"
  value       = var.enable_gvisor ? "ssh root@<worker-ip> 'bash -s' < infrastructure/scripts/install-gvisor.sh" : null
}

output "kata_install_command" {
  description = "Command to install Kata on the dedicated server"
  value       = var.enable_kata ? "ssh root@<dedicated-ip> 'bash -s' < infrastructure/scripts/install-kata.sh" : null
}

output "dedicated_setup_script" {
  description = "Path to the generated dedicated server setup script"
  value       = var.enable_dedicated_server ? "infrastructure/scripts/generated/dedicated-setup.sh" : null
}
