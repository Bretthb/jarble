# Longhorn Hardening — Audit Findings & Tenant Isolation Fix

**Date:** 2026-04-07
**Author:** k8s-pod-lifecycle-debugger agent
**Branch:** worktree branched from `bc8735b` on develop
**Cluster:** dev (`api.jarble.ai`, K3s v1.29.2 on Hetzner master `178.156.230.13`)
**Longhorn version:** v1.6.0 (latest stable v1.6.4 / latest v1.11.0 available)
**Scope:** Comprehensive Longhorn audit + minimal-blast-radius fix to enforce 1:1
VPS-per-agent storage isolation enforced by commit `bc8735b`.

---

## Executive summary

Commit `bc8735b` enforces hard 1:1 VPS-per-agent isolation at the pod-placement
layer (required `nodeAffinity` + required `podAntiAffinity`) so each bot owns its
own Hetzner VPS. **But** the default Longhorn StorageClass still ships with
`numberOfReplicas: 3` and `dataLocality: disabled`. The moment a second auto-worker
joins the cluster, Longhorn will rebuild every bot's two stopped replicas onto
other tenants' VPSes — silently breaking the isolation guarantee. A container
escape on bot B's VPS would expose bot A's replica data at
`/var/lib/longhorn/replicas/pvc-A-r-xxx/`, in direct conflict with the user's
mental model ("my deployment = my VPS = my data").

This PR creates a new `longhorn-isolated` StorageClass alongside the existing
default `longhorn` (which other tenants — Coolify, Kubero — depend on), points
the bot PVC creation paths at it in `lifecycle.ts` and `operator.ts`, patches
the one currently-attached bot volume in place, and adds test coverage for the
class assertion. No existing pods were disrupted. Five higher-impact follow-ups
are documented but **not** applied in this PR.

---

