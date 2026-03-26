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

import { db, tables, dbDate, getRowsAffected } from "../db/index.js";
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
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("configSync");
import { nanoid } from "nanoid";

const { deployments, platformCredentials, deploymentSkills, skillsCatalog, serviceInstalls, marketplaceServices, componentInstalls, marketplaceComponents } = tables;
// deploymentSubagents may not exist yet (schema created by separate agent)
const deploymentSubagents = (tables as any).deploymentSubagents;

/**
 * Re-register the MCP server on the pod to point at the PVC-deployed version.
 * The baked-in Docker image may have a stale jarble-ui-server.js; configSync
 * deploys the current version to /data/config/mcp/. This exec re-registers
 * mcporter so OpenClaw discovers the updated tool list (including set_theme, etc.).
 */
async function reRegisterMcpServer(
  deploymentId: string,
  managedBy: ManagedBy,
): Promise<void> {
  try {
    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) return;

    const containerName = getContainerName(managedBy);
    const pvcMount = getPvcMountPath(managedBy);
    const mcpPath = `${pvcMount}/config/mcp/jarble-ui-server.js`;

    // Re-register mcporter to use the PVC version
    await execInPod(podName, [
      "sh", "-c",
      `/opt/openclaw/node_modules/.bin/mcporter config remove jarble-ui 2>/dev/null; ` +
      `/opt/openclaw/node_modules/.bin/mcporter config add jarble-ui ` +
      `--command node --arg "${mcpPath}" ` +
      `--description "Jarble UI canvas components" --scope home 2>&1 || true`,
    ], containerName);

    log.info({ deploymentId }, "configSync: re-registered MCP server with PVC version");
  } catch (err) {
    log.warn({ deploymentId, err }, "configSync: MCP re-registration failed (non-fatal)");
  }
}

/**
 * Retry a function once after a delay for transient failures.
 * Used for exec-based PVC writes that can fail if the pod is briefly unavailable.
 */
