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
layer (required `nodeAffinity` + required `podAntiAffinity`) so each agent owns its
own Hetzner VPS. **But** the default Longhorn StorageClass still ships with
`numberOfReplicas: 3` and `dataLocality: disabled`. The moment a second auto-worker
joins the cluster, Longhorn will rebuild every agent's two stopped replicas onto
other tenants' VPSes — silently breaking the isolation guarantee. A container
escape on agent B's VPS would expose agent A's replica data at
`/var/lib/longhorn/replicas/pvc-A-r-xxx/`, in direct conflict with the user's
mental model ("my deployment = my VPS = my data").

This PR creates a new `longhorn-isolated` StorageClass alongside the existing
default `longhorn` (which other tenants — Coolify, Kubero — depend on), points
the agent PVC creation paths at it in `lifecycle.ts` and `operator.ts`, patches
the one currently-attached agent volume in place, and adds test coverage for the
class assertion. No existing pods were disrupted. Five higher-impact follow-ups
are documented but **not** applied in this PR.

---

## Audit findings table

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| L-01 | **CRITICAL** | Default `longhorn` StorageClass has `numberOfReplicas: "3"` + `dataLocality: "disabled"`. Once a 2nd node joins, every agent's data spreads to other tenant VPSes. | `kubectl get storageclass longhorn -o yaml` |
| L-02 | **CRITICAL** | Longhorn cluster setting `default-replica-count: 3` mirrors the StorageClass default. Any future StorageClass that omits `numberOfReplicas` inherits 3-way replication. | `kubectl -n longhorn-system get settings.longhorn.io default-replica-count` |
| L-03 | **CRITICAL** | t1's existing volume `pvc-2a6500ee-...` had `numberOfReplicas: 3` with 2 stopped replicas waiting to schedule onto a 2nd node. Robustness was `degraded`. The first auto-worker would have triggered an immediate cross-tenant replica build. | `kubectl -n longhorn-system get volumes.longhorn.io` (before patch) |
| L-04 | ✅ **FIXED** (Wave 2A) | ~~`engine-image-ei-acb7590c` DaemonSet has **NO** tolerations for `jarble.ai/workload=agent:NoSchedule`~~. Fixed: live kubectl strategic-merge patch applied; Terraform master `user_data` extended to patch all 3 Longhorn DaemonSets (manager, csi-plugin, engine-image) with dynamic engine-image discovery by label `longhorn.io/component=engine-image`, plus the global `taint-toleration` setting as belt-and-suspenders. Longhorn's own setting-propagation was blocked by an attached-volume webhook guard, which is why the global setting alone wasn't enough — the direct DS patch covers bootstrap. | `kubectl -n longhorn-system get daemonset engine-image-ei-acb7590c -o jsonpath='{.spec.template.spec.tolerations}'` now returns the jarble.ai/workload toleration |
| L-05 | ✅ **FIXED** (Wave 2C) | ~~TWO StorageClasses are marked default: both `local-path` (k3s-managed) and `longhorn` carry `storageclass.kubernetes.io/is-default-class: "true"`~~. Fixed: annotation removed from `longhorn` live (verified safe — only 2 PVCs cluster-wide, both explicit; Coolify gone per commit `bc4ccad`) and in Terraform master user_data. `local-path` is now the sole default. See `longhorn-backup-setup.md`. | `kubectl get storageclass` now shows only `local-path (default)` |
| L-06 | **HIGH** | `/var/lib/longhorn/` on master is **not** a dedicated block device — it lives on the root `/dev/sda1` (75 GB total, 17 GB used, 55 GB free). Filling the agent data directory will fill the OS disk and brick the cluster control plane. | `df -h /var/lib/longhorn/` |
| L-07 | **HIGH** | `replica-soft-anti-affinity: false` (and `replica-zone-soft-anti-affinity: true`) means Longhorn will refuse to place multiple replicas of the same volume on the same node. Combined with `numberOfReplicas: 3` on a 1-node cluster, that's why t1's two extra replicas were stuck in `stopped` state instead of scheduling. **Hides L-01 today; unmasks the moment node count > 1.** | `kubectl -n longhorn-system get settings.longhorn.io replica-soft-anti-affinity` |
| L-08 | **MEDIUM** | Longhorn v1.6.0 is **two minor versions behind stable** (v1.6.4 patch / v1.11.0 latest). v1.6.x has known disk-rebuild and CSI race fixes shipped in v1.6.2, v1.6.3, v1.6.4. **STATUS: DEFERRED 2026-04-07 (Wave 3)** — Release-notes review (v1.6.1–v1.6.4) confirms the fixes are highly relevant (csi.sock disconnect v1.6.2, csi sidecar rate limit v1.6.3, ISCSI burst connection errors v1.6.4, "no Pending workload pods for volume" v1.6.1) and there are no breaking changes that apply to our cluster (no v2 volumes, no CSI snapshot v1beta1 CRDs, no XFS volumes, no block-mode PVCs). **However**, upgrade DEFERRED for two blocking reasons: (1) backup target is not yet pointed at a real Hetzner Object Storage bucket (L-10 still PENDING BUCKET), so a botched upgrade has no rollback path and Longhorn does not support downgrade; (2) re-applying `longhorn.yaml` would silently overwrite the live engine-image DaemonSet and wipe the L-04 `jarble.ai/workload` toleration patch. Step-by-step upgrade plan added to `longhorn-backup-setup.md` (or this doc) for the operator to execute during a maintenance window AFTER the bucket is provisioned. | `kubectl -n longhorn-system get deployment longhorn-ui -o jsonpath='{.spec.template.spec.containers[0].image}'` still returns v1.6.0 |
| L-09 | **MEDIUM** | No `recurringjobs.longhorn.io` exist. **Zero snapshot or backup cadence.** Agent PVC data has no point-in-time recovery — a single bad write or accidental delete is permanent. **STATUS: APPLIED LIVE 2026-04-07 (Wave 3)** — `daily-snapshot` (0 3 * * * UTC, retain 7, concurrency 2) + `weekly-backup` (0 4 * * 0 UTC, retain 4, concurrency 1) `RecurringJob` CRs from `infrastructure/longhorn/recurring-jobs.yaml` applied via `kubectl apply -f -` heredoc on `178.156.230.13`. Also inlined into the master user_data heredoc so they reinstall on cluster rebuild. Both target `groups: ["default"]` — Longhorn auto-labels every new volume into the `default` group, verified live. t1 pod stayed `1/1 Running` `0` restarts and t1 volume stayed `attached/healthy` throughout. The weekly-backup job will log an error and skip until L-10's bucket is wired (verified safe — does not block volume ops). See `longhorn-backup-setup.md`. | `kubectl -n longhorn-system get recurringjobs` now lists `daily-snapshot` and `weekly-backup` |
| L-10 | **MEDIUM** | `backup-target` setting is empty. Even if recurring backup jobs existed, there's nowhere to ship them. No S3, no NFS, no off-cluster destination. **STATUS: IMPLEMENTED IN CODE / PENDING BUCKET 2026-04-07** — Terraform variables `longhorn_backup_target` + `longhorn_backup_secret_name` added; master user_data heredoc patches both Longhorn settings on apply when the target is non-empty. **The Hetzner Object Storage bucket and the credentials Secret must still be created manually** because `hetznercloud/hcloud ~> 1.45` does not support Hetzner Object Storage S3 buckets yet. Step-by-step setup in `longhorn-backup-setup.md`. The weekly-backup recurring job will log an error and move on until the bucket is wired up — it does NOT block volume operations. | `kubectl -n longhorn-system get settings.longhorn.io backup-target` |
| L-11 | **MEDIUM** | Longhorn UI is running (2 replicas) but **no Ingress exists**. UI is unreachable from outside the cluster — only via `kubectl port-forward`. Ops cannot inspect cluster state without SSH. | `kubectl -n longhorn-system get ingress` |
| L-12 | **MEDIUM** | High restart counts on Longhorn control-plane Deployments: `csi-attacher` x15, `csi-provisioner` x13, `csi-snapshotter` x9 — most clustered ~3h ago when the CSI fix was patched. Suggests rolling-restart instability or some lingering crash loop earlier today. Worth grepping the logs. | `kubectl -n longhorn-system get pods` |
| L-13 | **LOW** | t1 deployment `dep-nljs8499aj7o` only carries `preferredDuringScheduling` affinity, not the `required` rule from commit `bc8735b`. The required affinity will not apply until t1 is recreated. Existing agents are still spreadable. | `kubectl -n jarble get deployment dep-nljs8499aj7o -o yaml` |
| L-14 | **LOW** | `storage-reserved-percentage-for-default-disk: 30` reserves 30% of `/var/lib/longhorn/` (~22 GiB on 75 GB root). On a single-node dev cluster with agent data growing, the effective ceiling is ~33 GiB before scheduling stalls. | `kubectl -n longhorn-system get settings.longhorn.io storage-reserved-percentage-for-default-disk` |
| L-15 | **LOW** | `orphan-auto-deletion: false`. Future replica/volume rebuilds that fail will leave dangling resources requiring manual cleanup. | settings.longhorn.io |
| L-16 | **LOW** | `node-down-pod-deletion-policy: do-nothing`. If an agent VPS dies, its pod will sit in `Terminating` indefinitely until manually deleted, blocking PVC re-attach. | settings.longhorn.io |
| L-17 | **INFO** | Longhorn cluster setting `taint-toleration: jarble.ai/workload=agent:NoSchedule` is set — the autoscaler-csi fix already landed at the cluster-setting level (in addition to the DaemonSet patches). This setting causes Longhorn to inject the toleration into system-managed pods it spawns dynamically. | settings.longhorn.io |
| L-18 | **INFO** | `priority-class: longhorn-critical`, `node-drain-policy: block-if-contains-last-replica`, `auto-salvage: true` — sane defaults for a single-replica future. | settings.longhorn.io |
| L-19 | **INFO** | Only 1 instance manager (`v1` engine, type `aio`) currently running on `jarble-master`. v2 data engine is disabled (`v2-data-engine: false`) which is correct for this Longhorn version. | `kubectl -n longhorn-system get instancemanagers` |
| L-20 | **INFO** | Volume `data-locality` cannot be patched in-place between `disabled` and `strict-local` while the volume is attached. The only way to convert an existing volume is to detach it (scale pod to 0), patch, and re-attach. **This blocked the full t1 patch the user originally requested.** | `kubectl patch` returned `the request is invalid: data locality cannot be converted between strict-local and other modes when volume is not detached` |

