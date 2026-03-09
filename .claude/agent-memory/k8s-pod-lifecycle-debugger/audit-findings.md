# K8s Pod Lifecycle Audit -- Detailed Findings (Feb 2026, Full Reaudit)

## CRITICAL Findings

### C1: No Recreate Strategy -- RWO PVC Mount Races
- File: `jarble-api-main/src/k8s/deployment.ts` line 196-228
- Deployment spec has no `strategy` field; K8s defaults to RollingUpdate
- With RWO PVCs, new pod can't mount if old pod hasn't fully terminated
- `restartDeployment()` only waits 2s (line 336) between stop and start
- Affects every restart and rolling update scenario

### C2: createDeployment Partial Failure Orphans K8s Resources
- File: `jarble-api-main/src/k8s/deployment.ts` lines 164-228
- Sequential creation: PVC (line 164) -> Secret (line 190) -> Deployment (line 196)
- If Secret or Deployment creation fails, previously created resources are not cleaned up
- Orphaned PVCs/Secrets block retry since K8s returns "already exists"
- No rollback logic in catch block

### C3: Fire-and-Forget Deploy Sets "running" Without Verifying Pod
- File: `jarble-api-main/src/trpc/routers/deployment.ts` lines 411-434
- `deploy` mutation: fire-and-forget block sets `status: "running"` immediately
  after `createDeployment()` returns, without checking actual pod readiness
- `createDeployment()` returns after K8s Deployment is created, not when pod is Running
- Compare: `start` mutation (line 702) correctly polls `getDeploymentPodStatus()`
- DB status says "running" while pod may still be Pending/Creating

## HIGH Findings

### H1: Status Race Between Fire-and-Forget and Enforcement Services
- Files: `jarble-api-main/src/trpc/routers/deployment.ts` lines 411-434, 702-724, 766-790
- Files: `jarble-api-main/src/services/storageEnforcement.ts` lines 60-64
- Files: `jarble-api-main/src/services/subscriptionEnforcement.ts` lines 66-72
- Fire-and-forget blocks unconditionally overwrite DB status on completion
- If enforcement service stops a deployment (sets status="stopped"), the fire-and-forget
  block can overwrite it back to "running" moments later
- No optimistic concurrency / "only update if still in expected state" guard
- Specific scenario: enforcement sets stopped at t=1, f&f poll finishes at t=2 -> running

### H2: SSE Status Sync Fire-and-Forget DB Update Not Awaited
- File: `jarble-api-main/src/index.ts` line 868
- `void (db as any).update(...)` -- DB write is fire-and-forget, never awaited
- If it fails (connection error, etc.), status divergence between K8s and DB persists silently
- This is the "self-healing" sync that should correct DB<->K8s drift

### H3: restart/start Procedures Use Hardcoded 2s Delay Instead of Pod Termination Polling
- File: `jarble-api-main/src/k8s/deployment.ts` line 336
- `restartDeployment()` does `await stopDeployment()` then `setTimeout(2000)` then `startDeployment()`
- Pod termination grace period defaults to 30s in K8s; 2s is often insufficient
- Combined with missing Recreate strategy (C1), this guarantees PVC mount conflicts on slow shutdowns

### H4: Config-Changed Webhook Has No Authentication
- File: `jarble-api-main/src/index.ts` lines 424-448
- Comment says "DEPLOYMENT_ID is a random nanoid only the pod knows"
- But any caller who can guess/obtain a deployment ID can trigger config sync
- No shared secret, HMAC, or API key verification
- Could be exploited to force config re-reads or trigger unexpected restarts

## MEDIUM Findings

### M1: Storage Enforcement Uses DB storageMb Not Actual PVC Size
- File: `jarble-api-main/src/services/storageEnforcement.ts` line 47
- `allocatedGb = dep.storageMb || 30` reads from DB, not from `df` output's `totalGb`
- PVC might be provisioned at a different size than DB records
- If user updates storageMb via the update mutation, enforcement uses the new value
  even though the PVC has not been resized (Longhorn PVC expansion is a separate operation)

### M2: Shell Injection Risk in writeConfigsToPvc
- File: `jarble-api-main/src/k8s/deployment.ts` line 755
- `["sh", "-c", \`cat > ${filePath}\`]` -- filePath is interpolated into shell command
- filePath comes from `file.path` which is rendered by runtime handlers
- Currently safe because handler paths are static strings, but no sanitization exists
- A malicious or buggy handler could inject shell commands

