/**
 * ═══════════════════════════════════════════════════════════════════════
 * Config Sync Service — Two-way config synchronization between DB and PVC
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Direction 1: Frontend → PVC (syncConfigsToPvc)
 *   User saves config on frontend → DB updates → this service renders
 *   config files from the runtime handler and applies them with minimal
 *   disruption using a tiered strategy:
 *
 *   Tier 1 (file-only): System prompt, skills → write files to PVC, no restart
 *   Tier 2 (process restart): LLM keys, platform tokens → signal entrypoint
 *     to restart the gateway process with new env vars (~5-10s downtime)
 *   Tier 3 (pod restart): Fallback when process restart isn't supported
 *     (old image) → full scale 0→1 restart (~30-60s downtime)
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

import { db, tables, dbDate } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import {
  writeConfigsToPvc,
  readConfigsFromPvc,
  updateDeploymentSecret,
  restartDeployment,
  getDeploymentPodStatus,
  signalProcessRestart,
  readCurrentSecretData,
  findPodForDeployment,
  execInPod,
} from "../k8s/index.js";
import type { ManagedBy } from "../k8s/constants.js";
import { getPvcMountPath, getContainerName } from "../k8s/constants.js";
import { updateDeploymentConfigMap } from "../k8s/configmap.js";
import { getHandlerOrNull } from "../runtimes/index.js";
import type { DeploymentFields } from "../runtimes/types.js";
import { decryptApiKey, encryptApiKey } from "../utils/encryption.js";
import { logger } from "../utils/logger.js";
import { nanoid } from "nanoid";

const { deployments, platformCredentials, deploymentSkills, skillsCatalog } = tables;

// ── Per-deployment sync mutex ────────────────────────────────────────────
// Prevents concurrent syncs for the same deployment from racing.
// Each deployment chains its syncs sequentially; different deployments run in parallel.
const syncMutexes = new Map<string, Promise<void>>();

// ── Helper: Build DeploymentFields from DB row ──────────────────────────

/**
 * Load a deployment + its platform credentials from DB and build a
 * DeploymentFields object suitable for runtime handler methods.
 */
