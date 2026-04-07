# Monitoring: Stuck Deployments & Volume Failures

**Status**: Documented (manual setup required)
**Date**: 2026-04-07
**Author**: CI/observability follow-up agent (Bot Teams rescue post-mortem)

## Background

During the Bot Teams rescue (2026-04-07), three user deployments were
found stuck in the `creating` state for **45+ minutes** with zero alerts.
Root cause was a mix of `FailedAttachVolume` events on Longhorn PVCs and
silent `Pending` pods that never got rescheduled.

We had no monitoring for any of:

1. Deployments stuck in non-terminal states (`creating`, `updating`,
   `restarting`) longer than expected
2. K8s `FailedAttachVolume` / `FailedMount` events in the `jarble`
   namespace
3. Longhorn replica rebuild failures or volume degradation

This document specifies the alert rules to add and how to wire them up.

## Sentry environment

- Org: `jarble-corp` (`https://jarble-corp.sentry.io`)
- Region: `https://us.sentry.io`
- Existing projects (as of 2026-04-07): `javascript-nextjs`, `node`

The existing projects appear to be the default starter projects from
Sentry onboarding rather than the production Jarble API. **Before
applying any rules below, verify with the team which Sentry project the
production API is reporting to** (or create a dedicated `jarble-api`
project). Applying alert rules to the wrong project will produce noise
without coverage of the real signal.

## Alert 1 — Deployment stuck in `creating` > 5 min

### What we want to fire on

A deployment row in the `deployments` table whose `status` has been
`creating` (or `restarting`, `updating`) for more than 5 minutes
without transitioning to `running` or `error`.

### How to emit the signal

Sentry doesn't observe the database directly. The cleanest path is to
emit a Sentry event from a scheduled job in the API:

1. Add a new background ticker in `jarble-api-main/src/services/`
   (suggested name: `stuckDeploymentMonitor.ts`) that runs every 60s.
2. Each tick, query for deployments where:
   - `status IN ('creating', 'updating', 'restarting')`
   - `updatedAt < NOW() - INTERVAL '5 minutes'`
3. For each match, call `Sentry.captureMessage()` with:
   - level: `warning` (5–15 min) or `error` (>15 min)
   - tags: `deployment_id`, `runtime`, `stuck_status`, `stuck_minutes`
   - fingerprint: `['stuck-deployment', deploymentId]` to dedupe per-id
4. To avoid alert fatigue, only emit one event per deployment per
   "stuck cycle" — track last-emitted timestamp in memory and only
   re-emit on status change or after 30 min.

### Sentry alert rule (UI configuration)

Once the API is emitting these messages, in Sentry → Alerts → Create:

- **Type**: Issue Alert
- **Filter**: `message:"stuck deployment"` AND `level:[warning,error]`
- **Trigger**: New issue OR issue affects 1+ users (per fingerprint)
- **Action**: Email `ops@jarble.ai` + (optional) Slack webhook
- **Frequency**: Notify at most every 15 min per issue

### Sentry query (Discover)

```
event.type:default
message:"stuck deployment"
tags[stuck_minutes]:>5
```

## Alert 2 — `FailedAttachVolume` / `FailedMount` events

### What we want to fire on

K8s emits Events on the API server when a pod can't attach its PVC.
Common causes:
- Longhorn replica unavailable (`FailedAttachVolume`)
- Stale CSI mount on a deprovisioned worker (`FailedMount`)
- Multi-attach error after a worker hard-reboots

### How to forward

K8s events do not flow to Sentry by default. Two viable approaches:

**Option A — sentry-kubernetes** (recommended)