async function retryOnce<T>(
  fn: () => Promise<T>,
  delayMs: number = 2000,
  label: string = "operation",
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err, label }, `${label} failed, retrying once after ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

// ── Per-deployment sync mutex ────────────────────────────────────────────
// Prevents concurrent syncs for the same deployment from racing.
// Each deployment chains its syncs sequentially; different deployments run in parallel.
const syncMutexes = new Map<string, Promise<ConfigSyncResult>>();

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
      log.warn(
        { deploymentId: deployment.id, platformId: row.platformId, err },
        "configSync: failed to decrypt platform credentials, skipping"
      );
    }
  }

  // Load installed skills for this deployment (single query with join)
  const skillRows = await db.query.deploymentSkills.findMany({
    where: eq(deploymentSkills.deploymentId, deployment.id),
    with: { skill: true },
  });

  const skills: Array<{ name: string; config: string }> = [];
  for (const row of skillRows) {
    if (row.skill) {
      skills.push({ name: row.skill.name, config: row.skill.config });
    }
  }

  // Load instruction snippets from installed services.
  // For remote/hybrid services, also collect remoteSkillConfigs so skill JSON
  // files on the PVC can be stamped with the correct proxy URL.
  const svcInstallRows = await db.query.serviceInstalls.findMany({
    where: eq(serviceInstalls.deploymentId, deployment.id),
  });

  const serviceSnippets: Array<{ packageName: string; snippet: string }> = [];
  const remoteSkillConfigs: Array<{ packageId: string; skillName: string; proxyUrl: string }> = [];

  for (const svcInstall of svcInstallRows) {
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(marketplaceServices.id, svcInstall.packageId),
    });
    if (!svc) continue;

    if (svc.instructionSnippet) {
      serviceSnippets.push({ packageName: svc.displayName, snippet: svc.instructionSnippet });
    }

    // For remote/hybrid services with a remoteApiConfig, derive proxyUrl per skill.
    // The proxy URL routes skill calls through the Jarble API, which signs requests
    // with the stored HMAC secret before forwarding to the creator's endpoint.
    if (
      (svc.hostingModel === "remote" || svc.hostingModel === "hybrid" || svc.hostingModel === "platform_managed") &&
      svc.remoteApiConfig
    ) {
      try {
        const card = JSON.parse(svc.remoteApiConfig) as { skills?: Array<{ name: string }> };
        const apiBase = process.env.JARBLE_API_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";

        if (Array.isArray(card.skills)) {
          for (const skill of card.skills) {
            if (typeof skill.name === "string" && skill.name) {
              const proxyUrl = svc.hostingModel === "platform_managed"
                ? `${apiBase}/api/services/execute/${svc.id}/${skill.name}?deploymentId=${deployment.id}`
                : `${apiBase}/api/services/proxy/${deployment.id}/${svc.id}/${skill.name}`;
              remoteSkillConfigs.push({
                packageId: svc.id,
                skillName: skill.name,
                proxyUrl,
              });
            }
          }
        }
      } catch (err) {
        log.warn(
          { deploymentId: deployment.id, serviceId: svc.id, err },
          "configSync: failed to parse remoteApiConfig for remote skill proxy URLs, skipping"
        );
      }
    }
  }

  // Load installed marketplace components for soul.md awareness
  const installedComponents: Array<{
    name: string; displayName: string; description: string;
    botDescription: string | null; tier: string; category: string;
  }> = [];

  const compInstallRows = await db.query.componentInstalls.findMany({
    where: eq(componentInstalls.deploymentId, deployment.id),
    with: { component: true },
  });

  for (const row of compInstallRows) {
    if (row.component) {
      installedComponents.push({
        name: row.component.name,
        displayName: row.component.displayName,
        description: row.component.botDescription || row.component.description,
        botDescription: row.component.botDescription,
        tier: row.component.tier,
        category: row.component.category,
      });
    }
  }

  // Load enabled subagents for this deployment
  const subagents: Array<{
    slug: string; name: string; description: string | null;
    systemPrompt: string; model: string | null;
    triggerType: string; triggerConfig: string | null; tools: string | null;
  }> = [];

  if (deploymentSubagents) {
    try {
      const subagentRows = await db.query.deploymentSubagents.findMany({
        where: and(
          eq(deploymentSubagents.deploymentId, deployment.id),
          eq(deploymentSubagents.enabled, true),
        ),
        orderBy: (s: any, { asc }: any) => [asc(s.sortOrder)],
      });

      for (const row of subagentRows) {
        subagents.push({
          slug: row.slug,
          name: row.name,
          description: row.description ?? null,
          systemPrompt: row.systemPrompt,
          model: row.model ?? null,
          triggerType: row.triggerType ?? "manual",
          triggerConfig: row.triggerConfig ?? null,
          tools: row.tools ?? null,
        });
      }
    } catch (err) {
      // Table may not exist yet — non-fatal
      log.debug({ deploymentId: deployment.id, err }, "configSync: failed to load subagents (table may not exist yet)");
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
    packageSnippets: serviceSnippets.length > 0 ? serviceSnippets : undefined,
    remoteSkillConfigs: remoteSkillConfigs.length > 0 ? remoteSkillConfigs : undefined,
    installedComponents: installedComponents.length > 0 ? installedComponents : undefined,
    subagents: subagents.length > 0 ? subagents : undefined,
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
/** Result of a configSync→PVC operation */
export interface ConfigSyncResult {
  success: boolean;
  tier?: number;
  error?: string;
  durationMs: number;
}

export function syncConfigsToPvc(deploymentId: string): Promise<ConfigSyncResult> {
  // Chain onto any existing sync for this deployment (mutex)
  const prev = syncMutexes.get(deploymentId) ?? Promise.resolve(undefined as unknown as ConfigSyncResult);
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

async function syncConfigsToPvcInner(deploymentId: string): Promise<ConfigSyncResult> {
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
      log.warn({ deploymentId }, "configSync→PVC: deployment not found, skipping");
      return { success: true, tier: 0, durationMs: Date.now() - syncStartMs };
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
          log.info({ deploymentId }, "configSync→PVC: updated ConfigMap for creating deployment (init container will apply)");
        }
      }
      return { success: true, tier: 0, durationMs: Date.now() - syncStartMs };
    } else if (deployment.status !== "running") {
      log.info(
        { deploymentId, status: deployment.status },
        "configSync→PVC: deployment not running, skipping (config will apply on next deploy/start)"
      );
      return { success: true, tier: 0, durationMs: Date.now() - syncStartMs };
    }

    // 3. Verify pod is actually running in K8s.
    // If it's still creating (npm install in progress), wait up to 3 minutes.
    // This handles the case where credentials are saved while the pod is still booting.
    let podStatus = await getDeploymentPodStatus(deploymentId, managedBy);
    if (podStatus.status === "creating") {
      log.info({ deploymentId }, "configSync→PVC: pod still starting in K8s, waiting for readiness...");
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        podStatus = await getDeploymentPodStatus(deploymentId, managedBy);
        if (podStatus.status === "running") {
          log.info({ deploymentId }, "configSync→PVC: pod is now ready");
          break;
        }
        if (podStatus.status === "failed") {
          log.warn({ deploymentId }, "configSync→PVC: pod failed while waiting for readiness, skipping");
          return { success: false, error: "Pod failed while waiting for readiness", durationMs: Date.now() - syncStartMs };
        }
      }
    }
    if (podStatus.status !== "running") {
      log.info(
        { deploymentId, podStatus: podStatus.status },
        "configSync→PVC: pod not ready after waiting, skipping"
      );
      return { success: false, error: "Pod not ready after waiting", durationMs: Date.now() - syncStartMs };
    }

    // 4. Get runtime handler
    const runtimeHandler = getHandlerOrNull(deployment.runtime);
    if (!runtimeHandler) {
      log.warn(
        { deploymentId, runtime: deployment.runtime },
        "configSync→PVC: no runtime handler, skipping"
      );
      return { success: true, tier: 0, durationMs: Date.now() - syncStartMs };
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

    log.info(
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
      log.info({ deploymentId, tier: 1 }, "ConfigSync: starting tier 1 (file-only, zero downtime)");
      if (configFiles.length > 0) {
        // Always update ConfigMap so the next pod restart gets fresh config
        await updateDeploymentConfigMap(deploymentId, configFiles, managedBy);

        // Also write directly to the running pod for immediate effect
        try {
          await retryOnce(
            () => writeConfigsToPvc(deploymentId, configFiles, managedBy, ["skills"]),
            2000,
            "configSync→PVC tier1 write",
          );
        } catch (writeErr) {
          log.warn(
            { deploymentId, err: writeErr },
            "configSync→PVC: direct PVC write failed (ConfigMap updated, will apply on restart)"
          );
        }
        for (const f of configFiles) {
          log.debug({ deploymentId, filePath: f.path, contentLength: f.content.length }, "ConfigSync: writing file to PVC");
        }

        // If the MCP server script was deployed, re-register mcporter to use the PVC version
        if (configFiles.some((f) => f.path.includes("jarble-ui-server"))) {
          await reRegisterMcpServer(deploymentId, managedBy);
        }

        const durationMs = Date.now() - syncStartMs;
        log.info(
          { deploymentId, durationMs, tier: 1, files: configFiles.map((f) => f.path) },
          "ConfigSync: completed (file-only, zero downtime)"
        );
      }
      return { success: true, tier: 1, durationMs: Date.now() - syncStartMs };
    }

    if (!comparison.removed) {
      // ── Tier 2: Process restart (env vars added/changed, ~5-10s) ──────
      log.info({ deploymentId, tier: 2 }, "ConfigSync: starting tier 2 (process restart)");
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
          await retryOnce(
            () => writeConfigsToPvc(deploymentId, configFiles, managedBy, ["skills"]),
            2000,
            "configSync→PVC tier2 write",
          );
        } catch (writeErr) {
          log.warn(
            { deploymentId, err: writeErr },
            "configSync→PVC: direct PVC write failed (ConfigMap updated, will apply on restart)"
          );
        }
      }

      // Update K8s Secret for persistence (if pod truly restarts later, it gets the new values)
      log.info({ deploymentId, keyCount: Object.keys(secretEntries).length }, "ConfigSync: updating K8s secret");
      await updateDeploymentSecret(
        deploymentId,
        deployment.userId,
        deployment.name,
        deployment.runtime,
        secretEntries,
        (deployment as any).template || undefined,
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
          log.info({ deploymentId, durationMs, tier: 2 }, "ConfigSync: completed (process restart)");
          return { success: true, tier: 2, durationMs };
        } else {
          await db.update(deployments)
            .set({
              status: "failed",
              error: failureReason || "Process did not become ready after reload",
            })
            .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "reloading")));
          log.warn({ deploymentId, failureReason }, "configSync→PVC: process restart failed");
          return { success: false, tier: 2, error: failureReason || "Process did not become ready after reload", durationMs: Date.now() - syncStartMs };
        }
      }

      // Process restart not supported (old image without PID file) — fall through to Tier 3
      log.info({ deploymentId }, "configSync→PVC: process restart not available, falling back to pod restart");
      await db.update(deployments)
        .set({ status: "restarting", error: null })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "reloading")));
    } else {
      // ── Tier 3 entry: Secrets removed (need full pod restart) ─────────
      log.info({ deploymentId, tier: 3 }, "ConfigSync: starting tier 3 (secrets removed, full pod restart)");
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
          await retryOnce(
            () => writeConfigsToPvc(deploymentId, configFiles, managedBy, ["skills"]),
            2000,
            "configSync→PVC tier3 write",
          );
        } catch (writeErr) {
          log.warn(
            { deploymentId, err: writeErr },
            "configSync→PVC: direct PVC write failed (ConfigMap updated, will apply on restart)"
          );
        }
      }

      // Update K8s Secret (critical for platform tokens)
      log.info({ deploymentId, keyCount: Object.keys(secretEntries).length }, "ConfigSync: updating K8s secret");
      await updateDeploymentSecret(
        deploymentId,
        deployment.userId,
        deployment.name,
        deployment.runtime,
        secretEntries,
        (deployment as any).template || undefined,
      );
    }

    // ── Tier 3: Full pod restart (~30-60s) ──────────────────────────────
    // Either secrets were removed, or process restart wasn't supported.
    // Status is already "restarting" at this point.

    // CRITICAL: Delete stale .env from PVC before restarting.
    // The entrypoint sources /data/config/.env on every boot. If a previous
    // Tier 2 sync wrote old values there, they would override the fresh K8s
    // Secret env vars, causing model/key changes to not take effect.
    try {
      const podName = await findPodForDeployment(deploymentId, { managedBy });
      if (podName) {
        const containerName = getContainerName(managedBy);
        const pvcMount = getPvcMountPath(managedBy);
        await execInPod(podName, ["sh", "-c", `rm -f ${pvcMount}/config/.env`], containerName);
        log.info({ deploymentId }, "ConfigSync: cleared stale .env before Tier 3 restart");
      }
    } catch {
      // Pod may already be terminating — .env will be clean on next boot
      // since the init container doesn't create one.
    }

    // For operator mode, restartDeployment needs userId + config to recreate the CR
    log.info({ deploymentId, managedBy }, "ConfigSync: restarting deployment (full pod restart)");
    await restartDeployment(deploymentId, managedBy, deployment.userId, {
      name: deployment.name,
      runtime: deployment.runtime,
      extraSecretEntries: secretEntries,
      initialConfigs: configFiles,
      gatewayToken: currentSecret?.OPENCLAW_GATEWAY_TOKEN,
    });

    // Poll for readiness with adaptive intervals:
    //   - First 20s: poll every 1s (warm boots with .initialized are ready in ~15s)
    //   - 20s-60s: poll every 2s
    //   - 60s-180s: poll every 3s (cold boot npm install takes 2-3 min)
    let ready = false;
    let failureReason = "";
    const pollStartMs = Date.now();
    const maxPollMs = 180_000; // 3 min max
    while (Date.now() - pollStartMs < maxPollMs) {
      const status = await getDeploymentPodStatus(deploymentId, managedBy);
      if (status.status === "running") {
        ready = true;
        break;
      }
      if (status.status === "failed") {
        failureReason = status.error || "Pod failed to start";
        break;
      }
      const elapsedMs = Date.now() - pollStartMs;
      const pollMs = elapsedMs < 20_000 ? 1000 : elapsedMs < 60_000 ? 2000 : 3000;
      await new Promise((r) => setTimeout(r, pollMs));
    }

    if (ready) {
      const result = await db.update(deployments)
        .set({ status: "running", error: null })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
      const affected = getRowsAffected(result);
      if (affected === 0) {
        log.warn({ deploymentId }, "configSync→PVC: status update skipped — deployment no longer in 'restarting' state");
      } else {
        const durationMs = Date.now() - syncStartMs;
        log.info({ deploymentId, durationMs, tier: 3 }, "ConfigSync: completed (full pod restart)");
      }
      return { success: true, tier: 3, durationMs: Date.now() - syncStartMs };
    } else {
      const result = await db.update(deployments)
        .set({
          status: "failed",
          error: failureReason || "Pod did not become ready after config sync",
        })
        .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
      const affected = getRowsAffected(result);
      if (affected === 0) {
        log.warn({ deploymentId, failureReason }, "configSync→PVC: failure status update skipped — deployment no longer in 'restarting' state");
      } else {
        log.warn({ deploymentId, failureReason }, "configSync→PVC: pod failed to become ready");
      }
      return { success: false, tier: 3, error: failureReason || "Pod did not become ready after config sync", durationMs: Date.now() - syncStartMs };
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - syncStartMs;
    log.error(
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

      log.info(
        { deploymentId, previousStatus },
        "configSync→PVC: rolled back DB status"
      );
    } catch (rollbackErr) {
      log.error(
        { deploymentId, rollbackErr },
        "configSync→PVC: failed to rollback DB status"
      );
    }
    return { success: false, error: errorMessage, durationMs };
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
      log.warn({ deploymentId }, "configSync←PVC: deployment not found, skipping");
      return;
    }

    // 2. Only sync if deployment is running
    if (deployment.status !== "running") {
      log.info(
        { deploymentId, status: deployment.status },
        "configSync←PVC: deployment not running, skipping"
      );
      return;
    }

    const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;

    // 3. Get runtime handler
    const runtimeHandler = getHandlerOrNull(deployment.runtime);
    if (!runtimeHandler) {
      log.warn(
        { deploymentId, runtime: deployment.runtime },
        "configSync←PVC: no runtime handler, skipping"
      );
      return;
    }

    // 4. Read config files from PVC
    const files = await readConfigsFromPvc(deploymentId, runtimeHandler.configFiles, managedBy);

    if (files.length === 0) {
      log.debug({ deploymentId }, "configSync←PVC: no config files found on PVC");
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

      log.info(
        { deploymentId, updatedFields: Object.keys(updates) },
        "configSync←PVC: deployments table updated from PVC config"
      );
    }

    // 8. Sync platformCredentials if parsed from config
    if (parsed.platformCredentials && Object.keys(parsed.platformCredentials).length > 0) {
      await syncPlatformCredentialsFromPvc(deploymentId, parsed.platformCredentials);
    }
  } catch (err) {
    log.error({ deploymentId, err }, "configSync←PVC: failed to sync from PVC");
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
    log.info(
      { deploymentId, platformIds: Object.keys(parsedCreds), upsertCount },
      "configSync←PVC: platform credentials synced from PVC"
    );
  }
}

// ── Gateway Restart Helper ──────────────────────────────────────────────────

/**
 * Signal the OpenClaw gateway to restart and pick up new MCP tools.
 *
 * New entrypoint: Touches .reload marker + kills the gateway PID.
 *   The entrypoint's reload loop detects this and restarts the process (~5-10s).
 * Old entrypoint: No PID file exists, .reload is ignored. Returns false
 *   so the caller knows a full pod restart is needed.
 *
 * Returns true if the gateway restart was signaled, false if not supported.
 */
async function signalGatewayRestart(
  podName: string,
  pvcMount: string,
  containerName: string,
): Promise<boolean> {
  try {
    // Check if the new entrypoint is running (has PID file)
    const pidCheck = await execInPod(podName, [
      "sh", "-c", `cat ${pvcMount}/.openclaw.pid 2>/dev/null || echo ""`,
    ], containerName);

    const pid = pidCheck.trim();
    if (!pid) {
      // Old entrypoint — no reload support
      return false;
    }

    // Touch .reload marker and kill the gateway process
    // The entrypoint's reload loop will detect .reload, re-source .env, and restart
    await execInPod(podName, [
      "sh", "-c",
      `touch ${pvcMount}/.reload && kill ${pid} 2>/dev/null || true`,
    ], containerName);

    log.info({ podName, pid }, "signalGatewayRestart: sent reload signal");
    return true;
  } catch (err) {
    log.warn({ podName, err }, "signalGatewayRestart: failed (non-fatal)");
    return false;
  }
}

// ── MCP Server Hot-Sync ─────────────────────────────────────────────────────
// Push the latest MCP server script to a running pod's PVC and optionally
// restart the gateway so it picks up new tools.
//
// Two modes:
//   Stage-only (default): Write file + update ConfigMap. Non-disruptive.
//     New tools activate on the pod's next natural restart (config change,
//     user restart, pod eviction). Safe to run while users are chatting.
//   Apply: Stage + restart gateway. Used when pod is idle (no active chat
//     sessions) or when explicitly requested via updateRuntime mutation.

/**
 * Stage the latest MCP server on a running pod's PVC.
 * Does NOT restart the gateway — safe to call while users are chatting.
 * The update takes effect on the pod's next restart.
 *
 * Returns { staged, fromHash, toHash }.
 */
export async function stageMcpServer(
  deploymentId: string,
  managedBy: ManagedBy = "legacy",
): Promise<{ staged: boolean; fromHash: string; toHash: string }> {
  const { getMcpServerInfo } = await import("../runtimes/handlers/openclaw.js");
  const { content, hash: currentHash } = getMcpServerInfo();

  if (!content || !currentHash) {
    throw new Error("MCP server script not available on API server");
  }

  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const containerName = getContainerName(managedBy);
  const pvcMount = getPvcMountPath(managedBy);
  const mcpDir = `${pvcMount}/config/mcp`;

  // Read current hash from pod (empty string if no marker file)
  let podHash = "";
  try {
    podHash = (await execInPod(podName, [
      "sh", "-c", `cat ${mcpDir}/.version 2>/dev/null || echo ""`,
    ], containerName)).trim();
  } catch {
    // No version file — needs update
  }

  if (podHash === currentHash) {
    log.debug({ deploymentId, hash: currentHash }, "stageMcpServer: pod already up-to-date");
    return { staged: false, fromHash: podHash, toHash: currentHash };
  }

  // Write the MCP server script + version marker to PVC
  log.info(
    { deploymentId, fromHash: podHash || "(none)", toHash: currentHash },
    "stageMcpServer: writing updated MCP server to PVC"
  );

  await execInPod(podName, ["mkdir", "-p", mcpDir], containerName);

  const { execInPodWithStdin } = await import("../k8s/exec.js");
  await execInPodWithStdin(
    podName,
    ["sh", "-c", `base64 -d > ${mcpDir}/jarble-ui-server.js`],
    Buffer.from(content).toString("base64"),
    30_000,
    containerName,
  );

  await execInPod(podName, [
    "sh", "-c", `echo "${currentHash}" > ${mcpDir}/.version`,
  ], containerName);

  // Update ConfigMap so next pod restart picks up the new MCP server
  await updateDeploymentConfigMap(deploymentId, [
    { path: "mcp/jarble-ui-server.js", content },
  ], managedBy);

  log.info({ deploymentId, hash: currentHash }, "stageMcpServer: staged successfully (activates on next restart)");
  return { staged: true, fromHash: podHash || "(none)", toHash: currentHash };
}

/**
 * Stage the latest MCP server AND restart the gateway so new tools
 * take effect immediately. Use only when the pod is idle or when
 * the user explicitly requests it (updateRuntime mutation).
 *
 * For new entrypoint: .reload signal (~5-10s, graceful).
 * For old entrypoint: full pod restart (~30-60s).
 */
export async function syncMcpServer(
  deploymentId: string,
  managedBy: ManagedBy = "legacy",
): Promise<{ updated: boolean; fromHash: string; toHash: string }> {
  const stageResult = await stageMcpServer(deploymentId, managedBy);
  if (!stageResult.staged) {
    return { updated: false, fromHash: stageResult.fromHash, toHash: stageResult.toHash };
  }

  // Re-register mcporter
  await reRegisterMcpServer(deploymentId, managedBy);

  // Restart gateway so it re-reads the tool list
  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (podName) {
    const containerName = getContainerName(managedBy);
    const pvcMount = getPvcMountPath(managedBy);
    const hasReloadSupport = await signalGatewayRestart(podName, pvcMount, containerName);
    if (!hasReloadSupport) {
      log.info({ deploymentId }, "syncMcpServer: old entrypoint, triggering full pod restart");
      await restartDeployment(deploymentId, managedBy);
    }
  }

  log.info({ deploymentId }, "syncMcpServer: updated and gateway restarted");
  return { updated: true, fromHash: stageResult.fromHash, toHash: stageResult.toHash };
}

// ── Active session tracking ─────────────────────────────────────────────────
// Track which deployments have active chat sessions so auto-sync can
// skip busy pods and only restart idle ones.

const activeDeployments = new Set<string>();

/** Mark a deployment as having an active chat session. */
export function markDeploymentActive(deploymentId: string): void {
  activeDeployments.add(deploymentId);
}

/** Mark a deployment as idle (chat session ended). */
export function markDeploymentIdle(deploymentId: string): void {
  activeDeployments.delete(deploymentId);
}

/** Check if a deployment currently has active chat sessions. */
export function isDeploymentActive(deploymentId: string): boolean {
  return activeDeployments.has(deploymentId);
}

/**
 * Auto-sync MCP server to all running deployments.
 * - Active pods (users chatting): Stage only — no restart, no disruption.
 * - Idle pods (no active sessions): Stage + restart gateway for immediate effect.
 */
export async function syncMcpServerToAllRunning(): Promise<{
  total: number; staged: number; applied: number; skipped: number; failed: number;
}> {
  const { getMcpServerInfo } = await import("../runtimes/handlers/openclaw.js");
  const { hash } = getMcpServerInfo();
  if (!hash) return { total: 0, staged: 0, applied: 0, skipped: 0, failed: 0 };

  const allDeployments = await db.query.deployments.findMany({
    where: eq(deployments.status, "running"),
  });

  const results = { total: allDeployments.length, staged: 0, applied: 0, skipped: 0, failed: 0 };

  for (const dep of allDeployments) {
    try {
      const managedBy = (dep.managedBy ?? "legacy") as ManagedBy;

      if (isDeploymentActive(dep.id)) {
        // User is chatting — stage only, don't interrupt
        const result = await stageMcpServer(dep.id, managedBy);
        if (result.staged) results.staged++;
        else results.skipped++;
      } else {
        // Pod is idle — stage and apply (restart gateway)
        const result = await syncMcpServer(dep.id, managedBy);
        if (result.updated) results.applied++;
        else results.skipped++;
      }
    } catch (err) {
      results.failed++;
      log.warn({ deploymentId: dep.id, err }, "syncMcpServerToAllRunning: failed for deployment");
    }
  }

  if (results.staged > 0 || results.applied > 0) {
    log.info(results, "syncMcpServerToAllRunning: batch update complete");
  }

  return results;
}

// ── Marketplace Component Sync ──────────────────────────────────────────────

/**
 * Write a marketplace component to a deployment's PVC.
 * Called when a component is installed on a deployment.
 *
 * Writes to two locations:
 * 1. /data/marketplace/{componentId}/ — manifest.json + component file (metadata)
 * 2. /data/components/{name}.json — define_component format (for MCP server discovery)
 *
 * The MCP server on the pod reads custom components from /data/components/ using
 * the same resolution path as bot-defined components (define_component tool).
 * This ensures marketplace components work transparently with render_ui — the
 * template gets resolved to built-in primitives that the frontend can render.
 *
 * @param deploymentId - Target deployment
 * @param componentId - Unique component identifier (used as directory name)
 * @param componentName - Component name slug (used as filename in /data/components/)
 * @param manifest - Validated marketplace manifest object
 * @param componentDefinition - Component definition JSON: { name, description, layout } for template tier,
 *                              or { name, description, layout: [{ component: "sandbox", props: { html } }] } for sandbox tier
 * @param tier - "template" or "sandbox"
 */
export async function syncMarketplaceComponent(
  deploymentId: string,
  componentId: string,
  componentName: string,
  manifest: Record<string, unknown>,
  componentDefinition: Record<string, unknown> | null,
  tier: "template" | "sandbox",
  managedBy: ManagedBy = "legacy",
): Promise<void> {
  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const containerName = getContainerName(managedBy);
  const pvcMount = getPvcMountPath(managedBy);

  // 1. Write to /data/marketplace/{componentId}/manifest.json (metadata)
  const marketplacePath = `${pvcMount}/marketplace/${componentId}`;
  await execInPod(podName, ["mkdir", "-p", marketplacePath], containerName);

  const manifestContent = JSON.stringify(manifest, null, 2);
  const manifestB64 = Buffer.from(manifestContent).toString("base64");
  await execInPod(podName, [
    "sh", "-c",
    `echo '${manifestB64}' | base64 -d > '${marketplacePath}/manifest.json'`,
  ], containerName);

  // 2. Write component definition to /data/components/{name}.json
  //    This is the same format as define_component uses, so the MCP server's
  //    custom component resolution handles rendering transparently.
  if (componentDefinition) {
    const componentsDir = `${pvcMount}/components`;
    await execInPod(podName, ["mkdir", "-p", componentsDir], containerName);

    const defContent = JSON.stringify(componentDefinition, null, 2);
    const defB64 = Buffer.from(defContent).toString("base64");
    await execInPod(podName, [
      "sh", "-c",
      `echo '${defB64}' | base64 -d > '${componentsDir}/${componentName}.json'`,
    ], containerName);

    log.info(
      { deploymentId, componentId, componentName, tier },
      "syncMarketplaceComponent: wrote component definition to /data/components/"
    );
  } else {
    log.warn(
      { deploymentId, componentId, componentName },
      "syncMarketplaceComponent: no component definition available, marketplace manifest only"
    );
  }
}

/**
 * Remove a marketplace component from a deployment's PVC.
 * Called when a component is uninstalled.
 *
 * Removes from both locations:
 * 1. /data/marketplace/{componentId}/ — metadata directory
 * 2. /data/components/{componentName}.json — define_component definition
 *
 * @param deploymentId - Target deployment
 * @param componentId - Component to remove
 * @param componentName - Component name slug (for /data/components/ cleanup)
 */
export async function removeMarketplaceComponent(
  deploymentId: string,
  componentId: string,
  componentName: string | null,
  managedBy: ManagedBy = "legacy",
): Promise<void> {
  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const containerName = getContainerName(managedBy);
  const pvcMount = getPvcMountPath(managedBy);

  // Remove marketplace metadata directory
  const marketplacePath = `${pvcMount}/marketplace/${componentId}`;
  await execInPod(podName, ["rm", "-rf", marketplacePath], containerName);

  // Remove custom component definition
  if (componentName) {
    const componentPath = `${pvcMount}/components/${componentName}.json`;
    await execInPod(podName, ["rm", "-f", componentPath], containerName);
  }

  log.info(
    { deploymentId, componentId, componentName },
    "removeMarketplaceComponent: removed component from PVC"
  );
}
