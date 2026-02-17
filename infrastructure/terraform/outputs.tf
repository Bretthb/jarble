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
    "api.${var.domain}"    = hcloud_server.master.ipv4_address
    "*.${var.domain}"      = hcloud_server.master.ipv4_address
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
