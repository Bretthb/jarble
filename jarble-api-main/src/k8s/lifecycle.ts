import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { coreApi, appsApi } from "./client.js";
import { NAMESPACE, DEFAULT_IMAGE, RUNTIME_PORTS } from "./constants.js";
import type { DeploymentConfig, ManagedBy } from "./constants.js";
import { getDeploymentPodStatus } from "./status.js";
import { createDeploymentConfigMap, deleteDeploymentConfigMap } from "./configmap.js";
import {
  createOpenClawInstance,
  deleteOpenClawInstance,
} from "./operator.js";

// ── Create ──────────────────────────────────────────────────────────────

export async function createDeployment(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig,
  managedBy: ManagedBy = "legacy"
): Promise<void> {
  if (managedBy === "operator") {
    return createDeploymentOperator(deploymentId, userId, config);
  }
  return createDeploymentLegacy(deploymentId, userId, config);
}

async function createDeploymentOperator(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  const createStartMs = Date.now();
  logger.info({ deploymentId, userId, mode: "operator" }, "K8s: creating deployment (operator)");

  const gatewayToken = config.gatewayToken || crypto.randomBytes(32).toString("hex");
  let secretCreated = false;
  let configMapCreated = false;

  try {
    // 1. Create Secret (with `token` key for operator's gateway discovery)
    const baseSecretData: Record<string, string> = {
      DEPLOYMENT_ID: deploymentId,
      USER_ID: userId,
      DEPLOYMENT_NAME: config.name,
      TEMPLATE: config.template || "personal",
      RUNTIME: config.runtime || "openclaw",
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      token: gatewayToken, // Operator reads `token` key for gateway auth
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
    logger.info({ deploymentId, keyCount: Object.keys(secretData).length }, "K8s: created Secret (operator)");

    // 2. Create ConfigMap with flat keys (operator uses these directly)
    if (config.initialConfigs && config.initialConfigs.length > 0) {
      await createDeploymentConfigMap(deploymentId, config.initialConfigs, "operator");
      configMapCreated = true;
      logger.info({ deploymentId, fileCount: config.initialConfigs.length }, "K8s: created ConfigMap (operator)");
    }

    // 3. Create OpenClawInstance CR
    await createOpenClawInstance(deploymentId, userId, config);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, secretCreated, configMapCreated, error: errorMessage }, "K8s: createDeployment (operator) failed, rolling back");
    try {
      if (configMapCreated) await deleteDeploymentConfigMap(deploymentId);
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete ConfigMap");
    }
    try {
      if (secretCreated) await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete Secret");
    }
    throw err;
  }

  const createDurationMs = Date.now() - createStartMs;
  logger.info({ deploymentId, durationMs: createDurationMs }, "K8s: deployment created successfully (operator)");
}

