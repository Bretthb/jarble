---
name: Infrastructure hosting setup
description: Coolify for frontend, Kubero for API, both on Hetzner K3s. Replacing Vercel.
type: project
---

Frontend (Next.js) is deployed via **Coolify** at `coolify.jarble.ai` to:
- `dev.jarble.ai` (development)
- `jarble.ai` (production)

API (Express + tRPC) is deployed via **Kubero** at `kubero.jarble.ai` to:
- `api.jarble.ai` (K3s namespace: `jarble-production`)

Both run on the Hetzner K3s cluster (master: `178.156.230.13`).

**Why:** Replacing Vercel for frontend deployments — moving everything to self-hosted on Hetzner.

**How to apply:** When setting env vars for the frontend, use Coolify dashboard, not Vercel. API env vars go through Kubero or `kubectl` on the K3s cluster. SSH to master: `ssh -i ~/.ssh/id_ed25519_hetzner root@178.156.230.13`.
