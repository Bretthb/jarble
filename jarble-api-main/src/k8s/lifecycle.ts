import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { coreApi, appsApi } from "./client.js";
import { NAMESPACE, DEFAULT_IMAGE, RUNTIME_PORTS } from "./constants.js";
import type { DeploymentConfig } from "./constants.js";
import { getDeploymentPodStatus } from "./status.js";
import { writeConfigsToPvc } from "./config.js";
import { signalProcessRestart } from "./config.js";

export async function createDeployment(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  logger.info({ deploymentId, userId }, "Creating deployment");

  const containerImage = config.image || DEFAULT_IMAGE;

  // Derive resource values from config (with sensible defaults)
  const cpuLimit = config.cpuLimit || "2.0";
  const memoryMb = config.memoryMb || 3072;
  const storageGbVal = config.storageMb || 30; // "storageMb" is actually GB (historical naming)

  // Convert to K8s resource units
  // CPU: "2.0" → "2000m" (millicores). Request = limit (guaranteed QoS).
  const cpuMillicores = `${Math.round(parseFloat(cpuLimit) * 1000)}m`;
  // Memory: MB → "XMi"
  const memoryMi = `${memoryMb}Mi`;
  // Storage: Value is already in GB → "XGi" (minimum 1Gi)
  const storageGi = `${Math.max(1, storageGbVal)}Gi`;

  // 1. Create PVC for deployment storage
  // Resources are created sequentially with rollback on failure to prevent orphans.
  let pvcCreated = false;
  let secretCreated = false;

  try {
  await coreApi.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${deploymentId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: process.env.K8S_STORAGE_CLASS || "longhorn",
      resources: { requests: { storage: storageGi } },
    },
  });
  pvcCreated = true;

  // 2. Create Secret for deployment env vars
  // Base entries are always included; runtime handler provides extras (e.g. LLM keys)
  // Use pre-generated gateway token or create one
  const gatewayToken = config.gatewayToken || crypto.randomBytes(32).toString("hex");
  const baseSecretData: Record<string, string> = {
    DEPLOYMENT_ID: deploymentId,
    USER_ID: userId,
    DEPLOYMENT_NAME: config.name,
    TEMPLATE: config.template || "personal",
    RUNTIME: config.runtime || "openclaw",
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };

  // Include JARBLE_API_URL for file watcher callback (PVC → DB sync)
  if (process.env.JARBLE_API_URL) {
    baseSecretData.JARBLE_API_URL = process.env.JARBLE_API_URL;
  }
  // Include CONFIG_WEBHOOK_SECRET for authenticated config-changed callbacks
  if (process.env.CONFIG_WEBHOOK_SECRET) {
    baseSecretData.CONFIG_WEBHOOK_SECRET = process.env.CONFIG_WEBHOOK_SECRET;
  }

  const secretData = { ...baseSecretData, ...(config.extraSecretEntries ?? {}) };

  await coreApi.createNamespacedSecret(NAMESPACE, {
    metadata: { name: `secret-${deploymentId}` },
    stringData: secretData,
  });
  secretCreated = true;

  // 3. Create Deployment
  await appsApi.createNamespacedDeployment(NAMESPACE, {
    metadata: {
      name: `dep-${deploymentId}`,
      labels: { app: `dep-${deploymentId}`, "jarble.ai/deployment-id": deploymentId },
    },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" }, // RWO PVCs can only mount to one pod at a time
      selector: { matchLabels: { app: `dep-${deploymentId}` } },
      template: {
        metadata: { labels: { app: `dep-${deploymentId}` } },
        spec: {
          // Disable K8s API access - pods shouldn't query the cluster
          automountServiceAccountToken: false,
          // Pod-level security: run as non-root user, set group for PVC access
          securityContext: {
            runAsNonRoot: false,  // Allow init container to run as root
            fsGroup: 1000,        // PVC files accessible to this group
          },
          // Init container: fix PVC permissions before main container starts
          // On first boot (.initialized missing): full recursive chown
          // On subsequent boots: just ensure dirs exist (fast)
          initContainers: [{
            name: "fix-permissions",
            image: "busybox:1.36",
            command: ["sh", "-c", "mkdir -p /data/config /data/logs /data/.openclaw /data/components && if [ ! -f /data/.initialized ]; then chown -R 1000:1000 /data && chmod -R 755 /data; else chown 1000:1000 /data/config /data/logs /data/.openclaw /data/components; fi"],
            securityContext: {
              runAsUser: 0,  // Run as root to fix permissions
            },
            volumeMounts: [{ name: "data", mountPath: "/data" }],
          }],
          containers: [{
            name: "runtime",
            image: containerImage,
            ports: [{
              containerPort: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              name: "gateway",
            }],
            resources: {
              requests: { cpu: cpuMillicores, memory: memoryMi, "ephemeral-storage": "100Mi" },
              limits: { cpu: cpuMillicores, memory: memoryMi, "ephemeral-storage": "1Gi" },
            },
            // Container-level security: run as non-root, drop all capabilities, read-only root filesystem
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              capabilities: { drop: ["ALL"] },
            },
            envFrom: [{ secretRef: { name: `secret-${deploymentId}` } }],
            volumeMounts: [
              { name: "data", mountPath: "/data" },
              { name: "tmp", mountPath: "/tmp" },        // Writable tmp (root fs is read-only)
            ],
            // Liveness probe: restart pod if OpenClaw gateway stops responding
            livenessProbe: {
              tcpSocket: {
                port: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              },
              initialDelaySeconds: 60, // Gateway starts in ~20-30s (no npm install)
              periodSeconds: 30,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
            // Readiness probe: don't route traffic until gateway port is open
            readinessProbe: {
              tcpSocket: {
                port: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              },
              initialDelaySeconds: 20, // First check after 20s — cached restarts are fast
              periodSeconds: 10,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
          }],
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: `pvc-${deploymentId}` } },
            { name: "tmp", emptyDir: {} },        // Ephemeral tmp directory
          ],
          imagePullSecrets: [{ name: "ghcr-pull-secret" }],
        },
      },
    },
  });

  } catch (err) {
    // Rollback: clean up any resources created before the failure
    logger.error({ deploymentId, err, pvcCreated, secretCreated }, "createDeployment failed, rolling back");
    try {
      if (secretCreated) {
        await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
      }
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete secret");
    }
    try {
      if (pvcCreated) {
        await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
      }
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete PVC");
    }
    throw err;
  }

  // 4. Write initial config files to PVC (fire-and-forget — don't block deployment return)
  // We write configs in the background when the pod becomes ready.
  if (config.initialConfigs && config.initialConfigs.length > 0) {
    const configs = config.initialConfigs;
    void (async () => {
      try {
        for (let i = 0; i < 150; i++) { // 150 × 2s = 5 min max
          const status = await getDeploymentPodStatus(deploymentId);
          if (status.status === "running") {
            await writeConfigsToPvc(deploymentId, configs);
            logger.info({ deploymentId }, "Initial config files written to PVC (background)");

            // Signal the gateway to reload so it picks up the new config
            // (e.g., gateway.auth.token written to the OpenClaw state dir).
            // The entrypoint's restart loop re-reads the config on reload.
            try {
              const reloaded = await signalProcessRestart(deploymentId, {});
              if (reloaded) {
                logger.info({ deploymentId }, "Gateway reload signaled after initial config write");
              }
            } catch (reloadErr) {
              logger.debug({ deploymentId, err: reloadErr }, "Gateway reload after initial config write failed (non-fatal)");
            }

            return;
          }
          if (status.status === "failed" || status.status === "not_found") {
            logger.warn({ deploymentId }, "Pod failed/gone, skipping initial config write");
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        logger.warn({ deploymentId }, "Pod not ready after 5 min, skipping initial config write");
      } catch (err) {
        logger.error({ deploymentId, err }, "Failed to write initial config files (background)");
      }
    })();
  }

  logger.info({ deploymentId }, "Deployment created successfully");
}

// ── Stop / Start (replica scaling) ────────────────────────────────────

/**
 * Stop a deployment by scaling replicas to 0.
 * PVC and Secret remain intact — data persists. Pod is terminated.
 */
export async function stopDeployment(deploymentId: string): Promise<void> {
  logger.info({ deploymentId }, "Stopping deployment (scaling to 0)");

  await appsApi.patchNamespacedDeployment(
    `dep-${deploymentId}`,
    NAMESPACE,
    { spec: { replicas: 0 } },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
  );

  logger.info({ deploymentId }, "Deployment stopped");
}

/**
 * Start a previously stopped deployment by scaling replicas to 1.
 * Pod starts fresh from the container image, PVC data is still there.
 */
export async function startDeployment(deploymentId: string): Promise<void> {
  logger.info({ deploymentId }, "Starting deployment (scaling to 1)");

  await appsApi.patchNamespacedDeployment(
    `dep-${deploymentId}`,
    NAMESPACE,
    { spec: { replicas: 1 } },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
  );

  logger.info({ deploymentId }, "Deployment started");
}

/**
 * Restart a running deployment by scaling to 0 then back to 1.
 * Useful for picking up config changes.
 */
export async function restartDeployment(deploymentId: string): Promise<void> {
  logger.info({ deploymentId }, "Restarting deployment");

  await stopDeployment(deploymentId);

  // Wait for the pod to fully terminate before starting a new one.
  // RWO PVCs can only be mounted by one pod — starting too early causes multi-attach errors.
  const maxWaitMs = 60_000;
  const pollMs = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await getDeploymentPodStatus(deploymentId);
    if (status.status === "not_found") break;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  await startDeployment(deploymentId);

  logger.info({ deploymentId }, "Deployment restarted");
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeployment(deploymentId: string): Promise<void> {
  logger.info({ deploymentId }, "deleteDeployment: starting");

  // Step 1: Scale to 0 so the pod releases the RWO PVC before we delete it.
  logger.debug({ deploymentId }, "deleteDeployment: scaling to 0 replicas");
  try {
    await appsApi.patchNamespacedDeployment(
      `dep-${deploymentId}`,
      NAMESPACE,
      { spec: { replicas: 0 } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
    logger.debug({ deploymentId }, "deleteDeployment: scaled to 0, waiting for pod termination");

    // Step 2: Wait for pod to terminate (max 30s) before deleting PVC
    const maxWaitMs = 30_000;
    const pollMs = 2_000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const status = await getDeploymentPodStatus(deploymentId);
      logger.debug({ deploymentId, podStatus: status.status }, "deleteDeployment: polling pod status");
      if (status.status === "not_found") {
        logger.debug({ deploymentId }, "deleteDeployment: pod terminated");
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as any).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "deleteDeployment: K8s deployment not found (already stopped/never created), skipping scale-down");
    } else {
      logger.warn({ deploymentId, err }, "deleteDeployment: failed to scale down before delete — proceeding anyway");
    }
  }

  // Step 3: Delete K8s Deployment
  logger.debug({ deploymentId }, "deleteDeployment: deleting K8s Deployment");
  try {
    await appsApi.deleteNamespacedDeployment(`dep-${deploymentId}`, NAMESPACE);
    logger.debug({ deploymentId }, "deleteDeployment: K8s Deployment deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as any).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "deleteDeployment: K8s Deployment already gone (404)");
    } else {
      logger.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s Deployment");
      throw err;
    }
  }

  // Step 4: Delete K8s Secret
  logger.debug({ deploymentId }, "deleteDeployment: deleting K8s Secret");
  try {
    await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    logger.debug({ deploymentId }, "deleteDeployment: K8s Secret deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as any).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "deleteDeployment: K8s Secret already gone (404)");
    } else {
      logger.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s Secret");
      throw err;
    }
  }

  // Step 5: Delete PVC (data is gone — intentional)
  logger.debug({ deploymentId }, "deleteDeployment: deleting K8s PVC");
  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
    logger.debug({ deploymentId }, "deleteDeployment: K8s PVC deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as any).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "deleteDeployment: K8s PVC already gone (404)");
    } else {
      logger.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s PVC");
      throw err;
    }
  }

  logger.info({ deploymentId }, "deleteDeployment: all K8s resources deleted");
}
