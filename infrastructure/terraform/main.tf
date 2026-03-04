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
      --flannel-iface "ens10" \
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

    # Install cert-manager for automatic TLS certificate provisioning
    kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml
    kubectl rollout status deployment/cert-manager -n cert-manager --timeout=120s
    kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=120s

    echo "K3s master setup complete" > /var/log/k3s-setup.log
  EOF

  depends_on = [hcloud_network_subnet.cluster]
}

# ─── Agent (Worker) Nodes ────────────────────────────────────────────────────

resource "hcloud_server" "agent" {
  count       = var.agent_count
  name        = "${var.cluster_name}-agent-${count.index + 1}"
  server_type = var.agent_server_type
  image       = var.os_image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.default.id]

  firewall_ids = [hcloud_firewall.cluster.id]

  network {
    network_id = hcloud_network.cluster.id
    ip         = "10.0.1.${20 + count.index}"
  }

  labels = {
    cluster = var.cluster_name
    role    = "agent"
    index   = tostring(count.index + 1)
  }

  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Wait for network + master to be ready
    sleep 30

    # Install prerequisites for Longhorn
    apt-get update -qq
    apt-get install -y -qq open-iscsi nfs-common curl

    # Enable and start iscsid (required for Longhorn)
    systemctl enable iscsid
    systemctl start iscsid

    # ── Mount Hetzner Block Storage at Longhorn default data path ──
    VOLUME_DEVICE="/dev/disk/by-id/scsi-0HC_Volume_${hcloud_volume.longhorn[count.index].id}"
    MOUNT_PATH="/var/lib/longhorn"

    # Wait for volume device to appear (attachment may be in progress)
    echo "Waiting for block storage device..."
    for i in $(seq 1 60); do
      if [ -b "$VOLUME_DEVICE" ]; then
        echo "Volume device found: $VOLUME_DEVICE"
        break
      fi
      if [ "$i" -eq 60 ]; then
        echo "ERROR: Volume device not found after 5 minutes"
        exit 1
      fi
      sleep 5
    done

    # Mount (volume is pre-formatted as ext4 by Hetzner API)
    mkdir -p "$MOUNT_PATH"
    mount -o discard,defaults "$VOLUME_DEVICE" "$MOUNT_PATH"

    # Persist mount across reboots via fstab
    if ! grep -q "$VOLUME_DEVICE" /etc/fstab; then
      echo "$VOLUME_DEVICE $MOUNT_PATH ext4 discard,nofail,defaults 0 0" >> /etc/fstab
    fi

    echo "Block storage mounted at $MOUNT_PATH"
    # ────────────────────────────────────────────────────────────────

    # Install K3s agent — joins the master
    curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${var.k3s_version}" sh -s - agent \
      --server "https://10.0.1.10:6443" \
      --token "${local.k3s_token}" \
      --node-ip "10.0.1.${20 + count.index}" \
      --flannel-iface "ens10"

    echo "K3s agent setup complete" > /var/log/k3s-setup.log
  EOF

  depends_on = [hcloud_server.master, hcloud_network_subnet.cluster]
}

# ─── Block Storage for Longhorn ──────────────────────────────────────────────

resource "hcloud_volume" "longhorn" {
  count    = var.agent_count
  name     = "${var.cluster_name}-longhorn-${count.index + 1}"
  size     = var.longhorn_volume_size
  location = var.location
  format   = "ext4"

  labels = {
    cluster = var.cluster_name
    role    = "longhorn-data"
    agent   = tostring(count.index + 1)
  }
}

resource "hcloud_volume_attachment" "longhorn" {
  count     = var.agent_count
  volume_id = hcloud_volume.longhorn[count.index].id
  server_id = hcloud_server.agent[count.index].id
  automount = false
}

# ─── Floating IP for Ingress ────────────────────────────────────────────────

resource "hcloud_primary_ip" "ingress" {
  name          = "${var.cluster_name}-ingress-ip"
  type          = "ipv4"
  datacenter    = "${var.location}-dc1"
  assignee_type = "server"
  auto_delete   = false
}
