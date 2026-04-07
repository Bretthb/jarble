/**
 * Stuck Deployment Monitor — observability ticker + Longhorn-aware diagnosis.
 *
 * Polls the database for deployments stuck in transitional states
 * (`creating`, `restarting`, `reloading`) longer than STUCK_THRESHOLD_MS.
 * Emits a structured warning log + Sentry event (with dedup fingerprint)
 * for each match.
 *
 * **Wave 4 Layer C extension:** before emitting the generic time-based
 * warning, queries the K8s pod + PVC + Longhorn Volume CR to find the
 * actual root cause. When it detects `LocalReplicaSchedulingFailure`
 * (Longhorn refusing to schedule a replica because of insufficient node
 * storage — the bug that ate 20+ minutes of dev time on 2026-04-07), it
 * emits a precise error message AND auto-flips the deployment to `failed`
 * since there's no way it'll recover on its own. This is the ONE write
 * the monitor performs — every other status correction is left to
 * `statusReconciler.ts`. The monitor is otherwise read-only.
 *
 * **Wave 4 Layer C orphan cleanup:** a second ticker runs every 5 min and
 * removes K8s resources (Deployment, PVC, Secret, ConfigMap) for `failed`
 * deployments older than 30 min, then asks `nodeManager.checkScaleDown`
 * to deprovision now-empty Hetzner workers. The DB row itself is never
 * deleted — only the K8s side is reaped.
 *
 * See docs/audits/monitoring-stuck-deployments.md Alert #1.
 */
import * as Sentry from "@sentry/node";
import { and, eq, inArray, lt } from "drizzle-orm";
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

// ── Wave 4 Layer C: orphan cleanup ────────────────────────────────────
//
// A SECOND ticker runs less frequently (every 5 min) and reaps K8s
// resources for deployments stuck in `failed` for more than this age.
// Unlike the diagnostic poller above, this one MUST be conservative:
// only `failed` rows older than ORPHAN_AGE_THRESHOLD_MS are touched, and
// the DB row itself is NEVER deleted — only the K8s objects.
export const ORPHAN_POLL_INTERVAL_MS = 5 * 60_000;
export const ORPHAN_AGE_THRESHOLD_MS = 30 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let orphanTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let orphanRunning = false;

// Tracks the last time we sent a Sentry event for each deployment, so we
// can suppress duplicate events within the re-emit window. Cleared on
// stopStuckDeploymentMonitor() so tests get a clean slate.
const lastSentryEmitAt = new Map<string, number>();

// ── Diagnosis types ───────────────────────────────────────────────────
//
// `diagnoseStuckDeployment` is the new helper that turns a stuck row into
// a structured root-cause object. The default implementation queries the
// real K8s API (lazy-imported so the module is safe to import in tests
// that don't mock K8s). Tests inject their own implementation via
// `__setDiagnoseStuckDeploymentFn` to avoid touching a real cluster.

export type StuckFailureKind =
  | "longhorn_storage" // Longhorn refused to schedule a replica (insufficient node storage)
  | "longhorn_other" // Longhorn condition unhealthy for a different reason
  | "image_pull" // ImagePullBackOff / ErrImagePull
  | "crashloop" // CrashLoopBackOff
  | "unknown"; // No specific failure detected — fall through to generic warning

export interface StuckDiagnosis {
  failureKind: StuckFailureKind;
  /** Human-readable message suitable for both logs and `error` column. */
  message: string;
  /**
   * If true, the failure is unrecoverable and the monitor should flip the
   * deployment row to `failed`. Currently only set for `longhorn_storage`
   * — every other diagnosis is informational and leaves the row alone so
   * `statusReconciler.ts` keeps owning the corrective writes.
   */
  unrecoverable: boolean;
}

type DiagnoseFn = (row: {
  id: string;
  name: string | null;
  storageMb: number | null;
}) =>
  | StuckDiagnosis
  | null
  | Promise<StuckDiagnosis | null>;

let diagnoseStuckDeploymentImpl: DiagnoseFn = defaultDiagnoseStuckDeployment;

/**
 * Override the diagnosis implementation. Used by tests to swap in a fake
 * that doesn't hit a real cluster. Calling with `null` (or no arg) resets
 * to the default real implementation.
 */
