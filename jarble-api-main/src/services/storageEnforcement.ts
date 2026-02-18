import { db, tables, USE_SQLITE } from "../db/index.js";
import { eq } from "drizzle-orm";
import { getDeploymentStorageUsage, stopDeployment } from "../k8s/deployment.js";
import { logger } from "../utils/logger.js";

const { deployments } = tables;

const STORAGE_ERROR_PREFIX = "Storage limit exceeded";

/**
 * Check storage usage for all running deployments and enforce limits.
 * - 100%+: stop deployment and set error message.
 * - Below 100%: clear any previous storage error (user freed space and restarted).
 */
export async function enforceStorageLimits(): Promise<void> {
  if (USE_SQLITE) return;

  try {
    const running = await db.query.deployments.findMany({
      where: eq(deployments.status, "running"),
    });

    if (running.length === 0) return;

    logger.debug({ count: running.length }, "storageEnforcement: checking running deployments");

    for (const dep of running) {
      try {
        await checkDeploymentStorage(dep as any);
      } catch (err) {
        logger.warn({ deploymentId: dep.id, err }, "storageEnforcement: failed to check deployment");
      }
    }
  } catch (err) {
    logger.error({ err }, "storageEnforcement: sweep failed");
  }
}

async function checkDeploymentStorage(dep: {
  id: string;
  storageMb: number | null;
  error: string | null;
}): Promise<void> {
  const usage = await getDeploymentStorageUsage(dep.id);
  if (!usage) return;

  // Use actual PVC size from `df` output (not DB value which may be stale after plan changes)
  const allocatedGb = usage.totalGb > 0 ? usage.totalGb : (dep.storageMb || 30);
  const percentOfAllocated = allocatedGb > 0
    ? Math.round((usage.usedGb / allocatedGb) * 1000) / 10
    : 0;

  if (percentOfAllocated >= 100) {
    const errorMsg = `${STORAGE_ERROR_PREFIX}: using ${usage.usedGb.toFixed(1)} GB of ${allocatedGb} GB allocated. Free up space and restart.`;

    logger.warn(
      { deploymentId: dep.id, usedGb: usage.usedGb, allocatedGb, percentOfAllocated },
      "storageEnforcement: storage exceeded, stopping deployment"
    );

    await stopDeployment(dep.id);

    await (db as any).update(deployments)
      .set({ status: "stopped", error: errorMsg })
      .where(eq(deployments.id, dep.id));

    return;
  }

  // Clear storage error if usage dropped below limit (user freed space)
  if (dep.error && dep.error.startsWith(STORAGE_ERROR_PREFIX)) {
    logger.info(
      { deploymentId: dep.id, percentOfAllocated },
      "storageEnforcement: usage below limit, clearing storage error"
    );

    await (db as any).update(deployments)
      .set({ error: null })
      .where(eq(deployments.id, dep.id));
  }
}

/**
 * Start the periodic storage enforcement check.
 * Runs immediately on startup, then every `intervalMs` (default 5 minutes).
 */
export function startStorageEnforcement(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  logger.info({ intervalMs }, "storageEnforcement: starting periodic storage limit checks");
  void enforceStorageLimits();
  return setInterval(() => void enforceStorageLimits(), intervalMs);
}
