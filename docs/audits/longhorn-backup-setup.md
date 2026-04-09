# Longhorn Backup Setup — Operator Guide

**Date:** 2026-04-07
**Status:** Implemented (RecurringJobs + L-05 default-class flip), Pending bucket creation (L-10)
**Audit refs:** L-05, L-09, L-10 in `docs/audits/longhorn-hardening-findings.md`
**Files:**
- `infrastructure/longhorn/recurring-jobs.yaml` — canonical RecurringJob CRs
- `infrastructure/terraform/main.tf` — master user_data heredoc embeds the same manifest
- `infrastructure/terraform/variables.tf` — `longhorn_backup_target`, `longhorn_backup_secret_name`
- `infrastructure/terraform/outputs.tf` — visibility outputs

---

## Overview

Bot data lives on Longhorn PVCs (`pvc-{deploymentId}`, 20–30 GiB each, RWO,
single-replica via the `longhorn-isolated` StorageClass from commit `af75011`).
Before this work landed, the cluster had **zero** snapshot or backup cadence
and an empty `backup-target` setting (audit findings L-09, L-10) — a single
bad write or accidental delete would be unrecoverable.

This setup adds two protection tiers, both configured via Longhorn's
`RecurringJob` CRD:

| Tier | Schedule | Retention | Where it lives | Restore time | Cost |
|------|----------|-----------|----------------|--------------|------|
| **daily-snapshot** | 03:00 UTC daily | last 7 | local CoW on the same Hetzner volume | minutes (instant attach) | zero |
| **weekly-backup** | 04:00 UTC Sunday | last 4 | off-cluster S3 bucket | minutes to hours (download GB-scale) | ~€0.01/GB/month object storage + egress on restore |

Both jobs target `groups: ["default"]`, and Longhorn v1.6 automatically
applies the `recurring-job-group.longhorn.io/default: enabled` label to every
new volume — verified live on the cluster's existing t1 PVC. So **all bot
PVCs auto-enroll** without any code change to `lifecycle.ts`/`operator.ts`.

The default StorageClass policy (L-05) was also fixed: `local-path` is now
the sole default; the `longhorn` class no longer carries the
`is-default-class=true` annotation. Bot PVCs explicitly use `longhorn-isolated`,
and Kubero PVCs explicitly use `local-path`, so nothing depends on the old
dual-default state.

---

## Why this matters

- **Bot data is single-point-of-failure on a single VPS disk.** Phase 5
  (`bc8735b`) made each bot run on its own dedicated Hetzner VPS, and Team 1
  (`af75011`) made each bot's Longhorn replica single-instance and
  strict-local. That gives strong tenant isolation but ALSO means any data
  loss (bad migration, accidental delete, disk corruption) is permanent.
- **Daily snapshots** cover the common case: someone fat-fingers an
  unrecoverable change. Snapshots take seconds and can be restored in
  minutes without any external dependency.
- **Weekly off-cluster backups** cover the catastrophic case: the entire
  Hetzner VPS is lost (drive failure, region outage, account suspension).
  Without an off-cluster copy, the data is gone. The weekly cadence
  + 4-week retention is a deliberate cost trade-off — see the cost estimate
  section below.

---

## Hetzner Object Storage — bucket creation (out-of-band)

The Hetzner Cloud Terraform provider (`hetznercloud/hcloud ~> 1.45`) does
**not** yet have a resource for Hetzner Object Storage S3 buckets. Their
older `hcloud_storage_box` is WebDAV/SSH only, not S3-compatible, and
Longhorn requires S3.

Until the provider catches up, the bucket is created manually via the
Hetzner Cloud Console:

1. Log in to https://console.hetzner.cloud/
2. Navigate to **Object Storage** in the sidebar (under "Storage")
3. Click **Create bucket**
4. Choose:
   - **Name**: `jarble-longhorn-backups` (or another unique name; must be
     globally unique within the chosen region)
   - **Region**: `fsn1` (Falkenstein, Germany — same region as the
     master VPS for lowest egress cost) OR `nbg1` / `hel1` for a different
     failure domain
   - **Visibility**: Private
5. After creation, click into the bucket and go to **Access Credentials**
6. Click **Create access credential** with type **Read & Write**
7. Save the **Access Key ID** and **Secret Access Key** somewhere safe — they
   are shown only once
8. Note the **Endpoint URL** (e.g., `https://fsn1.your-objectstorage.com`)

You now have:
- `BUCKET_NAME` = `jarble-longhorn-backups`
- `REGION` = `fsn1`
- `ENDPOINT` = `https://fsn1.your-objectstorage.com`
- `AWS_ACCESS_KEY_ID` = `<from step 7>`
- `AWS_SECRET_ACCESS_KEY` = `<from step 7>`

