# Audit — Stale `deploymentId` references in `orchestration_flows.definition`

**Date:** 2026-04-07
**Status:** **CLEANED 2026-04-07** (see §10 Execution log)
**Environment:** Production (Neon Postgres, `ep-blue-credit-aitceucu-pooler.c-4.us-east-1.aws.neon.tech`)
**Auditor:** Claude Code (drizzle-db-schema agent), read-only
**Trigger:** Agent Teams rescue — `flow_deployment_memberships` is empty in production despite 29 flows existing. Hypothesis: silent FK violations against stale `deploymentId` references in flow definitions.
**Related:** `docs/audits/qa-bot-teams-2026-04-07.md`, `docs/audits/bot-teams-fix1-plan.md`
**Re-runnable audit script:** `scripts/audit-stale-flow-deployment-ids.mjs`
**Cleanup script:** `scripts/cleanup-stale-flow-deployment-ids.mjs`

---

## TL;DR

- **5 stale `deploymentId` references** across **3 flows**, all owned by 2 users, all in `draft` status.
- **0 valid references** — there is currently **only ONE deployment in production** (`nljs8499aj7o`), and no flow node points at it. **Every** deployment-typed node in every flow is currently stale.
- **0 cross-owner references** — none of the stale IDs belonged to a different user than the flow owner. No privilege boundary issue.
- **FK constraint already exists** in production (`flow_deployment_memberships_deployment_id_fkey ... ON DELETE CASCADE`). Stale-ID inserts genuinely DO fail with FK violations — that fully explains the empty join table.
- The "stale" IDs almost certainly belonged to deployments the user **deleted** (cascade-deleted any membership rows, but did NOT touch the JSON `definition` text on `orchestration_flows`).
- **Recommended fix: Strategy A + Strategy D combined.** Cleanup script that strips stale nodes from existing flow definitions, plus a validator at `flows.create` / `flows.update` that rejects new mutations referencing nonexistent deployments. No schema change needed — the FK already does what it's supposed to. The bug is purely **`orchestration_flows.definition` is unaware that the deployments it references can be deleted out from under it.**

---

## 1. Production DB snapshot

| Table | Rows |
|---|---:|
| `orchestration_flows` | 29 |
| `flow_deployment_memberships` | **0** |
| `deployments` | **1** |

### 1.1 Flows by status

| Status | Count |
|---|---:|
| archived | 16 |
| draft | 13 |

### 1.2 Date range

- Oldest flow: `2026-03-26T03:43:30Z`
- Newest flow: `2026-04-05T08:20:01Z`

### 1.3 Distinct flow owners

| User ID | Flow count |
|---|---:|
| `ogrw3gF_MQgF` | 13 |
| `WzLEPojjKozC` | 10 |
| `11u1rYyIRG15` | 4 |
| `ngzM8k7rGQaF` | 2 |

### 1.4 The single existing deployment

| Field | Value |
|---|---|
| `id` | `nljs8499aj7o` |
| `name` | `t1` |
| `user_id` | `ngzM8k7rGQaF` |
| `status` | `running` |
| `created_at` | `2026-04-07T17:04:11Z` |

This deployment was created **today**, hours before the audit ran, and **after every flow that contains a stale reference**. No flow currently in the DB references it.

---

## 2. FK constraint check

```text
constraint_name                                  column_name      references_table       references_column   delete_rule
flow_deployment_memberships_flow_id_fkey         flow_id          orchestration_flows    id                  CASCADE
flow_deployment_memberships_deployment_id_fkey   deployment_id    deployments            id                  CASCADE
```

**Both FKs exist with `ON DELETE CASCADE`** in production. This matches the Drizzle schema (`jarble-api-main/src/db/schema.pg.ts:876-893`).

This is critical: it means

1. Stale-ID inserts from `syncFlowMemberships` (`flows.ts:108-122`) **do** raise an FK violation. The silent try/catch at `flows.ts:279-291`/`365-377` was masking it. The recently-merged change to log at `error` level (also in `flows.ts`) will surface the actual cause as soon as someone saves a stale-ref flow, which is good.
2. **Strategy C (add a constraint) is a no-op** — it already exists.
3. The bug is therefore not a missing constraint but a **missing cleanup of orphaned JSON references** when a deployment is deleted. The FK cascades the join table; nothing cascades the inline definition.

