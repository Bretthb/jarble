# ─── Coolify VPS ─────────────────────────────────────────────────────────────
#
# Self-hosted PaaS for the Next.js frontend (replaces Vercel).
# Runs on a dedicated CX22 on the same Hetzner private network as K3s.
#
# After `terraform apply`:
#   1. SSH in: ssh root@<coolify_ip>
#   2. Install Coolify: curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
#   3. Access dashboard: http://<coolify_ip>:8000
#
# ─────────────────────────────────────────────────────────────────────────────

resource "hcloud_server" "coolify" {
  count = var.enable_coolify ? 1 : 0

  name        = "${var.cluster_name}-coolify"
  server_type = var.coolify_server_type
  image       = var.os_image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.default.id]

  firewall_ids = [hcloud_firewall.cluster.id]

  network {
    network_id = hcloud_network.cluster.id
    ip         = "10.0.1.30"
  }

  labels = {
    cluster = var.cluster_name
    role    = "coolify"
  }

  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Wait for network
    sleep 10

    # Install Docker (Coolify prerequisite)
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl enable docker
    systemctl start docker

    echo "Docker installed. SSH in and run: curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"
  EOF

  depends_on = [hcloud_network_subnet.cluster]
}