async function createDeploymentLegacy(
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
  const cpuMillicores = `${Math.round(parseFloat(cpuLimit) * 1000)}m`;
  const memoryMi = `${memoryMb}Mi`;
  const storageGi = `${Math.max(1, storageGbVal)}Gi`;

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
      storageClassName: "longhorn",
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
  if (config.initialConfigs && config.initialConfigs.length > 0) {
    await createDeploymentConfigMap(deploymentId, config.initialConfigs);
    configMapCreated = true;
    logger.info({ deploymentId, fileCount: config.initialConfigs.length }, "K8s: created ConfigMap");
  }

  // 4. Build the init container script that copies ConfigMap files to PVC.
  const configInitScript = [
    "mkdir -p /data/config /data/logs /data/.openclaw /data/components /data/files",
    "chmod -R 755 /data/config /data/logs /data/.openclaw /data/components /data/files",
    "if [ -d /config-source ]; then " +
      "for f in /config-source/*; do " +
        "key=$(basename \"$f\"); " +
        "case \"$key\" in " +
          "abs-*) target=\"/$(echo \"$key\" | sed 's/^abs-//' | sed 's/--/\\//g')\" ;; " +
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
          initContainers: [
            {
              name: "config-init",
              image: "busybox:1.36",
              command: ["sh", "-c", configInitScript],
              securityContext: {
                runAsUser: 0,
              },
              volumeMounts: [
                { name: "data", mountPath: "/data" },
                ...(hasConfigMap ? [{ name: "config-source", mountPath: "/config-source", readOnly: true }] : []),
              ],
            },
            ...(hasConfigMap ? [{
              name: "validate-config",
              image: containerImage,
              command: ["sh", "-c",
                "if command -v openclaw >/dev/null 2>&1 && openclaw config validate --help >/dev/null 2>&1; then " +
                  "openclaw config validate --json && echo '[validate-config] Config OK' || " +
                  "{ echo '[validate-config] Config validation failed' >&2; exit 1; }; " +
                "else " +
                  "echo '[validate-config] Skipping — validate not available'; " +
                "fi"
              ],
              envFrom: [{ secretRef: { name: `secret-${deploymentId}` } }],
              volumeMounts: [
                { name: "data", mountPath: "/data" },
              ],
            }] : []),
          ],
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
            securityContext: {
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
              httpGet: {
                path: "/healthz",
                port: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              },
              initialDelaySeconds: 60,
              periodSeconds: 30,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
            readinessProbe: {
              httpGet: {
                path: "/healthz",
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

// ── Stop / Start ────────────────────────────────────────────────────────

/**
 * Stop a deployment.
 * Legacy: scale replicas to 0. Operator: delete CR (PVC is retained).
 */
export async function stopDeployment(deploymentId: string, managedBy: ManagedBy = "legacy"): Promise<void> {
  if (managedBy === "operator") {
    logger.info({ deploymentId, mode: "operator" }, "Stopping deployment (deleting CR)");
    await deleteOpenClawInstance(deploymentId);
    logger.info({ deploymentId }, "Deployment stopped (CR deleted, PVC retained)");
    return;
  }

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
 * Start a previously stopped deployment.
 * Legacy: scale replicas to 1. Operator: recreate CR with existingClaim.
 *
 * For operator mode, `config` is required to rebuild the CR spec.
 */
export async function startDeployment(
  deploymentId: string,
  managedBy: ManagedBy = "legacy",
  userId?: string,
  config?: DeploymentConfig
): Promise<void> {
  if (managedBy === "operator") {
    if (!config || !userId) {
      throw new Error("startDeployment: operator mode requires userId and config to recreate CR");
    }
    logger.info({ deploymentId, mode: "operator" }, "Starting deployment (recreating CR with existingClaim)");
    // Operator-managed PVC is named `dep-{id}-data` by convention
    const pvcName = `dep-${deploymentId}-data`;
    await createOpenClawInstance(deploymentId, userId, config, pvcName);
    logger.info({ deploymentId }, "Deployment started (CR recreated)");
    return;
  }

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
 * Restart a running deployment.
 * Legacy: scale 0 → wait → scale 1. Operator: delete CR → wait → recreate CR.
 */
export async function restartDeployment(
  deploymentId: string,
  managedBy: ManagedBy = "legacy",
  userId?: string,
  config?: DeploymentConfig
): Promise<void> {
  const restartStartMs = Date.now();
  logger.info({ deploymentId, mode: managedBy }, "K8s: restarting deployment");

  await stopDeployment(deploymentId, managedBy);

  // Wait for the pod to fully terminate before starting a new one.
  const maxWaitMs = 60_000;
  const pollMs = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await getDeploymentPodStatus(deploymentId, managedBy);
    if (status.status === "not_found") break;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  await startDeployment(deploymentId, managedBy, userId, config);

  const restartDurationMs = Date.now() - restartStartMs;
  logger.info({ deploymentId, durationMs: restartDurationMs }, "K8s: deployment restarted");
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeployment(deploymentId: string, managedBy: ManagedBy = "legacy"): Promise<void> {
  if (managedBy === "operator") {
    return deleteDeploymentOperator(deploymentId);
  }
  return deleteDeploymentLegacy(deploymentId);
}

async function deleteDeploymentOperator(deploymentId: string): Promise<void> {
  const deleteStartMs = Date.now();
  logger.info({ deploymentId, mode: "operator" }, "K8s: deleteDeployment starting (operator)");

  // 1. Delete CR (cascades StatefulSet, Service, PDB, NetworkPolicy)
  await deleteOpenClawInstance(deploymentId);

  // 2. Wait for pod termination
  const maxWaitMs = 30_000;
  const pollMs = 2_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await getDeploymentPodStatus(deploymentId, "operator");
    if (status.status === "not_found") break;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  // 3. Delete Secret (not managed by operator)
  try {
    await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    logger.debug({ deploymentId }, "deleteDeployment (operator): Secret deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode !== 404) throw err;
  }

  // 4. Delete ConfigMap (not managed by operator)
  await deleteDeploymentConfigMap(deploymentId);

  // 5. Delete retained PVC (operator names it `dep-{id}-data`)
  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`dep-${deploymentId}-data`, NAMESPACE);
    logger.debug({ deploymentId }, "deleteDeployment (operator): PVC deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode !== 404) throw err;
  }

  const deleteDurationMs = Date.now() - deleteStartMs;
  logger.info({ deploymentId, durationMs: deleteDurationMs }, "K8s: deleteDeployment completed (operator)");
}

async function deleteDeploymentLegacy(deploymentId: string): Promise<void> {
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
