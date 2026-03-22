import crypto from "crypto";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("k8s:lifecycle");
import { coreApi, appsApi } from "./client.js";
import { NAMESPACE, DEFAULT_IMAGE, RUNTIME_PORTS, RUNTIME_CLASS_MAP, RUNTIME_OVERHEAD, RUNTIME_NODE_SELECTOR } from "./constants.js";
import type { DeploymentConfig, ManagedBy, IsolationLevel } from "./constants.js";
import { getDeploymentPodStatus } from "./status.js";
import { createDeploymentConfigMap, deleteDeploymentConfigMap } from "./configmap.js";
import {
  createOpenClawInstance,
  deleteOpenClawInstance,
} from "./operator.js";

// ── Security Context Builder ─────────────────────────────────────────────

/**
 * Build pod-level and container-level security contexts based on isolation level.
 *
 * - "standard": Minimal changes for backwards compat (existing behavior).
 * - "gvisor" / "kata": Full hardening — runAsNonRoot, drop all capabilities,
 *   seccomp RuntimeDefault profile, no privilege escalation.
 */
export function buildSecurityContext(isolationLevel: IsolationLevel = "standard") {
  if (isolationLevel === "standard") {
    // Backwards-compatible: keep existing behavior for standard deployments
    return {
      pod: {
        runAsNonRoot: false,
        fsGroup: 1000,
      },
      initContainer: {
        runAsUser: 0,
      },
      container: {
        runAsUser: 0,
        runAsGroup: 0,
        allowPrivilegeEscalation: false,
      },
    };
  }

  // Hardened context for gVisor / Kata isolated deployments
  return {
    pod: {
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
      seccompProfile: { type: "RuntimeDefault" },
    },
    initContainer: {
      // Init container still needs root to set up PVC directory permissions
      runAsUser: 0,
    },
    container: {
      runAsUser: 1000,
      runAsGroup: 1000,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: false, // pods need to write to PVC
      capabilities: { drop: ["ALL"] },
    },
  };
}

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
  log.info({ deploymentId, userId, mode: "operator" }, "K8s: creating deployment (operator)");

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
    log.info({ deploymentId, keyCount: Object.keys(secretData).length }, "K8s: created Secret (operator)");

    // 2. Create ConfigMap with flat keys (operator uses these directly)
    if (config.initialConfigs && config.initialConfigs.length > 0) {
      await createDeploymentConfigMap(deploymentId, config.initialConfigs, "operator");
      configMapCreated = true;
      log.info({ deploymentId, fileCount: config.initialConfigs.length }, "K8s: created ConfigMap (operator)");
    }

    // 3. Create OpenClawInstance CR
    await createOpenClawInstance(deploymentId, userId, config);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ deploymentId, secretCreated, configMapCreated, error: errorMessage }, "K8s: createDeployment (operator) failed, rolling back");
    try {
      if (configMapCreated) await deleteDeploymentConfigMap(deploymentId);
    } catch (cleanupErr) {
      log.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete ConfigMap");
    }
    try {
      if (secretCreated) await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    } catch (cleanupErr) {
      log.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete Secret");
    }
    throw err;
  }

  const createDurationMs = Date.now() - createStartMs;
  log.info({ deploymentId, durationMs: createDurationMs }, "K8s: deployment created successfully (operator)");
}