async function buildDeploymentFields(
  deployment: any,
  gatewayToken?: string,
  managedBy?: "legacy" | "operator",
): Promise<DeploymentFields> {
  // Decrypt LLM API key
  const rawApiKey = deployment.llmApiKey
    ? decryptApiKey(deployment.llmApiKey)
    : null;

  // Load and decrypt platform credentials
  const platformCredsRows = await db.query.platformCredentials.findMany({
    where: eq(platformCredentials.deploymentId, deployment.id),
  });

  const platformCredsMap: Record<string, Record<string, string>> = {};
  for (const row of platformCredsRows) {
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

  // Load installed skills for this deployment
  const skillRows = await db.query.deploymentSkills.findMany({
    where: eq(deploymentSkills.deploymentId, deployment.id),
  });

  const skills: Array<{ name: string; config: string }> = [];
  if (skillRows.length > 0) {
    for (const row of skillRows) {
      const skill = await db.query.skillsCatalog.findFirst({
        where: eq(skillsCatalog.id, row.skillId),
      });
      if (skill) {
        skills.push({ name: skill.name, config: skill.config });
      }
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
    gatewayToken,
    messagingOnly: deployment.messagingOnly ?? false,
    managedBy: managedBy ?? deployment.managedBy ?? "legacy",
    skills: skills.length > 0 ? skills : undefined,
  };
}

// ── Helper: Compare secret entries ──────────────────────────────────────

// Base keys that are always present and managed by createDeployment/updateDeploymentSecret,
// not by the runtime handler's getSecretEntries(). These never change during configSync.
const BASE_SECRET_KEYS = new Set([
  "DEPLOYMENT_ID", "USER_ID", "DEPLOYMENT_NAME", "TEMPLATE", "RUNTIME",
  "OPENCLAW_GATEWAY_TOKEN", "JARBLE_API_URL", "CONFIG_WEBHOOK_SECRET",
]);

interface SecretComparison {
  changed: boolean;  // true if any runtime entries differ
  removed: boolean;  // true if a runtime key was removed (can't unset via .env sourcing)
}

/**
 * Compare current K8s secret with the desired runtime entries.
 * Returns whether entries changed and whether any were removed.
 */
function compareSecrets(
  current: Record<string, string> | null,
  newEntries: Record<string, string>
): SecretComparison {
  if (!current) return { changed: true, removed: false };

  let changed = false;
  let removed = false;

  // Check if any new entry is different from what's currently deployed
  for (const [key, value] of Object.entries(newEntries)) {
    if (current[key] !== value) {
      changed = true;
      break;
    }
  }

  // Check if any runtime-specific key was removed
  for (const key of Object.keys(current)) {
    if (!BASE_SECRET_KEYS.has(key) && !(key in newEntries)) {
      changed = true;
      removed = true;
      break;
    }
  }

  return { changed, removed };
}

// ── Direction 1: Frontend → PVC ─────────────────────────────────────────

/**
 * Sync deployment config from DB to the running pod's PVC.
 *
 * Call this fire-and-forget after any DB update that affects config:
 *   void syncConfigsToPvc(deploymentId);
 *
 * Uses a per-deployment mutex to serialize concurrent syncs and a tiered
 * strategy to minimize downtime:
 *
 *   Phase 1 - Preparation (no side effects):
 *     1. Load deployment + platform creds from DB
 *     2. Guard: skip if not running
 *     3. Build DeploymentFields, render config files + secret entries
 *     4. Compare secret entries with current K8s secret
 *
 *   Phase 2 - Execution (tiered by change type):
 *     File-only: Write configs to PVC — zero downtime
 *     Secret changed: Process restart via .reload marker — ~5-10s
 *     Secret removed or old image: Full pod restart — ~30-60s (fallback)
 */
export function syncConfigsToPvc(deploymentId: string): Promise<void> {
  // Chain onto any existing sync for this deployment (mutex)
  const prev = syncMutexes.get(deploymentId) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // Don't let previous failure block next sync
    .then(() => syncConfigsToPvcInner(deploymentId));
  syncMutexes.set(deploymentId, next);
  void next.finally(() => {
    if (syncMutexes.get(deploymentId) === next) {
      syncMutexes.delete(deploymentId);
    }
  });
  return next;
}

async function syncConfigsToPvcInner(deploymentId: string): Promise<void> {
  let previousStatus: string | null = null;
  const syncStartMs = Date.now();

  try {
    // ══════════════════════════════════════════════════════════════════════
    // PHASE 1: Preparation (read-only, no side effects)
    // ══════════════════════════════════════════════════════════════════════

    // 1. Load deployment from DB
    let deployment = await db.query.deployments.findFirst({
      where: eq(deployments.id, deploymentId),
    });

    if (!deployment) {
      logger.warn({ deploymentId }, "configSync→PVC: deployment not found, skipping");
      return;
    }

    previousStatus = deployment.status;
    const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;

    // 2. If deployment is still creating, just update the ConfigMap —
    //    the init container will copy files on boot, no need to wait for the pod.
    if (deployment.status === "creating") {
      const runtimeHandler = getHandlerOrNull(deployment.runtime);
      if (runtimeHandler) {
        const currentSecret = await readCurrentSecretData(deploymentId);
        const gatewayToken = currentSecret?.OPENCLAW_GATEWAY_TOKEN ?? undefined;
        const fields = await buildDeploymentFields(deployment, gatewayToken, managedBy);
        const configFiles = runtimeHandler.renderConfigs(fields);
        if (configFiles.length > 0) {
          await updateDeploymentConfigMap(deploymentId, configFiles, managedBy);
          logger.info({ deploymentId }, "configSync→PVC: updated ConfigMap for creating deployment (init container will apply)");
        }
      }
      return;
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
    let podStatus = await getDeploymentPodStatus(deploymentId, managedBy);
    if (podStatus.status === "creating") {
      logger.info({ deploymentId }, "configSync→PVC: pod still starting in K8s, waiting for readiness...");
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        podStatus = await getDeploymentPodStatus(deploymentId, managedBy);
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

    // 5. Read current K8s secret (needed for gateway token + comparison)
    const currentSecret = await readCurrentSecretData(deploymentId);

    // Extract gateway token from existing K8s Secret so renderConfigs includes auth config
    const gatewayToken = currentSecret?.OPENCLAW_GATEWAY_TOKEN ?? undefined;

    // 6. Build DeploymentFields and render configs
    const fields = await buildDeploymentFields(deployment, gatewayToken, managedBy);
    const configFiles = runtimeHandler.renderConfigs(fields);
    const secretEntries = runtimeHandler.getSecretEntries(fields);

    // 7. Compare secret entries with current K8s secret to determine sync tier
    const comparison = compareSecrets(currentSecret, secretEntries);

    logger.info(
      {
        deploymentId,
        configCount: configFiles.length,
        secretKeys: Object.keys(secretEntries).length,
        secretsChanged: comparison.changed,
        secretsRemoved: comparison.removed,
      },
      "configSync→PVC: preparation complete"
    );

    // ══════════════════════════════════════════════════════════════════════
    // PHASE 2: Tiered execution
    // ══════════════════════════════════════════════════════════════════════

    if (!comparison.changed) {
      // ── Tier 1: File-only change (zero downtime) ──────────────────────
      // Secrets are unchanged — update the ConfigMap (source of truth for
      // restarts) and write to the running pod's PVC for immediate effect.
      logger.info({ deploymentId, tier: 1 }, "ConfigSync: starting tier 1 (file-only, zero downtime)");
      if (configFiles.length > 0) {
        // Always update ConfigMap so the next pod restart gets fresh config
        await updateDeploymentConfigMap(deploymentId, configFiles, managedBy);

        // Also write directly to the running pod for immediate effect
        try {
          await writeConfigsToPvc(deploymentId, configFiles, managedBy);
        } catch (writeErr) {
          logger.warn(
            { deploymentId, err: writeErr },
            "configSync→PVC: direct PVC write failed (ConfigMap updated, will apply on restart)"
          );
        }
        for (const f of configFiles) {
          logger.debug({ deploymentId, filePath: f.path, contentLength: f.content.length }, "ConfigSync: writing file to PVC");
        }
        const durationMs = Date.now() - syncStartMs;
        logger.info(
          { deploymentId, durationMs, tier: 1, files: configFiles.map((f) => f.path) },
          "ConfigSync: completed (file-only, zero downtime)"
        );
      }
      return;
    }

    if (!comparison.removed) {
      // ── Tier 2: Process restart (env vars added/changed, ~5-10s) ──────
      logger.info({ deploymentId, tier: 2 }, "ConfigSync: starting tier 2 (process restart)");
      // Secrets changed but none removed. Try in-container process restart:
      // write .env + .reload marker, kill OpenClaw process, entrypoint loop
      // re-sources .env and restarts the gateway.

      // Set transitional status
      await db.update(deployments)
        .set({ status: "reloading", error: null })
        .where(eq(deployments.id, deploymentId));

      // Update ConfigMap (source of truth for restarts) + write to running pod
      if (configFiles.length > 0) {
        await updateDeploymentConfigMap(deploymentId, configFiles, managedBy);
        try {
          await writeConfigsToPvc(deploymentId, configFiles, managedBy);
        } catch (writeErr) {
          logger.warn(
            { deploymentId, err: writeErr },
            "configSync→PVC: direct PVC write failed (ConfigMap updated, will apply on restart)"
          );
        }
      }

      // Update K8s Secret for persistence (if pod truly restarts later, it gets the new values)
      logger.info({ deploymentId, keyCount: Object.keys(secretEntries).length }, "ConfigSync: updating K8s secret");
      await updateDeploymentSecret(
        deploymentId,
        deployment.userId,
        deployment.name,
        deployment.runtime,
        secretEntries
      );

      // Build full env overrides for the .env file (base + runtime entries)
      const envOverrides: Record<string, string> = {
        ...secretEntries,
      };

      // Attempt process restart (operator mode skips Tier 2 — signalProcessRestart returns false)
      const restarted = await signalProcessRestart(deploymentId, envOverrides, managedBy);

      if (restarted) {
        // Process restart signaled — poll for readiness (shorter timeout since no pod recreation)
        let ready = false;
        let failureReason = "";
        for (let i = 0; i < 30; i++) { // 30 × 2s = 60s max
          const status = await getDeploymentPodStatus(deploymentId, managedBy);
          if (status.status === "running") {
            ready = true;
            break;
          }
          if (status.status === "failed") {
            failureReason = status.error || "Pod failed after reload";
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }

        if (ready) {
          await db.update(deployments)
            .set({ status: "running", error: null })
            .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "reloading")));
          const durationMs = Date.now() - syncStartMs;
          logger.info({ deploymentId, durationMs, tier: 2 }, "ConfigSync: completed (process restart)");
        } else {
          await db.update(deployments)
            .set({
              status: "failed",
              error: failureReason || "Process did not become ready after reload",
            })
            .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "reloading")));
          logger.warn({ deploymentId, failureReason }, "configSync→PVC: process restart failed");
        }
        return;
      }

      // Process restart not supported (old image without PID file) — fall through to Tier 3
      logger.info({ deploymentId }, "configSync→PVC: process restart not available, falling back to pod restart");
      await db.update(deployments)
        .set({ status: "restarting", error: null })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "reloading")));
    } else {
      // ── Tier 3 entry: Secrets removed (need full pod restart) ─────────
      logger.info({ deploymentId, tier: 3 }, "ConfigSync: starting tier 3 (secrets removed, full pod restart)");
      // Env vars can't be unset via .env sourcing — must recreate the pod
      // so the K8s Secret envFrom produces a clean environment.

      // Set transitional status
      await db.update(deployments)
        .set({ status: "restarting", error: null })
        .where(eq(deployments.id, deploymentId));

      // Update ConfigMap (init container will copy on restart) + write to running pod
      if (configFiles.length > 0) {
        await updateDeploymentConfigMap(deploymentId, configFiles, managedBy);
        try {
          await writeConfigsToPvc(deploymentId, configFiles, managedBy);
        } catch (writeErr) {
          logger.warn(
            { deploymentId, err: writeErr },
            "configSync→PVC: direct PVC write failed (ConfigMap updated, will apply on restart)"
          );
        }
      }

      // Update K8s Secret (critical for platform tokens)
      logger.info({ deploymentId, keyCount: Object.keys(secretEntries).length }, "ConfigSync: updating K8s secret");
      await updateDeploymentSecret(
        deploymentId,
        deployment.userId,
        deployment.name,
        deployment.runtime,
        secretEntries
      );
    }

    // ── Tier 3: Full pod restart (~30-60s) ──────────────────────────────
    // Either secrets were removed, or process restart wasn't supported.
    // Status is already "restarting" at this point.

    // For operator mode, restartDeployment needs userId + config to recreate the CR
    logger.info({ deploymentId, managedBy }, "ConfigSync: restarting deployment (full pod restart)");
    await restartDeployment(deploymentId, managedBy, deployment.userId, {
      name: deployment.name,
      runtime: deployment.runtime,
      extraSecretEntries: secretEntries,
      initialConfigs: configFiles,
      gatewayToken: currentSecret?.OPENCLAW_GATEWAY_TOKEN,
    });

    // Poll for readiness (90 × 2s = 3 min max)
    let ready = false;
    let failureReason = "";
    for (let i = 0; i < 90; i++) {
      const status = await getDeploymentPodStatus(deploymentId, managedBy);
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

    if (ready) {
      const result = await db.update(deployments)
        .set({ status: "running", error: null })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
      // Cross-provider: MySQL returns [ResultSetHeader], SQLite returns { changes }, PG returns { rowCount }
      const affected = (result as any)?.changes ?? (result as any)?.[0]?.affectedRows ?? 1;
      if (affected === 0) {
        logger.warn({ deploymentId }, "configSync→PVC: status update skipped — deployment no longer in 'restarting' state");
      } else {
        const durationMs = Date.now() - syncStartMs;
        logger.info({ deploymentId, durationMs, tier: 3 }, "ConfigSync: completed (full pod restart)");
      }
    } else {
      const result = await db.update(deployments)
        .set({
          status: "failed",
          error: failureReason || "Pod did not become ready after config sync",
        })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
      const affected = (result as any)?.changes ?? (result as any)?.[0]?.affectedRows ?? 1;
      if (affected === 0) {
        logger.warn({ deploymentId, failureReason }, "configSync→PVC: failure status update skipped — deployment no longer in 'restarting' state");
      } else {
        logger.warn({ deploymentId, failureReason }, "configSync→PVC: pod failed to become ready");
      }
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - syncStartMs;
    logger.error(
      { deploymentId, durationMs, error: errorMessage },
      "ConfigSync: failed"
    );

    // Restore DB status with error message
    try {
      await db.update(deployments)
        .set({
          status: previousStatus || "running",
          error: `Config sync failed: ${errorMessage}. Pod may have inconsistent config.`,
        })
        .where(eq(deployments.id, deploymentId));

      logger.info(
        { deploymentId, previousStatus },
        "configSync→PVC: rolled back DB status"
      );
    } catch (rollbackErr) {
      logger.error(
        { deploymentId, rollbackErr },
        "configSync→PVC: failed to rollback DB status"
      );
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
    const deployment = await db.query.deployments.findFirst({
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

    const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;

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
    const files = await readConfigsFromPvc(deploymentId, runtimeHandler.configFiles, managedBy);

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
      await db.update(deployments)
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
  const existingRows = await db.query.platformCredentials.findMany({
    where: eq(platformCredentials.deploymentId, deploymentId),
  });

  const existingMap = new Map<string, { id: string; creds: Record<string, string> }>();
  for (const row of existingRows) {
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
      await db.update(platformCredentials)
        .set({
          credentials: encrypted,
          updatedAt: dbDate(),
        })
        .where(eq(platformCredentials.id, existing.id));
    } else {
      // Insert new row
      await db.insert(platformCredentials).values({
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

// ── Marketplace Component Sync ──────────────────────────────────────────────

/**
 * Write a marketplace component package to a deployment's PVC.
 * Called when a component is installed on a deployment.
 *
 * Writes the manifest and component file (template.json or sandbox.html)
 * to /data/marketplace/{componentId}/ on the pod using the same base64-
 * encoded exec pattern as writeConfigsToPvc.
 *
 * @param deploymentId - Target deployment
 * @param componentId - Unique component identifier (used as directory name)
 * @param manifest - Validated marketplace manifest object
 * @param templateOrHtml - Template JSON string (tier 1) or HTML string (tier 2)
 * @param tier - "template" or "sandbox"
 */
export async function syncMarketplaceComponent(
  deploymentId: string,
  componentId: string,
  manifest: Record<string, unknown>,
  templateOrHtml: string,
  tier: "template" | "sandbox",
  managedBy: ManagedBy = "legacy",
): Promise<void> {
  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const containerName = getContainerName(managedBy);
  const pvcMount = getPvcMountPath(managedBy);
  const basePath = `${pvcMount}/marketplace/${componentId}`;

  // Ensure the marketplace component directory exists
  await execInPod(podName, ["mkdir", "-p", basePath], containerName);

  // Write manifest.json
  const manifestContent = JSON.stringify(manifest, null, 2);
  const manifestB64 = Buffer.from(manifestContent).toString("base64");
  await execInPod(podName, [
    "sh", "-c",
    `echo '${manifestB64}' | base64 -d > '${basePath}/manifest.json'`,
  ], containerName);

  // Write the component file based on tier
  const fileName = tier === "template" ? "template.json" : "sandbox.html";
  const fileB64 = Buffer.from(templateOrHtml).toString("base64");
  await execInPod(podName, [
    "sh", "-c",
    `echo '${fileB64}' | base64 -d > '${basePath}/${fileName}'`,
  ], containerName);

  logger.info(
    { deploymentId, componentId, tier },
    "syncMarketplaceComponent: wrote component to PVC"
  );
}

/**
 * Remove a marketplace component from a deployment's PVC.
 * Called when a component is uninstalled.
 *
 * Removes the entire /data/marketplace/{componentId}/ directory from the pod.
 *
 * @param deploymentId - Target deployment
 * @param componentId - Component to remove
 */
export async function removeMarketplaceComponent(
  deploymentId: string,
  componentId: string,
  managedBy: ManagedBy = "legacy",
): Promise<void> {
  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const containerName = getContainerName(managedBy);
  const pvcMount = getPvcMountPath(managedBy);
  const basePath = `${pvcMount}/marketplace/${componentId}`;

  await execInPod(podName, ["rm", "-rf", basePath], containerName);

  logger.info(
    { deploymentId, componentId },
    "removeMarketplaceComponent: removed component from PVC"
  );
}
