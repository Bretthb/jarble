#!/usr/bin/env node
/**
 * Neon DB housekeeping script.
 *
 * Targets stale rows with ZERO value for live operation:
 *   1. managed_nodes rows in status=failed/deleted older than 24 hours
 *      → DELETE (these are records of Hetzner servers that are already
 *        torn down; the rows only served nodeManager's reaper loop)
 *
 *   2. flow_executions stuck in status=running for > 6 hours
 *      → UPDATE SET status='abandoned', error='cleanup: stuck >6h'
 *        (abandoned is a terminal state; the row is kept for audit)
 *
 *   3. agent_calls in status=pending older than 10 minutes (stale inflight)
 *      → UPDATE SET status='abandoned' (same rationale)
 *
 * Run with: DATABASE_URL=postgresql://... node scripts/neon-cleanup.mjs
 *
 * Safety:
 *   - DRY-RUN by default. Set CLEANUP_CONFIRM=1 to actually execute.
 *   - Prints row counts + sample rows before/after.
 *   - Never touches deployments, chat_messages, agent_calls outside of
 *     the pending-abandoned flip, org tables, user tables, or marketplace
 *     tables.
 *   - All operations wrapped in a transaction so a failure rolls back.
 */
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[cleanup] DATABASE_URL is required");
  process.exit(1);
}
const CONFIRM = process.env.CLEANUP_CONFIRM === "1";

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log(`[cleanup] Mode: ${CONFIRM ? "EXECUTE" : "DRY-RUN (set CLEANUP_CONFIRM=1 to apply)"}`);
  console.log();

  try {
    await client.query("BEGIN");

    // 1. managed_nodes — delete dead nodes > 24h
    const mnPreview = await client.query(`
      SELECT status, COUNT(*) AS n
      FROM managed_nodes
      WHERE status IN ('failed','deleted')
        AND COALESCE(deleted_at, created_at) < now() - interval '24 hours'
      GROUP BY status
    `);
    console.log("== managed_nodes: dead > 24h ==");
    mnPreview.rows.forEach((r) => console.log(" ", r.status, r.n));
    if (CONFIRM) {
      const res = await client.query(`
        DELETE FROM managed_nodes
        WHERE status IN ('failed','deleted')
          AND COALESCE(deleted_at, created_at) < now() - interval '24 hours'
      `);
      console.log("  deleted:", res.rowCount);
    }
    console.log();

    // 2. flow_executions — mark stuck as abandoned
    const feStuck = await client.query(`
      SELECT id, flow_id, started_at
      FROM flow_executions
      WHERE status = 'running'
        AND started_at < now() - interval '6 hours'
    `);
    console.log("== flow_executions: stuck running > 6h ==");
    feStuck.rows.forEach((r) => console.log(" ", r.id, r.flow_id, r.started_at));
    if (CONFIRM && feStuck.rowCount && feStuck.rowCount > 0) {
      const res = await client.query(`
        UPDATE flow_executions
        SET status = 'abandoned',
            error = COALESCE(error, '') ||
                    CASE WHEN COALESCE(error,'') = '' THEN '' ELSE E'\n' END ||
                    'neon-cleanup: stuck in running state >6h, flipped to abandoned',
            completed_at = now()
        WHERE status = 'running'
          AND started_at < now() - interval '6 hours'
      `);
      console.log("  abandoned:", res.rowCount);
    }
    console.log();

    // 3. agent_calls — flip stale pending to abandoned
    const acPending = await client.query(`
      SELECT COUNT(*) AS n FROM agent_calls WHERE status='pending' AND created_at < now() - interval '10 minutes'
    `);
    console.log("== agent_calls: pending > 10 min ==");
    console.log(" ", acPending.rows[0].n);
    if (CONFIRM && parseInt(String(acPending.rows[0].n), 10) > 0) {
      const res = await client.query(`
        UPDATE agent_calls
        SET status = 'abandoned',
            error_message = COALESCE(error_message, '') ||
                            CASE WHEN COALESCE(error_message,'') = '' THEN '' ELSE E'\n' END ||
                            'neon-cleanup: still pending after 10min',
            end_ms = EXTRACT(EPOCH FROM now()) * 1000
        WHERE status = 'pending'
          AND created_at < now() - interval '10 minutes'
      `);
      console.log("  abandoned:", res.rowCount);
    }
    console.log();

    if (CONFIRM) {
      await client.query("COMMIT");
      console.log("[cleanup] COMMIT");
    } else {
      await client.query("ROLLBACK");
      console.log("[cleanup] ROLLBACK (dry-run)");
    }

    // Post-run summary
    console.log();
    console.log("== post-run row counts ==");
    for (const t of ["managed_nodes", "flow_executions", "agent_calls"]) {
      const r = await client.query(`SELECT COUNT(*) AS n FROM ${t}`);
      console.log(" ", String(r.rows[0].n).padStart(6), t);
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("[cleanup] failed:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
