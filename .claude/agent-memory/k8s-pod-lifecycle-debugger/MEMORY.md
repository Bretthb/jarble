# K8s Pod Lifecycle Debugger -- Agent Memory

## Platform Architecture (Verified Feb 2026)

- Namespace: `jarble` (NOT `default` as docs claim)
- Naming: PVC=`pvc-{id}`, Secret=`secret-{id}`, Deployment=`dep-{id}`, Label=`app=dep-{id}`
- Single-replica deployments, RWO Longhorn PVCs, Recreate strategy (fixed from earlier audit)
- Pods now have liveness+readiness probes, resource limits, ephemeral-storage limits
- Init container (`config-init`, busybox) copies ConfigMap to PVC before main container starts
- Container name is always `"runtime"`, mount path is `/data`, configs at `/data/config/`
- MOCK_K8S mode uses in-memory `mockStore` Map
- DB status values: pending, creating, running, stopped, failed, stopping, restarting
- Schema default is "creating" but create mutation sets "pending" explicitly

## Key Files (Updated Mar 2026)

K8s code was refactored from monolithic `deployment.ts` into `src/k8s/` modules:
- `jarble-api-main/src/k8s/index.ts` -- Barrel re-export
- `jarble-api-main/src/k8s/client.ts` -- KubeConfig, coreApi, appsApi, execClient
- `jarble-api-main/src/k8s/lifecycle.ts` -- create/start/stop/restart/delete deployment
- `jarble-api-main/src/k8s/status.ts` -- getPodAddress, getDeploymentPodStatus, storage usage
- `jarble-api-main/src/k8s/exec.ts` -- execInPod, execInPodWithStdin, findPodForDeployment
- `jarble-api-main/src/k8s/config.ts` -- writeConfigsToPvc, readConfigsFromPvc
- `jarble-api-main/src/k8s/configmap.ts` -- ConfigMap-based config (replaces exec-based writes)
- `jarble-api-main/src/k8s/secrets.ts` -- updateDeploymentSecret
- `jarble-api-main/src/services/openclawGateway.ts` -- WS client for pod chat (Ed25519 auth)
- `jarble-api-main/src/routes/tamboAgent.ts` -- Chat endpoint (WS gateway + exec fallback)
- `jarble-api-main/src/routes/diagnose.ts` -- Health check endpoint
- `jarble-api-main/k8s/deployment.yaml` -- K8s manifests (SA, Role, Deployment, Service, Ingress)

## Known Bugs (Full Audit Feb 2026)

See `audit-findings.md` for full details with line numbers. Summary:
- **CRITICAL**: No `Recreate` strategy + 2s restart delay = RWO PVC mount races
- **CRITICAL**: `createDeployment` partial failure orphans PVCs/Secrets (no cleanup)
- **CRITICAL**: `deploy` mutation sets "running" without verifying pod readiness
- **HIGH**: F&F status overwrites race with enforcement services (can undo stops)
- **HIGH**: SSE status sync DB write is fire-and-forget, never awaited
- **HIGH**: Config webhook has no authentication beyond deploymentId
- **MEDIUM**: Storage enforcement uses DB storageMb not actual PVC size
- **MEDIUM**: Shell injection risk in writeConfigsToPvc (sh -c cat > path)
- **MEDIUM**: updateDeploymentSecret hardcodes TEMPLATE="personal"
- **MEDIUM**: No liveness/readiness probes on pods
- **MEDIUM**: Concurrent configSync calls can corrupt state (no mutex)

## Production Bugs Found (Mar 2026 Debugging Session)

See `prod-chat-broken-mar2026.md` for full details.

1. **OpenClaw origin rejection** -- `openclawGateway.ts:128` sends `origin: "http://localhost"`, OpenClaw rejects non-matching origins even with `dangerouslyAllowHostHeaderOriginFallback: true` (flag only applies when NO origin is sent)
2. **K3s exec 403** -- RBAC role has `pods/exec: [create]` but `@kubernetes/client-node` Exec sends GET+Upgrade, K3s v1.29 checks `get` verb. Fix: add `get` to pods/exec verbs
3. **No exec fallback for origin errors** -- `tamboAgent.ts:1347` regex only matches connection errors (ETIMEDOUT etc), not auth errors like "origin not allowed"
4. **K8s manifest drift** -- `k8s/deployment.yaml` is outdated vs live cluster (missing configmaps, services resources)

## Production Bugs Found (Apr 2026 Debugging Session)

See `autoscaler-label-silent-failure.md` for details.

5. **Autoscaler label PATCH silent failure** -- `nodeManager.ts:497-513` swallows label PATCH error as "non-fatal". Node ends up with `jarble.ai/workload=agent:NoSchedule` taint applied but missing `jarble.ai/auto-scaled=true` label, leaving agent pod permanently Pending (required nodeAffinity from `lifecycle.ts:113-160`). Quick unblock: `kubectl label node jarble-auto-{id} jarble.ai/auto-scaled=true jarble.ai/role=agent jarble.ai/managed-node-id={dbId}`. Real fix: throw on label failure OR add read-back verification + retry OR periodic reconciler.

## Patterns & Conventions

- `storageMb` field is historically misnamed -- it actually stores GB values
- All mock guards are at function top; `execInPodWithStdin` is the exception (private, guarded by caller)
- Fire-and-forget: `void (async () => { ... })()` -- status updated after K8s ops complete
- Platform credentials cascade-delete with deployments (DB foreign key)
- 3 schema files: schema.ts (MySQL default), schema.pg.ts, schema.sqlite.ts -- keep in sync
