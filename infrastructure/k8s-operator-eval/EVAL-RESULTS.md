# OpenClaw K8s Operator — Evaluation Results

**Date**: 2026-03-02
**Operator Version**: 0.10.16 (Helm chart `oci://ghcr.io/openclaw-rocks/charts/openclaw-operator`)
**Cluster**: k3d-jarble (K3s), single node
**Namespace**: jarble-eval

## Verdict: CONDITIONAL GO

The operator works and provides significant value, but requires **2 changes before production adoption**:
1. Remap all PVC path references from `/data/` to `/home/openclaw/.openclaw/`
2. Implement stop/start via CR delete/create (no replica scaling)

---

## Test Results

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Operator installs via Helm | PASS | v0.10.16, CRDs registered instantly |
| 2 | CRD accepted by API server | PASS | Strict validation — caught 5 invalid fields in our initial CR |
| 3 | Pod starts and reaches Running | PASS (with override) | Required `readOnlyRootFilesystem: false` — our image writes to `/data/` at startup |
| 4 | Pod labels | DIFFERENT | `app.kubernetes.io/instance=test-eval-agent`, NOT `app=dep-{id}` |
| 5 | PVC mount path | DIFFERENT | `/home/openclaw/.openclaw` (not `/data`) |
| 6 | `kubectl exec` works | PASS | Both `-c openclaw` and default work |
| 7 | File writes to PVC persist | PASS | Writes to `/home/openclaw/.openclaw/` persist |
| 8 | Gateway `/healthz` responds | PASS | Returns OpenClaw Control HTML page (200 OK) |
| 9 | `df` works on PVC mount | PASS | `df -B1 /home/openclaw/.openclaw` returns correct Longhorn stats |
| 10 | Config files readable | PASS | Operator merged gateway config into `openclaw.json` automatically |
| 11 | Process restart (.reload) | UNTESTED | PID file exists at `/data/.openclaw.pid` (ephemeral path) |
| 12 | Read-only root FS | CONFIRMED | Had to disable for our image compatibility |
| 13 | CR deletion cascades | PASS | All resources deleted except PVC (retained by design) |

## Critical Findings

### 1. PVC Mount Path: `/home/openclaw/.openclaw` (not `/data`)

The operator mounts the PVC at `/home/openclaw/.openclaw`. Our image's entrypoint creates `/data/` directories on the root filesystem (overlay), which is **ephemeral**.

| What | Path | Persistent? |
|------|------|-------------|
| Operator PVC mount | `/home/openclaw/.openclaw` | YES |
| Our image's `/data/` | Root overlay FS | NO — lost on restart |
| `df -B1 /data` | Reports root FS, not PVC | Wrong metric |

**Impact**: All configSync writes to `/data/config/` are ephemeral. Components written to `/data/components/` are ephemeral. Only `/home/openclaw/.openclaw/` survives restarts.

**Fix**: Update all path references in `config.ts`, `components.ts`, `status.ts` to use a configurable `PVC_MOUNT_PATH`.

### 2. Pod Labels: `app.kubernetes.io/instance` (not `app=dep-{id}`)

Actual labels on operator-managed pods:
```
app.kubernetes.io/instance=test-eval-agent
app.kubernetes.io/managed-by=openclaw-operator
app.kubernetes.io/name=openclaw
```

Our `findPodForDeployment()` uses `app=dep-{deploymentId}`. 8 call sites need updating.

**Fix**: Extract label selector to `constants.ts`, update all callers.

### 3. Container Name: `openclaw` (not `runtime`)

Our `execInPod()` hardcodes container name `"runtime"`. Operator uses `"openclaw"`.

**Fix**: Make container name configurable in `constants.ts`.

### 4. No Replica Scaling — Stop Requires CR Deletion

The operator has no `replicas` field or pause/suspend mechanism. It always reconciles to 1 replica. Scaling the StatefulSet to 0 is immediately reverted by the operator.

**Stop**: Delete the CR (operator cleans up StatefulSet, Service, NetworkPolicy, PDB). PVC is retained.
**Start**: Re-create the CR with `storage.persistence.existingClaim` pointing to the retained PVC.

**Impact**: Our `stopDeployment()`/`startDeployment()` (patch replicas 0/1) won't work. Need CR delete/create cycle.

### 5. Operator Adds Gateway Proxy Sidecar (nginx)

