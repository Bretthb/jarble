/**
 * ═══════════════════════════════════════════════════════════════════════
 * Config Sync Service — Two-way config synchronization between DB and PVC
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Direction 1: Frontend → PVC (syncConfigsToPvc)
 *   User saves config on frontend → DB updates → this service renders
 *   config files from the runtime handler, writes them to the PVC,
 *   updates the K8s Secret, and restarts the pod.
 *
 * Direction 2: PVC → Frontend (syncConfigsFromPvc)
 *   File watcher in the container detects changes → webhook calls API →
 *   this service reads config files from the PVC, parses them via the
 *   runtime handler, and updates the DB if values changed.
 *
 * Both functions are designed to be called fire-and-forget:
 *   void syncConfigsToPvc(deploymentId);
 *   void syncConfigsFromPvc(deploymentId);
 */

import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import {
  writeConfigsToPvc,
  readConfigsFromPvc,
  updateDeploymentSecret,
  restartDeployment,
  getDeploymentPodStatus,
} from "../k8s/deployment.js";
import { getHandlerOrNull } from "../runtimes/index.js";
import type { DeploymentFields } from "../runtimes/types.js";
import { decryptApiKey } from "../utils/encryption.js";
import { logger } from "../utils/logger.js";

const { deployments, platformCredentials } = tables;

// ── Helper: Build DeploymentFields from DB row ──────────────────────────

/**
 * Load a deployment + its platform credentials from DB and build a
 * DeploymentFields object suitable for runtime handler methods.
 */
async function buildDeploymentFields(
  deployment: any
): Promise<DeploymentFields> {
  // Decrypt LLM API key
  const rawApiKey = deployment.llmApiKey
    ? decryptApiKey(deployment.llmApiKey)
    : null;

  // Load and decrypt platform credentials
  const platformCredsRows = await (db as any).query.platformCredentials.findMany({
    where: eq(platformCredentials.deploymentId, deployment.id),
  });

  const platformCredsMap: Record<string, Record<string, string>> = {};
  for (const row of platformCredsRows as any[]) {
    try {
      const decrypted = decryptApiKey(row.credentials);
      platformCredsMap[row.platformId] = JSON.parse(decrypted);
    } catch (err) {
      logger.warn(
        { deploymentId: deployment.id, platformId: row.platformId, err },
        "configSync: failed to decrypt platform credentials, skipping"
      );
    }
  }

  return {
    id: deployment.id,
    runtime: deployment.runtime,
    name: deployment.name,
    description: deployment.description ?? null,
    systemPrompt: deployment.systemPrompt ?? null,
    llmMode: deployment.llmMode ?? "byok",
    llmProvider: deployment.llmProvider ?? "openrouter",
    llmModel: deployment.llmModel ?? null,
    llmApiKey: rawApiKey,
    platformCredentials: Object.keys(platformCredsMap).length > 0 ? platformCredsMap : undefined,
  };
}

// ── Direction 1: Frontend → PVC ─────────────────────────────────────────

/**
 * Sync deployment config from DB to the running pod's PVC.
 *
 * Call this fire-and-forget after any DB update that affects config:
 *   void syncConfigsToPvc(deploymentId);
 *
 * Flow:
 *   1. Load deployment + platform creds from DB
 *   2. Guard: skip if not running
 *   3. Build DeploymentFields, render config files + secret entries
 *   4. Write config files to PVC
 *   5. Update K8s Secret
 *   6. Restart pod (scale 0 → 1)
 *   7. Poll for readiness, update DB status
 */