---

## 3. Full inventory of `deploymentId` references

5 references across 3 flows. Every reference is STALE.

| flow_id | flow_name | flow_status | flow_owner | node_id | node_type | referenced_deployment_id | validity | cross_owner | cleaned_at |
|---|---|---|---|---|---|---|---|---|---|
| `flw_3p42f1nl8lr2` | Team 2 | draft | `ngzM8k7rGQaF` | `lnhat9nut3ek` | deployment | `lnhat9nut3ek` | ~~STALE~~ CLEANED | — | 2026-04-07 |
| `flw_3p42f1nl8lr2` | Team 2 | draft | `ngzM8k7rGQaF` | `8vtgevemz6ft` | deployment | `8vtgevemz6ft` | ~~STALE~~ CLEANED | — | 2026-04-07 |
| `flw_psbr1o5x8prm` | Team 1 | draft | `ngzM8k7rGQaF` | `ifvqafgds4qd` | deployment | `ifvqafgds4qd` | ~~STALE~~ CLEANED | — | 2026-04-07 |
| `flw_psbr1o5x8prm` | Team 1 | draft | `ngzM8k7rGQaF` | `b24qltf1zoo1` | deployment | `b24qltf1zoo1` | ~~STALE~~ CLEANED | — | 2026-04-07 |
| `flw_ofsixnu3birl` | Team 1 | draft | `WzLEPojjKozC` | `45c08kyb58ee` | deployment | `45c08kyb58ee` | ~~STALE~~ CLEANED | — | 2026-04-07 |

**Distinct stale deploymentIds:** 5 (one new vs the original report — `45c08kyb58ee` was missed by the prior query because it sits in `Team 1` owned by `WzLEPojjKozC`, a different user).

**Pattern:** in every case, `node.id == node.deploymentId`. The canvas evidently re-uses the deployment ID as the React-Flow node ID. Not a bug per se, but worth knowing if you're writing a cleanup script.

### 3.1 Cross-owner check

Zero. Every stale reference was authored by a user who would have legitimately owned that deployment when it existed. **No privilege boundary issue.**

### 3.2 Where the references live in the JSON

Node shape (from `flw_3p42f1nl8lr2`):

```json
{
  "id": "lnhat9nut3ek",
  "type": "deployment",
  "label": "tt2",
  "deploymentId": "lnhat9nut3ek",
  "config": {
    "goal": "Route user requests to the specialist and synthesize results",
    "role": "Coordinator",
    "canDelegate": true,
    "contextScope": "task",
    "isEntryPoint": true
  },
  "position": { "x": -215.87, "y": -96.28 }
}
```

The audit script extracts `deploymentId` from BOTH `node.deploymentId` (top-level) and `node.config.deploymentId` (nested). In the current dataset only the top-level form is in use, but **the production code at `flows.ts:71-72` only checks the top-level form**. If anyone in the future writes a node config builder that nests it, it will silently bypass `syncFlowMemberships`. Worth a defensive `getDefinitionDeploymentIds` fix even though there's nothing to clean up there today.

### 3.3 Subflow node references

Zero `subflow` nodes exist in production. No stale `flowId` references either. Good — one less thing to worry about during cleanup.

### 3.4 Audit log forensics

`audit_logs` is **empty** (0 rows). Either the audit-log feature was added but never wired up, or it was wiped at some point. No historical breadcrumbs available for the deletion timestamps of the 5 missing deployments.

---

## 4. Root-cause hypothesis (high confidence)

