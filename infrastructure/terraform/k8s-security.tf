# ─── Namespace Security Policies ─────────────────────────────────────────────
#
# Pod Security Standards and ResourceQuotas for the jarble namespace.
# Only applied when sandbox isolation is enabled (gVisor or Kata).
# ─────────────────────────────────────────────────────────────────────────────

# ─── Pod Security Standards ─────────────────────────────────────────────────
#
# Enforce "baseline" (blocks known-dangerous configs like hostNetwork, privileged)
# Warn + audit on "restricted" (the strictest policy — flags runAsRoot, capabilities)
#
# This catches misconfigured deployments before they run, without breaking
# existing workloads that meet baseline requirements.

resource "kubernetes_labels" "jarble_pss" {
  count = var.enable_gvisor || var.enable_kata ? 1 : 0

  api_version = "v1"
  kind        = "Namespace"

  metadata {
    name = "jarble"
  }

  labels = {
    "pod-security.kubernetes.io/enforce"         = "baseline"
    "pod-security.kubernetes.io/enforce-version" = "latest"
    "pod-security.kubernetes.io/warn"            = "restricted"
    "pod-security.kubernetes.io/warn-version"    = "latest"
    "pod-security.kubernetes.io/audit"           = "restricted"
    "pod-security.kubernetes.io/audit-version"   = "latest"
  }
}

# ─── Resource Quotas ────────────────────────────────────────────────────────
#
# Prevents runaway resource consumption in the jarble namespace.
# Adjust limits based on cluster capacity and expected deployment density.

resource "kubernetes_resource_quota" "jarble" {
  count = var.enable_gvisor || var.enable_kata ? 1 : 0

  metadata {
    name      = "jarble-quota"
    namespace = "jarble"

    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }

  spec {
    hard = {
      "requests.cpu"               = "32"
      "requests.memory"            = "64Gi"
      "limits.cpu"                 = "64"
      "limits.memory"              = "128Gi"
      "pods"                       = "200"
      "persistentvolumeclaims"     = "200"
    }
  }
}