## Audit findings table

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| L-01 | **CRITICAL** | Default `longhorn` StorageClass has `numberOfReplicas: "3"` + `dataLocality: "disabled"`. Once a 2nd node joins, every bot's data spreads to other tenant VPSes. | `kubectl get storageclass longhorn -o yaml` |
| L-02 | **CRITICAL** | Longhorn cluster setting `default-replica-count: 3` mirrors the StorageClass default. Any future StorageClass that omits `numberOfReplicas` inherits 3-way replication. | `kubectl -n longhorn-system get settings.longhorn.io default-replica-count` |
| L-03 | **CRITICAL** | t1's existing volume `pvc-2a6500ee-...` had `numberOfReplicas: 3` with 2 stopped replicas waiting to schedule onto a 2nd node. Robustness was `degraded`. The first auto-worker would have triggered an immediate cross-tenant replica build. | `kubectl -n longhorn-system get volumes.longhorn.io` (before patch) |
| L-04 | ✅ **FIXED** (Wave 2A) | ~~`engine-image-ei-acb7590c` DaemonSet has **NO** tolerations for `jarble.ai/workload=agent:NoSchedule`~~. Fixed: live kubectl strategic-merge patch applied; Terraform master `user_data` extended to patch all 3 Longhorn DaemonSets (manager, csi-plugin, engine-image) with dynamic engine-image discovery by label `longhorn.io/component=engine-image`, plus the global `taint-toleration` setting as belt-and-suspenders. Longhorn's own setting-propagation was blocked by an attached-volume webhook guard, which is why the global setting alone wasn't enough — the direct DS patch covers bootstrap. | `kubectl -n longhorn-system get daemonset engine-image-ei-acb7590c -o jsonpath='{.spec.template.spec.tolerations}'` now returns the jarble.ai/workload toleration |
| L-05 | **HIGH** | TWO StorageClasses are marked default: both `local-path` (k3s-managed) and `longhorn` carry `storageclass.kubernetes.io/is-default-class: "true"`. Kubernetes picks ONE non-deterministically — any PVC that omits `storageClassName` could land on either. | `kubectl get storageclass` shows `local-path (default)` and `longhorn (default)` |
| L-06 | **HIGH** | `/var/lib/longhorn/` on master is **not** a dedicated block device — it lives on the root `/dev/sda1` (75 GB total, 17 GB used, 55 GB free). Filling the bot data directory will fill the OS disk and brick the cluster control plane. | `df -h /var/lib/longhorn/` |
| L-07 | **HIGH** | `replica-soft-anti-affinity: false` (and `replica-zone-soft-anti-affinity: true`) means Longhorn will refuse to place multiple replicas of the same volume on the same node. Combined with `numberOfReplicas: 3` on a 1-node cluster, that's why t1's two extra replicas were stuck in `stopped` state instead of scheduling. **Hides L-01 today; unmasks the moment node count > 1.** | `kubectl -n longhorn-system get settings.longhorn.io replica-soft-anti-affinity` |
| L-08 | **MEDIUM** | Longhorn v1.6.0 is **two minor versions behind stable** (v1.6.4 patch / v1.11.0 latest). v1.6.x has known disk-rebuild and CSI race fixes shipped in v1.6.2, v1.6.3, v1.6.4. | `kubectl -n longhorn-system get deployment longhorn-ui -o jsonpath='{.spec.template.spec.containers[0].image}'` |
| L-09 | **MEDIUM** | No `recurringjobs.longhorn.io` exist. **Zero snapshot or backup cadence.** Bot PVC data has no point-in-time recovery — a single bad write or accidental delete is permanent. | `kubectl -n longhorn-system get recurringjobs` |
| L-10 | **MEDIUM** | `backup-target` setting is empty. Even if recurring backup jobs existed, there's nowhere to ship them. No S3, no NFS, no off-cluster destination. | `kubectl -n longhorn-system get settings.longhorn.io backup-target` |
| L-11 | **MEDIUM** | Longhorn UI is running (2 replicas) but **no Ingress exists**. UI is unreachable from outside the cluster — only via `kubectl port-forward`. Ops cannot inspect cluster state without SSH. | `kubectl -n longhorn-system get ingress` |
| L-12 | **MEDIUM** | High restart counts on Longhorn control-plane Deployments: `csi-attacher` x15, `csi-provisioner` x13, `csi-snapshotter` x9 — most clustered ~3h ago when the CSI fix was patched. Suggests rolling-restart instability or some lingering crash loop earlier today. Worth grepping the logs. | `kubectl -n longhorn-system get pods` |
| L-13 | **LOW** | t1 deployment `dep-nljs8499aj7o` only carries `preferredDuringScheduling` affinity, not the `required` rule from commit `bc8735b`. The required affinity will not apply until t1 is recreated. Existing bots are still spreadable. | `kubectl -n jarble get deployment dep-nljs8499aj7o -o yaml` |
| L-14 | **LOW** | `storage-reserved-percentage-for-default-disk: 30` reserves 30% of `/var/lib/longhorn/` (~22 GiB on 75 GB root). On a single-node dev cluster with bot data growing, the effective ceiling is ~33 GiB before scheduling stalls. | `kubectl -n longhorn-system get settings.longhorn.io storage-reserved-percentage-for-default-disk` |
| L-15 | **LOW** | `orphan-auto-deletion: false`. Future replica/volume rebuilds that fail will leave dangling resources requiring manual cleanup. | settings.longhorn.io |
| L-16 | **LOW** | `node-down-pod-deletion-policy: do-nothing`. If a bot VPS dies, its pod will sit in `Terminating` indefinitely until manually deleted, blocking PVC re-attach. | settings.longhorn.io |
| L-17 | **INFO** | Longhorn cluster setting `taint-toleration: jarble.ai/workload=agent:NoSchedule` is set — the autoscaler-csi fix already landed at the cluster-setting level (in addition to the DaemonSet patches). This setting causes Longhorn to inject the toleration into system-managed pods it spawns dynamically. | settings.longhorn.io |
| L-18 | **INFO** | `priority-class: longhorn-critical`, `node-drain-policy: block-if-contains-last-replica`, `auto-salvage: true` — sane defaults for a single-replica future. | settings.longhorn.io |
| L-19 | **INFO** | Only 1 instance manager (`v1` engine, type `aio`) currently running on `jarble-master`. v2 data engine is disabled (`v2-data-engine: false`) which is correct for this Longhorn version. | `kubectl -n longhorn-system get instancemanagers` |
| L-20 | **INFO** | Volume `data-locality` cannot be patched in-place between `disabled` and `strict-local` while the volume is attached. The only way to convert an existing volume is to detach it (scale pod to 0), patch, and re-attach. **This blocked the full t1 patch the user originally requested.** | `kubectl patch` returned `the request is invalid: data locality cannot be converted between strict-local and other modes when volume is not detached` |

---

## Top 5 prioritized follow-ups (deferred — not in this PR)