---

## Create the credentials Secret in the cluster

The Secret holds the S3 credentials and lives in the `longhorn-system`
namespace. Longhorn reads it via the `backup-target-credential-secret`
setting. The Secret values are sensitive — do NOT commit them to git.

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@178.156.230.13

# Replace with the values from the bucket creation step above
export HETZNER_S3_ACCESS_KEY="<paste access key>"
export HETZNER_S3_SECRET_KEY="<paste secret key>"
export HETZNER_S3_ENDPOINT="https://fsn1.your-objectstorage.com"

kubectl -n longhorn-system create secret generic longhorn-backup-credentials \
  --from-literal=AWS_ACCESS_KEY_ID="$HETZNER_S3_ACCESS_KEY" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$HETZNER_S3_SECRET_KEY" \
  --from-literal=AWS_ENDPOINTS="$HETZNER_S3_ENDPOINT"
```

Verify:
```bash
kubectl -n longhorn-system get secret longhorn-backup-credentials \
  -o jsonpath='{.data}' | base64 -d 2>/dev/null || \
kubectl -n longhorn-system describe secret longhorn-backup-credentials
```

---

## Apply the Terraform changes

Now that the bucket and Secret exist, set the Terraform variables and apply:

1. Edit `infrastructure/terraform/terraform.tfvars` (or set via env / CI):
   ```hcl
   longhorn_backup_target      = "s3://jarble-longhorn-backups@fsn1/"
   longhorn_backup_secret_name = "longhorn-backup-credentials"
   ```

2. Plan and review:
   ```bash
   cd infrastructure/terraform
   terraform plan
   ```
   Expected change: only output values flip (the master server has
   `lifecycle.ignore_changes = [user_data]`, so the master VPS itself is
   NOT recreated — the new user_data only takes effect on a fresh master
   rebuild).

3. To apply the backup-target settings to the **existing** master without
   waiting for a rebuild, patch them directly:
   ```bash
   ssh -i ~/.ssh/id_ed25519_hetzner root@178.156.230.13

   kubectl -n longhorn-system patch setting backup-target --type=merge \
     -p '{"value":"s3://jarble-longhorn-backups@fsn1/"}'
   kubectl -n longhorn-system patch setting backup-target-credential-secret --type=merge \
     -p '{"value":"longhorn-backup-credentials"}'
   ```

4. Apply the recurring jobs manifest (also already inlined into Terraform's
   master user_data, so it will install on rebuild):
   ```bash
   # From your laptop, with the worktree checked out
   scp -i ~/.ssh/id_ed25519_hetzner \
     infrastructure/longhorn/recurring-jobs.yaml \
     root@178.156.230.13:/tmp/

   ssh -i ~/.ssh/id_ed25519_hetzner root@178.156.230.13 \
     'kubectl apply -f /tmp/recurring-jobs.yaml'
   ```

---

## Verify backups are running

### Longhorn webhook quirk — spec.name required

Both `RecurringJob` CRs in this work specify `spec.name` in addition to
`metadata.name`. This is required by the Longhorn validating webhook
even though the CRD's OpenAPI schema marks `spec.name` as optional —
discovered via `kubectl apply --dry-run=server` against the live cluster.
Without it the webhook returns:

```
admission webhook "validator.longhorn.io" denied the request:
invalid job {Name: Groups:[default] Task:snapshot ...}
```

(Note the empty `Name:` in the error.) When editing
`infrastructure/longhorn/recurring-jobs.yaml`, always keep
`metadata.name` and `spec.name` in sync.

### List the recurring jobs

```bash
kubectl -n longhorn-system get recurringjobs
```

Expected:
```
NAME             GROUPS      TASK       CRON          RETAIN   CONCURRENCY   AGE
daily-snapshot   [default]   snapshot   0 3 * * *     7        2             5m
weekly-backup    [default]   backup     0 4 * * 0     4        1             5m
```

### Check the backup-target settings

```bash
kubectl -n longhorn-system get settings.longhorn.io \
  backup-target backup-target-credential-secret
```

Expected:
```
NAME                              VALUE
backup-target                     s3://jarble-longhorn-backups@fsn1/
backup-target-credential-secret   longhorn-backup-credentials
```

### List existing snapshots for a volume

```bash
# Replace with the actual volume name (from `kubectl -n longhorn-system get volumes`)
VOL="pvc-2a6500ee-df47-48b6-9449-f238e5246864"
kubectl -n longhorn-system get snapshots.longhorn.io \
  -l longhornvolume="$VOL"
