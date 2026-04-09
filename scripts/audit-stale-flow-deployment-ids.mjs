#!/usr/bin/env node
/**
 * audit-stale-flow-deployment-ids.mjs
 *
 * Read-only audit of orchestration_flows.definition for stale deploymentId
 * references — i.e. node.deploymentId values that point to a row that no
 * longer exists in the deployments table. Stale references silently break
 * `syncFlowMemberships` (FK violation), which leaves
 * `flow_deployment_memberships` empty in production and breaks the entire
 * Bot Teams / soul.md Team Context pipeline.
 *
 * Usage:
 *   DATABASE_URL="<prod connection string>" node scripts/audit-stale-flow-deployment-ids.mjs
 *
 * Output:
 *   - Row counts for orchestration_flows / flow_deployment_memberships / deployments
 *   - FK constraints on flow_deployment_memberships (sanity check)
 *   - Per-flow inventory of deploymentId references with VALID / STALE / CROSS_OWNER status
 *   - Distinct stale deploymentId list with the flows that reference them
 *   - Subflow node references (forward-looking — currently zero)
 *
 * Safety:
 *   - SELECT ONLY. No UPDATE, INSERT, DELETE, ALTER, DROP, or TRUNCATE.
 *   - Safe to run from a developer laptop, CI, or an ops runbook.
 *
 * Note: this script depends on the `pg` driver, which is already a runtime
 * dependency of jarble-api-main. The script resolves `pg` against the API
 * package's node_modules so it works from any cwd (including the repo root)
 * as long as `npm install` has been run inside `jarble-api-main`.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ is a sibling of jarble-api-main/ at the repo root
const apiPkgJson = resolve(__dirname, "..", "jarble-api-main", "package.json");
const requireFromApi = createRequire(apiPkgJson);
const pg = requireFromApi("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  console.error("Example: DATABASE_URL='postgresql://user:pass@host/db?sslmode=require' node scripts/audit-stale-flow-deployment-ids.mjs");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const HEADER = (s) => `\n${"=".repeat(8)} ${s} ${"=".repeat(8)}`;

async function main() {
  await client.connect();

  // ─── 1. row counts ──────────────────────────────────────────────────────
  console.log(HEADER("ROW COUNTS"));
  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM orchestration_flows)         AS flows,
      (SELECT COUNT(*)::int FROM flow_deployment_memberships) AS memberships,
      (SELECT COUNT(*)::int FROM deployments)                 AS deployments;
  `);
  console.log(counts.rows[0]);

  // ─── 2. FK constraints (sanity check) ───────────────────────────────────
  console.log(HEADER("FK CONSTRAINTS ON flow_deployment_memberships"));
  const fks = await client.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS references_table,
      ccu.column_name AS references_column,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'flow_deployment_memberships';
  `);
  console.table(fks.rows);

  // ─── 3. flows by status ─────────────────────────────────────────────────
  console.log(HEADER("FLOWS BY STATUS"));
  const byStatus = await client.query(`
    SELECT status, COUNT(*)::int AS n
    FROM orchestration_flows
    GROUP BY status
    ORDER BY n DESC;
  `);
  console.table(byStatus.rows);

  // ─── 4. extract every deploymentId reference + cross-check ──────────────
  console.log(HEADER("ALL deploymentId REFERENCES (validated)"));
  const refs = await client.query(`
    WITH refs AS (
      SELECT
        f.id                                  AS flow_id,
        f.name                                AS flow_name,
        f.user_id                             AS flow_user_id,
        f.status                              AS flow_status,
        f.created_at                          AS flow_created_at,
        f.updated_at                          AS flow_updated_at,
        node->>'id'                           AS node_id,
        node->>'type'                         AS node_type,
        node->>'label'                        AS node_label,
        COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') AS referenced_deployment_id
      FROM orchestration_flows f,
           jsonb_array_elements(f.definition::jsonb->'nodes') AS node
      WHERE COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') IS NOT NULL
    )
    SELECT
      r.flow_id,
      r.flow_name,
      r.flow_status,
      r.flow_user_id,
      r.node_id,
      r.node_type,
      r.referenced_deployment_id,
      CASE WHEN d.id IS NOT NULL THEN 'VALID' ELSE 'STALE' END AS validity,
      d.user_id AS deployment_owner,
      CASE
        WHEN d.user_id IS NOT NULL AND d.user_id <> r.flow_user_id THEN 'CROSS_OWNER'
        ELSE NULL
      END AS cross_owner_flag
    FROM refs r
    LEFT JOIN deployments d ON d.id = r.referenced_deployment_id
    ORDER BY validity, r.flow_id, r.node_id;
  `);
  console.table(
    refs.rows.map((r) => ({
      flow: r.flow_id,
      node: r.node_id,
      ref: r.referenced_deployment_id,
      validity: r.validity,
      cross_owner: r.cross_owner_flag ?? "",
      flow_status: r.flow_status,
    })),
  );

  const totals = refs.rows.reduce(
    (acc, r) => {
      if (r.validity === "VALID") acc.valid++;
      else acc.stale++;
      if (r.cross_owner_flag) acc.cross_owner++;
      return acc;
    },
    { valid: 0, stale: 0, cross_owner: 0 },
  );
  console.log(`\nTOTAL refs: ${refs.rows.length}  |  VALID: ${totals.valid}  STALE: ${totals.stale}  CROSS_OWNER: ${totals.cross_owner}`);

  // ─── 5. distinct stale IDs ──────────────────────────────────────────────
  console.log(HEADER("DISTINCT STALE deploymentIds"));
  const distinctStale = await client.query(`
    WITH refs AS (
      SELECT
        f.id AS flow_id,
        f.status AS flow_status,
        COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') AS referenced_deployment_id
      FROM orchestration_flows f,
           jsonb_array_elements(f.definition::jsonb->'nodes') AS node
      WHERE COALESCE(node->>'deploymentId', node->'config'->>'deploymentId') IS NOT NULL
    )
    SELECT
      r.referenced_deployment_id AS stale_deployment_id,
      COUNT(DISTINCT r.flow_id)::int AS flow_count,
      array_agg(DISTINCT r.flow_id ORDER BY r.flow_id) AS flow_ids,
      array_agg(DISTINCT r.flow_status) AS flow_statuses
    FROM refs r
    LEFT JOIN deployments d ON d.id = r.referenced_deployment_id
    WHERE d.id IS NULL
    GROUP BY r.referenced_deployment_id
    ORDER BY flow_count DESC, stale_deployment_id;
  `);
  console.table(distinctStale.rows);

  // ─── 6. subflow references (forward-looking) ────────────────────────────
  console.log(HEADER("SUBFLOW NODE REFERENCES"));
  const subflows = await client.query(`
    SELECT
      f.id AS flow_id,
      f.name AS flow_name,
      node->>'id' AS node_id,
      node->'config'->>'flowId' AS sub_flow_id,
      CASE WHEN sub.id IS NOT NULL THEN 'VALID' ELSE 'STALE' END AS validity
    FROM orchestration_flows f,
         jsonb_array_elements(f.definition::jsonb->'nodes') AS node
    LEFT JOIN orchestration_flows sub ON sub.id = node->'config'->>'flowId'
    WHERE node->>'type' = 'subflow';
  `);
  if (subflows.rows.length === 0) {
    console.log("(none)");
  } else {
    console.table(subflows.rows);
  }

  await client.end();
  console.log("\nAudit complete. Read-only.");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  client.end().catch(() => {});
  process.exit(1);
});