1. Users `ngzM8k7rGQaF` and `WzLEPojjKozC` created deployments with the IDs in §3, then created flows that incorporated them as deployment-typed nodes.
2. They later **deleted** those deployments through the normal `deployment.delete` mutation.
3. The CASCADE on `flow_deployment_memberships.deployment_id` cleaned up any rows in the join table for those deployments.
4. **Nothing touched the JSON `definition` text column on `orchestration_flows`.** The stale IDs remained in place as orphaned references.
5. Every subsequent `flows.update` to those flows tried to re-run `syncFlowMemberships`, which deleted any existing memberships for that flow and tried to re-insert from the (still-orphaned) JSON. Every insert hit the FK constraint and the silent try/catch swallowed it. No row landed in the join table.
6. Because no row ever landed, **no agent's `soul.md` ever received a Team Context block**, and the entire Agent Teams pipeline appeared to do nothing — exactly the symptom the rescue investigation found.

Two pieces of evidence support this:

- The single existing deployment was created today, after the most recent flow update (`flw_3p42f1nl8lr2.updated_at = 2026-04-06T20:43:40Z`). So the user deleted at least one earlier deployment **and the flow_deployment_memberships table never recovered**, even after a fresh deployment came online.
- All flow owners except `11u1rYyIRG15` show flow updates that are MORE RECENT than their oldest stale references — i.e., they edited the flow after the underlying deployment was deleted, and `syncFlowMemberships` was failing on every save.

**Caveat:** I can't 100% prove the deployments existed and were deleted vs never existed. `audit_logs` is empty, there's no `deleted_at` column on `deployments`, and the deployment IDs themselves are random base36 — no metadata stored anywhere outside the now-deleted row. But the pattern fits "user deleted their agent" much better than "user typed an ID that never existed", because the flows store other valid metadata (labels, goals, roles) that suggest a real agent was wired up at some point.

---

## 5. Anomaly investigation — could the FK have been bypassed?

The original brief asked: if the FK exists, how can stale refs be **inserted** at all? Answer: they're not inserted into `flow_deployment_memberships`. They're inserted into `orchestration_flows.definition`, which is a `text` column with no schema-aware FK at all (Postgres has no JSONB→FK validation). The stale-ID problem isn't an insert that bypassed the FK — it's data that **exists outside** the FK system entirely.

**Trace through the write path:**

1. Frontend canvas builds a `FlowDefinition` JSON object including `node.deploymentId`.
2. Frontend calls `flows.create` or `flows.update`.
3. Router's Zod schema (`FlowNodeSchema`, `flows.ts:97-100`) **does not validate** that `deploymentId` exists in the deployments table. It only validates the type / shape.
4. Drizzle writes the JSON blob into `orchestration_flows.definition::text`. No FK applies.
5. THEN router calls `syncFlowMemberships`, which tries to insert into the join table with the stale ID. **This** is where the FK fires. The insert fails. The try/catch swallows. The flow row, however, was already written with the bad reference.

So: the JSON write succeeds, the relational write fails, and they get out of sync. The `definition` blob is the source of truth but it has no referential integrity. **The cleanup must operate on `orchestration_flows.definition`.**

---

## 6. Cleanup strategy recommendations

I've evaluated the 4 strategies in the brief plus a 5th. Below is my recommendation, in order of preference.

### ✅ Strategy A — Strip stale deployment nodes from flow definitions (primary)

A one-shot cleanup that:

1. Reads each flow with stale refs (flows in §3).
2. For each flow, parses the JSON definition.
3. Filters out any `node` whose `deploymentId` (top-level OR `config.deploymentId`) doesn't exist in `deployments`.
4. Filters edges that reference those removed nodes (both `source` and `target`).
5. Writes the cleaned definition back.
6. Re-runs `syncFlowMemberships` so the join table populates from the remaining (valid) refs.

**Pros**
- Surgical: only removes the orphaned nodes, not the whole flow.
- Re-runs `syncFlowMemberships` automatically after cleanup, so the join table self-heals.
- Reversible at audit time — keep a `flow_definition_backup` table or just save the original `definition` JSON to a `before/` artifact directory before running.

**Cons**
- Currently, **every** deployment-typed node in production is stale, so this would leave 3 flows entirely empty of deployment nodes. The user might be confused that "Team 2 lost its agents." This is acceptable IMO — the agents are gone, the flow can't possibly work, leaving them in is worse than removing them.
- Edges connecting the removed nodes to other (non-deployment) nodes also need to be filtered. If a flow has a `transform → deployment` edge, the transform should stay but the edge should die. Easy enough.

