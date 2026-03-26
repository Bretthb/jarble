---
description: Hetzner auto-scaling, node manager, K3s worker provisioning
globs:
  - "jarble-api-main/src/k8s/nodeManager*"
  - "jarble-api-main/k8s/cluster-autoscaler*"
---

# Auto-Scaling (Hetzner K3s Workers)

Background watcher (`nodeManager.ts`) polls every 15s for Pending (Unschedulable) bot pods. Provisions Hetzner servers sized to pod CPU/RAM + block storage for Longhorn. Server joins K3s via cloud-init. Empty workers deprovisioned after 5 min. Controlled by `AUTOSCALE_ENABLED=true`.

## Server Type Mapping
| Pod CPU | Pod RAM | Hetzner Type | Server Specs |
|---------|---------|--------------|-------------|
| ≤1.5 vCPU | ≤1.5 GB | cpx11 | 2 vCPU, 2 GB |
| ≤2.5 vCPU | ≤3.5 GB | cpx21 | 3 vCPU, 4 GB |
| ≤3.5 vCPU | ≤7.5 GB | cpx31 | 4 vCPU, 8 GB |
| ≤7.5 vCPU | ≤15.5 GB | cpx41 | 8 vCPU, 16 GB |
| >7.5 vCPU | >15.5 GB | cpx51 | 16 vCPU, 32 GB |

## Key Files
| File | Purpose |
|------|---------|
| `jarble-api-main/src/k8s/nodeManager.ts` | Background watcher, Hetzner provisioning/deprovisioning |
| `jarble-api-main/src/db/schema*.ts` | `managed_nodes` table (tracks auto-provisioned servers) |
