# ─── Terraform Configuration ─────────────────────────────────────────────────
#
# Jarble K3s Cluster on Hetzner Cloud
#
# Usage:
#   terraform init
#   terraform plan -var="hcloud_token=YOUR_TOKEN"
#   terraform apply -var="hcloud_token=YOUR_TOKEN"
#
# To add more worker nodes:
#   Change agent_count variable and re-apply
#
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# ─── SSH Key ─────────────────────────────────────────────────────────────────

resource "hcloud_ssh_key" "default" {
  name       = "${var.cluster_name}-key"
  public_key = var.ssh_public_key != "" ? var.ssh_public_key : file(var.ssh_public_key_path)
}

# ─── Network ────────────────────────────────────────────────────────────────

resource "hcloud_network" "cluster" {
  name     = "${var.cluster_name}-network"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "cluster" {
  network_id   = hcloud_network.cluster.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = "10.0.1.0/24"
}

# ─── Firewall ───────────────────────────────────────────────────────────────

resource "hcloud_firewall" "cluster" {
  name = "${var.cluster_name}-firewall"

  # SSH
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # K3s API server (restrict to your IP in production)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "6443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # K3s inter-node communication (internal network only)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "10250"
    source_ips = ["10.0.0.0/16"]
  }

  # Flannel VXLAN
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "8472"
    source_ips = ["10.0.0.0/16"]
  }

  # etcd (K3s embedded)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "2379-2380"
    source_ips = ["10.0.0.0/16"]
  }
}

# ─── Agent Egress Firewall ──────────────────────────────────────────────────
#
# Tightens OUTBOUND traffic for auto-scaled agent VPSes (provisioned by
# nodeManager.ts). Attached IN ADDITION to hcloud_firewall.cluster — the
# cluster firewall handles inbound K3s traffic (ports 22/80/443/6443/10250/8472/2379-2380),
# and this firewall layers on an egress allowlist.
#
# Hetzner Cloud firewall semantics:
#   - Ingress is default-DENY (only listed rules allowed).
#   - Egress is default-ALLOW UNTIL the first egress rule exists, then it
#     flips to default-DENY (only listed rules allowed). So the moment we
#     add ANY rule with direction="out", everything not in the allowlist
#     below is dropped at the Hetzner network layer — including:
#       * 169.254.169.254 (Hetzner metadata SSRF — also blocked at iptables layer)
#       * Lateral scans into the private network outside our allowlist
#       * Crypto-mining stratum/SSH outbound exfil/SMB
#
# Multiple firewalls combine additively: this firewall provides ONLY egress
# rules, no ingress, so it inherits all ingress allowances from cluster firewall.
#
# DO NOT attach this to master or coolify — they need broader egress for
# cert-manager, Let's Encrypt, GHCR pulls, apt repos, etc.
resource "hcloud_firewall" "agent_egress" {
  name = "${var.cluster_name}-agent-egress"

  # ─── Outbound: DNS (UDP + TCP for large responses / DoT later) ───────────
  rule {
    direction        = "out"
    protocol         = "udp"
    port             = "53"
    destination_ips  = ["0.0.0.0/0", "::/0"]
    description      = "DNS resolution"
  }
  rule {
    direction        = "out"
    protocol         = "tcp"
    port             = "53"
    destination_ips  = ["0.0.0.0/0", "::/0"]
    description      = "DNS resolution (TCP)"
  }

  # ─── Outbound: HTTPS (LLM APIs, GHCR, npm registry, MCP servers) ─────────
  rule {
    direction        = "out"
    protocol         = "tcp"
    port             = "443"
    destination_ips  = ["0.0.0.0/0", "::/0"]
    description      = "HTTPS — LLM providers, container registries, MCPs"
  }

  # ─── Outbound: HTTP (apt mirrors, get.k3s.io redirects) ──────────────────
  rule {
    direction        = "out"
    protocol         = "tcp"
    port             = "80"
    destination_ips  = ["0.0.0.0/0", "::/0"]
    description      = "HTTP — apt repos, K3s installer redirects"
  }

  # ─── Outbound: K3s kubelet (private network only) ────────────────────────
  rule {
    direction        = "out"
    protocol         = "tcp"
    port             = "10250"
    destination_ips  = ["10.0.0.0/16"]
    description      = "K3s kubelet — private network only"
  }

  # ─── Outbound: K3s API server (private network only) ─────────────────────
  rule {
    direction        = "out"
    protocol         = "tcp"
    port             = "6443"
    destination_ips  = ["10.0.0.0/16"]
    description      = "K3s API server — private network only"
  }

  # ─── Outbound: Flannel VXLAN (private network only) ──────────────────────
  rule {
    direction        = "out"
    protocol         = "udp"
    port             = "8472"
    destination_ips  = ["10.0.0.0/16"]
    description      = "Flannel VXLAN overlay — private network only"
  }

  # ─── Outbound: NTP (time sync) ───────────────────────────────────────────
  rule {
    direction        = "out"
    protocol         = "udp"
    port             = "123"
    destination_ips  = ["0.0.0.0/0", "::/0"]
    description      = "NTP time sync"
  }

  # NOTE: All other outbound traffic is implicitly DENIED, including:
  #   - 169.254.169.254 (Hetzner metadata — SSRF vector, also blocked by iptables)
  #   - Arbitrary high TCP ports (port scanning, exploit shells, mining stratum)
  #   - SMB/CIFS (445), SSH outbound (22), IRC, etc.
  #   - 10.0.0.0/16 traffic outside the explicit kubelet/API/VXLAN allowlist
  #     (cuts off lateral kubelet→kubelet probes between agent VPSes).
}

