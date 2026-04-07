/**
 * Stuck Deployment Monitor — observability ticker.
 *
 * Polls the database for deployments stuck in transitional states
 * (`creating`, `restarting`, `reloading`) longer than STUCK_THRESHOLD_MS.
 * Emits a structured warning log + Sentry event (with dedup fingerprint)
 * for each match.
 *
 * READ-ONLY: this monitor never writes to the database. Status correction
 * is the job of `statusReconciler.ts`. This module is purely observability —
 * it surfaces stuck deployments to ops via logs + Sentry so the team learns
 * about silent failures (FailedAttachVolume, configSync hangs, etc).
 *
 * See docs/audits/monitoring-stuck-deployments.md Alert #1.
 */
import * as Sentry from "@sentry/node";
import { and, inArray, lt } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("stuck-deployment-monitor");

// Poll every minute; alert if a deployment has been in a transitional
// state for more than 5 minutes without resolving.
export const POLL_INTERVAL_MS = 60_000;
export const STUCK_THRESHOLD_MS = 5 * 60_000;

// Transitional statuses that should not persist for long. These are the
// states a deployment passes *through* on the way to `running` / `stopped`.
// `creating` — initial spin-up; `restarting` / `reloading` — config changes.
// (Note: this codebase does not use a `starting` status — `creating` covers
// both initial provisioning and re-provisioning.)
export const STUCK_STATES = ["creating", "restarting", "reloading"] as const;

// Re-emit Sentry events for the same deployment at most once per this
// window. Avoids alert fatigue when a deployment stays stuck for hours.
const SENTRY_REEMIT_WINDOW_MS = 30 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

// Tracks the last time we sent a Sentry event for each deployment, so we
// can suppress duplicate events within the re-emit window. Cleared on
// stopStuckDeploymentMonitor() so tests get a clean slate.
const lastSentryEmitAt = new Map<string, number>();

/**
 * Run a single poll cycle. Exported so tests can drive it directly without
 * waiting for setInterval.
 *
 * @returns the number of stuck deployments found, or -1 on error.
 */
export async function pollOnce(now: Date = new Date()): Promise<number> {
  // Single-flight guard: if a previous poll is still running (e.g. DB is
  // slow and the cycle takes longer than POLL_INTERVAL_MS), skip this tick
  // rather than letting overlapping queries pile up.
  if (running) {
    log.debug("pollOnce: previous cycle still running, skipping");
    return 0;
  }
  running = true;
  try {
    const cutoff = new Date(now.getTime() - STUCK_THRESHOLD_MS);

    const rows = await db
      .select({
        id: tables.deployments.id,
        name: tables.deployments.name,
        userId: tables.deployments.userId,
        runtime: tables.deployments.runtime,
        status: tables.deployments.status,
        createdAt: tables.deployments.createdAt,
        updatedAt: tables.deployments.updatedAt,
      })
      .from(tables.deployments)
      .where(
        and(
          inArray(
            tables.deployments.status,
            STUCK_STATES as unknown as string[],
          ),
          lt(tables.deployments.updatedAt, cutoff),
        ),
      );

    for (const row of rows) {
      const updatedAtMs = row.updatedAt
        ? new Date(row.updatedAt).getTime()
        : now.getTime();
      const stuckMs = now.getTime() - updatedAtMs;
      const ageMinutes = Math.round(stuckMs / 60_000);
      const fingerprint = `stuck-deployment:${row.id}`;
      // Severity escalates from "warning" to "error" once a deployment has
      // been stuck for >15 min — gives the email-tier alert a clear cutoff
      // before paging-tier escalation.
      const level: "warning" | "error" = ageMinutes >= 15 ? "error" : "warning";

      log.warn(
        {
          deploymentId: row.id,
          deploymentName: row.name,
          userId: row.userId,
          runtime: row.runtime,
          status: row.status,
          ageMinutes,
          level,
          fingerprint,
        },
        `Deployment stuck in ${row.status} for ${ageMinutes}m`,
      );

      // Sentry dedup: only re-emit per deployment once per window. The
      // fingerprint also dedupes server-side, but client-side suppression
      // saves a network round-trip when SENTRY_DSN is set.
      const lastEmit = lastSentryEmitAt.get(row.id) ?? 0;
      if (now.getTime() - lastEmit < SENTRY_REEMIT_WINDOW_MS) continue;

      try {
        Sentry.captureMessage(
          `Deployment ${row.id} stuck in ${row.status} for ${ageMinutes}m`,
          {
            level,
            tags: {
              deployment_id: row.id,
              runtime: row.runtime ?? "unknown",
              stuck_status: row.status,
              stuck_minutes: String(ageMinutes),
            },
            // Sentry uses the fingerprint to group all events for the same
            // deployment into a single issue.
            fingerprint: ["stuck-deployment", row.id],
          },
        );
        lastSentryEmitAt.set(row.id, now.getTime());
      } catch (err) {
        // Sentry capture should never crash the ticker. If Sentry is not
        // initialized (no SENTRY_DSN), captureMessage is a no-op, but we
        // still defend against any other transport failure.
        log.debug(
          { err: err instanceof Error ? err.message : String(err) },
          "stuckDeploymentMonitor: Sentry capture failed (non-fatal)",
        );
      }
    }

    return rows.length;
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "stuckDeploymentMonitor: poll cycle failed",
    );
    return -1;
  } finally {
    running = false;
  }
}

/**
 * Start the periodic stuck-deployment monitor.
 *
 * Runs once immediately on startup so deployments left stuck by a previous
 * process crash get reported right away. Idempotent — calling twice without
 * stopping in between is a no-op.
 */
export function startStuckDeploymentMonitor(
  intervalMs: number = POLL_INTERVAL_MS,
): NodeJS.Timeout | null {
  if (timer) {
    log.debug("startStuckDeploymentMonitor: already running");
    return timer;
  }
  log.info(
    { pollIntervalMs: intervalMs, thresholdMs: STUCK_THRESHOLD_MS },
    "stuckDeploymentMonitor: starting",
  );
  // Run once immediately so stuck pods from a previous process crash alert
  // without waiting for the first interval to elapse.
  void pollOnce().catch(() => {
    /* pollOnce already swallows its own errors */
  });
  timer = setInterval(() => {
    void pollOnce().catch((err) => {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "stuckDeploymentMonitor: uncaught error in interval callback",
      );
    });
  }, intervalMs);
  return timer;
}

/**
 * Stop the monitor and clear all in-memory state. Safe to call when the
 * monitor isn't running.
 */
export function stopStuckDeploymentMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info("stuckDeploymentMonitor: stopped");
  }
  lastSentryEmitAt.clear();
}