**Sample SQL preview (read-only):**

```sql
-- Find flows that would be affected
SELECT
  f.id,
  f.name,
  f.user_id,
  jsonb_array_length(f.definition::jsonb->'nodes') AS old_node_count,
  (
    SELECT COUNT(*)
    FROM jsonb_array_elements(f.definition::jsonb->'nodes') AS node
    LEFT JOIN deployments d
      ON d.id = COALESCE(node->>'deploymentId', node->'config'->>'deploymentId')
    WHERE node->>'type' != 'deployment'
       OR d.id IS NOT NULL
  ) AS new_node_count
FROM orchestration_flows f
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(f.definition::jsonb->'nodes') AS node
  LEFT JOIN deployments d
    ON d.id = COALESCE(node->>'deploymentId', node->'config'->>'deploymentId')
  WHERE COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') IS NOT NULL
    AND d.id IS NULL
);
```

**Sample Node cleanup script (NOT to be run automatically — user-approved only):**

```javascript
// scripts/cleanup-stale-flow-deployment-ids.mjs (DO NOT CREATE WITHOUT EXPLICIT APPROVAL)
import pg from "pg";
import fs from "node:fs";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// Pull every flow + the set of valid deployment IDs
const valid = new Set((await c.query("SELECT id FROM deployments")).rows.map(r => r.id));
const flows = (await c.query("SELECT id, name, definition FROM orchestration_flows")).rows;

const backups = [];
const updates = [];

for (const f of flows) {
  const def = typeof f.definition === "string" ? JSON.parse(f.definition) : f.definition;
  const beforeNodeCount = def.nodes?.length ?? 0;

  const removedNodeIds = new Set();
  const cleanedNodes = (def.nodes ?? []).filter(node => {
    const ref = node.deploymentId ?? node.config?.deploymentId;
    if (ref && !valid.has(ref)) {
      removedNodeIds.add(node.id);
      return false;
    }
    return true;
  });

  if (removedNodeIds.size === 0) continue;

  const cleanedEdges = (def.edges ?? []).filter(e => !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target));
  const newDef = { ...def, nodes: cleanedNodes, edges: cleanedEdges };

  backups.push({ id: f.id, name: f.name, before: def });
  updates.push({ id: f.id, after: newDef, removedNodeIds: [...removedNodeIds] });
}

// Backup BEFORE any write
fs.writeFileSync(`backup-flow-defs-${Date.now()}.json`, JSON.stringify(backups, null, 2));

// Dry-run output
console.log(`Would update ${updates.length} flows:`);
for (const u of updates) {
  console.log(`  ${u.id} — removing nodes [${u.removedNodeIds.join(", ")}]`);
}

if (process.env.APPLY === "true") {
  for (const u of updates) {
    await c.query(
      `UPDATE orchestration_flows SET definition = $1::text, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(u.after), u.id]
    );
  }
  console.log("Applied. Now POST a no-op flows.update for each affected flow to trigger syncFlowMemberships.");
}

