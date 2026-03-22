# OpenClaw K8s Operator — Field Mapping & Compatibility Analysis

## Overview

Maps every function in our 8 K8s module files to the operator CRD equivalent. Total code replaced: ~420 lines across `lifecycle.ts`, `configmap.ts`, and parts of `constants.ts`/`components.ts`.

---

## Part 1: What the Operator Replaces

### lifecycle.ts — createDeployment() (Lines 9–255)

Our `createDeployment()` creates 4 K8s resources sequentially with rollback on failure. The operator replaces all of this with a single CR apply.

| Our Code (lifecycle.ts) | K8s Resource Created | Operator CRD Field | Notes |
|---|---|---|---|
| L40-48: `createNamespacedPersistentVolumeClaim()` | PVC `pvc-{id}`, 30Gi Longhorn RWO | `spec.storage.persistence` | Operator creates PVC automatically. Name may differ (e.g. `{name}-data-0`). |
| L51-76: `createNamespacedSecret()` | Secret `secret-{id}` with env vars | `spec.envFrom` + `spec.env` | We still create the Secret. Operator references it via `envFrom`. |
| L52: `crypto.randomBytes(32)` gateway token | Part of Secret | `spec.gateway.autoGenerateToken` | Set to `false` — we manage the token so `getPodAddress()` can read it back. |
| L78-85: `createDeploymentConfigMap()` | ConfigMap `config-{id}` | `spec.config.configMapRef` | We still create the ConfigMap. Operator copies it to PVC via init chain. |
| L87-111: busybox init container script | Init container `config-init` | Operator's built-in init chain | Operator handles ConfigMap → PVC copy. Our `abs-` key encoding may need adaptation. |
| L149-164: validate-config init container | Init container `validate-config` | Operator may have built-in validation | Need to verify. If not, we lose pre-flight config validation. |
| L115-224: `createNamespacedDeployment()` | Deployment `dep-{id}`, 1 replica, Recreate strategy | Entire CRD | Operator creates a **StatefulSet** (not Deployment). Pod name: `{name}-0`. |
| L117-118: labels `app: dep-{id}` | Deployment + pod labels | Operator's label scheme | **CRITICAL**: Our `findPodForDeployment()` uses `app=dep-{id}` selector. |
| L127: `automountServiceAccountToken: false` | Pod spec | Operator default | Operator likely sets this by default. Verify. |
| L129-131: `runAsNonRoot: false, fsGroup: 1000` | Pod security context | Operator overrides | Operator defaults to `runAsNonRoot: true`. May need override. |
| L166-184: container spec (image, ports, security) | Container `runtime` | `spec.image`, `spec.resources`, etc. | Container name may differ (check with `kubectl describe pod`). |
| L186-189: volume mounts (`/data`, `/tmp`) | Volume mounts | `spec.storage` + emptyDir | Operator mounts PVC and /tmp. **Mount path may differ.** |
| L190-209: liveness/readiness probes | Probe config | Operator defaults or `spec.probes` | Operator likely auto-configures probes on gateway port. |
| L211-219: volumes (PVC, tmp, ConfigMap) | Volume specs | Managed by operator | Operator handles all volume creation. |
| L220: `imagePullSecrets` | Image pull secrets | `spec.imagePullSecrets` | Pass through in CR. |
| L226-251: rollback on failure | Error handling | Operator reconciler | Operator handles failed creation gracefully via reconciliation loop. |

### lifecycle.ts — stopDeployment() (Lines 263–278)

```typescript
// Our code: patch replicas to 0
await appsApi.patchNamespacedDeployment(`dep-${id}`, NAMESPACE, { spec: { replicas: 0 } });
```

**Operator equivalent**: Two options:
1. Patch the CR: `kubectl patch openclawinstance {name} -p '{"spec":{"replicas":0}}'`
2. Scale via kubectl: May work if operator supports subresource scale

**API code change**: Replace `appsApi.patchNamespacedDeployment()` with custom object patch on the CRD.

### lifecycle.ts — startDeployment() (Lines 285–301)

```typescript
// Our code: patch replicas to 1
await appsApi.patchNamespacedDeployment(`dep-${id}`, NAMESPACE, { spec: { replicas: 1 } });
```

**Operator equivalent**: Patch CR replicas back to 1.

### lifecycle.ts — restartDeployment() (Lines 307–328)

```typescript
// Our code: scale 0 → wait for termination → scale 1
await stopDeployment(id);
// poll until pod gone (max 60s)
await startDeployment(id);
```