```

You should see snapshots accumulate after the first 03:00 UTC run.

### List backups in the off-cluster bucket

```bash
kubectl -n longhorn-system get backups.longhorn.io
```

Or via the Longhorn UI (port-forward and open in a browser):
```bash
kubectl -n longhorn-system port-forward svc/longhorn-frontend 8080:80
# Open http://localhost:8080 → Backup → check the bucket contents
```

### Check job execution history

```bash
# Cron jobs are managed internally by longhorn-manager — check the manager logs
kubectl -n longhorn-system logs daemonset/longhorn-manager --since=24h \
  | grep -i 'recurringjob\|snapshot\|backup'
```

---

## Restore procedure — single volume from backup

Scenario: bot `dep-XYZ` has corrupted data and needs to be rolled back to
last week's backup.

### Step 1 — Identify the backup

```bash
kubectl -n longhorn-system get backups.longhorn.io \
  -o custom-columns='NAME:.metadata.name,VOLUME:.spec.snapshotName,STATE:.status.state,SIZE:.status.size'
```

Find the backup matching the volume name (`pvc-XYZ`) and the desired
timestamp.

### Step 2 — Stop the bot pod

```bash
DEPLOY_ID="XYZ"
kubectl -n jarble scale deployment "dep-$DEPLOY_ID" --replicas=0
# Wait for pod termination
kubectl -n jarble wait pod -l app="dep-$DEPLOY_ID" --for=delete --timeout=120s || true
```

### Step 3 — Delete the existing PVC and PV (DANGER — destroys current data)

> WARNING: This is destructive. The current volume data is replaced
> with the backup contents. Make sure you have the right backup name
> first. If you want to keep the current data for forensics, snapshot
> it first via the Longhorn UI before proceeding.

```bash
kubectl -n jarble delete pvc "pvc-$DEPLOY_ID"
# The PV is reclaim=Delete, so it will be auto-removed
```

### Step 4 — Create a new PVC from the backup

Via the Longhorn UI is easiest:

1. Port-forward the UI: `kubectl -n longhorn-system port-forward svc/longhorn-frontend 8080:80`
2. Open http://localhost:8080
3. Backup → select the bucket → click the volume name → click the desired backup → **Restore Latest Backup**
4. In the restore dialog:
   - **Name**: `pvc-XYZ` (must match the original PVC name)
   - **Number of Replicas**: 1 (matches `longhorn-isolated`)
   - **Frontend**: blockdev
   - **Data Locality**: strict-local
   - **Access Mode**: ReadWriteOnce
5. Click **OK**

CLI alternative — create a Volume CR pointing at the backup:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: longhorn.io/v1beta2
kind: Volume
metadata:
  name: pvc-$DEPLOY_ID
  namespace: longhorn-system
spec:
  fromBackup: "s3://jarble-longhorn-backups@fsn1/?backup=backup-XXX&volume=pvc-$DEPLOY_ID"
  numberOfReplicas: 1
  dataLocality: strict-local
  accessMode: rwo
  size: "32212254720"
EOF
```

### Step 5 — Bind a new PVC to the restored volume

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pvc-$DEPLOY_ID
  namespace: jarble
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: longhorn-isolated
  resources:
    requests:
      storage: 30Gi
  volumeName: pvc-$DEPLOY_ID
