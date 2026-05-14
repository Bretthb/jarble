---
name: Cluster auto-scaling work in progress
description: Hetzner K3s auto-scaling — two approaches attempted, both need refinement. Custom nodeManager has provisioning logic but capacity detection edge cases. K8s cluster autoscaler deployed but can't resolve Terraform-provisioned nodes.
type: project
---

## Auto-scaling K3s Workers (2026-03-25)

**Goal**: Auto-provision Hetzner cpx21 workers when bot pods can't schedule, deprovision when empty.

### What's deployed:
- `cluster-autoscaler.yaml` in kube-system — Hetzner provider, CPX21:ASH pool, 0-10 range
- `nodeManager.ts` simplified to observability-only (capacity logging)
- `managed_nodes` table in DB (MySQL/PG/SQLite schemas)
- RBAC: `jarble-node-manager` ClusterRole (nodes + pods permissions)
- Master node tainted (`NoSchedule`) to prevent bot pods landing there
- Pod resource requests now match limits (guaranteed QoS)
- Hetzner env vars in K8s secret (HETZNER_API_TOKEN, NETWORK_ID, FIREWALL_ID, SSH_KEY_ID, K3S_JOIN_TOKEN)

### Issue with K8s Cluster Autoscaler:
- The Hetzner provider uses `k3s://{nodeName}` to look up servers in the Hetzner API
- Terraform-provisioned nodes (`jarble-agent-1`, `jarble-agent-2`) aren't found because they weren't created by the autoscaler
- Every loop errors: "failed to get servers for node jarble-agent-1 error: server not found"
- This blocks the autoscaler from reaching the scale-up logic

**Why:** The autoscaler expects to own all nodes. Existing Terraform nodes don't have the right provider IDs.

### Current approach (WORKING — needs network fix):
Background watcher polls every 15s for Pending (Unschedulable) bot pods.
When detected, provisions a Hetzner server via API. Server creates successfully.
**Issue**: K3s agent doesn't join because cloud-init doesn't set `--node-ip`
and the auto-assigned IPs (10.0.1.1, 10.0.1.2) conflict with the gateway.
**Fix needed**: Either assign a static private IP via the Hetzner API
(`POST /servers/{id}/actions/attach_to_network` with explicit IP) BEFORE
cloud-init runs, or pass the IP to cloud-init via server metadata/labels.

### Next steps:
1. Fix cloud-init network: either use `--node-ip` with a deterministic IP, or
   let K3s auto-detect from the `enp7s0` interface
2. Dynamic server sizing: match Hetzner server type + block storage to deployment
   config (user picks vCPU/RAM/storage, we provision the right server type)
3. Per-deployment VPS: each deployment gets its own server (1:1 mapping)

### Hetzner IDs:
- Network: 11998849
- Firewall: 10633885 (jarble-firewall)
- SSH Key: 109686600 (jarble-key)
- K3s token: UfFzWMkCq0l3cXHFSYydjedjGfUKxAGWKURFE89AnkfCHxTx
- API token: in K8s secret `jarble-api-secrets`

### Key files:
- `jarble-api-main/k8s/cluster-autoscaler.yaml`
- `jarble-api-main/src/k8s/nodeManager.ts`
- `jarble-api-main/src/k8s/constants.ts` (nodeName in DeploymentConfig)
- `jarble-api-main/src/k8s/lifecycle.ts` (nodeSelector for pinning, guaranteed QoS)
- `jarble-api-main/src/db/schema*.ts` (managed_nodes table)
