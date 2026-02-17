# ─── Remote State Backend ───────────────────────────────────────────────────
#
# State is stored in Terraform Cloud (free tier).
# Execution mode is "Local" — plans/applies run in GitHub Actions or on the
# developer's machine, and only the state file is stored remotely.
#
# First-time setup:
#   1. Run: terraform login
#   2. Run: terraform init
#   3. When prompted, migrate existing local state to the remote backend
#
# For CI, the TF_API_TOKEN environment variable authenticates instead of
# `terraform login`.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  cloud {
    organization = "jarble"

    workspaces {
      name = "jarble-infrastructure"
    }
  }
}
