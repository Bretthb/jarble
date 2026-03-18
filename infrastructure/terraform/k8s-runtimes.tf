# ─── Kubernetes RuntimeClasses for Sandbox Isolation ─────────────────────────
#
# Track B: gVisor on existing VPS nodes + Kata on dedicated bare-metal servers
#
# Prerequisites:
#   - kubernetes provider configured (see provider block below)
#   - kubeconfig available after cluster bootstrap
#   - gVisor/Kata actually installed on nodes (see infrastructure/scripts/)
#
# These manifests are safe to apply before runtimes are installed —
# pods referencing an absent RuntimeClass simply won't schedule.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Kubernetes Provider ────────────────────────────────────────────────────
#
# Uses the kubeconfig from the master node. Only active when sandbox
# isolation is enabled (either gVisor or Kata).

provider "kubernetes" {
  host                   = var.enable_gvisor || var.enable_kata ? "https://${hcloud_server.master.ipv4_address}:6443" : null
  token                  = var.enable_gvisor || var.enable_kata ? local.k3s_token : null
  insecure               = true # K3s uses self-signed certs; in production use client_certificate
}

# ─── gVisor RuntimeClass ────────────────────────────────────────────────────
#
# gVisor (runsc) provides user-space kernel isolation. Works on standard
# VPS nodes — no /dev/kvm or nested virt required.
#
# Install gVisor on workers first: bash infrastructure/scripts/install-gvisor.sh

resource "kubernetes_runtime_class_v1" "gvisor" {
  count = var.enable_gvisor ? 1 : 0

  metadata {
    name = "gvisor"
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "jarble.ai/isolation-tier"     = "sandbox"
    }
  }

  handler = "runsc"

  overhead {
    pod_fixed = {
      cpu    = "100m"
      memory = "40Mi"
    }
  }
}

# ─── Kata + Cloud Hypervisor RuntimeClass ───────────────────────────────────
#
# Kata Containers with Cloud Hypervisor provides full MicroVM isolation.
# Requires a dedicated bare-metal server with /dev/kvm access.
#
# Node selector ensures pods only land on labeled dedicated nodes.
# Install Kata on the dedicated server: bash infrastructure/scripts/install-kata.sh

resource "kubernetes_runtime_class_v1" "kata_clh" {
  count = var.enable_kata ? 1 : 0

  metadata {
    name = "kata-clh"
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "jarble.ai/isolation-tier"     = "microvm"
    }
  }

  handler = "kata-clh"

  overhead {
    pod_fixed = {
      cpu    = "250m"
      memory = "160Mi"
    }
  }

  scheduling {
    node_selector = {
      "jarble.ai/runtime-capable" = "kata"
    }
  }
}