1. **L-04 — Patch `engine-image` DaemonSet tolerations.** Immediate, ~1 minute. Without this, the previous CSI fix is incomplete: auto-workers will register the CSI driver but bot PVC attaches will fail because the engine-image binary never lands on the node. One-line `kubectl patch daemonset` mirroring the existing patch on `longhorn-manager` and `longhorn-csi-plugin`. Also bake into Terraform `master user_data` so it survives master rebuild.
2. **L-05 — Fix dual-default StorageClass.** Choose one. Recommended: drop the default annotation from `longhorn` (since Coolify/Kubero presumably already specify storageClassName explicitly, and bot PVCs now use `longhorn-isolated` explicitly). Leaves `local-path` as the sole default for system workloads. Single-line patch, but verify no existing tenant relies on default-class fall-through first.
3. **L-06 — Mount a dedicated block device at `/var/lib/longhorn/`.** On master and on every auto-worker. The cluster cannot survive bot data filling root. nodeManager.ts already provisions a Hetzner volume on auto-workers and conditionally mounts it; verify the master is doing the same and add fstab entry if not. Master rebuild risk is non-zero (`prevent_destroy = true`), so probably needs to be done as a live `mkfs` + `rsync` migration, not a Terraform change.
4. **L-09 + L-10 — Stand up a snapshot cadence and an off-cluster backup target.** Without these, bot data is single-point-of-failure on a single VPS disk. Recommend Hetzner Object Storage (S3-compatible) as backup-target, then a `RecurringJob` for daily snapshots with 7-day retention and weekly backups with 4-week retention. Cost: pennies per bot per month.
5. **L-08 — Upgrade Longhorn to v1.6.4.** Patch-level upgrade only, well-supported in-place via the upstream `kubectl apply -f https://.../v1.6.4/longhorn.yaml` flow. Picks up bug fixes for replica rebuild races and CSI socket leaks. v1.7+ requires more diligence — defer until backups exist (item 4).

---

## What this PR actually applied

### 1. New StorageClass `longhorn-isolated` (live cluster)

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: longhorn-isolated
  annotations:
    description: "Single-replica Longhorn class for tenant-isolated bot PVCs"
provisioner: driver.longhorn.io
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "1"
  dataLocality: "strict-local"
  staleReplicaTimeout: "30"
  fromBackup: ""
  fsType: "ext4"
```

Applied via `kubectl apply -f -` heredoc. Default `longhorn` StorageClass left untouched.

### 2. Source-code update — both PVC creation paths

- `jarble-api-main/src/k8s/lifecycle.ts:278` — `createDeploymentLegacy` PVC creation. `storageClassName: "longhorn"` → `"longhorn-isolated"`.
- `jarble-api-main/src/k8s/operator.ts:75` — `buildCRSpec` `storageSpec` (used by `createDeploymentOperator` via OpenClawInstance CRD). `storageClass: "longhorn"` → `"longhorn-isolated"`.

Both paths needed updating because the codebase supports two deployment modes (legacy Deployment + Service vs. operator-managed OpenClawInstance CRD).

### 3. t1 volume in-place patch (live cluster — partial)

`pvc-2a6500ee-df47-48b6-9449-f238e5246864` (the only currently-attached bot volume — t1 / `dep-nljs8499aj7o`) was patched from `numberOfReplicas: 3` to `numberOfReplicas: 1`.

**`dataLocality` was NOT changed** because Longhorn rejects in-place transitions between `disabled` and `strict-local` while the volume is attached:

```
The request is invalid: data locality cannot be converted between
strict-local and other modes when volume is not detached
```

Per the safety rules in the task ("if the patch produces errors, STOP and report"),
I did **not** detach the volume to force the change. The replica-count patch
alone achieves the most important guarantee (no spread across multiple VPSes
when more nodes join). `dataLocality: disabled` is harmless on a 1-node
cluster, and any new bot created from the new StorageClass will get
`strict-local` from day one. To fix t1 fully, the deployment would need to be
scaled to 0, the volume patched, and scaled back to 1 — that's a separate
deferred ops task tracked under follow-up "L-20".

### 4. Test update

`jarble-api-main/src/k8s/lifecycle.test.ts:171-180` — `"sets correct storage class"` test renamed to `"sets correct storage class (longhorn-isolated for tenant isolation)"`. Assertion updated from `"longhorn"` to `"longhorn-isolated"`. Comment added explaining the cross-reference to commit `bc8735b` and the tenant-isolation rationale, so the next person reading this test knows why.

---

## Verification — evidence

### t1 volume — before patch

```
NAME                                       DATA ENGINE   STATE      ROBUSTNESS   SIZE          NODE
pvc-2a6500ee-df47-48b6-9449-f238e5246864   v1            attached   degraded     32212254720   jarble-master

# Replicas (3 desired, 1 running, 2 stopped):
pvc-2a6500ee-...-r-2e502092   stopped  (waiting for 2nd node)
pvc-2a6500ee-...-r-21b5688b   stopped  (waiting for 2nd node)
pvc-2a6500ee-...-r-a9c284b0   running  jarble-master
```

### t1 volume — after patch

```
NAME                                       DATA ENGINE   STATE      ROBUSTNESS   SIZE          NODE
pvc-2a6500ee-df47-48b6-9449-f238e5246864   v1            attached   healthy      32212254720   jarble-master

spec.numberOfReplicas: 1
spec.dataLocality: disabled  (unchanged — see L-20)