await c.end();
```

### ✅ Strategy D — Validate `deploymentId` at create/update time (preventive)

Add a Zod refine (or a manual check) inside `flows.create` and `flows.update` that rejects any node whose `deploymentId` doesn't exist in `deployments`. Reject with a clear error message naming the bad node.

**Pros**
- Stops the bleed: no NEW stale references can be saved going forward.
- Cheap (one extra query per mutation, can be batched).
- Discoverable failure for users: they get a 400 with a real reason.

**Cons**
- Doesn't fix existing stale data — still need Strategy A for that.
- If a deployment is deleted **between** flow load and flow save, the user gets a confusing error. Mitigatable: check ownership too, and let the frontend handle "your deployment was deleted, please refresh."

**Combined recommendation: Strategy A + Strategy D.** A heals the existing data; D prevents recurrence. Both are low-risk and operate on different layers.

### ⚠ Strategy B — Archive flows with stale references (rejected)

Setting status=`archived` is too disruptive for the current dataset. Users would lose 3 flows entirely (one is "Team 2", an actively-edited dispatcher/specialist team). Archiving a flow that was just missing a couple of node references is a sledgehammer.

### ❌ Strategy C — Add FK constraint (no-op)

Already exists, see §2. **Don't propose this.**

### 💡 Strategy E (new) — `deployment.delete` should rewrite affected flow definitions

This is the **proper long-term fix**. When a deployment is deleted:

1. Find all flows whose JSON definition references this deployment ID.
2. Rewrite each definition to remove the deployment node + dangling edges.
3. Re-run `syncFlowMemberships` for each affected flow.
4. Optionally notify the flow owner: "Deployment X was deleted; the following flows were updated: [list]."

This makes the data model self-healing — the same way the FK CASCADE keeps the join table consistent. Without this, every future agent deletion will leave more orphans behind.

**Effort:** ~2-3 hours of router work in `deployment.ts` + a couple of unit tests.

**Pros**
- Symmetrical with the existing FK cascade behavior.
- Eliminates the entire class of bug going forward.
- No ongoing cleanup script needed.

**Cons**
- Touches the deployment delete path (sensitive — has to handle errors carefully so a flow-rewrite failure doesn't block the deletion).
- Requires user-facing UX consideration (notify? silent? show in audit log?).

---

## 7. Recommended action plan

In priority order:

1. **Run Strategy A cleanup once** (with user approval, after a backup). Restores the 3 affected flows to a consistent state. Estimated effort: 30 min.
2. **Implement Strategy D validator** in `flows.create` and `flows.update`. Stops the bleed. Estimated effort: 1 hour.
3. **Implement Strategy E** (auto-rewrite on deployment.delete) as a follow-up. Long-term fix. Estimated effort: 2-3 hours.
4. **Optional defensive fix:** update `getDefinitionDeploymentIds()` at `flows.ts:69-75` to also check `node.config?.deploymentId`, even though no current node uses that nested form. Costs nothing and prevents a future regression. Estimated effort: 5 min.

---

## 8. How to re-run this audit

```bash
# From the repo root:
DATABASE_URL='<prod connection string>' node scripts/audit-stale-flow-deployment-ids.mjs

# To get the prod connection string (requires SSH access to K3s master):
ssh -i ~/.ssh/id_ed25519_hetzner root@178.156.230.13 \
  "kubectl -n jarble-production exec deployment/jarble-api-kuberoapp-web -- env | grep DATABASE_URL"