EOF
```

### Step 6 — Restart the bot pod

```bash
kubectl -n jarble scale deployment "dep-$DEPLOY_ID" --replicas=1
kubectl -n jarble wait pod -l app="dep-$DEPLOY_ID" --for=condition=Ready --timeout=300s
```

### Step 7 — Verify

```bash
# Check pod is running and has the right files
kubectl -n jarble exec deployment/"dep-$DEPLOY_ID" -- ls -la /data
```

If the pod is healthy and the data looks right, the restore is complete.

---

## Cost estimate

### Storage cost per bot per month

- Each bot PVC: 20–30 GiB (default 30 GiB)
- Average data fill: 5–10 GiB after npm install + initialization (the
  remainder is unused free space, not stored in backups — Longhorn backs
  up only used blocks)
- Snapshot retention: 7 daily snapshots, but snapshots are CoW on the
  REPLICA (not the bucket) — they cost zero in object storage
- Backup retention: 4 weekly backups in the bucket, each ~5–10 GiB
  → ~20–40 GiB per bot in object storage steady-state

### Hetzner Object Storage pricing (as of 2026-04)

- Storage: **€0.0049 per GB per month** (≈ €0.005)
- Egress (download for restore): **€0.0049 per GB** (one-time per restore)
- Ingress (upload during backup): **free**
- API requests: **free** (no per-request charge)

### Per-bot monthly cost

| Bot data fill | Storage in bucket | Monthly cost |
|---------------|-------------------|--------------|
| 5 GiB used   | ~20 GiB (4 weekly copies) | **€0.10** |
| 10 GiB used  | ~40 GiB | **€0.20** |
| 20 GiB used  | ~80 GiB | **€0.40** |

So well under €0.50/month per bot for backup storage at typical sizes.
With 100 bots: ~€10–40/month total.

### Restore cost (one-time)

Restoring a 30 GiB volume costs €0.15 in egress, paid once per restore.
Negligible.

### Comparison: not having backups

- A single accidental `rm -rf /data` on a bot = permanent data loss
- Customer goodwill cost: very high
- Engineering time to triage: hours
- Verdict: backup cost is 100x cheaper than the smallest data-loss
  incident.

---

## Troubleshooting / what to do if a backup fails

### Backups failing with "AccessDenied"

The Secret credentials are wrong, or the bucket policy doesn't grant
write access. Re-check:

```bash
kubectl -n longhorn-system get secret longhorn-backup-credentials -o yaml
# Decode and compare against the Hetzner Console values
```

### Backups failing with "NoSuchBucket"

The bucket name in `backup-target` doesn't match the actual bucket. Check:

```bash
kubectl -n longhorn-system get setting backup-target -o jsonpath='{.value}'
```

The format is `s3://BUCKET_NAME@REGION/`. Common gotcha: the trailing
slash IS required.

### Backups stuck in "InProgress" forever

A previous backup attempt left a lock file in the bucket. Check the
manager logs:

```bash
kubectl -n longhorn-system logs daemonset/longhorn-manager --since=1h \
  | grep -i 'backup\|lock'
```

Manual fix: delete the stale `.lock` files via the Hetzner Console → bucket
contents → delete `lock.lck` files for the affected volume directory.

### Manually triggering a backup (without waiting for the Sunday cron)

```bash
# Replace VOL with the volume name
VOL="pvc-2a6500ee-df47-48b6-9449-f238e5246864"

# Trigger via the UI: Volume → click → "Take Snapshot" then "Create Backup"
# OR via kubectl by patching the volume (annoyingly indirect):
kubectl -n longhorn-system create -f - <<EOF
apiVersion: longhorn.io/v1beta2
kind: Backup
metadata:
  name: manual-$(date +%s)
  namespace: longhorn-system
  labels:
    backup-volume: $VOL
spec:
  snapshotName: ""  # leave empty to snapshot now
EOF
```

### No alerts on backup failures

**Gap**: there are no alerts when a backup fails. The weekly-backup job
will silently log to the manager DaemonSet and move on. Until we wire up
Prometheus + Alertmanager + a backup-failure alert rule, the only way to
notice a failure is to manually check `kubectl -n longhorn-system get
backups` weekly.

**Recommended follow-up** (out of scope for this PR): add a cron-driven
script that runs `kubectl get backups -o yaml` and pages on any backup
in `Error` state. Or better: deploy `kube-prometheus-stack` and use the
Longhorn ServiceMonitor + alert rules.

---

## What this work did NOT change

- **No new Longhorn version** — still v1.6.0. Patch upgrade to v1.6.4 is
  L-08 in the audit and remains deferred.
- **No new replica policy** — `longhorn-isolated` (1 replica, strict-local)
  remains the policy from `af75011`.
- **No alerting** — explicitly out of scope. See "No alerts" section above.
- **No engine-image DaemonSet patch** (L-04) — still flagged in the
  hardening audit, blocked here as out-of-scope. When this is fixed, new
  auto-workers will gain the ability to host Longhorn replicas; the
  recurring jobs will then start covering volumes that schedule onto them
  too, with no further code change needed.

---

## Files touched

| File | Purpose |
|------|---------|
| `infrastructure/longhorn/recurring-jobs.yaml` | New — canonical RecurringJob CRs |
| `infrastructure/terraform/main.tf` | L-05 patch flip + recurring jobs apply + optional backup-target patches in master user_data heredoc |
| `infrastructure/terraform/variables.tf` | New `longhorn_backup_target`, `longhorn_backup_secret_name` |
| `infrastructure/terraform/outputs.tf` | New `longhorn_backups_enabled`, `longhorn_backup_target`, `longhorn_backup_secret_name` |
| `docs/audits/longhorn-hardening-findings.md` | L-05/L-09/L-10 status updates |
| `docs/audits/longhorn-backup-setup.md` | This file |
