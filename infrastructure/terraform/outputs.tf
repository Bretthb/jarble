# ─── Outputs ─────────────────────────────────────────────────────────────────

output "master_ip" {
  description = "Public IP of the K3s master node"
  value       = hcloud_server.master.ipv4_address
}

output "master_private_ip" {
  description = "Private IP of the K3s master node"
  value       = "10.0.1.10"
}

output "agent_ips" {
  description = "Public IPs of K3s agent nodes"
  value       = hcloud_server.agent[*].ipv4_address
}

output "agent_private_ips" {
  description = "Private IPs of K3s agent nodes"
  value       = [for i in range(var.agent_count) : "10.0.1.${20 + i}"]
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

output "longhorn_volume_ids" {
  description = "Hetzner Block Storage volume IDs for Longhorn"
  value       = hcloud_volume.longhorn[*].id
}

output "longhorn_volume_size_gb" {
  description = "Size (GB) of each Longhorn block storage volume"
  value       = var.longhorn_volume_size
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