### M3: updateDeploymentSecret Hardcodes TEMPLATE="personal"
- File: `jarble-api-main/src/k8s/deployment.ts` line 975
- `createDeployment()` uses `config.template || "personal"` (line 179)
- `updateDeploymentSecret()` always sets `TEMPLATE: "personal"` (line 975)
- If a deployment was created with a different template, secret updates override it
- Called from `configSync.ts` line 157 during every config sync cycle

### M4: Schema Default for status is "creating" But create Mutation Sets "pending"
- File: `jarble-api-main/src/db/schema.pg.ts` line 43, `schema.sqlite.ts` line 45, `schema.ts` line 43
- Schema: `status: varchar("status", ...).notNull().default("creating")`
- Router create mutation (deployment.ts line 321): explicitly sets `status: "pending"`
- If a row is ever inserted without explicit status (e.g., DB migration, manual insert),
  it gets "creating" which may confuse enforcement services that only query for "running"
- Not a functional bug today but a consistency issue

### M5: No Liveness/Readiness Probes on Pod Spec
- File: `jarble-api-main/src/k8s/deployment.ts` lines 207-218
- Container spec has no readiness or liveness probes
- K8s marks the pod as Ready based solely on the container process starting
- A pod where the application is deadlocked or hung will appear "running" forever
- Storage enforcement exec may hang or timeout without detection
- Status checks rely entirely on container started flag

### M6: Concurrent configSync Can Corrupt Deployment State
- File: `jarble-api-main/src/services/configSync.ts` lines 101-203
- `syncConfigsToPvc` is called fire-and-forget from multiple locations:
  - deployment.ts router update (line 624): `void syncConfigsToPvc(id)`
  - index.ts WhatsApp connect (line 722): `void syncConfigsToPvc(deploymentId)`
  - platformCredentials router (multiple places)
- No mutex/lock: two concurrent syncs can both set status="creating",
  both restart the pod, then both poll -- one overwrites the other's final status
- Rapid config changes (e.g., user saves twice quickly) trigger overlapping restarts

## LOW Findings

### L1: execInPodWithStdin Has No MOCK_K8S Guard
- File: `jarble-api-main/src/k8s/deployment.ts` line 919
- Private function, currently only called from `writeConfigsToPvc()` which has its own mock guard
- If called directly in mock mode, `exec!` would be null -- runtime null dereference
- Latent bug, currently unreachable

### L2: Mock Mode Status Inconsistencies
- File: `jarble-api-main/src/k8s/deployment.ts`
- Mock `createDeployment` sets status="running" immediately (line 122)
- Real K8s creation doesn't set any mock status (it creates actual K8s resources)
- Mock `getDeploymentPodStatus` returns "not_found" for stopped (line 392)
- Real K8s may still have a terminating pod for stopped deployments
- Mock behavior doesn't faithfully simulate real K8s lifecycle timing

### L3: getDeploymentPodStatus Swallows Errors as "not_found"
- File: `jarble-api-main/src/k8s/deployment.ts` lines 455-458
- Catch block returns `{ status: "not_found" }` for any K8s API error
- Network timeouts, auth failures, and rate limiting are all hidden as "not_found"
- Callers (enforcement, SSE sync) treat "not_found" as "no pod" which is wrong
  for transient API failures

### L4: storageMb Field Naming Confusion Across Codebase
- DB column: `storage_mb` (integer, actually stores GB values)
- Schema comments: "storage in GB (historical naming)"
- DeploymentConfig interface: `storageMb?: number` with comment "persistent storage in GB (historical naming)"
- MockDeployment interface: `storageMb: number`
- Consistently treated as GB but named MB everywhere -- documentation hazard

### L5: DB Delete After K8s Delete Has No Atomicity
- File: `jarble-api-main/src/trpc/routers/deployment.ts` lines 1064-1068
- `deleteDeployment()` (K8s) runs first, then DB delete
- If K8s delete succeeds but DB delete fails (connection error), K8s resources are gone
  but DB still has the deployment record -- orphaned DB record pointing to nothing
- Reverse order would be worse (DB gone but K8s resources still running)
- Best fix: mark as "deleting" first, delete K8s, then delete DB
