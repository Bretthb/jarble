---
name: Docker builds must NOT run on master node
description: Critical lesson — Docker build on K3s master node caused load average 82, crashed SSH and kubectl. Use GitHub Actions or dedicated build server.
type: feedback
---

NEVER build Docker images on the K3s master node.

**Why:** On 2026-04-06, a Docker build (`docker build` for the API image) on the master node caused load average to spike to 82.50, making SSH unresponsive and kubectl commands hang. The master node is a small VPS that also runs K3s control plane, Longhorn, cert-manager, etc. npm ci + tsc compilation exhausted CPU/RAM.

**How to apply:**
- Use GitHub Actions workflow (`.github/workflows/deploy-api.yml`) for image builds — builds on GitHub's runners, pushes to GHCR
- The Coolify/Kubero server is for frontend builds only (currently not provisioned)
- If manual build needed: use a separate build machine, never the master
- After accidental build on master: stop Docker (`systemctl stop docker`), clean up (`rm -rf /tmp/jarble-build`), wait for load to recover