[`getsentry/sentry-kubernetes`](https://github.com/getsentry/sentry-kubernetes)
is a small daemon that watches the K8s event stream and forwards
qualifying events to Sentry. Deploy as a single-replica Deployment in
the `kube-system` namespace with a config like:

```yaml
env:
  - name: SENTRY_DSN
    valueFrom:
      secretKeyRef:
        name: sentry-k8s-dsn
        key: dsn
  - name: EVENT_LEVEL
    value: Warning
  - name: EVENT_NAMESPACES
    value: jarble,jarble-production,longhorn-system
```

Filter rules in Sentry:

- `tags[reason]:[FailedAttachVolume,FailedMount,VolumeBinding]`
- Group by `pod_name` to dedupe storms

**Option B — periodic scrape from the API**

Less reliable but no extra deployment. Add a tick to the same
`stuckDeploymentMonitor.ts` that runs `kubectl get events -n jarble
--field-selector type=Warning` every 5 min and forwards new Warning
events to Sentry. Track seen events by `(pod, reason, lastTimestamp)`
to dedupe.

### Sentry alert rule

- **Filter**: `tags[reason]:FailedAttachVolume OR tags[reason]:FailedMount`
- **Trigger**: 3+ events in 10 min (storm) → page on-call
- **Trigger**: 1+ events sustained over 5 min → email ops
- **Action**: Email `ops@jarble.ai` (sustained) + PagerDuty (storm)

## Alert 3 — Longhorn replica rebuild / volume degradation

### What we want to fire on

Longhorn emits events on the `longhorn-system` namespace when:
- A volume becomes `Degraded` (replica count below desired)
- Replica rebuild fails repeatedly
- A node loses its disk

### How to forward

Same `sentry-kubernetes` daemon — just include `longhorn-system` in
`EVENT_NAMESPACES`. Filter by:
- `tags[reason]:[ReplicaRebuildFailed,FailedRebuild,VolumeDegraded]`

### Sentry alert rule

- **Filter**: `tags[namespace]:longhorn-system AND
  tags[reason]:[ReplicaRebuildFailed,FailedRebuild]`
- **Trigger**: Any new event
- **Action**: Page on-call (Longhorn data integrity is critical)

## Expected fire rate

| Alert | Expected base rate | Action on >5x base |
|-------|-------------------|-------------------|
| Stuck deployment >5 min | <1/day during normal ops | Investigate config sync pipeline |
| FailedAttachVolume sustained | <1/week during normal ops | Investigate worker drain / Longhorn health |
| Longhorn rebuild failed | 0/week | Escalate to data team |

If any rule fires more than 5x its base rate in 24h, lower the rule's
sensitivity rather than ignoring — alert fatigue causes real incidents
to be missed. Tune the filter or the deduplication window.

## On-call escalation

- **Email-only alerts** (`ops@jarble.ai`): triaged next business day
- **PagerDuty / Slack alerts**: respond within 15 min
- **Runbook**: see `docs/RUNBOOK.md` § "Stuck deployments" (TODO — add
  this section once these alerts are in place)

## Testing the alerts

Once configured, validate each alert path:

1. **Stuck deployment**: in dev, manually flip a deployment row to
   `status=creating`, `updatedAt = NOW() - 10 min`. Confirm a Sentry
   event arrives within 60s.
2. **FailedAttachVolume**: in dev cluster, create a PVC against a
   non-existent storage class and a pod that mounts it. Within 30s
   the pod will emit `FailedAttachVolume` events. Confirm sentry-k8s
   forwards them.
3. **Longhorn degradation**: cordon a worker that hosts a Longhorn
   replica and wait for the volume to enter `Degraded` state. Confirm
   Sentry event.

Re-run these tests after any change to the alert filters.

## Open questions

1. **Sentry project naming**: confirm whether prod Jarble API reports to
   `node`, `javascript-nextjs`, or a not-yet-created `jarble-api`. Until
   resolved, do not apply rules above to live Sentry — they may go to
   the wrong project.
2. **PagerDuty integration**: not yet wired. For now route all alerts
   to email + Slack until on-call rotation is formalized.
3. **In-API monitor or external?**: the stuck-deployment monitor as a
   ticker inside `jarble-api-main` is simpler but couples observability
   to API health. If the API itself is the thing that's broken, the
   monitor won't fire. Long-term, prefer running this as a separate
   CronJob in the cluster against the same Postgres.

## Why we did not apply these via MCP

Sentry MCP authentication is working (`mcp__sentry__whoami` returns
`Brett (ops@jarble.ai)`), and `mcp__sentry__find_organizations` returns
`jarble-corp`. However the only projects under that org are
`javascript-nextjs` and `node`, neither of which is clearly the
production Jarble API. Applying alert rules without confirming the
target project would either create rules in the wrong project (no
coverage) or generate noise from unrelated events.

**Action item for the human**: confirm the prod project slug, then
re-run this work to apply the rules above via MCP.