# Replicas (1 desired, 1 running, stopped replicas garbage-collected):
pvc-2a6500ee-...-r-a9c284b0   running  jarble-master
```

Robustness flipped from `degraded` → `healthy` automatically. The two stopped
replicas were cleaned up by the Longhorn controller within seconds. **The t1 pod
`dep-nljs8499aj7o-bb69bc6cf-qtwh5` stayed `1/1 Running` with `0` restarts
throughout the patch operation.** Zero disruption.

### StorageClass apply

```
$ kubectl apply -f -
storageclass.storage.k8s.io/longhorn-isolated created

$ kubectl get storageclass
NAME                   PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION
local-path (default)   rancher.io/local-path   Delete          WaitForFirstConsumer   false
longhorn (default)     driver.longhorn.io      Delete          Immediate              true
longhorn-isolated      driver.longhorn.io      Delete          Immediate              true
```

Default `longhorn` left intact for Coolify/Kubero. New `longhorn-isolated`
sits alongside.

### Build + tests

```
$ cd jarble-api-main && npm run typecheck
> tsc --noEmit
(clean — zero errors, zero warnings)

$ npx vitest run src/k8s/lifecycle.test.ts
✓ src/k8s/lifecycle.test.ts (54 tests) 2568ms
  ✓ sets correct storage class (longhorn-isolated for tenant isolation)
Test Files  1 passed (1)
     Tests  54 passed (54)
```

---

## Risks and surprises encountered

1. **`dataLocality` cannot be patched on an attached volume** (L-20). Longhorn enforces this at the validation webhook level — there is no `--force` equivalent. The user's instructions assumed the full patch would work in-place. Falling back to a partial patch (replica count only) was the safe and correct call given the safety rules. Documented as a deferred follow-up. **Net effect**: the data-locality guarantee is enforced for new bots but t1 specifically still has `dataLocality: disabled`. On a 1-node cluster this is meaningless; it would only matter once a 2nd node joins AND the t1 pod gets rescheduled to a different node, at which point Longhorn could allow the (single) replica to remain on the original node rather than being forced local. To fully bring t1 in line, schedule an ops window to scale it to 0, patch, scale back to 1.

2. **Engine-image DaemonSet was missed by the previous CSI fix** (L-04). The autoscaler-csi-fix-plan's "Workstream A" patched `longhorn-manager` and `longhorn-csi-plugin` but not `engine-image-ei-acb7590c`. This means the previous CSI fix is incomplete — when the next auto-worker comes up, the engine-image won't extract there, and bot replicas will fail to start. This is a bigger find than anything in the original audit scope and warrants its own follow-up urgently. Out of scope for this PR per the "files you MUST NOT touch" list (touching infrastructure is Team 2's domain), but flagged here so it doesn't get lost.

3. **Two default StorageClasses** (L-05). When PVCs omit `storageClassName`, Kubernetes' admission controller picks one of the two non-deterministically (typically alphabetical, so `local-path` wins, but this is implementation-defined and can flip). Bot pods are unaffected because they always specify the class explicitly, but anything else in the cluster relying on default-class fall-through is in undefined-behavior territory.

4. **`/var/lib/longhorn/` is on root disk** (L-06). The audit assumed there'd be a dedicated block device. There isn't. The 30% reserved-storage setting carves out 22 GiB for the OS, leaving ~33 GiB usable for Longhorn data on the master. With `storageMb` defaulting to 30 GiB per bot PVC, the master can host **exactly one** bot PVC's worth of data before scheduling stalls. This is the strongest argument for getting auto-workers fully working (with their own block storage) and stopping all bot scheduling on master.

5. **t1's deployment spec lacks the required affinity from `bc8735b`** (L-13). The bc8735b enforcement only applies to deployments created or recreated AFTER the commit lands. Existing pods (t1) still carry the old `preferred` affinity. Until they're recreated (via stop/start or a config change that triggers `restartDeployment`), they remain spread-eligible. Worth noting but out of scope here.

---

## Verdict

**SUCCESS (with one documented caveat)**

- New `longhorn-isolated` StorageClass live, validated, sitting alongside the
  untouched default.
- Both source-code PVC creation paths (legacy + operator) updated and
  typecheck-clean.
- t1's volume safely patched to `numberOfReplicas: 1` with zero pod disruption.
- Test coverage updated and passing (54/54 in lifecycle.test.ts).
- 20 audit findings classified by severity with 5 prioritized follow-ups
  recorded for ops backlog.

**Caveat**: t1's `dataLocality` could not be changed in-place (Longhorn webhook
forbids it on attached volumes). t1 specifically remains `disabled` until a
detach window can be scheduled. New bots created via the updated code path
get the full hard-isolated profile (`numberOfReplicas: 1` + `dataLocality:
strict-local`) on day one, which is the actual goal.
