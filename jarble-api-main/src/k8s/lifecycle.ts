import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { coreApi, appsApi } from "./client.js";
import { NAMESPACE, DEFAULT_IMAGE, RUNTIME_PORTS } from "./constants.js";
import type { DeploymentConfig } from "./constants.js";
import { getDeploymentPodStatus } from "./status.js";
import { createDeploymentConfigMap, deleteDeploymentConfigMap } from "./configmap.js";

export async function createDeployment(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  const createStartMs = Date.now();
  logger.info({ deploymentId, userId }, "K8s: creating deployment");

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
  let configMapCreated = false;

  try {
  // 1. Create PVC for deployment storage
  await coreApi.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${deploymentId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: process.env.K8S_STORAGE_CLASS || "longhorn",
      resources: { requests: { storage: storageGi } },
    },
  });
  pvcCreated = true;
  logger.info({ deploymentId, storageGi }, "K8s: created PVC");

  // 2. Create Secret for deployment env vars
  const gatewayToken = config.gatewayToken || crypto.randomBytes(32).toString("hex");
  const baseSecretData: Record<string, string> = {
    DEPLOYMENT_ID: deploymentId,
    USER_ID: userId,
    DEPLOYMENT_NAME: config.name,
    TEMPLATE: config.template || "personal",
    RUNTIME: config.runtime || "openclaw",
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };

  if (process.env.JARBLE_API_URL) {
    baseSecretData.JARBLE_API_URL = process.env.JARBLE_API_URL;
  }
  if (process.env.CONFIG_WEBHOOK_SECRET) {
    baseSecretData.CONFIG_WEBHOOK_SECRET = process.env.CONFIG_WEBHOOK_SECRET;
  }

  const secretData = { ...baseSecretData, ...(config.extraSecretEntries ?? {}) };

  await coreApi.createNamespacedSecret(NAMESPACE, {
    metadata: { name: `secret-${deploymentId}` },
    stringData: secretData,
  });
  secretCreated = true;
  logger.info({ deploymentId, keyCount: Object.keys(secretData).length }, "K8s: created Secret");

  // 3. Create ConfigMap with initial config files
  // The init container copies these to the PVC before the main container starts,
  // eliminating the old "poll-then-exec" race condition.
  if (config.initialConfigs && config.initialConfigs.length > 0) {
    await createDeploymentConfigMap(deploymentId, config.initialConfigs);
    configMapCreated = true;
    logger.info({ deploymentId, fileCount: config.initialConfigs.length }, "K8s: created ConfigMap");
  }

  // 4. Build the init container script that copies ConfigMap files to PVC.
  // Each ConfigMap key encodes the target path:
  //   - Keys starting with "abs-" → absolute paths (e.g. "abs-data--.openclaw--openclaw.json" → "/data/.openclaw/openclaw.json")
  //   - Other keys → relative to /data/config/ (e.g. "soul.md" → "/data/config/soul.md")
  const configInitScript = [
    // Phase 1: Ensure directories exist with correct permissions
    "mkdir -p /data/config /data/logs /data/.openclaw /data/components /data/files",
    "chmod -R 755 /data/config /data/logs /data/.openclaw /data/components /data/files",
    // Phase 2: Copy ConfigMap files to PVC
    "if [ -d /config-source ]; then " +
      "for f in /config-source/*; do " +
        "key=$(basename \"$f\"); " +
        "case \"$key\" in " +
          // Decode abs- prefix back to absolute path
          "abs-*) target=\"/$(echo \"$key\" | sed 's/^abs-//' | sed 's/--/\\//g')\" ;; " +
          // Relative paths go under /data/config/
          "*) target=\"/data/config/$key\" ;; " +
        "esac; " +
        "dir=$(dirname \"$target\"); " +
        "mkdir -p \"$dir\"; " +
        "cp \"$f\" \"$target\"; " +
      "done; " +
      "echo '[config-init] Copied config files from ConfigMap'; " +
    "fi",
  ].join(" && ");

  // 5. Create Deployment
  const hasConfigMap = configMapCreated;
  await appsApi.createNamespacedDeployment(NAMESPACE, {
    metadata: {
      name: `dep-${deploymentId}`,
      labels: { app: `dep-${deploymentId}`, "jarble.ai/deployment-id": deploymentId },
    },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: `dep-${deploymentId}` } },
      template: {
        metadata: { labels: { app: `dep-${deploymentId}`, "jarble.ai/type": "bot" } },
        spec: {
          automountServiceAccountToken: false,
          securityContext: {
            runAsNonRoot: false,
            fsGroup: 1000,
          },
          initContainers: [{
            name: "fix-permissions",
            image: "busybox:1.36",
            command: ["sh", "-c", configInitScript],
            securityContext: {
              runAsUser: 0,
            },
            volumeMounts: [
              { name: "data", mountPath: "/data" },
              // Mount ConfigMap as read-only source for the init container to copy from
              ...(hasConfigMap ? [{ name: "config-source", mountPath: "/config-source", readOnly: true }] : []),
            ],
          }],
          containers: [{
            name: "runtime",
            image: containerImage,
            imagePullPolicy: process.env.K8S_IMAGE_PULL_POLICY === "IfNotPresent" ? "IfNotPresent" : "Always",
            ports: [{
              containerPort: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              name: "gateway",
            }],
            resources: {
              requests: { cpu: "100m", memory: "256Mi", "ephemeral-storage": "100Mi" },
              limits: { cpu: cpuMillicores, memory: memoryMi, "ephemeral-storage": "1Gi" },
            },
            securityContext: {
              // Relaxed to allow self-updates (npm), package installs (apt-get python3), etc.
              // Runs as root so the runtime can apt-get install packages as needed.
              // Network egress is still restricted by NetworkPolicy; K8s API access disabled.
              runAsUser: 0,
              runAsGroup: 0,
              allowPrivilegeEscalation: false,
            },
            envFrom: [{ secretRef: { name: `secret-${deploymentId}` } }],
            volumeMounts: [
              { name: "data", mountPath: "/data" },
              { name: "tmp", mountPath: "/tmp" },
            ],
            livenessProbe: {
              tcpSocket: {
                port: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              },
              initialDelaySeconds: 60,
              periodSeconds: 30,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
            readinessProbe: {
              tcpSocket: {
                port: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              },
              initialDelaySeconds: 20,
              periodSeconds: 10,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
          }],
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: `pvc-${deploymentId}` } },
            { name: "tmp", emptyDir: {} },
            // ConfigMap volume — init container copies files to PVC paths
            ...(hasConfigMap ? [{
              name: "config-source",
              configMap: { name: `config-${deploymentId}` },
            }] : []),
          ],
          imagePullSecrets: [{ name: "ghcr-pull-secret" }],
        },
      },
    },
  });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, pvcCreated, secretCreated, configMapCreated, error: errorMessage }, "K8s: createDeployment failed, rolling back");
    try {
      if (configMapCreated) {
        await deleteDeploymentConfigMap(deploymentId);
      }
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete ConfigMap");
    }
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

  const createDurationMs = Date.now() - createStartMs;
  logger.info({ deploymentId, durationMs: createDurationMs }, "K8s: deployment created successfully");
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
  const restartStartMs = Date.now();
  logger.info({ deploymentId }, "K8s: restarting deployment");

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

  const restartDurationMs = Date.now() - restartStartMs;
  logger.info({ deploymentId, durationMs: restartDurationMs }, "K8s: deployment restarted");
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeployment(deploymentId: string): Promise<void> {
  const deleteStartMs = Date.now();
  logger.info({ deploymentId }, "K8s: deleteDeployment starting");

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
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
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
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
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
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "deleteDeployment: K8s Secret already gone (404)");
    } else {
      logger.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s Secret");
      throw err;
    }
  }

  // Step 5: Delete ConfigMap
  logger.debug({ deploymentId }, "deleteDeployment: deleting K8s ConfigMap");
  await deleteDeploymentConfigMap(deploymentId);

  // Step 6: Delete PVC (data is gone — intentional)
  logger.debug({ deploymentId }, "deleteDeployment: deleting K8s PVC");
  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
    logger.debug({ deploymentId }, "deleteDeployment: K8s PVC deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "deleteDeployment: K8s PVC already gone (404)");
    } else {
      logger.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s PVC");
      throw err;
    }
  }

  const deleteDurationMs = Date.now() - deleteStartMs;
  logger.info({ deploymentId, durationMs: deleteDurationMs }, "K8s: deleteDeployment completed, all resources deleted");
}