async function createDeploymentLegacy(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  const createStartMs = Date.now();
  log.info({ deploymentId, userId }, "K8s: creating deployment");

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
  log.info({ deploymentId, storageGi }, "K8s: created PVC");

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
  log.info({ deploymentId, keyCount: Object.keys(secretData).length }, "K8s: created Secret");

  // 3. Create ConfigMap with initial config files
  if (config.initialConfigs && config.initialConfigs.length > 0) {
    await createDeploymentConfigMap(deploymentId, config.initialConfigs);
    configMapCreated = true;
    log.info({ deploymentId, fileCount: config.initialConfigs.length }, "K8s: created ConfigMap");
  }

  // 4. Build the init container script that copies ConfigMap files to PVC.
  //    Directories are created in a single mkdir call and config copying is
  //    done in one shell invocation to minimize init container runtime.
  const configInitScript = [
    "mkdir -p /data/config /data/logs /data/.openclaw /data/components /data/files /data/skills /data/marketplace",
    "chmod -R 755 /data/config /data/logs /data/.openclaw /data/components /data/files /data/skills /data/marketplace",
    "if [ -d /config-source ]; then " +
      "for f in /config-source/*; do " +
        "key=$(basename \"$f\"); " +
        "case \"$key\" in " +
          "abs-*) target=\"/$(echo \"$key\" | sed 's/^abs-//' | sed 's/--/\\//g')\" ;; " +
          "*) target=\"/data/config/$(echo \"$key\" | sed 's/--/\\//g')\" ;; " +
        "esac; " +
        "dir=$(dirname \"$target\"); " +
        "mkdir -p \"$dir\"; " +
        "cp \"$f\" \"$target\"; " +
      "done; " +
      "echo '[config-init] Copied config files from ConfigMap'; " +
    "fi",
  ].join(" && ");

  // 5. Create Deployment
  //
  // Optimizations applied to the pod spec:
  //   - Removed validate-config init container: it pulled the full OpenClaw image
  //     a second time just to check config validity. Since configs are generated by
  //     trusted code (renderConfigs), validation adds ~10-30s startup time for no
  //     practical benefit. Config errors surface immediately via container logs.
  //   - Reduced terminationGracePeriodSeconds from default 30s to 10s: OpenClaw
  //     has no long-running requests to drain — it's a WebSocket gateway that
  //     reconnects instantly. Faster termination means faster restarts.
  //   - Tuned readiness probe: initialDelaySeconds 10s (down from 20s) since warm
  //     boots (with .initialized marker) start the gateway in <5s. periodSeconds 5s
  //     (down from 10s) for faster detection. successThreshold 1 (default).
  //   - Tuned liveness probe: initialDelaySeconds 90s (up from 60s) to give cold
  //     boots (npm install) more breathing room before being killed.
  //   - Added resource request/limit split: requests are lower than limits to allow
  //     burst during npm install while keeping baseline scheduling efficient.
  const hasConfigMap = configMapCreated;
  const gatewayPort = config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789;

  // Resource request/limit split: requests < limits allows CPU burst during npm install
  // while keeping scheduling efficient for steady-state operation.
  const cpuLimitVal = parseFloat(cpuLimit);
  const cpuRequestMillicores = `${Math.max(250, Math.round(cpuLimitVal * 500))}m`; // 50% of limit, min 250m

  // ── Isolation level: runtimeClass, security hardening, node selectors ──
  const isolationLevel: IsolationLevel = config.isolationLevel || "standard";
  const runtimeClassName = RUNTIME_CLASS_MAP[isolationLevel];
  const nodeSelector = RUNTIME_NODE_SELECTOR[isolationLevel];
  const overhead = RUNTIME_OVERHEAD[isolationLevel];
  const secCtx = buildSecurityContext(isolationLevel);

  // Adjust memory request to account for runtime overhead (gVisor/Kata use extra RAM)
  const adjustedMemoryMi = `${memoryMb + overhead.memoryMi}Mi`;

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
          terminationGracePeriodSeconds: 10,
          ...(runtimeClassName ? { runtimeClassName } : {}),
          ...(nodeSelector ? { nodeSelector } : {}),
          securityContext: secCtx.pod,
          initContainers: [
            {
              name: "config-init",
              image: "busybox:1.36",
              command: ["sh", "-c", configInitScript],
              securityContext: secCtx.initContainer,
              resources: {
                requests: { cpu: "50m", memory: "32Mi" },
                limits: { cpu: "200m", memory: "64Mi" },
              },
              volumeMounts: [
                { name: "data", mountPath: "/data" },
                ...(hasConfigMap ? [{ name: "config-source", mountPath: "/config-source", readOnly: true }] : []),
              ],
            },
          ],
          containers: [{
            name: "runtime",
            image: containerImage,
            ports: [{
              containerPort: gatewayPort,
              name: "gateway",
            }],
            resources: {
              requests: { cpu: cpuRequestMillicores, memory: "512Mi", "ephemeral-storage": "100Mi" },
              limits: { cpu: cpuMillicores, memory: adjustedMemoryMi, "ephemeral-storage": "1Gi" },
            },
            securityContext: secCtx.container,
            envFrom: [{ secretRef: { name: `secret-${deploymentId}` } }],
            volumeMounts: [
              { name: "data", mountPath: "/data" },
              { name: "tmp", mountPath: "/tmp" },
            ],
            livenessProbe: {
              httpGet: {
                path: "/healthz",
                port: gatewayPort,
              },
              initialDelaySeconds: 90,
              periodSeconds: 30,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
            readinessProbe: {
              httpGet: {
                path: "/healthz",
                port: gatewayPort,
              },
              initialDelaySeconds: 10,
              periodSeconds: 5,
              timeoutSeconds: 3,
              failureThreshold: 3,
            },
          }],
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: `pvc-${deploymentId}` } },
            { name: "tmp", emptyDir: { sizeLimit: "1Gi" } },
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
    log.error({ deploymentId, pvcCreated, secretCreated, configMapCreated, error: errorMessage }, "K8s: createDeployment failed, rolling back");
    try {
      if (configMapCreated) {
        await deleteDeploymentConfigMap(deploymentId);
      }
    } catch (cleanupErr) {
      log.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete ConfigMap");
    }
    try {
      if (secretCreated) {
        await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
      }
    } catch (cleanupErr) {
      log.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete secret");
    }
    try {
      if (pvcCreated) {
        await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
      }
    } catch (cleanupErr) {
      log.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete PVC");
    }
    throw err;
  }

  const createDurationMs = Date.now() - createStartMs;
  log.info({ deploymentId, durationMs: createDurationMs }, "K8s: deployment created successfully");
}