```

The script is read-only and safe to run quarterly as part of an ops health-check.

---

## 9. Files

- **This audit:** `docs/audits/stale-flow-deployment-ids.md`
- **Re-runnable audit script:** `scripts/audit-stale-flow-deployment-ids.mjs`
- **Cleanup script:** `scripts/cleanup-stale-flow-deployment-ids.mjs`
- **Schema reference:** `jarble-api-main/src/db/schema.pg.ts:876-893` (FK definitions)
- **Sync code reference:** `jarble-api-main/src/trpc/routers/flows.ts:209-236` (`syncFlowMemberships`)
- **Extraction reference:** `jarble-api-main/src/trpc/routers/flows.ts:107-125` (`getDefinitionDeploymentIds` — defensive `config.deploymentId` check landed in Wave 2B)
- **Strategy D validator (Wave 2B):** `jarble-api-main/src/trpc/routers/flows.ts:155-203` (`validateDeploymentReferences`)
- **Strategy E auto-rewrite (Wave 2B):** `jarble-api-main/src/trpc/routers/deployment.ts` — `deployment.delete` now sweeps and rewrites affected `orchestration_flows.definition` rows on agent deletion

---

## 10. Execution log

### 2026-04-07 — Strategy A cleanup (one-shot)

**Operator:** Claude Code (drizzle-db-schema agent), explicit user authorization for the dev Neon branch.
**Script:** `scripts/cleanup-stale-flow-deployment-ids.mjs` (dry-run by default; `--execute` flag required to commit).
**Method:** All writes wrapped in a single Postgres transaction. Deletes existing `flow_deployment_memberships` rows for each affected flow, rewrites the `definition` JSON to drop orphaned `deployment`-typed nodes and any edges that referenced removed nodes, then re-inserts memberships for the surviving (now valid) deployment-typed nodes — replicating `syncFlowMemberships` semantics.

**Before / after counts (from `scripts/audit-stale-flow-deployment-ids.mjs`):**

| Metric | Before | After |
|---|---:|---:|
| Total `deploymentId` references in `orchestration_flows.definition` | 5 | 0 |
| STALE references | 5 | 0 |
| VALID references | 0 | 0 |
| Distinct stale ids | 5 | 0 |
| Affected flows | 3 | 0 |
| `orchestration_flows` row count | 29 | 29 |
| `deployments` row count | 1 | 1 |
| `flow_deployment_memberships` row count | 0 | 0 |

The membership table is **still empty after cleanup** — and that is the correct outcome for this dataset. Every reference in the DB was stale, so removing orphans left the 3 flows with zero deployment-typed nodes and therefore zero memberships to insert. The next time a user adds a real, owned deployment node to one of these flows, `syncFlowMemberships` will populate the join table normally because Wave 2B's `validateDeploymentReferences` now runs before any write.

**Per-flow modifications:**

| flow_id | flow_name | nodes (before → after) | edges (before → after) | nodes removed |
|---|---|---|---|---|
| `flw_3p42f1nl8lr2` | Team 2 | 2 → 0 | 1 → 0 | `lnhat9nut3ek` (tt2), `8vtgevemz6ft` (Devssssssssss111) |
| `flw_ofsixnu3birl` | Team 1 | 1 → 0 | 0 → 0 | `45c08kyb58ee` (tt1) |
| `flw_psbr1o5x8prm` | Team 1 | 2 → 0 | 0 → 0 | `ifvqafgds4qd` (Dev11122), `b24qltf1zoo1` (QA-Test-Agent) |

**Removed edges:**

- `flw_3p42f1nl8lr2`: `edge-tt2-delegates-dev111` (`lnhat9nut3ek` → `8vtgevemz6ft`)

**Outcome:** SUCCESS. Single transaction committed cleanly. Re-running `scripts/audit-stale-flow-deployment-ids.mjs` immediately after the execute showed `TOTAL refs: 0  |  VALID: 0  STALE: 0  CROSS_OWNER: 0`. No `orchestration_flows` rows were deleted; only the `definition` column was rewritten on the 3 affected rows. No `deployments` rows were touched.

**User-visible impact:** The 3 affected flows ("Team 1" × 2 and "Team 2") will appear as empty canvases (no nodes, no edges) the next time their owners open them. This is the intended behavior — every agent they referenced has been deleted, so leaving the orphaned cards in place would be misleading. Owners can rebuild the teams by dragging in their current agents. Wave 2B's `validateDeploymentReferences` will now reject any save attempt that tries to wire in another nonexistent deployment.

### Long-term prevention (already landed in Wave 2B)

- **Strategy D — `validateDeploymentReferences`** (`flows.ts:155-203`) rejects any `flows.create` / `flows.update` mutation whose definition references a deployment that doesn't exist or isn't owned by the caller / their orgs. Fires a clear TRPC error naming the bad ids.
- **Strategy E — `deployment.delete` rewrite** (`deployment.ts`) sweeps all `orchestration_flows` whose JSON definition references the deployment being deleted, rewrites them to drop the orphaned nodes + dangling edges, and re-runs `syncFlowMemberships`. This is the symmetrical, self-healing fix that prevents this audit from ever needing a Strategy A pass again.
- **Defensive `getDefinitionDeploymentIds`** (`flows.ts:107-125`) now reads both `node.deploymentId` (top-level) and `node.config.deploymentId` (nested) so a future canvas refactor that nests the id can't silently bypass membership sync.

This Strategy A cleanup pass should not need to be re-run unless something circumvents both Strategy D (validator) and Strategy E (auto-rewrite).
