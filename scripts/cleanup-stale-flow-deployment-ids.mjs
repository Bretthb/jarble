#!/usr/bin/env node
/**
 * cleanup-stale-flow-deployment-ids.mjs
 *
 * One-shot cleanup for stale `deploymentId` references in
 * `orchestration_flows.definition`. Companion to
 * `scripts/audit-stale-flow-deployment-ids.mjs`.
 *
 * Strategy A from `docs/audits/stale-flow-deployment-ids.md`:
 *   1. Identify every flow whose definition references a deploymentId that
 *      no longer exists in the deployments table.
 *   2. For each affected flow, parse the JSON definition, drop the orphaned
 *      nodes (matched by top-level `node.deploymentId` OR nested
 *      `node.config.deploymentId`), and drop any edges whose `source` or
 *      `target` references a removed node id.
 *   3. Write the cleaned definition back, then re-populate
 *      `flow_deployment_memberships` for the surviving (now valid) refs —
 *      replicating `syncFlowMemberships` logic from
 *      `jarble-api-main/src/trpc/routers/flows.ts`.
 *   4. All writes happen in a single transaction so partial failures
 *      cannot leave the DB in an inconsistent state.
 *
 * Safety:
 *   - DRY-RUN by default. Pass `--execute` to actually modify the DB.
 *   - All writes wrapped in BEGIN/COMMIT — atomic.
 *   - Touches ONLY `orchestration_flows.definition` (UPDATE) and
 *     `flow_deployment_memberships` (DELETE + INSERT). Does NOT touch any
 *     deployment row or any other flow row.
 *   - Re-runs the same audit query at the end of an --execute pass and
 *     refuses to silently leave stale refs behind.
 *
 * Usage:
 *   # dry run (default — prints diff, makes no changes)
 *   DATABASE_URL='postgresql://...' node scripts/cleanup-stale-flow-deployment-ids.mjs
 *
 *   # execute (writes to DB inside a single transaction)
 *   DATABASE_URL='postgresql://...' node scripts/cleanup-stale-flow-deployment-ids.mjs --execute
 *
 * Note: like the audit script, this depends on the `pg` driver, resolved
 * against `jarble-api-main/node_modules/pg` so it works from the repo root
 * after `npm install` has been run inside the API package.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPkgJson = resolve(__dirname, "..", "jarble-api-main", "package.json");
const requireFromApi = createRequire(apiPkgJson);
const pg = requireFromApi("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

// ── CLI flags ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const DRY_RUN = !EXECUTE;

if (DRY_RUN) {
  console.log("MODE: DRY-RUN (no changes will be written). Pass --execute to commit.");
} else {
  console.log("MODE: EXECUTE (writes will be committed in a single transaction).");
}

// ── Helpers ──────────────────────────────────────────────────────────────
const HEADER = (s) => `\n${"=".repeat(8)} ${s} ${"=".repeat(8)}`;

// Match the nanoid alphabet used by flows.ts (customAlphabet 0-9 a-z, length 12)
function generateMembershipId() {
  const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyz";
  const buf = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}

function getNodeDeploymentId(node) {
  if (node && typeof node.deploymentId === "string") return node.deploymentId;
  if (node && node.config && typeof node.config.deploymentId === "string") {
    return node.config.deploymentId;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────
const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function fetchValidDeploymentIds() {
  const r = await client.query("SELECT id FROM deployments");
  return new Set(r.rows.map((row) => row.id));
}

async function fetchAffectedFlows() {
  // Pull every flow that references a deploymentId not present in deployments.
  // Mirrors the audit query but returns the full row so we can rewrite it.
  const r = await client.query(`
    SELECT DISTINCT f.id, f.name, f.user_id, f.status, f.definition, f.updated_at
    FROM orchestration_flows f
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(f.definition::jsonb->'nodes') AS node
      LEFT JOIN deployments d
        ON d.id = COALESCE(node->>'deploymentId', node->'config'->>'deploymentId')
      WHERE COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') IS NOT NULL
        AND d.id IS NULL
    )
    ORDER BY f.id;
  `);
  return r.rows;
}

async function countStaleRefs() {
  const r = await client.query(`
    SELECT COUNT(*)::int AS n
    FROM orchestration_flows f,
         jsonb_array_elements(f.definition::jsonb->'nodes') AS node
    LEFT JOIN deployments d
      ON d.id = COALESCE(node->>'deploymentId', node->'config'->>'deploymentId')
    WHERE COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') IS NOT NULL
      AND d.id IS NULL;
  `);
  return r.rows[0].n;
}

function planFlowCleanup(flow, validIds) {
  // flow.definition arrives as either a parsed object (jsonb) or a string (text).
  // The schema declares it `text` so it should be a string in practice.
  const def =
    typeof flow.definition === "string"
      ? JSON.parse(flow.definition)
      : flow.definition;

  const originalNodes = Array.isArray(def?.nodes) ? def.nodes : [];
  const originalEdges = Array.isArray(def?.edges) ? def.edges : [];

  const removedNodeIds = new Set();
  const removedNodeDetails = []; // for diff printing
  const cleanedNodes = [];

  for (const node of originalNodes) {
    const ref = getNodeDeploymentId(node);
    if (ref && !validIds.has(ref)) {
      removedNodeIds.add(node.id);
      removedNodeDetails.push({
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: node.label,
        deploymentId: ref,
      });
    } else {
      cleanedNodes.push(node);
    }
  }

  const cleanedEdges = [];
  const removedEdges = [];
  for (const edge of originalEdges) {
    if (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target)) {
      removedEdges.push({
        edgeId: edge.id,
        source: edge.source,
        target: edge.target,
      });
    } else {
      cleanedEdges.push(edge);
    }
  }

  const cleanedDef = { ...def, nodes: cleanedNodes, edges: cleanedEdges };

  return {
    flowId: flow.id,
    flowName: flow.name,
    flowUserId: flow.user_id,
    flowStatus: flow.status,
    beforeNodeCount: originalNodes.length,
    afterNodeCount: cleanedNodes.length,
    beforeEdgeCount: originalEdges.length,
    afterEdgeCount: cleanedEdges.length,
    removedNodes: removedNodeDetails,
    removedEdges,
    cleanedDef,
    // Keep the surviving deployment-typed nodes so we can populate the join table
    survivingDeploymentNodes: cleanedNodes.filter((n) => getNodeDeploymentId(n)),
  };
}

function printPlan(plans) {
  if (plans.length === 0) {
    console.log("\nNo flows need cleanup. Database is already consistent.");
    return;
  }
  console.log(HEADER(`PLAN — ${plans.length} flow(s) will be modified`));
  for (const p of plans) {
    console.log(`\nFlow: ${p.flowId}  (${p.flowName})`);
    console.log(`  status:        ${p.flowStatus}`);
    console.log(`  owner:         ${p.flowUserId}`);
    console.log(`  nodes:         ${p.beforeNodeCount} → ${p.afterNodeCount}  (removing ${p.removedNodes.length})`);
    console.log(`  edges:         ${p.beforeEdgeCount} → ${p.afterEdgeCount}  (removing ${p.removedEdges.length})`);
    console.log(`  surviving deployment nodes (will be inserted into flow_deployment_memberships): ${p.survivingDeploymentNodes.length}`);
    if (p.removedNodes.length > 0) {
      console.log(`  removed nodes:`);
      for (const n of p.removedNodes) {
        console.log(`    - id=${n.nodeId} type=${n.nodeType} label=${JSON.stringify(n.nodeLabel)} deploymentId=${n.deploymentId}`);
      }
    }
    if (p.removedEdges.length > 0) {
      console.log(`  removed edges:`);
      for (const e of p.removedEdges) {
        console.log(`    - id=${e.edgeId} ${e.source} → ${e.target}`);
      }
    }
  }
}

async function executePlan(plans) {
  // One transaction for everything. If any step fails the whole batch rolls back.
  await client.query("BEGIN");
  try {
    for (const p of plans) {
      // 1. Rewrite the flow definition.
      const upd = await client.query(
        `UPDATE orchestration_flows
            SET definition = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(p.cleanedDef), p.flowId],
      );
      if (upd.rowCount !== 1) {
        throw new Error(`Expected 1 row updated for flow ${p.flowId}, got ${upd.rowCount}`);
      }

      // 2. Re-sync flow_deployment_memberships for this flow (delete + insert).
      //    Mirrors `syncFlowMemberships` in jarble-api-main/src/trpc/routers/flows.ts.
      await client.query(
        `DELETE FROM flow_deployment_memberships WHERE flow_id = $1`,
        [p.flowId],
      );
      for (const node of p.survivingDeploymentNodes) {
        const deploymentId = getNodeDeploymentId(node);
        if (!deploymentId) continue;
        const isEntry =
          typeof node.isEntryPoint === "boolean"
            ? node.isEntryPoint
            : (node.config && typeof node.config.isEntryPoint === "boolean"
              ? node.config.isEntryPoint
              : false);
        const role = node.role ?? node.label ?? null;
        await client.query(
          `INSERT INTO flow_deployment_memberships
             (id, flow_id, deployment_id, node_id, role, is_entry_point, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [generateMembershipId(), p.flowId, deploymentId, node.id, role, isEntry],
        );
      }
    }
    await client.query("COMMIT");
    console.log("\nTransaction committed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nERROR during execute — transaction rolled back. No changes were saved.");
    throw err;
  }
}

async function main() {
  await client.connect();

  console.log(HEADER("AUDIT (before)"));
  const beforeStaleCount = await countStaleRefs();
  console.log(`Stale deploymentId references found: ${beforeStaleCount}`);

  const validIds = await fetchValidDeploymentIds();
  console.log(`Valid deployments in database:        ${validIds.size}`);

  const affected = await fetchAffectedFlows();
  console.log(`Flows that need cleanup:              ${affected.length}`);

  const plans = affected.map((row) => planFlowCleanup(row, validIds));

  printPlan(plans);

  if (DRY_RUN) {
    console.log("\nDRY-RUN complete. No changes were written. Re-run with --execute to commit.");
    await client.end();
    return;
  }

  if (plans.length === 0) {
    console.log("\nNothing to execute.");
    await client.end();
    return;
  }

  console.log(HEADER("EXECUTING"));
  await executePlan(plans);

  console.log(HEADER("AUDIT (after)"));
  const afterStaleCount = await countStaleRefs();
  console.log(`Stale deploymentId references found: ${afterStaleCount}`);

  const memCount = await client.query(
    `SELECT flow_id, COUNT(*)::int AS n
       FROM flow_deployment_memberships
      WHERE flow_id = ANY($1::text[])
      GROUP BY flow_id
      ORDER BY flow_id`,
    [plans.map((p) => p.flowId)],
  );
  console.log(`\nflow_deployment_memberships rows for cleaned flows:`);
  if (memCount.rows.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of memCount.rows) {
      console.log(`  ${r.flow_id}: ${r.n}`);
    }
  }

  if (afterStaleCount > 0) {
    console.error(`\nERROR: ${afterStaleCount} stale references remain after cleanup. This should not happen — investigate.`);
    await client.end();
    process.exit(2);
  }

  console.log("\nCleanup complete. 0 stale references remain.");
  await client.end();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  client.end().catch(() => {});
  process.exit(1);
});
