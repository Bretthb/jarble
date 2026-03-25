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
#
# Note: overhead and scheduling are applied post-deploy via kubectl, as the
# Terraform kubernetes provider doesn't support these RuntimeClass fields.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Kubernetes Provider ────────────────────────────────────────────────────
#
# Uses the K3s API on the master node. Only connects when sandbox
# isolation is enabled (either gVisor or Kata). When both are false,
# the provider is configured with a dummy host to avoid errors —
# no resources will be created since all counts are 0.

provider "kubernetes" {
  host     = var.enable_gvisor || var.enable_kata ? "https://${hcloud_server.master.ipv4_address}:6443" : "https://localhost"
  token    = var.enable_gvisor || var.enable_kata ? local.k3s_token : "unused"
  insecure = true
}

# ─── gVisor RuntimeClass ────────────────────────────────────────────────────

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
}

# ─── Kata + Cloud Hypervisor RuntimeClass ───────────────────────────────────

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
}