export function __setDiagnoseStuckDeploymentFn(fn: DiagnoseFn | null): void {
  diagnoseStuckDeploymentImpl = fn ?? defaultDiagnoseStuckDeployment;
}

/**
 * Public wrapper that the tests + the orphan ticker can call. Always
 * delegates to the currently-installed implementation, so test overrides
 * take effect immediately.
 */
export async function diagnoseStuckDeployment(row: {
  id: string;
  name: string | null;
  storageMb: number | null;
}): Promise<StuckDiagnosis | null> {
  return await diagnoseStuckDeploymentImpl(row);
}

/**
 * Default diagnosis implementation. Lazy-imports K8s clients so this
 * module is safe to import in tests that don't mock the K8s layer.
 *
 * Returns null on ANY failure — graceful degradation is critical here
 * because the alternative (a thrown error inside the polling loop) would
 * silence the entire monitor for ops.
 */
async function defaultDiagnoseStuckDeployment(row: {
  id: string;
  name: string | null;
  storageMb: number | null;
}): Promise<StuckDiagnosis | null> {
  try {
    // Lazy import: keeps the K8s client out of the import graph for any
    // call site that doesn't drive a real poll cycle (incl. tests that
    // only validate constants / dedup state).
    const { coreApi, customApi } = await import("../k8s/client.js");
    const { NAMESPACE } = await import("../k8s/constants.js");

    // 1. Find the pod for this deployment. The label is set by
    //    `lifecycle.ts` (legacy mode) — operator-managed deployments use
    //    `app.kubernetes.io/instance` instead, but we don't currently
    //    diagnose those (they're rare and Longhorn behaves the same).
    const podsResp = await coreApi.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      `jarble.ai/deployment-id=${row.id}`,
    );
    const pod = podsResp.body?.items?.[0];

    // 2. If the pod is Pending and PVC unbound, jump straight to the
    //    Longhorn check. We don't even bother parsing pod events — the
    //    Longhorn Volume condition is the source of truth.
    let pvcName = `pvc-${row.id}`;
    if (pod) {
      const podPhase = pod.status?.phase;
      const containerStatus = pod.status?.containerStatuses?.[0];
      const waiting = containerStatus?.state?.waiting?.reason;

      if (waiting === "ImagePullBackOff" || waiting === "ErrImagePull") {
        const msg = `Deployment ${row.name ?? row.id} (${row.id}) stuck: container image pull failed (${waiting}). ${containerStatus?.state?.waiting?.message ?? ""}`.trim();
        return { failureKind: "image_pull", message: msg, unrecoverable: false };
      }
      if (waiting === "CrashLoopBackOff") {
        const msg = `Deployment ${row.name ?? row.id} (${row.id}) stuck: container in CrashLoopBackOff. ${containerStatus?.state?.waiting?.message ?? ""}`.trim();
        return { failureKind: "crashloop", message: msg, unrecoverable: false };
      }

      // If the pod isn't Pending, Longhorn isn't the bottleneck — bail.
      if (podPhase && podPhase !== "Pending") {
        return null;
      }

      // Pull the actual PVC name from the pod spec — defends against
      // operator-managed pods that use a different naming scheme.
      const dataVolume = pod.spec?.volumes?.find(
        (v) => v.persistentVolumeClaim?.claimName,
      );
      if (dataVolume?.persistentVolumeClaim?.claimName) {
        pvcName = dataVolume.persistentVolumeClaim.claimName;
      }
    }

    // 3. Look up the PVC's bound PV name. An unbound PVC has no
    //    spec.volumeName yet — but the storage size requested is right
    //    on the spec, so we can still report it.
    let pvName: string | undefined;
    let requestedGi: string | number | undefined;
    try {
      const pvcResp = await coreApi.readNamespacedPersistentVolumeClaim(
        pvcName,
        NAMESPACE,
      );
      pvName = pvcResp.body?.spec?.volumeName;
      requestedGi = pvcResp.body?.spec?.resources?.requests?.storage;
    } catch (err) {
      log.debug(
        { deploymentId: row.id, pvcName, err: errMsg(err) },
        "diagnoseStuckDeployment: PVC lookup failed (graceful)",
      );
    }

    // 4. If we have a PV name, query the Longhorn Volume CR for its
    //    scheduling status. If we don't, we still try the Longhorn API
    //    using the PVC name (some Longhorn versions name the volume
    //    after the PVC). Either way, an exception aborts the diagnosis.
    const longhornVolumeName = pvName ?? pvcName;
    try {
      const volResp = await customApi.getNamespacedCustomObject(
        "longhorn.io",
        "v1beta2",
        "longhorn-system",
        "volumes",
        longhornVolumeName,
      );
      const body = volResp.body as {
        status?: {
          conditions?: Array<{
            type?: string;
            status?: string;
            reason?: string;
            message?: string;
          }>;
        };
      };
      const conditions = body.status?.conditions ?? [];
      const scheduled = conditions.find((c) => c?.type === "Scheduled");

      if (scheduled && scheduled.status === "False") {
        const reason = scheduled.reason ?? "";
        const detail = scheduled.message ?? "";
        // The exact reason that bit us on 2026-04-07 was
        // `LocalReplicaSchedulingFailure` with message containing
        // "insufficient storage". We treat any LocalReplicaSchedulingFailure
        // with that substring as the load-bearing case and recommend
        // either reducing PVC size or upgrading the node tier.
        if (
          reason === "LocalReplicaSchedulingFailure" &&
          /insufficient storage/i.test(detail)
        ) {
          const sizeStr =
            requestedGi != null
              ? String(requestedGi)
              : row.storageMb != null
                ? `${row.storageMb} GiB`
                : "the requested";
          const msg = `Deployment ${row.name ?? row.id} (${row.id}) stuck: Longhorn cannot schedule a ${sizeStr} replica because the node has insufficient storage. Either reduce the PVC size or upgrade the node tier. (LocalReplicaSchedulingFailure)`;
          return {
            failureKind: "longhorn_storage",
            message: msg,
            unrecoverable: true,
          };
        }

        // Longhorn rejected scheduling for some other reason — surface
        // the verbatim message but leave recovery to the reconciler.
        const msg = `Deployment ${row.name ?? row.id} (${row.id}) stuck: Longhorn refused to schedule replica — ${reason || "Scheduled=False"}: ${detail || "(no detail)"}`;
        return {
          failureKind: "longhorn_other",
          message: msg,
          unrecoverable: false,
        };
      }
    } catch (err) {
      log.debug(
        { deploymentId: row.id, pvName: longhornVolumeName, err: errMsg(err) },
        "diagnoseStuckDeployment: Longhorn lookup failed (graceful)",
      );
    }

    // No specific failure detected — caller falls through to the generic
    // time-based warning.
    return null;
  } catch (err) {
    // Top-level catch: lazy-import failure, network error, etc. Always
    // returns null so the monitor never crashes.
    log.debug(
      { deploymentId: row.id, err: errMsg(err) },
      "diagnoseStuckDeployment: top-level failure (graceful)",
    );
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
        storageMb: tables.deployments.storageMb,
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

      // ── Wave 4 Layer C: Longhorn-aware diagnosis ───────────────────
      //
      // Before falling back to the generic time-based warning, ask the
      // diagnose helper for a precise root cause. The helper is wrapped
      // in a try/catch (and the default impl already catches everything
      // internally), so any failure here just leaves us with a null
      // diagnosis and the existing generic path runs unchanged.
      //
      // The impl is allowed to return a sync `null | StuckDiagnosis` OR a
      // Promise of either — we only `await` when it's a Promise. This is
      // load-bearing for the existing test suite, which uses fake timers
      // with a fixed number of microtask flushes; adding an unconditional
      // `await` here would shift the Sentry capture out of reach of those
      // flushes and break tests that pre-date Wave 4.
      let diagnosis: StuckDiagnosis | null = null;
      try {
        const result = diagnoseStuckDeploymentImpl({
          id: row.id,
          name: row.name ?? null,
          storageMb: row.storageMb ?? null,
        });
        diagnosis =
          result && typeof (result as Promise<unknown>).then === "function"
            ? await (result as Promise<StuckDiagnosis | null>)
            : (result as StuckDiagnosis | null);
      } catch (err) {
        log.debug(
          { deploymentId: row.id, err: errMsg(err) },
          "stuckDeploymentMonitor: diagnose threw (graceful, falling back to generic)",
        );
        diagnosis = null;
      }

      // Pick the message + Sentry tag based on whether we got a precise
      // diagnosis. The fingerprint stays the same (per-deployment) so a
      // diagnosed alert + a later generic alert still group together.
      const baseMessage = diagnosis
        ? diagnosis.message
        : `Deployment stuck in ${row.status} for ${ageMinutes}m`;
      const failureKindTag = diagnosis?.failureKind ?? "unknown";

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
          failureKind: failureKindTag,
        },
        baseMessage,
      );

      // ── Auto-flip unrecoverable failures ────────────────────────────
      //
      // If the diagnosis says the failure is unrecoverable (currently
      // only Longhorn insufficient-storage), write `failed` + the precise
      // error message to the deployment row. We use the existing `error`
      // text column so we don't have to add a new schema column. The
      // write is wrapped in a try/catch — a DB failure here MUST NOT
      // break alerting.
      if (diagnosis?.unrecoverable) {
        try {
          await db
            .update(tables.deployments)
            .set({
              status: "failed",
              error: diagnosis.message,
              updatedAt: new Date(),
            })
            .where(eq(tables.deployments.id, row.id));
          log.info(
            {
              deploymentId: row.id,
              failureKind: diagnosis.failureKind,
            },
            "stuckDeploymentMonitor: flipped unrecoverable deployment to failed",
          );
        } catch (err) {
          log.error(
            { deploymentId: row.id, err: errMsg(err) },
            "stuckDeploymentMonitor: failed to flip status (non-fatal, alert still fires)",
          );
        }
      }

      // Sentry dedup: only re-emit per deployment once per window. The
      // fingerprint also dedupes server-side, but client-side suppression
      // saves a network round-trip when SENTRY_DSN is set.
      const lastEmit = lastSentryEmitAt.get(row.id) ?? 0;
      if (now.getTime() - lastEmit < SENTRY_REEMIT_WINDOW_MS) continue;

      try {
        Sentry.captureMessage(
          diagnosis
            ? diagnosis.message
            : `Deployment ${row.id} stuck in ${row.status} for ${ageMinutes}m`,
          {
            level,
            tags: {
              deployment_id: row.id,
              runtime: row.runtime ?? "unknown",
              stuck_status: row.status,
              stuck_minutes: String(ageMinutes),
              failure_kind: failureKindTag,
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
  if (orphanTimer) {
    clearInterval(orphanTimer);
    orphanTimer = null;
    log.info("stuckDeploymentMonitor: orphan cleanup stopped");
  }
  lastSentryEmitAt.clear();
  // Reset diagnose injection so the next test starts from a clean slate.
  diagnoseStuckDeploymentImpl = defaultDiagnoseStuckDeployment;
}

// ═══════════════════════════════════════════════════════════════════════
// Orphan Cleanup (Wave 4 Layer C)
// ═══════════════════════════════════════════════════════════════════════
//
// Failed deployments leave behind K8s resources (Deployment, PVC, Secret,
// ConfigMap) AND a Hetzner worker that the autoscaler provisioned for
// them. Without cleanup, those workers stay up forever — a single failed
// deployment from earlier today (the Longhorn insufficient-storage bug
// that motivated this wave) cost real money in idle compute. The orphan
// cleanup ticker reaps that state.
//
// CONSERVATIVE BY DESIGN:
//   - Only touches rows in `failed` state
//   - Only touches rows whose `updatedAt` is older than ORPHAN_AGE_THRESHOLD_MS
//     (gives a human ample time to investigate before automation cleans up)
//   - NEVER deletes the DB row itself — only the K8s side
//   - Calls `nodeManager.checkScaleDown` afterwards so newly-empty Hetzner
//     workers actually get deprovisioned (otherwise the bill keeps growing)
//
// Like `pollOnce`, the K8s + nodeManager modules are lazy-imported so this
// file is safe to import in tests that don't mock them.

// Test injection points — same pattern as `__setDiagnoseStuckDeploymentFn`
// above. The defaults call into the real `lifecycle.ts` / `nodeManager.ts`.
type DeleteFn = (deploymentId: string) => Promise<void>;
type ScaleDownFn = () => Promise<void>;

let deleteOrphanFn: DeleteFn = defaultDeleteOrphan;
let scaleDownFn: ScaleDownFn = defaultScaleDown;

export function __setOrphanCleanupFns(opts: {
  deleteFn?: DeleteFn | null;
  scaleDownFn?: ScaleDownFn | null;
}): void {
  deleteOrphanFn = opts.deleteFn ?? defaultDeleteOrphan;
  scaleDownFn = opts.scaleDownFn ?? defaultScaleDown;
}

async function defaultDeleteOrphan(deploymentId: string): Promise<void> {
  const { deleteDeployment } = await import("../k8s/lifecycle.js");
  await deleteDeployment(deploymentId, "legacy");
}

async function defaultScaleDown(): Promise<void> {
  const { checkScaleDown } = await import("../k8s/nodeManager.js");
  await checkScaleDown(db);
}

/**
 * Run a single orphan cleanup cycle. Exported so tests can drive it
 * without waiting for the interval.
 *
 * @returns the number of orphans cleaned up, or -1 on a top-level error.
 */
export async function cleanupOrphansOnce(now: Date = new Date()): Promise<number> {
  // Single-flight guard, same shape as pollOnce.
  if (orphanRunning) {
    log.debug("cleanupOrphansOnce: previous cycle still running, skipping");
    return 0;
  }
  orphanRunning = true;
  try {
    const cutoff = new Date(now.getTime() - ORPHAN_AGE_THRESHOLD_MS);

    const rows = await db
      .select({
        id: tables.deployments.id,
        name: tables.deployments.name,
        status: tables.deployments.status,
        updatedAt: tables.deployments.updatedAt,
      })
      .from(tables.deployments)
      .where(
        and(
          eq(tables.deployments.status, "failed"),
          lt(tables.deployments.updatedAt, cutoff),
        ),
      );

    if (rows.length === 0) {
      return 0;
    }

    let cleaned = 0;
    for (const row of rows) {
      try {
        log.info(
          { deploymentId: row.id, deploymentName: row.name },
          "cleanupOrphansOnce: deleting K8s resources for failed deployment",
        );
        await deleteOrphanFn(row.id);
        cleaned += 1;
      } catch (err) {
        // 404s from the K8s API mean the orphan is already gone — that's
        // a successful no-op, not a failure. The default `deleteDeployment`
        // already swallows 404s internally, so anything that escapes here
        // is a real error worth logging.
        log.warn(
          { deploymentId: row.id, err: errMsg(err) },
          "cleanupOrphansOnce: delete failed (will retry next cycle)",
        );
      }
    }

    if (cleaned > 0) {
      try {
        await scaleDownFn();
      } catch (err) {
        log.warn(
          { err: errMsg(err) },
          "cleanupOrphansOnce: scaleDown failed (non-fatal)",
        );
      }
    }

    log.info(
      { totalOrphans: rows.length, cleaned },
      "cleanupOrphansOnce: cycle complete",
    );
    return cleaned;
  } catch (err) {
    log.error(
      { err: errMsg(err) },
      "cleanupOrphansOnce: cycle failed",
    );
    return -1;
  } finally {
    orphanRunning = false;
  }
}

/**
 * Start the orphan cleanup ticker. Idempotent; pairs with
 * `stopStuckDeploymentMonitor` (which clears both timers).
 */
export function startOrphanCleanupMonitor(
  intervalMs: number = ORPHAN_POLL_INTERVAL_MS,
): NodeJS.Timeout | null {
  if (orphanTimer) {
    log.debug("startOrphanCleanupMonitor: already running");
    return orphanTimer;
  }
  log.info(
    { pollIntervalMs: intervalMs, ageThresholdMs: ORPHAN_AGE_THRESHOLD_MS },
    "stuckDeploymentMonitor: starting orphan cleanup",
  );
  // Run once immediately so orphans from a previous process crash get
  // reaped without waiting for the first interval.
  void cleanupOrphansOnce().catch(() => {
    /* cleanupOrphansOnce already swallows its own errors */
  });
  orphanTimer = setInterval(() => {
    void cleanupOrphansOnce().catch((err) => {
      log.error(
        { err: errMsg(err) },
        "stuckDeploymentMonitor: uncaught error in orphan cleanup interval",
      );
    });
  }, intervalMs);
  return orphanTimer;
}