**Operator equivalent**: The operator detects ConfigMap SHA-256 changes and triggers rolling restarts automatically. For manual restart:
- Option A: Patch an annotation (e.g. `restartedAt: <timestamp>`) to trigger reconciliation
- Option B: Scale 0 → 1 (same as current approach, but on CRD not Deployment)
- Option C: If we update the ConfigMap, operator detects the change and restarts automatically

**Config-driven restart is a major win** — eliminates our manual restart-after-configSync flow.

### lifecycle.ts — deleteDeployment() (Lines 332–421)

```typescript
// Our code: 90 lines — scale to 0, wait, delete Deployment, Secret, ConfigMap, PVC
```

**Operator equivalent**:
```bash
kubectl delete openclawinstance {name} -n jarble
```

The operator cascades deletion of StatefulSet, PVC (depends on reclaim policy), and any operator-managed resources. **We still delete our Secret and ConfigMap ourselves** since we create them.

**API code change**: Replace 90 lines of sequential delete + error handling with:
1. Delete the CR (operator cascades StatefulSet + PVC)
2. Delete our Secret
3. Delete our ConfigMap

### configmap.ts — Full File (145 lines)

| Function | Lines | Operator Impact |
|---|---|---|
| `encodeConfigKey()` | 33-40 | Still needed — we encode paths in ConfigMap keys |
| `decodeConfigKey()` | 45-50 | Still needed — init container decodes |
| `createDeploymentConfigMap()` | 57-81 | **Still needed** — we create the ConfigMap; operator references it |
| `updateDeploymentConfigMap()` | 87-124 | **Still needed** — configSync updates ConfigMap on config changes |
| `deleteDeploymentConfigMap()` | 129-144 | **Still needed** — we clean up on deployment delete |

**Key insight**: configmap.ts is NOT replaced by the operator. We still create/update/delete ConfigMaps. The operator just copies them to PVC.

**BUT**: The operator may not understand our `abs-` key encoding. Its init chain likely just copies keys as filenames. We need to test whether:
1. Operator supports custom init scripts
2. Operator can be told to copy ConfigMap keys to specific PVC paths
3. Or we switch to simple key names and handle path mapping differently

### constants.ts (28 lines)

| Export | Operator Impact |
|---|---|
| `NAMESPACE` | Unchanged — still "jarble" |
| `DEFAULT_IMAGE` | Moves to CR `spec.image.repository` + `spec.image.tag` |
| `DeploymentConfig` interface | Simplified — many fields become CR spec fields |
| `RUNTIME_PORTS` | Moves to CR `spec.gateway.port` |

### secrets.ts (if exists as separate module)

Secrets are managed by us, not the operator. No changes needed. The operator just references our Secret via `spec.envFrom`.

---

## Part 2: What the Operator Does NOT Replace

These modules remain unchanged — they interact with running pods, not resource creation:

| Module | Lines | Why Not Replaced |
|---|---|---|
| `exec.ts` — `execInPod()` | 9-39 | Direct pod exec for pairing, diagnostics, component writes |
| `exec.ts` — `execInPodWithStdin()` | 45-90 | Stdin-based file writes (configSync Tier 2) |
| `exec.ts` — `streamExecInPod()` | 97-152 | Streaming exec for long-running commands |
| `exec.ts` — `findPodForDeployment()` | 163-187 | Pod discovery by label selector — **needs label update** |
| `config.ts` — `writeConfigsToPvc()` | 17-57 | Exec-based config file writes to running pods |
| `config.ts` — `readConfigsFromPvc()` | 69-134 | Reverse sync: read PVC config back to DB |
| `config.ts` — `exportDeploymentConfigs()` | 142-213 | ZIP export of config files |
| `config.ts` — `signalProcessRestart()` | 230-283 | .reload marker + process kill for fast restart |
| `components.ts` — all functions | 1-144 | Custom component CRUD on PVC |
| `status.ts` — `getDeploymentPodStatus()` | 13-73 | Pod status checks |
| `status.ts` — `getDeploymentStorageUsage()` | 89-181 | `df -B1 /data` for storage metrics |
| `status.ts` — `getPodAddress()` | 194-249 | Pod IP + gateway token for chat proxy |
| `logs.ts` — `getDeploymentLogs()` | 17-56 | One-shot log fetch |
| `logs.ts` — `streamDeploymentLogs()` | 63-106 | Real-time log streaming |
| `configmap.ts` — all functions | 1-145 | ConfigMap CRUD (we still manage these) |

---

## Part 3: What the Operator Adds

Features we don't currently have:

| Feature | Benefit | Our Current State |
|---|---|---|
| StatefulSet (not Deployment) | Stable pod name `{name}-0`, ordered shutdown | We use Deployment + Recreate strategy |
| Non-root UID 1000 | Better security posture | We run as root (UID 0) for npm/apt |
| Read-only root filesystem | Only PVC + /tmp writable | Root FS is writable |
| PodDisruptionBudget | Prevents eviction during node maintenance | No PDB — pods can be evicted anytime |
| Per-instance NetworkPolicy | Each instance gets isolation rules | One shared NetworkPolicy for all pods |
| ServiceMonitor (Prometheus) | Metrics scraping out of the box | No metrics collection |
| Config SHA-256 change detection | Auto rollout when ConfigMap content changes | Manual restart after configSync |
| Auto-update (OCI polling) | Watches registry for new image tags, rolls back on failure | Manual image updates via DEFAULT_POD_IMAGE |

---

## Part 4: Compatibility Analysis

### 4.1 — Pod Labels (CRITICAL)

**Current**: `findPodForDeployment()` uses label selector `app=dep-{deploymentId}` (exec.ts:175).

**Operator**: Likely uses standard Kubernetes labels:
- `app.kubernetes.io/name: openclaw`
- `app.kubernetes.io/instance: {cr-name}`
- May also add `app: {cr-name}` for backwards compatibility

**Impact**: Used in 6 places across 4 files:
- `exec.ts:175` — `findPodForDeployment()`
- `status.ts:21` — `getDeploymentPodStatus()`
- `status.ts:98` — `getDeploymentStorageUsage()`
- `status.ts:207` — `getPodAddress()`
- `config.ts:30` — `writeConfigsToPvc()`
- `config.ts:80` — `readConfigsFromPvc()`
- `logs.ts:27` — `getDeploymentLogs()`
- `logs.ts:74` — `streamDeploymentLogs()`

**Fix**: Extract label selector to a constant in `constants.ts`:
```typescript
export function podLabelSelector(deploymentId: string): string {
  // After operator migration:
  // return `app.kubernetes.io/instance=dep-${deploymentId}`;
  return `app=dep-${deploymentId}`;
}
```

**Effort**: Low — one function change + update all callers.

### 4.2 — PVC Mount Path (CRITICAL)

**Current**: All exec-based file I/O uses `/data/` as the PVC mount root.

