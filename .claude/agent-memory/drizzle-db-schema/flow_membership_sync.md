---
name: Flow membership sync (definition vs join table) — known fragility
description: orchestration_flows.definition is a text JSON blob with no FK protection; flow_deployment_memberships has FKs and silently failed to populate when nodes referenced deleted deployments
type: project
---

`orchestration_flows.definition` is a `text` column containing a JSON blob with `nodes[].deploymentId`. There is no DB-level FK from those embedded ids to `deployments.id`, so a deployment can be deleted out from under a flow with no cascade and no warning. The companion table `flow_deployment_memberships` (deployment_id has `ON DELETE CASCADE`) is supposed to mirror those embedded ids, but `syncFlowMemberships` runs `DELETE + INSERT` inside the same transaction that wrote the flow — so a single FK violation on one stale insert blows away all valid memberships for that flow too. Until 2026-04-07 the catch was silent and the join table sat empty in production.

**Why:** `flow_deployment_memberships` powers `configSync.buildDeploymentFields` → bot soul.md `Team Context` block. An empty join table means every Bot Team appears to do nothing, even if the flow definition looks correct in the canvas. The only way to detect this from the outside is to observe missing Team Context in soul.md or run `scripts/audit-stale-flow-deployment-ids.mjs`.

**How to apply:** When investigating "Bot Teams aren't working" or "soul.md is missing the team block", check `flow_deployment_memberships` row counts BEFORE assuming the bot runtime is at fault — empty table means a sync failure, and the audit script will name the offending stale ids. Wave 2B (`validateDeploymentReferences` + `deployment.delete` rewrite, both in `flows.ts` / `deployment.ts`) prevents new orphans, but pre-Wave-2B data needs `scripts/cleanup-stale-flow-deployment-ids.mjs --execute` to heal.