export async function syncConfigsToPvc(deploymentId: string): Promise<void> {
  try {
    // 1. Load deployment from DB
    const deployment = await (db as any).query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (!deployment) {
      logger.warn({ deploymentId }, "configSync→PVC: deployment not found, skipping");
      return;
    }

    // 2. Only sync if deployment is running
    if (deployment.status !== "running") {
      logger.info(
        { deploymentId, status: deployment.status },
        "configSync→PVC: deployment not running, skipping (config will apply on next deploy/start)"
      );
      return;
    }

    // 3. Verify pod is actually running in K8s
    const podStatus = await getDeploymentPodStatus(deploymentId);
    if (podStatus.status !== "running") {
      logger.info(
        { deploymentId, podStatus: podStatus.status },
        "configSync→PVC: pod not ready, skipping"
      );
      return;
    }

    // 4. Get runtime handler
    const runtimeHandler = getHandlerOrNull(deployment.runtime);
    if (!runtimeHandler) {
      logger.warn(
        { deploymentId, runtime: deployment.runtime },
        "configSync→PVC: no runtime handler, skipping"
      );
      return;
    }

    // 5. Build DeploymentFields and render configs
    const fields = await buildDeploymentFields(deployment);
    const configFiles = runtimeHandler.renderConfigs(fields);
    const secretEntries = runtimeHandler.getSecretEntries(fields);

    // 6. Write config files to PVC
    if (configFiles.length > 0) {
      await writeConfigsToPvc(deploymentId, configFiles);
      logger.info(
        { deploymentId, files: configFiles.map((f) => f.path) },
        "configSync→PVC: wrote config files"
      );
    }

    // 7. Update K8s Secret
    await updateDeploymentSecret(
      deploymentId,
      deployment.userId,
      deployment.name,
      deployment.runtime,
      secretEntries
    );

    // 8. Set DB status to "creating" (frontend shows spinner during restart)
    await (db as any).update(deployments)
      .set({ status: "creating" })
      .where(eq(deployments.id, deploymentId));

    // 9. Restart pod
    await restartDeployment(deploymentId);

    // 10. Poll for readiness (30 attempts × 2s = 60s max)
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const status = await getDeploymentPodStatus(deploymentId);
      if (status.status === "running") { ready = true; break; }
      if (status.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 11. Update DB status
    await (db as any).update(deployments)
      .set({ status: ready ? "running" : "failed" })
      .where(eq(deployments.id, deploymentId));

    logger.info({ deploymentId, ready }, "configSync→PVC: sync completed");
  } catch (err) {
    logger.error({ deploymentId, err }, "configSync→PVC: failed");

    // Best-effort: set status back to running with error
    try {
      await (db as any).update(deployments)
        .set({
          status: "running",
          error: "Config sync failed — pod may have stale config. Try restarting.",
        })
        .where(eq(deployments.id, deploymentId));
    } catch {
      // ignore
    }
  }
}

// ── Direction 2: PVC → Frontend ─────────────────────────────────────────

/**
 * Sync config from the running pod's PVC back to the DB.
 *
 * Called when the file watcher in the container detects changes:
 *   void syncConfigsFromPvc(deploymentId);
 *
 * Flow:
 *   1. Load deployment from DB
 *   2. Guard: skip if not running
 *   3. Read config files from PVC
 *   4. Parse via runtime handler
 *   5. Compare to DB values → update if different
 *   6. No restart needed (container already has the new config)
 */
export async function syncConfigsFromPvc(deploymentId: string): Promise<void> {
  try {
    // 1. Load deployment from DB
    const deployment = await (db as any).query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (!deployment) {
      logger.warn({ deploymentId }, "configSync←PVC: deployment not found, skipping");
      return;
    }

    // 2. Only sync if deployment is running
    if (deployment.status !== "running") {
      logger.info(
        { deploymentId, status: deployment.status },
        "configSync←PVC: deployment not running, skipping"
      );
      return;
    }

    // 3. Get runtime handler
    const runtimeHandler = getHandlerOrNull(deployment.runtime);
    if (!runtimeHandler) {
      logger.warn(
        { deploymentId, runtime: deployment.runtime },
        "configSync←PVC: no runtime handler, skipping"
      );
      return;
    }

    // 4. Read config files from PVC
    const files = await readConfigsFromPvc(deploymentId, runtimeHandler.configFiles);

    if (files.length === 0) {
      logger.debug({ deploymentId }, "configSync←PVC: no config files found on PVC");
      return;
    }

    // 5. Parse files into DB fields
    const parsed = runtimeHandler.parseConfigs(files);

    // 6. Compare to current DB values — only update if different
    const updates: Record<string, any> = {};

    if (parsed.systemPrompt !== undefined && parsed.systemPrompt !== (deployment.systemPrompt ?? undefined)) {
      updates.systemPrompt = parsed.systemPrompt;
    }
    if (parsed.llmProvider !== undefined && parsed.llmProvider !== (deployment.llmProvider ?? undefined)) {
      updates.llmProvider = parsed.llmProvider;
    }
    if (parsed.llmModel !== undefined && parsed.llmModel !== (deployment.llmModel ?? undefined)) {
      updates.llmModel = parsed.llmModel;
    }

    if (Object.keys(updates).length === 0) {
      logger.debug({ deploymentId }, "configSync←PVC: no changes detected, skipping DB update");
      return;
    }

    // 7. Update DB
    await (db as any).update(deployments)
      .set(updates)
      .where(eq(deployments.id, deploymentId));

    logger.info(
      { deploymentId, updatedFields: Object.keys(updates) },
      "configSync←PVC: DB updated from PVC config"
    );
  } catch (err) {
    logger.error({ deploymentId, err }, "configSync←PVC: failed to sync from PVC");
  }
}
