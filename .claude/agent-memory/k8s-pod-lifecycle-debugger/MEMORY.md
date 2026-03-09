# K8s Pod Lifecycle Debugger -- Agent Memory

## Platform Architecture (Verified Feb 2026)

- Namespace: `jarble` (NOT `default` as docs claim)
- Naming: PVC=`pvc-{id}`, Secret=`secret-{id}`, Deployment=`dep-{id}`, Label=`app=dep-{id}`
- Single-replica deployments, RWO Longhorn PVCs, no Recreate strategy set
- Container name is always `"runtime"`, mount path is `/data`, configs at `/data/config/`
- MOCK_K8S mode uses in-memory `mockStore` Map
- DB status values: pending, creating, running, stopped, failed, stopping, restarting
- Schema default is "creating" but create mutation sets "pending" explicitly

## Key Files

- `jarble-api-main/src/k8s/deployment.ts` -- All K8s operations (1252 lines)
- `jarble-api-main/src/services/storageEnforcement.ts` -- 5min poll, exec `df`, stop if >=100%
- `jarble-api-main/src/services/configSync.ts` -- Two-way DB<->PVC sync, fire-and-forget
- `jarble-api-main/src/services/subscriptionEnforcement.ts` -- Free trial + Stripe checks
- `jarble-api-main/src/trpc/routers/deployment.ts` -- tRPC router, fire-and-forget patterns
- `jarble-api-main/src/index.ts` -- SSE status endpoint, config webhook, WhatsApp QR

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

## Patterns & Conventions

- `storageMb` field is historically misnamed -- it actually stores GB values
- All mock guards are at function top; `execInPodWithStdin` is the exception (private, guarded by caller)
- Fire-and-forget: `void (async () => { ... })()` -- status updated after K8s ops complete
- Platform credentials cascade-delete with deployments (DB foreign key)
- 3 schema files: schema.ts (MySQL default), schema.pg.ts, schema.sqlite.ts -- keep in sync
