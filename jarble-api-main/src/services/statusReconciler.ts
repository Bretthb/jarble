import { db, tables } from "../db/index.js";
import { eq, inArray, desc } from "drizzle-orm";
import { getDeploymentPodStatus, type DeploymentPodStatus } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/constants.js";
import { logger } from "../utils/logger.js";

const { deployments } = tables;

/**
 * Status Reconciler - Background job that syncs DB status with K8s reality.
 *
 * Fixes the "stuck at creating" issue where:
 * - Deployment polling times out during slow npm install
 * - DB shows "creating" but pod is actually running (or failed)
 *
 * Also catches:
 * - DB says "running" but pod was evicted/OOMKilled
 * - DB says "running" but pod was manually deleted
 */

type DbStatus = "creating" | "running" | "stopped" | "failed" | "restarting" | "reloading";

interface StatusMismatch {
  deploymentId: string;
  dbStatus: DbStatus;
  k8sStatus: DeploymentPodStatus;
  newStatus: DbStatus;
  error?: string;
}

/**
 * Reconcile all deployments that may have drifted.
 * Checks deployments with status: creating, running, restarting
 */
export async function reconcileStatuses(): Promise<void> {
  // Skip in local dev mode — no real K8s cluster to reconcile against
  if (process.env.USE_SQLITE === "true") return;

  try {
    // Find deployments that might have drifted
    // Limit to 100 per cycle to prevent overwhelming K8s API at scale
    const driftCandidates = await db.query.deployments.findMany({
      where: inArray(deployments.status, ["creating", "running", "restarting", "reloading"]),
      columns: { id: true, status: true, name: true, updatedAt: true, managedBy: true },
      limit: 100,
      orderBy: (d, { desc }) => [desc(d.updatedAt)], // Prioritize recently changed
    });

    if (driftCandidates.length === 0) return;

    logger.debug({ count: driftCandidates.length }, "statusReconciler: checking deployments");

    const mismatches: StatusMismatch[] = [];

    for (const dep of driftCandidates) {
      try {
        const mismatch = await checkDeploymentStatus(dep as { id: string; status: DbStatus; name: string; managedBy: string | null });
        if (mismatch) {
          mismatches.push(mismatch);
        }
      } catch (err) {
        logger.warn({ deploymentId: dep.id, err }, "statusReconciler: failed to check deployment");
      }
    }

    // Apply fixes
    for (const mismatch of mismatches) {
      try {
        await applyStatusFix(mismatch);
      } catch (err) {
        logger.error({ deploymentId: mismatch.deploymentId, err }, "statusReconciler: failed to apply fix");
      }
    }

    if (mismatches.length > 0) {
      logger.info({ count: mismatches.length }, "statusReconciler: fixed status mismatches");
    }
  } catch (err) {
    logger.error({ err }, "statusReconciler: sweep failed");
  }
}

/**
 * Check a single deployment for status drift.
 * Returns a mismatch object if the DB and K8s disagree, null otherwise.
 */
async function checkDeploymentStatus(dep: {
  id: string;
  status: DbStatus;
  name: string;
  managedBy: string | null;
}): Promise<StatusMismatch | null> {
  const managedBy = (dep.managedBy ?? "legacy") as ManagedBy;
  const k8sStatus = await getDeploymentPodStatus(dep.id, managedBy);

  // Determine what the DB status should be based on K8s reality
  let expectedDbStatus: DbStatus;
  let error: string | undefined;

  switch (k8sStatus.status) {
    case "running":
      expectedDbStatus = "running";
      break;

    case "failed":
      expectedDbStatus = "failed";
      error = k8sStatus.error || "Pod failed";
      break;

    case "creating":
      // Pod is still starting up (Pending, or Running but readiness probe not yet passing).
      // Never downgrade "running" → "creating" — a pod can temporarily lose readiness
      // during initialDelaySeconds, configSync restarts, or brief probe failures.
      if (dep.status === "running") return null;
      // Preserve transitional statuses — restarting and reloading resolve on their own
      if (dep.status === "restarting" || dep.status === "reloading") return null;
      expectedDbStatus = "creating";
      break;

    case "not_found":
      // No pod exists
      if (dep.status === "creating" || dep.status === "restarting" || dep.status === "reloading") {
        // Deployment is in progress but pod doesn't exist yet - could be normal
        // Only flag as issue if we've been waiting too long (handled elsewhere)
        return null;
      }
      // DB says running but pod is gone
      expectedDbStatus = "stopped";
      break;

    default:
      return null;
  }

  // Check for mismatch
  if (dep.status !== expectedDbStatus) {
    return {
      deploymentId: dep.id,
      dbStatus: dep.status,
      k8sStatus,
      newStatus: expectedDbStatus,
      error,
    };
  }

  return null;
}

/**
 * Apply a status fix to the database.
 * Verifies the deployment still exists before updating (it may have been
 * deleted between the check and apply phases of reconciliation).
 */
async function applyStatusFix(mismatch: StatusMismatch): Promise<void> {
  // Guard: verify the deployment still exists in the DB
  const current = await db.query.deployments.findFirst({
    where: eq(deployments.id, mismatch.deploymentId),
    columns: { id: true, status: true },
  });

  if (!current) {
    logger.debug(
      { deploymentId: mismatch.deploymentId },
      "statusReconciler: deployment deleted before fix could be applied, skipping"
    );
    return;
  }

  // Also skip if the status has already changed since we checked
  if (current.status !== mismatch.dbStatus) {
    logger.debug(
      { deploymentId: mismatch.deploymentId, expected: mismatch.dbStatus, actual: current.status },
      "statusReconciler: deployment status changed since check, skipping"
    );
    return;
  }

  logger.info(
    {
      deploymentId: mismatch.deploymentId,
      from: mismatch.dbStatus,
      to: mismatch.newStatus,
      k8sPhase: mismatch.k8sStatus.phase,
      error: mismatch.error,
    },
    "statusReconciler: fixing status mismatch"
  );

  const updateData: { status: DbStatus; error?: string | null } = {
    status: mismatch.newStatus,
  };

  if (mismatch.error) {
    updateData.error = mismatch.error;
  } else if (mismatch.newStatus === "running") {
    // Clear any previous error when transitioning to running
    updateData.error = null;
  }

  await db.update(deployments)
    .set(updateData)
    .where(eq(deployments.id, mismatch.deploymentId));
}

/**
 * Start the periodic status reconciliation.
 * Runs immediately on startup, then every `intervalMs` (default 30 seconds).
 */
export function startStatusReconciler(intervalMs: number = 30 * 1000): NodeJS.Timeout {
  logger.info({ intervalMs }, "statusReconciler: starting periodic status reconciliation");
  void reconcileStatuses();
  return setInterval(() => void reconcileStatuses(), intervalMs);
}