Pods have 2 containers:
- `openclaw` — the actual OpenClaw runtime
- `gateway-proxy` — nginx reverse proxy (binds port 18789, proxies to loopback OpenClaw gateway)

The operator automatically:
- Injects gateway token into `openclaw.json` config
- Sets `gateway.bind: loopback` (OpenClaw only listens on localhost)
- Configures nginx to handle external auth + proxying

**Impact**: Chat proxy (`getPodAddress()`) connects to the nginx proxy, not directly to OpenClaw. Should work transparently since nginx exposes the same HTTP API.

### 6. Operator Creates Its Own ConfigMap

Our ConfigMap `config-test-eval-001` is NOT directly used. The operator creates `test-eval-agent-config` containing:
- `nginx.conf` — gateway proxy configuration
- `openclaw.json` — our config merged with operator-injected gateway settings

The operator's init container copies from this merged ConfigMap, not from ours directly.

**Impact**: ConfigMap naming convention differs. Our `configMapRef` is a source, not the final ConfigMap.

### 7. `readOnlyRootFilesystem` Incompatibility

Our image's entrypoint runs `mkdir -p /data/.openclaw/.openclaw` which fails with read-only root FS. We had to set `readOnlyRootFilesystem: false`.

**Long-term fix**: Update the OpenClaw image to support operator's PVC mount path, or use `workspace.initialDirectories` CRD field.

### 8. Gateway Token: `existingSecret` Requires `token` Key

When using `gateway.existingSecret`, the Secret must have a key named `token` (not `OPENCLAW_GATEWAY_TOKEN`). Our Secret needed patching to add this key.

**Fix**: When creating Secrets for operator-managed deployments, add both `OPENCLAW_GATEWAY_TOKEN` (for env var) and `token` (for operator gateway config).

## Resources Auto-Created by Operator

From a single OpenClawInstance CR, the operator created:

| Resource | Name | Notes |
|----------|------|-------|
| StatefulSet | `test-eval-agent` | 1 replica, 2 containers |
| Service | `test-eval-agent` | ClusterIP, ports 18789 (gateway), 18793 (?), 9090 (metrics) |
| PVC | `test-eval-agent-data` | 30Gi Longhorn, retained on CR delete |
| ConfigMap | `test-eval-agent-config` | Merged config + nginx.conf |
| NetworkPolicy | `test-eval-agent` | Per-instance isolation |
| PDB | `test-eval-agent` | maxUnavailable: 1 |
| ServiceAccount | `test-eval-agent` | |
| Role | `test-eval-agent` | |
| RoleBinding | `test-eval-agent` | |

## Migration Effort Reassessment

Based on actual findings, migration is more complex than initially estimated:

| Task | Original Est. | Revised Est. | Reason |
|------|---------------|--------------|--------|
| Path references (`/data/` → configurable) | Medium | Medium | ~20 references, mechanical |
| Label selector update | Low | Low | 8 call sites |
| Container name update | Low | Low | 4 references |
| Stop/start mechanism | Low | **High** | CR delete/create cycle replaces replica scaling. Need to manage PVC retention. |
| Gateway token key | Low | Low | Add `token` key alongside existing |
| ConfigMap workflow | N/A | **Medium** | Operator creates its own ConfigMap from our source. configSync needs adaptation. |
| Image compatibility | N/A | **Medium** | Either fix image or always override `readOnlyRootFilesystem` |

## Go/No-Go Assessment

### GO Criteria — Results

- [x] Pod exec works with standard `kubectl exec`
- [x] PVC is writable from main container at a known mount path (`/home/openclaw/.openclaw`)
- [x] ConfigMap files are copied to PVC by operator's init chain
- [x] Gateway health endpoint responds on port 18789
- [x] Pod labels are discoverable (need to update selector)
- [ ] Process restart via `.reload` marker — PID file exists but at ephemeral path
- [x] `df` storage usage check works on PVC mount

### NO-GO Criteria — Results

- [ ] Exec NOT blocked — works fine
- [x] PVC mount path IS different but configurable
- [ ] Config merge mode does NOT conflict — `overwrite` mode works as expected
- [x] Gateway token IS readable from Secret (need `token` key)
- [x] Label scheme change is manageable (~8 call sites)
- [ ] Read-only root FS CAN be overridden via CR

**Verdict**: No hard blockers. All issues have workarounds. Proceed to Phase C with the understanding that stop/start mechanism and path remapping are the biggest changes.
