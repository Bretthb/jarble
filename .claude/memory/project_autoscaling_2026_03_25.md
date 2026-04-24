---
name: Cluster auto-scaling status
description: Hetzner K3s auto-scaling via custom nodeManager — operational. JAR-130 (2026-04-22) fixed the duplicate-InternalIP bug in cloud-init. Cluster autoscaler still can't own Terraform-provisioned nodes (kept disabled).
type: project
originSessionId: 7d6aaeae-717e-4337-96f8-6133fa8748ed
---
## Auto-scaling K3s Workers

**Goal**: Auto-provision Hetzner cpx31+ workers when agent pods can't schedule, deprovision when empty.

### What's live (as of 2026-04-22):
- Custom `nodeManager.ts` background watcher — polls every 15s for Pending pods, provisions right-sized cpx31/41/51 workers via Hetzner API.
- `managed_nodes` table tracks provisioned servers with status lifecycle (`provisioning` → `joining` → `ready` → `draining` → `deleting` → `deleted` / `failed`).
- RBAC: `jarble-node-manager` ClusterRole with nodes + pods permissions.
- Master node tainted (`NoSchedule`) so agent pods don't land there.
- Pod resource requests match limits (Guaranteed QoS).
- Env vars in K8s secret `jarble-api-secrets` (rotate per JAR-82).

### JAR-130 resolution (2026-04-22)
Cloud-init used to bake a pre-picked `--node-ip` that drifted from the NIC's actual Hetzner-DHCP-assigned IP. Result: two workers reported the same `InternalIP=10.0.1.30`, which broke every `kubectl exec` into pods on them (404 "pod does not exist"). Fix landed in PR #172:

- `buildCloudInit` now derives `--node-ip` from `enp7s0` at first boot, with a bounded wait + 10.0.0.0/8 validation so link-local 169.254 can't be captured.
- After K3s joins, `provisionNode` reads the reported InternalIP and updates `managed_nodes.nodeIp` — DB row now reflects reality instead of a pre-picked placeholder.
- `getNextNodeIp` removed — Hetzner owns allocation.

**Ops follow-up still open**: the two already-running duplicate-IP workers were provisioned under the old code. At least one needs draining before exec into their pods starts working. See Linear comment on JAR-130 for the drain playbook.

### Cluster Autoscaler (disabled)
`jarble-api-main/k8s/cluster-autoscaler.yaml` exists but the Hetzner provider requires `k3s://{nodeName}` identity that Terraform-provisioned nodes don't have ("server not found" on every loop). Kept disabled; custom nodeManager does the work instead.

### DB schema
Schema is Postgres-only now (MySQL + SQLite providers removed in commit 388018b). Unit tests use an in-memory SQLite mirror (`src/__tests__/helpers/testSchema.sqlite.ts`).

### Key files
- `jarble-api-main/src/k8s/nodeManager.ts` — provision/deprovision + capacity check.
- `jarble-api-main/src/k8s/constants.ts` — `nodeName` in `DeploymentConfig`, server tier table.
- `jarble-api-main/src/k8s/lifecycle.ts` — nodeSelector pinning, guaranteed QoS.
- `jarble-api-main/src/db/schema.pg.ts` — `managed_nodes` table.
- `jarble-api-main/k8s/cluster-autoscaler.yaml` — disabled, Hetzner env vars should use secretRef.

### Secrets note
**Do not commit Hetzner or K3s tokens to this file.** They live in `jarble-api-secrets` K8s secret; surface them only via `process.env` at runtime. JAR-82 tracks the rotation of the previous committed-then-revoked values.
