# main.tf - K3s Cluster on Hetzner with Longhorn
#
# Deploy with: terraform apply
# Destroy with: terraform destroy

terraform {
  required_version = ">= 1.0"
  
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    ssh = {
      source  = "loafoe/ssh"
      version = "~> 2.6"
    }
  }
}

# ============================================
# PROVIDERS
# ============================================

provider "hcloud" {
  token = var.hetzner_token
}

# ============================================
# NETWORKING
# ============================================

resource "hcloud_network" "k3s" {
  name     = "${var.cluster_name}-network"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "k3s" {
  network_id   = hcloud_network.k3s.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.1.0/24"
}

# ============================================
# SSH KEY
# ============================================

resource "hcloud_ssh_key" "default" {
  name       = "${var.cluster_name}-key"
  public_key = file(var.ssh_public_key_path)
}

# ============================================
# CONTROL PLANE NODE
# ============================================

resource "hcloud_server" "control_plane" {
  name        = "${var.cluster_name}-control"
  server_type = var.control_plane_type
  image       = "ubuntu-22.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.default.id]

  network {
    network_id = hcloud_network.k3s.id
    ip         = "10.0.1.10"
  }

  labels = {
    role    = "control-plane"
    cluster = var.cluster_name
  }

  user_data = <<-EOF
    #!/bin/bash
    set -e
    
    # Install dependencies for Longhorn
    apt-get update
    apt-get install -y open-iscsi nfs-common
    systemctl enable iscsid
    systemctl start iscsid
    
    # Install K3s server
    curl -sfL https://get.k3s.io | sh -s - server \
      --disable traefik \
      --disable servicelb \
      --write-kubeconfig-mode 644 \
      --tls-san ${self.ipv4_address} \
      --node-ip 10.0.1.10 \
      --advertise-address 10.0.1.10
    
    # Wait for K3s to be ready
    until kubectl get nodes; do sleep 2; done
    
    # Save token for workers
    cat /var/lib/rancher/k3s/server/node-token > /root/k3s-token
  EOF

  depends_on = [hcloud_network_subnet.k3s]
}

# ============================================
# WORKER NODES
# ============================================

resource "hcloud_server" "worker" {
  count       = var.worker_count
  name        = "${var.cluster_name}-worker-${count.index + 1}"
  server_type = var.worker_type
  image       = "ubuntu-22.04"
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.default.id]

  network {
    network_id = hcloud_network.k3s.id
    ip         = "10.0.1.${count.index + 11}"
  }

  labels = {
    role    = "worker"
    cluster = var.cluster_name
  }

  depends_on = [hcloud_network_subnet.k3s]
}

# ============================================
# GET K3S TOKEN & INSTALL ON WORKERS
# ============================================

# Wait for control plane to be ready and get token
resource "ssh_resource" "get_k3s_token" {
  host        = hcloud_server.control_plane.ipv4_address
  user        = "root"
  private_key = file(var.ssh_private_key_path)

  timeout = "5m"

  commands = [
    "until [ -f /root/k3s-token ]; do sleep 5; done",
    "cat /root/k3s-token"
  ]

  depends_on = [hcloud_server.control_plane]
}

# Install K3s on workers
resource "ssh_resource" "install_k3s_worker" {
  count       = var.worker_count
  host        = hcloud_server.worker[count.index].ipv4_address
  user        = "root"
  private_key = file(var.ssh_private_key_path)

  timeout = "10m"

  commands = [
    "apt-get update && apt-get install -y open-iscsi nfs-common",
    "systemctl enable iscsid && systemctl start iscsid",
    "curl -sfL https://get.k3s.io | K3S_URL=https://10.0.1.10:6443 K3S_TOKEN=${ssh_resource.get_k3s_token.result} sh -s - agent --node-ip 10.0.1.${count.index + 11}"
  ]

  depends_on = [ssh_resource.get_k3s_token]
}

# ============================================
# GET KUBECONFIG
# ============================================

resource "ssh_resource" "get_kubeconfig" {
  host        = hcloud_server.control_plane.ipv4_address
  user        = "root"
  private_key = file(var.ssh_private_key_path)

  commands = [
    "cat /etc/rancher/k3s/k3s.yaml | sed 's/127.0.0.1/${hcloud_server.control_plane.ipv4_address}/g'"
  ]

  depends_on = [ssh_resource.install_k3s_worker]
}

# Save kubeconfig locally
resource "local_file" "kubeconfig" {
  content  = ssh_resource.get_kubeconfig.result
  filename = "${path.module}/kubeconfig.yaml"

  depends_on = [ssh_resource.get_kubeconfig]
}

# ============================================
# KUBERNETES & HELM PROVIDERS
# ============================================

provider "kubernetes" {
  config_path = local_file.kubeconfig.filename
}

provider "helm" {
  kubernetes {
    config_path = local_file.kubeconfig.filename
  }
}

# ============================================
# INSTALL LONGHORN
# ============================================

resource "helm_release" "longhorn" {
  name             = "longhorn"
  repository       = "https://charts.longhorn.io"
  chart            = "longhorn"
  namespace        = "longhorn-system"
  create_namespace = true

  set {
    name  = "defaultSettings.defaultReplicaCount"
    value = var.worker_count >= 3 ? "3" : var.worker_count
  }

  set {
    name  = "defaultSettings.defaultDataPath"
    value = "/var/lib/longhorn"
  }

  # Backup to R2/S3 (optional)
  dynamic "set" {
    for_each = var.backup_s3_endpoint != "" ? [1] : []
    content {
      name  = "defaultSettings.backupTarget"
      value = "s3://${var.backup_s3_bucket}@${var.backup_s3_region}/"
    }
  }

  depends_on = [local_file.kubeconfig, ssh_resource.install_k3s_worker]
}

# ============================================
# INSTALL TRAEFIK (Ingress)
# ============================================

resource "helm_release" "traefik" {
  name             = "traefik"
  repository       = "https://traefik.github.io/charts"
  chart            = "traefik"
  namespace        = "traefik"
  create_namespace = true

  set {
    name  = "service.type"
    value = "LoadBalancer"
  }

  depends_on = [helm_release.longhorn]
}

# ============================================
# CREATE JARBLE NAMESPACE
# ============================================

resource "kubernetes_namespace" "jarble" {
  metadata {
    name = "jarble"
  }

  depends_on = [helm_release.longhorn]
}

# ============================================
# OUTPUTS
# ============================================

output "control_plane_ip" {
  value       = hcloud_server.control_plane.ipv4_address
  description = "Public IP of the control plane"
}

output "worker_ips" {
  value       = hcloud_server.worker[*].ipv4_address
  description = "Public IPs of worker nodes"
}

output "kubeconfig_path" {
  value       = local_file.kubeconfig.filename
  description = "Path to kubeconfig file"
}

output "cluster_ready" {
  value       = "Run: export KUBECONFIG=${local_file.kubeconfig.filename}"
  description = "Command to use the cluster"
}