// ── Stop / Start ────────────────────────────────────────────────────────

/**
 * Stop a deployment.
 * Legacy: scale replicas to 0. Operator: delete CR (PVC is retained).
 */
export async function stopDeployment(deploymentId: string, managedBy: ManagedBy = "legacy"): Promise<void> {
  if (managedBy === "operator") {
    log.info({ deploymentId, mode: "operator" }, "Stopping deployment (deleting CR)");
    await deleteOpenClawInstance(deploymentId);
    log.info({ deploymentId }, "Deployment stopped (CR deleted, PVC retained)");
    return;
  }

  log.info({ deploymentId }, "Stopping deployment (scaling to 0)");
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
  log.info({ deploymentId }, "Deployment stopped");
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
    log.info({ deploymentId, mode: "operator" }, "Starting deployment (recreating CR with existingClaim)");
    // Operator-managed PVC is named `dep-{id}-data` by convention
    const pvcName = `dep-${deploymentId}-data`;
    await createOpenClawInstance(deploymentId, userId, config, pvcName);
    log.info({ deploymentId }, "Deployment started (CR recreated)");
    return;
  }

  log.info({ deploymentId }, "Starting deployment (scaling to 1)");
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
  log.info({ deploymentId }, "Deployment started");
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
  log.info({ deploymentId, mode: managedBy }, "K8s: restarting deployment");

  await stopDeployment(deploymentId, managedBy);

  // Wait for the pod to fully terminate before starting a new one.
  // With terminationGracePeriodSeconds: 10, pods terminate in ~2-5s typically.
  // Use aggressive initial polling (500ms) then back off to 1s.
  const maxWaitMs = 30_000;
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < maxWaitMs) {
    const status = await getDeploymentPodStatus(deploymentId, managedBy);
    if (status.status === "not_found") break;
    pollCount++;
    // First 5 polls at 500ms (fast path for typical 2-5s termination), then 1s
    const pollMs = pollCount <= 5 ? 500 : 1000;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  await startDeployment(deploymentId, managedBy, userId, config);

  const restartDurationMs = Date.now() - restartStartMs;
  log.info({ deploymentId, durationMs: restartDurationMs }, "K8s: deployment restarted");
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
  log.info({ deploymentId, mode: "operator" }, "K8s: deleteDeployment starting (operator)");

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
    log.debug({ deploymentId }, "deleteDeployment (operator): Secret deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode !== 404) throw err;
  }

  // 4. Delete ConfigMap (not managed by operator)
  await deleteDeploymentConfigMap(deploymentId);

  // 5. Delete retained PVC (operator names it `dep-{id}-data`)
  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`dep-${deploymentId}-data`, NAMESPACE);
    log.debug({ deploymentId }, "deleteDeployment (operator): PVC deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode !== 404) throw err;
  }

  const deleteDurationMs = Date.now() - deleteStartMs;
  log.info({ deploymentId, durationMs: deleteDurationMs }, "K8s: deleteDeployment completed (operator)");
}