# ─── K3s Token ──────────────────────────────────────────────────────────────

resource "random_password" "k3s_token" {
  count   = var.k3s_token == "" ? 1 : 0
  length  = 48
  special = false
}

locals {
  k3s_token = var.k3s_token != "" ? var.k3s_token : random_password.k3s_token[0].result
}

# ─── Master Node ─────────────────────────────────────────────────────────────

resource "hcloud_server" "master" {
  name        = "${var.cluster_name}-master"
  server_type = var.master_server_type
  image       = var.os_image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.default.id]

  firewall_ids = [hcloud_firewall.cluster.id]

  network {
    network_id = hcloud_network.cluster.id
    ip         = "10.0.1.10"
  }

  labels = {
    cluster = var.cluster_name
    role    = "master"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [ssh_keys, user_data]
  }

  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Wait for network
    sleep 10

    # Install K3s master with Traefik + Longhorn prerequisites
    apt-get update -qq
    apt-get install -y -qq open-iscsi nfs-common curl

    # Enable and start iscsid (required for Longhorn)
    systemctl enable iscsid
    systemctl start iscsid

    # Install K3s server
    curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${var.k3s_version}" sh -s - server \
      --token "${local.k3s_token}" \
      --tls-san "${var.cluster_name}-master" \
      --tls-san "$(curl -s http://169.254.169.254/hetzner/v1/metadata/public-ipv4)" \
      --node-ip "10.0.1.10" \
      --flannel-iface "enp7s0" \
      --disable "servicelb" \
      --write-kubeconfig-mode "0644"

    # Wait for K3s to be ready
    until kubectl get nodes; do sleep 5; done

    # Create jarble namespace
    kubectl create namespace jarble --dry-run=client -o yaml | kubectl apply -f -

    # Install Longhorn (block storage for persistent volumes)
    kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.6.0/deploy/longhorn.yaml

    # Set Longhorn as default storage class
    sleep 30
    kubectl patch storageclass longhorn -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
    kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'

    # Wait for Longhorn DaemonSets to exist before patching
    until kubectl -n longhorn-system get daemonset longhorn-manager >/dev/null 2>&1; do sleep 3; done
    until kubectl -n longhorn-system get daemonset longhorn-csi-plugin >/dev/null 2>&1; do sleep 3; done

    # Patch Longhorn DaemonSets so they schedule onto jarble-auto-* nodes,
    # which are tainted with jarble.ai/workload=agent:NoSchedule by nodeManager.ts.
    # See docs/audits/qa-bot-teams-2026-04-07.md and docs/audits/autoscaler-csi-fix-plan.md
    for DS in longhorn-manager longhorn-csi-plugin; do
      kubectl -n longhorn-system patch daemonset "$DS" --type=json -p='[
        {"op":"add","path":"/spec/template/spec/tolerations/-","value":{"key":"jarble.ai/workload","operator":"Equal","value":"agent","effect":"NoSchedule"}}
      ]' || true
    done

    # Install cert-manager for automatic TLS certificate provisioning
    kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml
    kubectl rollout status deployment/cert-manager -n cert-manager --timeout=120s
    kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=120s

    echo "K3s master setup complete" > /var/log/k3s-setup.log
  EOF

  depends_on = [hcloud_network_subnet.cluster]
}

# ─── Worker Nodes ────────────────────────────────────────────────────────────
#
# Static worker nodes are NOT managed by Terraform.
#   - jarble-agents (Discord bots) — manually provisioned, 10.0.1.50
#   - Auto-scaled agent VPS — provisioned by nodeManager.ts via Hetzner API
#
# The API runs as a pod on the master node (deployed via Kubero).
# ─────────────────────────────────────────────────────────────────────────────

# ─── Floating IP for Ingress ────────────────────────────────────────────────

resource "hcloud_primary_ip" "ingress" {
  name          = "${var.cluster_name}-ingress-ip"
  type          = "ipv4"
  location      = var.location
  assignee_type = "server"
  auto_delete   = false
}