**Operator**: May mount PVC at `/home/openclaw` (OpenClaw's default data directory).

**Hardcoded `/data/` references** (found via grep):

| File | Path Used | Purpose |
|---|---|---|
| `lifecycle.ts:93` | `/data/config`, `/data/logs`, `/data/.openclaw`, `/data/components`, `/data/files` | Init container directory creation |
| `lifecycle.ts:96-110` | `/config-source/*` → `/data/config/` | Init container config copy script |
| `lifecycle.ts:186-187` | `mountPath: "/data"` | PVC volume mount |
| `config.ts:43` | `/data/config/{path}` | Config file writes |
| `config.ts:102-122` | `/data/config/` | Config file reads |
| `config.ts:166` | `/data/config` | Config export (find) |
| `config.ts:244` | `/data/.openclaw.pid` | PID file for process restart |
| `config.ts:268` | `/data/config/.env` | Env override file |
| `config.ts:271` | `/data/.reload` | Reload marker |
| `components.ts:15` | `/data/components/{name}.json` | Component file writes |
| `components.ts:40` | `/data/components/{name}.json` | Component file reads |
| `components.ts:64` | `/data/components` | Component listing |
| `status.ts:128` | `df -B1 /data` | Storage usage check |

**Fix**: Add a constant to `constants.ts`:
```typescript
// PVC mount path — "/data" for manual deployments, may change to
// "/home/openclaw" for operator-managed deployments
export const PVC_MOUNT_PATH = process.env.PVC_MOUNT_PATH || "/data";
```

Then replace all hardcoded `/data/` with path joins using `PVC_MOUNT_PATH`.

**Effort**: Medium — ~20 path references across 4 files. Mechanical but needs thorough testing.

### 4.3 — ConfigMap Key Encoding

**Current**: We encode absolute paths with `abs-` prefix and `--` separators (configmap.ts:33-40). Our init container reverses this encoding.

**Operator**: Its init chain likely doesn't understand our encoding. It probably copies ConfigMap keys directly as filenames.

**Options**:
1. Switch to simple key names (e.g. `openclaw.json`, `soul.md`) and let operator place them in a standard location
2. Check if operator supports custom init scripts
3. Use `spec.config.raw` instead of `configMapRef` if the operator supports inline config

**Recommendation**: Simplify our ConfigMap keys to flat names. Move the path mapping logic to the operator's config spec or our configSync.

### 4.4 — Container Name

**Current**: `execInPod()` hardcodes container name `"runtime"` (exec.ts:23).

**Operator**: Container name may be `"openclaw"` or `"agent"` instead of `"runtime"`.

**Fix**: Make container name configurable:
```typescript
export const CONTAINER_NAME = process.env.POD_CONTAINER_NAME || "runtime";
```

**Effort**: Low — one constant + update `exec.ts` and `logs.ts` (4 references).

### 4.5 — Gateway Token Access

**Current**: `getPodAddress()` reads `OPENCLAW_GATEWAY_TOKEN` from our Secret (status.ts:219-222).

**Operator with autoGenerateToken=true**: Token is generated by the operator and stored in an operator-managed Secret. We'd need to know the Secret name and key.

**Recommendation**: Set `autoGenerateToken: false` in the CR. We continue to generate and store the token in our own Secret. This preserves `getPodAddress()` unchanged.

### 4.6 — Security Context (Root vs Non-Root)

**Current**: We run as root (UID 0) to allow `npm install` and `apt-get` inside the container (lifecycle.ts:177-184).

**Operator**: Defaults to UID 1000, non-root, read-only root FS.

**Impact**:
- OpenClaw's self-update mechanism (`npm install`) won't work
- `apt-get install python3` (used by some skills) won't work
- PVC writes still work (PVC is writable regardless of root FS setting)

**Options**:
1. Override security context in CR to allow root (less secure but compatible)
2. Pre-bake all dependencies into the container image (more secure, recommended)
3. Use operator's auto-update feature instead of in-pod npm install

### 4.7 — Deployment vs StatefulSet

**Current**: We create a Deployment with Recreate strategy. Pod names are random: `dep-{id}-{replicaset}-{random}`.

**Operator**: Creates a StatefulSet. Pod name is stable: `{cr-name}-0`.

**Impact**: Positive change. Stable pod names make debugging easier. Our code doesn't depend on specific pod names — `findPodForDeployment()` uses label selectors.

### 4.8 — Stop/Start Mechanism

**Current**: Patch Deployment replicas 0/1.

**Operator**: Need to verify whether patching CR `spec.replicas` works, or if we need to use a different mechanism.

**Test**: `kubectl patch openclawinstance test-eval-agent -n jarble-eval --type=merge -p '{"spec":{"replicas":0}}'`

---

## Part 5: Migration Summary

### Lines of Code Eliminated

| File | Lines | What's Replaced |
|---|---|---|
| `lifecycle.ts:9-255` | 247 | `createDeployment()` → single CR apply |
| `lifecycle.ts:263-301` | 39 | `stopDeployment()` / `startDeployment()` → CR patch |
| `lifecycle.ts:307-328` | 22 | `restartDeployment()` → operator auto-restart on config change |
| `lifecycle.ts:332-421` | 90 | `deleteDeployment()` → delete CR + our Secret/ConfigMap |
| **Total** | **~398** | |

### Lines of Code Modified

| File | Changes |
|---|---|
| `constants.ts` | Add `PVC_MOUNT_PATH`, `podLabelSelector()`, `CONTAINER_NAME` |
| `exec.ts:175` | Use `podLabelSelector()` instead of hardcoded label |
| `exec.ts:23` | Use `CONTAINER_NAME` instead of hardcoded `"runtime"` |
| `status.ts` (3 places) | Use `podLabelSelector()` for pod listing |
| `config.ts` (~12 places) | Replace `/data/` with `PVC_MOUNT_PATH` |
| `components.ts` (~6 places) | Replace `/data/` with `PVC_MOUNT_PATH` |
| `logs.ts` (2 places) | Use `podLabelSelector()` and `CONTAINER_NAME` |

### Lines of Code Unchanged

| File | Lines | Reason |
|---|---|---|
| `configmap.ts` | 145 | We still manage ConfigMaps ourselves |
| `exec.ts` (core functions) | ~150 | Exec mechanics unchanged |
| `config.ts` (logic) | ~200 | Config sync logic unchanged (paths update) |
| `components.ts` (logic) | ~120 | Component CRUD logic unchanged (paths update) |
| `status.ts` (logic) | ~200 | Status check logic unchanged |
| `logs.ts` (logic) | ~100 | Log streaming unchanged |

### New Code Required

| Component | Purpose | Est. Lines |
|---|---|---|
| `k8s/operator.ts` | CRD create/patch/delete via K8s custom objects API | ~80 |
| Constants updates | `PVC_MOUNT_PATH`, `podLabelSelector()`, `CONTAINER_NAME` | ~15 |

### Net Change

- **Removed**: ~398 lines (lifecycle.ts resource creation + deletion)
- **Added**: ~95 lines (operator.ts CRD management + constants)
- **Modified**: ~25 path/label references across 5 files
- **Net reduction**: ~300 lines