async function deleteDeploymentLegacy(deploymentId: string): Promise<void> {
  const deleteStartMs = Date.now();
  log.info({ deploymentId }, "K8s: deleteDeployment starting");

  // Step 1: Scale to 0 so the pod releases the RWO PVC before we delete it.
  log.debug({ deploymentId }, "deleteDeployment: scaling to 0 replicas");
  try {
    await appsApi.patchNamespacedDeployment(
      `dep-${deploymentId}`,
      NAMESPACE,
      { spec: { replicas: 0 } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
    log.debug({ deploymentId }, "deleteDeployment: scaled to 0, waiting for pod termination");

    const maxWaitMs = 30_000;
    const pollMs = 2_000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const status = await getDeploymentPodStatus(deploymentId);
      log.debug({ deploymentId, podStatus: status.status }, "deleteDeployment: polling pod status");
      if (status.status === "not_found") {
        log.debug({ deploymentId }, "deleteDeployment: pod terminated");
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      log.debug({ deploymentId }, "deleteDeployment: K8s deployment not found (already stopped/never created), skipping scale-down");
    } else {
      log.warn({ deploymentId, err }, "deleteDeployment: failed to scale down before delete — proceeding anyway");
    }
  }

  // Step 3: Delete K8s Deployment
  log.debug({ deploymentId }, "deleteDeployment: deleting K8s Deployment");
  try {
    await appsApi.deleteNamespacedDeployment(`dep-${deploymentId}`, NAMESPACE);
    log.debug({ deploymentId }, "deleteDeployment: K8s Deployment deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      log.debug({ deploymentId }, "deleteDeployment: K8s Deployment already gone (404)");
    } else {
      log.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s Deployment");
      throw err;
    }
  }

  // Step 4: Delete K8s Secret
  log.debug({ deploymentId }, "deleteDeployment: deleting K8s Secret");
  try {
    await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    log.debug({ deploymentId }, "deleteDeployment: K8s Secret deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      log.debug({ deploymentId }, "deleteDeployment: K8s Secret already gone (404)");
    } else {
      log.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s Secret");
      throw err;
    }
  }

  // Step 5: Delete ConfigMap
  log.debug({ deploymentId }, "deleteDeployment: deleting K8s ConfigMap");
  await deleteDeploymentConfigMap(deploymentId);

  // Step 6: Delete PVC (data is gone — intentional)
  log.debug({ deploymentId }, "deleteDeployment: deleting K8s PVC");
  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
    log.debug({ deploymentId }, "deleteDeployment: K8s PVC deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      log.debug({ deploymentId }, "deleteDeployment: K8s PVC already gone (404)");
    } else {
      log.error({ deploymentId, err }, "deleteDeployment: failed to delete K8s PVC");
      throw err;
    }
  }

  const deleteDurationMs = Date.now() - deleteStartMs;
  log.info({ deploymentId, durationMs: deleteDurationMs }, "K8s: deleteDeployment completed, all resources deleted");
}
