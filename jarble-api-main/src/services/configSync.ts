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
import { eq, and } from "drizzle-orm";
import {
  writeConfigsToPvc,
  readConfigsFromPvc,
  updateDeploymentSecret,
  restartDeployment,
  getDeploymentPodStatus,
} from "../k8s/deployment.js";
import { getHandlerOrNull } from "../runtimes/index.js";
import type { DeploymentFields } from "../runtimes/types.js";
import { decryptApiKey, encryptApiKey } from "../utils/encryption.js";
import { logger } from "../utils/logger.js";
import { nanoid } from "nanoid";

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
 * Flow (atomic with rollback):
 *   Phase 1 - Preparation (no side effects):
 *     1. Load deployment + platform creds from DB
 *     2. Guard: skip if not running
 *     3. Build DeploymentFields, render config files + secret entries
 *
 *   Phase 2 - Execution (with rollback on failure):
 *     4. Set DB status to "restarting"
 *     5. Write config files to PVC
 *     6. Update K8s Secret
 *     7. Restart pod (scale 0 → 1)
 *     8. Poll for readiness, update DB status
 *
 *   On failure at any step, rollback is attempted:
 *     - Restore DB status to previous state
 *     - Set error message describing what failed
 */
export async function syncConfigsToPvc(deploymentId: string): Promise<void> {
  // Track completed steps for rollback
  type SyncStep = "db_status" | "pvc_write" | "secret_update" | "pod_restart";
  const completedSteps: SyncStep[] = [];
  let previousStatus: string | null = null;

  try {
    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1: Preparation (read-only, no side effects)
    // ══════════════════════════════════════════════════════════════════════

    // 1. Load deployment from DB
    let deployment = await (db as any).query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (!deployment) {
      logger.warn({ deploymentId }, "configSync→PVC: deployment not found, skipping");
      return;
    }

    previousStatus = deployment.status;

    // 2. If deployment is still creating, wait for it to become running.
    //    Use 150 iterations (5 min) — first-boot npm install takes 3+ min and the
    //    DB status only flips to "running" after the readiness probe passes.
    if (deployment.status === "creating") {
      logger.info({ deploymentId }, "configSync→PVC: deployment creating, waiting up to 5 min for running...");
      let became_running = false;
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const updated = await (db as any).query.deployments.findFirst({
          where: eq(deployments.id, deploymentId),
        });
        if (!updated || updated.status === "failed" || updated.status === "stopped") {
          logger.info({ deploymentId, status: updated?.status }, "configSync→PVC: deployment left creating state without running, skipping");
          return;
        }
        if (updated.status === "running") {
          deployment = updated;
          previousStatus = "running";
          became_running = true;
          break;
        }
      }
      if (!became_running) {
        logger.warn({ deploymentId }, "configSync→PVC: timed out waiting for deployment to become running (5 min)");
        return;
      }
    } else if (deployment.status !== "running") {
      logger.info(
        { deploymentId, status: deployment.status },
        "configSync→PVC: deployment not running, skipping (config will apply on next deploy/start)"
      );
      return;
    }

    // 3. Verify pod is actually running in K8s.
    // If it's still creating (npm install in progress), wait up to 3 minutes.
    // This handles the case where credentials are saved while the pod is still booting.
    let podStatus = await getDeploymentPodStatus(deploymentId);
    if (podStatus.status === "creating") {
      logger.info({ deploymentId }, "configSync→PVC: pod still starting in K8s, waiting for readiness...");
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        podStatus = await getDeploymentPodStatus(deploymentId);
        if (podStatus.status === "running") {
          logger.info({ deploymentId }, "configSync→PVC: pod is now ready");
          break;
        }
        if (podStatus.status === "failed") {
          logger.warn({ deploymentId }, "configSync→PVC: pod failed while waiting for readiness, skipping");
          return;
        }
      }
    }
    if (podStatus.status !== "running") {
      logger.info(
        { deploymentId, podStatus: podStatus.status },
        "configSync→PVC: pod not ready after waiting, skipping"
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

    // 5. Build DeploymentFields and render configs (validation happens here)
    const fields = await buildDeploymentFields(deployment);
    const configFiles = runtimeHandler.renderConfigs(fields);
    const secretEntries = runtimeHandler.getSecretEntries(fields);

    logger.info(
      { deploymentId, configCount: configFiles.length, secretKeys: Object.keys(secretEntries).length },
      "configSync→PVC: preparation complete, starting execution"
    );

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 2: Execution (with rollback tracking)
    // ══════════════════════════════════════════════════════════════════════

    // Step A: Set DB status to "restarting" (frontend shows spinner)
    await (db as any).update(deployments)
      .set({ status: "restarting", error: null })
      .where(eq(deployments.id, deploymentId));
    completedSteps.push("db_status");

    // Step B: Update K8s Secret FIRST (critical for platform tokens)
    // This ensures platform tokens are available even if PVC writes fail
    await updateDeploymentSecret(
      deploymentId,
      deployment.userId,
      deployment.name,
      deployment.runtime,
      secretEntries
    );
    completedSteps.push("secret_update");
    logger.info({ deploymentId, secretKeys: Object.keys(secretEntries).length }, "configSync→PVC: K8s secret updated");

    // Step C: Write config files to PVC (may timeout if pod exec hangs)
    if (configFiles.length > 0) {
      try {
        await writeConfigsToPvc(deploymentId, configFiles);
        completedSteps.push("pvc_write");
        logger.info(
          { deploymentId, files: configFiles.map((f) => f.path) },
          "configSync→PVC: wrote config files"
        );
      } catch (writeErr) {
        // Log but don't fail - secret was already updated
        logger.warn(
          { deploymentId, err: writeErr },
          "configSync→PVC: failed to write config files (non-fatal, secret already updated)"
        );
      }
    }

    // Step D: Restart pod (scale 0 → 1)
    await restartDeployment(deploymentId);
    completedSteps.push("pod_restart");

    // Step E: Poll for readiness (90 attempts × 2s = 3 min max)
    // Needs to cover the readiness probe initialDelaySeconds (60s) + startup time.
    let ready = false;
    let failureReason = "";
    for (let i = 0; i < 90; i++) {
      const status = await getDeploymentPodStatus(deploymentId);
      if (status.status === "running") {
        ready = true;
        break;
      }
      if (status.status === "failed") {
        failureReason = status.error || "Pod failed to start";
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Step F: Update DB status (only if still in our transitional "restarting" state)
    // This prevents overwriting status if an enforcement service stopped the deployment
    if (ready) {
      const result = await (db as any).update(deployments)
        .set({ status: "running", error: null })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
      if ((result?.changes ?? result?.rowsAffected ?? 1) === 0) {
        logger.warn({ deploymentId }, "configSync→PVC: status update skipped — deployment no longer in 'restarting' state (possibly stopped or concurrent sync)");
      } else {
        logger.info({ deploymentId }, "configSync→PVC: sync completed successfully");
      }
    } else {
      const result = await (db as any).update(deployments)
        .set({
          status: "failed",
          error: failureReason || "Pod did not become ready after config sync",
        })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
      if ((result?.changes ?? result?.rowsAffected ?? 1) === 0) {
        logger.warn({ deploymentId, failureReason }, "configSync→PVC: failure status update skipped — deployment no longer in 'restarting' state");
      } else {
        logger.warn({ deploymentId, failureReason }, "configSync→PVC: pod failed to become ready");
      }
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error(
      { deploymentId, err, completedSteps },
      "configSync→PVC: failed during execution"
    );

    // ══════════════════════════════════════════════════════════════════════
    // ROLLBACK: Attempt to restore consistent state
    // ══════════════════════════════════════════════════════════════════════

    // Determine which step failed and set appropriate error
    let failedStep = "unknown";
    if (!completedSteps.includes("db_status")) {
      failedStep = "setting status";
    } else if (!completedSteps.includes("pvc_write")) {
      failedStep = "writing config files";
    } else if (!completedSteps.includes("secret_update")) {
      failedStep = "updating secrets";
    } else if (!completedSteps.includes("pod_restart")) {
      failedStep = "restarting pod";
    }

    // Restore DB status with error message
    try {
      await (db as any).update(deployments)
        .set({
          status: previousStatus || "running",
          error: `Config sync failed while ${failedStep}: ${errorMessage}. Pod may have inconsistent config.`,
        })
        .where(eq(deployments.id, deploymentId));

      logger.info(
        { deploymentId, previousStatus, failedStep },
        "configSync→PVC: rolled back DB status"
      );
    } catch (rollbackErr) {
      logger.error(
        { deploymentId, rollbackErr },
        "configSync→PVC: failed to rollback DB status"
      );
    }

    // If we updated the secret but failed to restart, try to restart anyway
    // (better to have new config than be stuck)
    if (completedSteps.includes("secret_update") && !completedSteps.includes("pod_restart")) {
      try {
        logger.info({ deploymentId }, "configSync→PVC: attempting recovery restart");
        await restartDeployment(deploymentId);
      } catch {
        // Already logged the main error, don't spam logs
      }
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

    // 7. Update deployments table if there are changes
    if (Object.keys(updates).length > 0) {
      await (db as any).update(deployments)
        .set(updates)
        .where(eq(deployments.id, deploymentId));

      logger.info(
        { deploymentId, updatedFields: Object.keys(updates) },
        "configSync←PVC: deployments table updated from PVC config"
      );
    }

    // 8. Sync platformCredentials if parsed from config
    if (parsed.platformCredentials && Object.keys(parsed.platformCredentials).length > 0) {
      await syncPlatformCredentialsFromPvc(deploymentId, parsed.platformCredentials);
    }
  } catch (err) {
    logger.error({ deploymentId, err }, "configSync←PVC: failed to sync from PVC");
  }
}

/**
 * Sync platform credentials parsed from PVC config back to the DB.
 * Compares with existing credentials and upserts any changes.
 */
async function syncPlatformCredentialsFromPvc(
  deploymentId: string,
  parsedCreds: Record<string, Record<string, string>>
): Promise<void> {
  // Load existing platform credentials from DB
  const existingRows = await (db as any).query.platformCredentials.findMany({
    where: eq(platformCredentials.deploymentId, deploymentId),
  });

  const existingMap = new Map<string, { id: string; creds: Record<string, string> }>();
  for (const row of existingRows as any[]) {
    try {
      const decrypted = decryptApiKey(row.credentials);
      existingMap.set(row.platformId, {
        id: row.id,
        creds: JSON.parse(decrypted),
      });
    } catch {
      // Skip corrupted rows
    }
  }

  let upsertCount = 0;

  for (const [platformId, newCreds] of Object.entries(parsedCreds)) {
    const existing = existingMap.get(platformId);

    // Compare credentials (simple JSON comparison)
    const existingJson = existing ? JSON.stringify(existing.creds) : "";
    const newJson = JSON.stringify(newCreds);

    if (existingJson === newJson) {
      continue; // No change
    }

    const encrypted = encryptApiKey(newJson);

    if (existing) {
      // Update existing row
      await (db as any).update(platformCredentials)
        .set({
          credentials: encrypted,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(platformCredentials.id, existing.id));
    } else {
      // Insert new row
      await (db as any).insert(platformCredentials).values({
        id: nanoid(12),
        deploymentId,
        platformId,
        credentials: encrypted,
      });
    }

    upsertCount++;
  }

  if (upsertCount > 0) {
    logger.info(
      { deploymentId, platformIds: Object.keys(parsedCreds), upsertCount },
      "configSync←PVC: platform credentials synced from PVC"
    );
  }
}