---

## Top 5 prioritized follow-ups

> **Update 2026-04-07 (Wave 3)**: Item 2 (L-05) implemented Wave 2C. Item 4
> (L-09 + L-10): L-09 RecurringJob manifest is now APPLIED LIVE on the cluster
> (Wave 3); L-10 still pending the manual Hetzner Object Storage bucket. Item
> 5 (L-08): release-notes review complete — DEFERRED with a documented
> step-by-step upgrade plan, blocked on (a) the L-10 bucket existing first
> (no rollback path without backups) and (b) re-asserting the L-04 engine-image
> toleration patch immediately post-upgrade. Items 1 (L-04) and 3 (L-06)
> remain deferred.

1. **L-04 — Patch `engine-image` DaemonSet tolerations.** [DEFERRED] Immediate, ~1 minute. Without this, the previous CSI fix is incomplete: auto-workers will register the CSI driver but agent PVC attaches will fail because the engine-image binary never lands on the node. One-line `kubectl patch daemonset` mirroring the existing patch on `longhorn-manager` and `longhorn-csi-plugin`. Also bake into Terraform `master user_data` so it survives master rebuild.
2. **L-05 — Fix dual-default StorageClass.** [IMPLEMENTED 2026-04-07] Live cluster: `longhorn` no longer carries the default annotation. Terraform `main.tf` master user_data flipped from setting `longhorn` default to setting `local-path` default. Verified: only one PVC in the cluster (kubero/kubero-data) used a default-class fall-through path, and it explicitly specifies `local-path`. The other PVC (jarble/pvc-nljs8499aj7o, t1) explicitly specifies `longhorn`. No production consumer relied on `longhorn` being default — Coolify was removed in commit `bc4ccad`. Zero pod disruption.
3. **L-06 — Mount a dedicated block device at `/var/lib/longhorn/`.** [DEFERRED] On master and on every auto-worker. The cluster cannot survive agent data filling root. nodeManager.ts already provisions a Hetzner volume on auto-workers and conditionally mounts it; verify the master is doing the same and add fstab entry if not. Master rebuild risk is non-zero (`prevent_destroy = true`), so probably needs to be done as a live `mkfs` + `rsync` migration, not a Terraform change.
4. **L-09 + L-10 — Stand up a snapshot cadence and an off-cluster backup target.** [L-09 APPLIED LIVE 2026-04-07 (Wave 3); L-10 PENDING BUCKET] `RecurringJob` manifest at `infrastructure/longhorn/recurring-jobs.yaml` (daily snapshot retain 7, weekly backup retain 4) is now applied to the live cluster (Wave 3) — `kubectl -n longhorn-system get recurringjobs` lists both. Same manifest inlined into the master user_data heredoc for fresh-master self-heal. Terraform variables `longhorn_backup_target` and `longhorn_backup_secret_name` added — when set, the master user_data patches the Longhorn `backup-target` + `backup-target-credential-secret` settings on apply. **One step still pending**: the Hetzner Object Storage bucket and the k8s `longhorn-backup-credentials` Secret must be created manually (the Hetzner Cloud Terraform provider does not yet support Object Storage S3 buckets). Full step-by-step in `longhorn-backup-setup.md`. Cost estimate: ~€0.10–0.40 per agent per month.
5. **L-08 — Upgrade Longhorn to v1.6.4.** [DEFERRED 2026-04-07 (Wave 3)] Patch-level upgrade only, well-supported in-place via the upstream `kubectl apply -f https://.../v1.6.4/longhorn.yaml` flow. Picks up bug fixes for replica rebuild races, CSI sidecar rate limiting, csi.sock disconnect, ISCSI burst connection errors, "no Pending workload pods for volume" — all directly relevant to the csi-attacher/csi-provisioner restart loops we see in L-12. **Wave 3 verdict: DEFER**. Two blockers identified during review: **(a) no rollback path** — backups are not yet pointed at a real Hetzner Object Storage bucket (L-10 PENDING BUCKET), and Longhorn does not support downgrade once CRDs are bumped; **(b) re-applying `longhorn.yaml` will overwrite the engine-image DaemonSet** and silently wipe the L-04 `jarble.ai/workload` toleration that's currently held in place by a live `kubectl patch` (Wave 2A). Master user_data has the auto-discovery re-patch logic, but that runs on master rebuild, not on a live `kubectl apply -f longhorn.yaml`. **Step-by-step upgrade plan** (execute in this order, in a single maintenance window, AFTER L-10 is fully wired):
   1. Ensure L-10 bucket exists and `kubectl -n longhorn-system get settings backup-target` returns a non-empty `s3://...@<region>/` value.
   2. Trigger an out-of-band manual snapshot of t1's volume via Longhorn UI or `kubectl create -f` of a `Snapshot` CR — get a known-good rollback point.
   3. Wait for the next `daily-snapshot` recurring job tick OR force one — confirm there's at least one local snapshot for t1's volume.
   4. (Optional but recommended) Trigger the `weekly-backup` recurring job manually so a copy of t1 lands in the off-cluster bucket. Verify it appears in `kubectl -n longhorn-system get backupvolumes`.
   5. Snapshot the engine-image DaemonSet name and toleration list: `kubectl -n longhorn-system get daemonset -l longhorn.io/component=engine-image -o yaml > /tmp/engine-image-pre-upgrade.yaml`.
   6. Apply the upgrade: `kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.6.4/deploy/longhorn.yaml`.
   7. Watch rollout (each command MUST return successfully before the next): `kubectl -n longhorn-system rollout status deployment/longhorn-driver-deployer`, `kubectl -n longhorn-system rollout status deployment/longhorn-ui`, `kubectl -n longhorn-system rollout status daemonset/longhorn-manager`, `kubectl -n longhorn-system rollout status daemonset/longhorn-csi-plugin`.
   8. Identify the NEW engine-image DS name (the hash will likely change from `ei-acb7590c`): `kubectl -n longhorn-system get daemonset -l longhorn.io/component=engine-image -o name`.
   9. Re-apply the `jarble.ai/workload=agent:NoSchedule` toleration to the new engine-image DS: `kubectl -n longhorn-system patch daemonset <new-engine-image-ds> --type=strategic --patch '{"spec":{"template":{"spec":{"tolerations":[{"key":"jarble.ai/workload","operator":"Equal","value":"agent","effect":"NoSchedule"}]}}}}'` (mirror Wave 2A's pattern).
   10. Verify t1 is still healthy: `kubectl -n jarble get pods` shows `dep-nljs8499aj7o-...` `1/1 Running`; `kubectl -n longhorn-system get volumes.longhorn.io` shows t1's volume `attached`/`healthy`.
   11. Verify version: `kubectl -n longhorn-system get deployment longhorn-ui -o jsonpath='{.spec.template.spec.containers[0].image}'` should report `longhornio/longhorn-ui:v1.6.4`.
   12. The engine on t1's volume will still be running on the OLD engine-image (v1.6.0). Because `concurrent-automatic-engine-upgrade-per-node-limit` is currently `0`, no auto-upgrade will occur. Either: (a) leave it — single-replica volumes are happy on the old engine; or (b) bump the setting to `1`, watch the live engine upgrade (which Longhorn supports for attached/healthy volumes), then revert the setting.
   13. If anything goes wrong: `kubectl -n longhorn-system get backupvolumes` to find the backup, restore via Longhorn UI to a NEW PVC, swap PVCs in t1's deployment manifest. **Do NOT attempt to "downgrade" Longhorn — restore from backup instead.**

   **Post-upgrade follow-ups**: re-bake the new engine-image DaemonSet name into Wave 2A's terraform user_data discovery patch (it auto-discovers by label, so likely no change needed); update L-08 status to `UPGRADED 2026-XX-XX`; close out L-12 if csi sidecar restart counts settle.

---

## Implementation log — 2026-04-07

Three deferred findings completed in a worktree branch building on `8839d8e`
(develop tip). Scope was strictly L-05, L-09, L-10 — L-04 (engine-image
DaemonSet) and L-06 (dedicated block device) and L-08 (Longhorn version
upgrade) remain open. See `longhorn-backup-setup.md` for the operator guide
covering bucket creation, Secret creation, restore procedure, cost
estimate, and troubleshooting.

### Live cluster changes applied during this work

1. **`kubectl patch storageclass longhorn -p '...is-default-class=false'`** —
   live patch on `178.156.230.13`. Verified before/after with
   `kubectl get storageclass`. Verified t1 pod (`dep-nljs8499aj7o-bb69bc6cf-qtwh5`)
   stayed `1/1 Running` with `0` restarts throughout. The L-05 evidence row
   should now read: `local-path (default)`, `longhorn` (no default), `longhorn-isolated` (no default).

### Code-only changes (no live apply)

2. **`infrastructure/terraform/main.tf`** — flipped the existing `kubectl
   patch storageclass longhorn` block from setting default `true` to setting
   default `false` (and made `local-path` the explicit default), so a master
   rebuild will not regress L-05. Added a new section that applies the
   recurring-jobs manifest after the longhorn CRDs are served, and a shell
   conditional that patches `backup-target` + `backup-target-credential-secret`
   when the new variable is non-empty. Both blocks live inside the master
   `user_data` heredoc.
3. **`infrastructure/terraform/variables.tf`** — added `longhorn_backup_target`
   (default empty — disabled in dev/preview) and `longhorn_backup_secret_name`
   (default `"longhorn-backup-credentials"`).
4. **`infrastructure/terraform/outputs.tf`** — added `longhorn_backups_enabled`,
   `longhorn_backup_target`, `longhorn_backup_secret_name` for visibility
   in `terraform output`.
5. **`infrastructure/longhorn/recurring-jobs.yaml`** — new file. Two
   `RecurringJob` CRs (`daily-snapshot`, `weekly-backup`) targeting
   `groups: ["default"]`. Verified on the live cluster that the existing
   t1 volume already carries `recurring-job-group.longhorn.io/default: enabled`
   automatically, so new agent PVCs auto-enroll with no code change required.
6. **`docs/audits/longhorn-backup-setup.md`** — new operator guide.

### Verification

- `terraform validate` (in `infrastructure/terraform/`) → Success.
- `terraform output -raw user_data` rendered through bash → produces a
  syntactically valid bash script with a flush-left YAML body that parses
  as two valid `RecurringJob` documents.
- `kubectl get storageclass` on live cluster → only `local-path (default)`
  shown; `longhorn` and `longhorn-isolated` no longer marked default.
- `kubectl -n jarble get pods` on live cluster → t1 pod still
  `1/1 Running` with `0` restarts after the live patch.
- `kubectl get pvc --all-namespaces` audit → only 2 PVCs cluster-wide;
  both specify `storageClassName` explicitly. No PVCs depend on default
  class fall-through. No StatefulSets exist (no `volumeClaimTemplates`
  to worry about).

### What did NOT change

- No agent PVCs were touched.
- No Longhorn version upgrade (still v1.6.0).
- No Longhorn engine-image DaemonSet patch (L-04 still open).
- No new Hetzner resources (no bucket — that's the manual step the user
  must take).
- No Secret values committed to the repo.

### Pending user action (to make L-10 fully live)

1. Create Hetzner Object Storage bucket via Hetzner Console (5 min).
2. SSH to master and `kubectl create secret generic longhorn-backup-credentials ...`
   with the bucket access keys (2 min).
3. Set `longhorn_backup_target` in `terraform.tfvars` to
   `s3://<bucket>@<region>/`.
4. SSH to master and run the two `kubectl patch setting` commands manually
   (since `prevent_destroy = true` on the master means `terraform apply`
   won't recreate it). OR wait for the next master rebuild for the
   user_data to do it automatically.
5. Verify by checking `kubectl -n longhorn-system get settings backup-target`
   and watching for the first weekly backup the following Sunday.

Detailed steps in `longhorn-backup-setup.md`.

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

`pvc-2a6500ee-df47-48b6-9449-f238e5246864` (the only currently-attached agent volume — t1 / `dep-nljs8499aj7o`) was patched from `numberOfReplicas: 3` to `numberOfReplicas: 1`.

**`dataLocality` was NOT changed** because Longhorn rejects in-place transitions between `disabled` and `strict-local` while the volume is attached:

```
The request is invalid: data locality cannot be converted between
strict-local and other modes when volume is not detached
```

Per the safety rules in the task ("if the patch produces errors, STOP and report"),
I did **not** detach the volume to force the change. The replica-count patch
alone achieves the most important guarantee (no spread across multiple VPSes
when more nodes join). `dataLocality: disabled` is harmless on a 1-node
cluster, and any new agent created from the new StorageClass will get
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

1. **`dataLocality` cannot be patched on an attached volume** (L-20). Longhorn enforces this at the validation webhook level — there is no `--force` equivalent. The user's instructions assumed the full patch would work in-place. Falling back to a partial patch (replica count only) was the safe and correct call given the safety rules. Documented as a deferred follow-up. **Net effect**: the data-locality guarantee is enforced for new agents but t1 specifically still has `dataLocality: disabled`. On a 1-node cluster this is meaningless; it would only matter once a 2nd node joins AND the t1 pod gets rescheduled to a different node, at which point Longhorn could allow the (single) replica to remain on the original node rather than being forced local. To fully bring t1 in line, schedule an ops window to scale it to 0, patch, scale back to 1.

2. **Engine-image DaemonSet was missed by the previous CSI fix** (L-04). The autoscaler-csi-fix-plan's "Workstream A" patched `longhorn-manager` and `longhorn-csi-plugin` but not `engine-image-ei-acb7590c`. This means the previous CSI fix is incomplete — when the next auto-worker comes up, the engine-image won't extract there, and agent replicas will fail to start. This is a bigger find than anything in the original audit scope and warrants its own follow-up urgently. Out of scope for this PR per the "files you MUST NOT touch" list (touching infrastructure is Team 2's domain), but flagged here so it doesn't get lost.

3. **Two default StorageClasses** (L-05). When PVCs omit `storageClassName`, Kubernetes' admission controller picks one of the two non-deterministically (typically alphabetical, so `local-path` wins, but this is implementation-defined and can flip). Agent pods are unaffected because they always specify the class explicitly, but anything else in the cluster relying on default-class fall-through is in undefined-behavior territory.

4. **`/var/lib/longhorn/` is on root disk** (L-06). The audit assumed there'd be a dedicated block device. There isn't. The 30% reserved-storage setting carves out 22 GiB for the OS, leaving ~33 GiB usable for Longhorn data on the master. With `storageMb` defaulting to 30 GiB per agent PVC, the master can host **exactly one** agent PVC's worth of data before scheduling stalls. This is the strongest argument for getting auto-workers fully working (with their own block storage) and stopping all agent scheduling on master.

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
detach window can be scheduled. New agents created via the updated code path
get the full hard-isolated profile (`numberOfReplicas: 1` + `dataLocality:
strict-local`) on day one, which is the actual goal.
