import * as k8s from "@kubernetes/client-node";
import crypto from "crypto";
import stream from "stream";
import archiver from "archiver";
import { logger } from "../utils/logger.js";
import type { ConfigFile, ConfigFileSpec } from "../runtimes/types.js";

// ── Mock Mode for Local Development ────────────────────────────────────
// When MOCK_K8S=true, all K8s operations are simulated with in-memory storage.
// This allows testing config sync without a real cluster.

const MOCK_K8S = process.env.MOCK_K8S === "true";

// In-memory mock storage: deploymentId -> { files, secrets, status, logs }
interface MockDeployment {
  files: Map<string, string>;           // path -> content (PVC simulation)
  secrets: Record<string, string>;      // K8s Secret env vars
  status: "pending" | "creating" | "running" | "stopped" | "failed";
  replicas: number;
  logs: string[];
  config: {
    image: string;
    cpuLimit: string;
    memoryMb: number;
    storageMb: number;
  };
}

const mockStore = new Map<string, MockDeployment>();

// Export for debug endpoint
export function getMockStore(): Map<string, MockDeployment> {
  return mockStore;
}

// Export mock file contents for a deployment (for debug endpoint)
export function getMockPvcFiles(deploymentId: string): Record<string, string> | null {
  const deployment = mockStore.get(deploymentId);
  if (!deployment) return null;
  return Object.fromEntries(deployment.files);
}

// Export all mock deployments info (for debug endpoint)
export function getMockDeployments(): Record<string, { status: string; replicas: number; fileCount: number; secrets: string[] }> {
  const result: Record<string, { status: string; replicas: number; fileCount: number; secrets: string[] }> = {};
  for (const [id, dep] of mockStore) {
    result[id] = {
      status: dep.status,
      replicas: dep.replicas,
      fileCount: dep.files.size,
      secrets: Object.keys(dep.secrets),
    };
  }
  return result;
}

if (MOCK_K8S) {
  logger.info("🎭 K8s mock mode enabled - no real cluster operations will be performed");
}

// Initialize K8s client (only if not in mock mode)
let kc: k8s.KubeConfig | null = null;
let coreApi: k8s.CoreV1Api | null = null;
let appsApi: k8s.AppsV1Api | null = null;
let exec: k8s.Exec | null = null;

if (!MOCK_K8S) {
  kc = new k8s.KubeConfig();

  // Load config - in-cluster when deployed, local kubeconfig for dev
  if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
  } else {
    kc.loadFromDefault();
  }

  coreApi = kc.makeApiClient(k8s.CoreV1Api);
  appsApi = kc.makeApiClient(k8s.AppsV1Api);
  exec = new k8s.Exec(kc);
}

const NAMESPACE = "jarble";
const DEFAULT_IMAGE = "ghcr.io/jarble-ai/openclaw:latest";

interface DeploymentConfig {
  name: string;
  template?: string;
  platform?: string;
  runtime?: string;
  image?: string;
  cpuLimit?: string;     // e.g. "2.0" — vCPU allocation
  memoryMb?: number;     // e.g. 2048 — RAM in MB
  storageMb?: number;    // e.g. 30 — persistent storage in GB (historical naming)
  containerPort?: number;  // Runtime-specific gateway port (openclaw: 18789, zeroclaw: 3000)
  initialConfigs?: ConfigFile[];              // Config files to write to PVC after pod starts
  extraSecretEntries?: Record<string, string>; // Additional K8s Secret env vars from runtime handler
}

// Default gateway ports per runtime
const RUNTIME_PORTS: Record<string, number> = {
  openclaw: 18789,
  zeroclaw: 3000,
};

export async function createDeployment(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  logger.info({ deploymentId, userId }, "Creating deployment");

  // Mock mode: simulate deployment creation
  if (MOCK_K8S) {
    const mockDep: MockDeployment = {
      files: new Map(),
      secrets: {
        DEPLOYMENT_ID: deploymentId,
        USER_ID: userId,
        DEPLOYMENT_NAME: config.name,
        TEMPLATE: config.template || "personal",
        RUNTIME: config.runtime || "openclaw",
        ...(config.extraSecretEntries ?? {}),
      },
      status: "running",
      replicas: 1,
      logs: [`[${new Date().toISOString()}] 🎭 Mock deployment created`],
      config: {
        image: config.image || DEFAULT_IMAGE,
        cpuLimit: config.cpuLimit || "2.0",
        memoryMb: config.memoryMb || 3072,
        storageMb: config.storageMb || 30,
      },
    };
    mockStore.set(deploymentId, mockDep);

    // Write initial config files to mock PVC
    if (config.initialConfigs && config.initialConfigs.length > 0) {
      for (const file of config.initialConfigs) {
        mockDep.files.set(file.path, file.content);
        mockDep.logs.push(`[${new Date().toISOString()}] Wrote config: ${file.path}`);
        logger.info({ deploymentId, path: file.path }, "🎭 Mock: Wrote config file to PVC");
      }
    }

    logger.info({ deploymentId }, "🎭 Mock: Deployment created successfully");
    return;
  }

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
  await coreApi!.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${deploymentId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn",
      resources: { requests: { storage: storageGi } },
    },
  });
  pvcCreated = true;

  // 2. Create Secret for deployment env vars
  // Base entries are always included; runtime handler provides extras (e.g. LLM keys)
  // Generate a gateway token for OpenClaw auth
  const gatewayToken = crypto.randomBytes(32).toString("hex");
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

  await coreApi!.createNamespacedSecret(NAMESPACE, {
    metadata: { name: `secret-${deploymentId}` },
    stringData: secretData,
  });
  secretCreated = true;

  // 3. Create Deployment
  await appsApi!.createNamespacedDeployment(NAMESPACE, {
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
          initContainers: [{
            name: "fix-permissions",
            image: "busybox:1.36",
            command: ["sh", "-c", "mkdir -p /data/runtime /data/config /data/logs /data/.openclaw /data/.npm && chown -R 1000:1000 /data && chmod -R 755 /data"],
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
              { name: "npm-cache", mountPath: "/.npm" }, // npm cache dir for non-root user
            ],
            // Liveness probe: restart pod if OpenClaw gateway stops responding
            livenessProbe: {
              tcpSocket: {
                port: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              },
              initialDelaySeconds: 180, // Wait 3 min for first boot (npm install)
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
            { name: "npm-cache", emptyDir: {} }, // Ephemeral npm cache
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
        await coreApi!.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
      }
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete secret");
    }
    try {
      if (pvcCreated) {
        await coreApi!.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
      }
    } catch (cleanupErr) {
      logger.warn({ deploymentId, cleanupErr }, "Rollback: failed to delete PVC");
    }
    throw err;
  }

  // 4. Write initial config files to PVC (fire-and-forget — don't block deployment return)
  // On first boot, npm install takes ~3 min so the pod won't be ready for a while.
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

  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (mockDep) {
      mockDep.status = "stopped";
      mockDep.replicas = 0;
      mockDep.logs.push(`[${new Date().toISOString()}] Deployment stopped`);
    }
    logger.info({ deploymentId }, "🎭 Mock: Deployment stopped");
    return;
  }

  await appsApi!.patchNamespacedDeployment(
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

  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (mockDep) {
      mockDep.status = "running";
      mockDep.replicas = 1;
      mockDep.logs.push(`[${new Date().toISOString()}] Deployment started`);
    }
    logger.info({ deploymentId }, "🎭 Mock: Deployment started");
    return;
  }

  await appsApi!.patchNamespacedDeployment(
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

  if (MOCK_K8S) {
    mockStore.delete(deploymentId);
    logger.info({ deploymentId }, "🎭 Mock: Deployment deleted");
    return;
  }

  // Step 1: Scale to 0 so the pod releases the RWO PVC before we delete it.
  logger.debug({ deploymentId }, "deleteDeployment: scaling to 0 replicas");
  try {
    await appsApi!.patchNamespacedDeployment(
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
    await appsApi!.deleteNamespacedDeployment(`dep-${deploymentId}`, NAMESPACE);
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
    await coreApi!.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
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
    await coreApi!.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
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

export interface DeploymentPodStatus {
  status: "creating" | "running" | "failed" | "not_found";
  phase?: string;
  restarts?: number;
  error?: string;
}

export async function getDeploymentPodStatus(deploymentId: string): Promise<DeploymentPodStatus> {
  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep) {
      return { status: "not_found" };
    }
    if (mockDep.status === "running") {
      return { status: "running", phase: "Running", restarts: 0 };
    }
    if (mockDep.status === "stopped") {
      return { status: "not_found" }; // No pod when stopped
    }
    if (mockDep.status === "failed") {
      return { status: "failed", error: "Mock failure" };
    }
    return { status: "creating", phase: "Pending" };
  }

  try {
    const pods = await coreApi!.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=dep-${deploymentId}`
    );

    if (pods.body.items.length === 0) {
      return { status: "not_found" };
    }

    const pod = pods.body.items[0];
    const phase = pod.status?.phase;
    const containerStatus = pod.status?.containerStatuses?.[0];

    // Check for errors
    if (containerStatus?.state?.waiting?.reason) {
      const reason = containerStatus.state.waiting.reason;
      if (["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull"].includes(reason)) {
        return {
          status: "failed",
          phase,
          error: `${reason}: ${containerStatus.state.waiting.message || ""}`,
          restarts: containerStatus.restartCount,
        };
      }
    }

    // Too many restarts = failed
    if ((containerStatus?.restartCount || 0) >= 5) {
      return {
        status: "failed",
        phase,
        error: "Too many restarts",
        restarts: containerStatus?.restartCount,
      };
    }

    // Running and ready
    if (phase === "Running" && containerStatus?.ready) {
      return {
        status: "running",
        phase: "Running",
        restarts: containerStatus.restartCount,
      };
    }

    // Still creating
    return {
      status: "creating",
      phase,
    };
  } catch (err) {
    logger.error({ deploymentId, err }, "Failed to get pod status");
    return { status: "not_found" };
  }
}

// ── Storage Usage ──────────────────────────────────────────────────

export interface StorageUsage {
  usedBytes: number;
  totalBytes: number;
  usedGb: number;
  totalGb: number;
  percentUsed: number;
}

/**
 * Get storage usage for a deployment by exec-ing `df` inside the running pod.
 * Returns null if the pod isn't running or the command fails.
 */
export async function getDeploymentStorageUsage(deploymentId: string): Promise<StorageUsage | null> {
  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep || mockDep.status !== "running") {
      return null;
    }
    // Calculate mock storage usage based on file contents
    let usedBytes = 0;
    for (const content of mockDep.files.values()) {
      usedBytes += Buffer.byteLength(content, "utf8");
    }
    const GB = 1024 * 1024 * 1024;
    const totalBytes = mockDep.config.storageMb * GB; // storageMb is actually GB
    return {
      usedBytes,
      totalBytes,
      usedGb: Math.round((usedBytes / GB) * 100) / 100,
      totalGb: mockDep.config.storageMb,
      percentUsed: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
    };
  }

  try {
    // Find the running pod for this deployment
    const pods = await coreApi!.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=dep-${deploymentId}`
    );

    if (pods.body.items.length === 0) {
      return null;
    }

    const pod = pods.body.items[0];
    const podName = pod.metadata?.name;
    const isRunning = pod.status?.phase === "Running" && pod.status?.containerStatuses?.[0]?.ready;

    if (!podName || !isRunning) {
      return null;
    }

    // Exec `df /data` inside the container to get filesystem usage
    // Output format: "Filesystem 1K-blocks Used Available Use% Mounted on"
    const stdout = new stream.PassThrough();
    const stderr = new stream.PassThrough();

    let stdoutData = "";
    let stderrData = "";
    stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
    stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

    await new Promise<void>((resolve, reject) => {
      exec!.exec(
        NAMESPACE,
        podName,
        "runtime",
        ["df", "-B1", "/data"],  // -B1 = output in bytes
        stdout,
        stderr,
        null,
        false,
        (status) => {
          if (status.status === "Success") {
            resolve();
          } else {
            reject(new Error(`df command failed: ${status.message || "unknown"}`));
          }
        }
      ).catch(reject);
    });

    if (stderrData) {
      logger.warn({ deploymentId, stderr: stderrData }, "df command stderr");
    }

    // Parse df output (second line contains the data)
    // Example: "/dev/longhorn/pvc-xxx 21474836480 1048576 21473787904 1% /data"
    const lines = stdoutData.trim().split("\n");
    if (lines.length < 2) {
      logger.warn({ deploymentId, output: stdoutData }, "Unexpected df output");
      return null;
    }

    const parts = lines[1].trim().split(/\s+/);
    // parts: [filesystem, total, used, available, use%, mountpoint]
    if (parts.length < 6) {
      logger.warn({ deploymentId, output: stdoutData }, "Could not parse df output");
      return null;
    }

    const totalBytes = parseInt(parts[1], 10);
    const usedBytes = parseInt(parts[2], 10);

    if (isNaN(totalBytes) || isNaN(usedBytes)) {
      return null;
    }

    const GB = 1024 * 1024 * 1024;
    return {
      usedBytes,
      totalBytes,
      usedGb: Math.round((usedBytes / GB) * 100) / 100,
      totalGb: Math.round((totalBytes / GB) * 100) / 100,
      percentUsed: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
    };
  } catch (err) {
    logger.error({ deploymentId, err }, "Failed to get storage usage");
    return null;
  }
}

// ── Config Export (ZIP) ──────────────────────────────────────────────

/**
 * Export all user config files from a running deployment as a ZIP archive.
 * Reads `/data/config/` from the pod, builds a ZIP in memory, returns as base64.
 */
export async function exportDeploymentConfigs(deploymentId: string): Promise<{ filename: string; data: string }> {
  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep) {
      throw new Error(`Mock deployment ${deploymentId} not found`);
    }
    if (mockDep.files.size === 0) {
      throw new Error("No config files found in mock PVC");
    }

    // Build ZIP archive from mock files
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);

      for (const [path, content] of mockDep.files) {
        archive.append(content, { name: path });
      }
      archive.finalize();
    });

    const filename = `config-${deploymentId}.zip`;
    logger.info({ deploymentId, fileCount: mockDep.files.size, sizeBytes: zipBuffer.length }, "🎭 Mock: Exported deployment configs");

    return { filename, data: zipBuffer.toString("base64") };
  }

  // Find the running pod
  const pods = await coreApi!.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error(`No pods found for deployment ${deploymentId}`);
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  const isRunning = pod.status?.phase === "Running" && pod.status?.containerStatuses?.[0]?.ready;

  if (!podName || !isRunning) {
    throw new Error("Pod is not running — cannot export configs");
  }

  // List all config files in /data/config/
  const fileListOutput = await execInPod(podName, ["find", "/data/config", "-type", "f"]);
  const filePaths = fileListOutput.trim().split("\n").filter(Boolean);

  if (filePaths.length === 0) {
    throw new Error("No config files found in /data/config/");
  }

  // Read each file's content via exec
  const files: Array<{ path: string; content: string }> = [];
  for (const fullPath of filePaths) {
    try {
      const content = await execInPod(podName, ["cat", fullPath]);
      // Strip the /data/config/ prefix for archive paths
      const relativePath = fullPath.replace(/^\/data\/config\//, "");
      files.push({ path: relativePath, content });
    } catch (err) {
      logger.warn({ deploymentId, path: fullPath, err }, "Skipping unreadable config file");
    }
  }

  if (files.length === 0) {
    throw new Error("All config files were unreadable");
  }

  // Build ZIP archive in memory
  const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const file of files) {
      archive.append(file.content, { name: file.path });
    }

    archive.finalize();
  });

  const filename = `config-${deploymentId}.zip`;
  logger.info({ deploymentId, fileCount: files.length, sizeBytes: zipBuffer.length }, "Exported deployment configs");

  return {
    filename,
    data: zipBuffer.toString("base64"),
  };
}

// ── Config File Writing ───────────────────────────────────────────────

/**
 * Write config files to a deployment's PVC by exec-ing into the running pod.
 * Files are written to /data/config/{path} — the config/ subdirectory keeps
 * Jarble-managed configs separate from runtime data (node_modules, etc.).
 *
 * Exported so the deployment router can call this for config updates (Phase 2).
 */
export async function writeConfigsToPvc(
  deploymentId: string,
  files: ConfigFile[]
): Promise<void> {
  if (files.length === 0) return;

  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep) {
      throw new Error(`Mock deployment ${deploymentId} not found`);
    }
    for (const file of files) {
      mockDep.files.set(file.path, file.content);
      mockDep.logs.push(`[${new Date().toISOString()}] Config updated: ${file.path}`);
      logger.info({ deploymentId, path: file.path }, "🎭 Mock: Wrote config file to PVC");
    }
    return;
  }

  // Find the running pod
  const pods = await coreApi!.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error(`No pods found for deployment ${deploymentId}`);
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  for (const file of files) {
    // Config files go under /data/config/ — handler paths are relative (e.g. "soul.md")
    const filePath = `/data/config/${file.path}`;

    // Ensure parent directory exists (e.g. /data/config/skills/)
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir && dir !== "/data/config") {
      await execInPod(podName, ["mkdir", "-p", dir]);
    }

    // Write file content via stdin pipe (use tee to avoid shell injection via filePath)
    await execInPodWithStdin(podName, ["tee", filePath], file.content);

    logger.info({ deploymentId, path: file.path }, "Wrote config file to PVC");
  }
}

/**
 * Execute a command in a pod (no stdin, capture stdout/stderr).
 */
export async function execInPod(podName: string, command: string[]): Promise<string> {
  if (MOCK_K8S) {
    // Mock exec - just return empty string for most commands
    const cmd = command.join(" ");
    logger.debug({ podName, cmd }, "🎭 Mock: execInPod");
    if (cmd.includes("find")) {
      return ""; // No files found
    }
    if (cmd.includes("cat")) {
      return ""; // Empty file content
    }
    return "";
  }

  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();

  let stdoutData = "";
  let stderrData = "";
  stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
  stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  await new Promise<void>((resolve, reject) => {
    exec!.exec(
      NAMESPACE,
      podName,
      "runtime",
      command,
      stdout,
      stderr,
      null,
      false,
      (status) => {
        if (status.status === "Success") {
          resolve();
        } else {
          reject(new Error(`exec failed: ${status.message || stderrData || "unknown"}`));
        }
      }
    ).catch(reject);
  });

  return stdoutData;
}

/**
 * Find the running pod for a deployment.
 * Returns the pod name or null if no pod exists.
 *
 * @param requireReady - if true (default), pod must pass readiness probe.
 *   For exec operations (e.g. pairing commands), set false — the pod just needs
 *   to be in Running phase so we can exec into it. The readiness probe (TCP 18789)
 *   may still be failing even after OpenClaw has started and is responding to messages.
 */
export async function findPodForDeployment(
  deploymentId: string,
  opts?: { requireReady?: boolean }
): Promise<string | null> {
  const requireReady = opts?.requireReady ?? true;

  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep || mockDep.status !== "running") {
      return null;
    }
    return `mock-pod-${deploymentId}`;
  }

  const pods = await coreApi!.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) return null;

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  const isRunning = pod.status?.phase === "Running" &&
    (requireReady ? pod.status?.containerStatuses?.[0]?.ready : true);

  if (!podName || !isRunning) return null;
  return podName;
}

/**
 * Execute a command in a pod with streaming stdout (long-running processes).
 * Unlike execInPod() which waits for exit, this streams output line-by-line.
 * Returns an abort handle to terminate the exec WebSocket.
 */
export async function streamExecInPod(
  podName: string,
  command: string[],
  onLine: (line: string) => void,
  onExit: (success: boolean, message?: string) => void
): Promise<{ abort: () => void }> {
  if (MOCK_K8S) {
    // Mock streaming - emit a few lines then exit
    setTimeout(() => {
      onLine(`[Mock] Executing: ${command.join(" ")}`);
      onLine(`[Mock] Stream started for ${podName}`);
    }, 100);
    setTimeout(() => {
      onExit(true, "Mock stream ended");
    }, 500);
    return { abort: () => {} };
  }

  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();
  let buffer = "";

  stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        onLine(line);
      }
    }
  });

  let stderrData = "";
  stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  let execWs: any;
  try {
    execWs = await exec!.exec(
      NAMESPACE,
      podName,
      "runtime",
      command,
      stdout,
      stderr,
      null,
      false,
      (status) => {
        // Flush remaining buffer
        if (buffer.trim()) {
          onLine(buffer);
          buffer = "";
        }
        onExit(status.status === "Success", status.message || stderrData || undefined);
      }
    );
  } catch (err: any) {
    onExit(false, err.message || "exec failed to start");
    return { abort: () => {} };
  }

  return {
    abort: () => {
      try { execWs?.close?.(); } catch {}
    },
  };
}

/**
 * Execute a command in a pod with stdin content piped in.
 * Used for writing file contents via `cat > /path`.
 */
async function execInPodWithStdin(
  podName: string,
  command: string[],
  stdinContent: string,
  timeoutMs: number = 30000
): Promise<void> {
  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();

  // Create a Readable stream from the content for stdin
  const stdinStream = new stream.Readable();
  stdinStream.push(stdinContent);
  stdinStream.push(null); // signal EOF

  let stderrData = "";
  stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

  await new Promise<void>((resolve, reject) => {
    // Add timeout to prevent hanging forever
    const timeout = setTimeout(() => {
      reject(new Error(`execInPodWithStdin timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    exec!.exec(
      NAMESPACE,
      podName,
      "runtime",
      command,
      stdout,
      stderr,
      stdinStream,
      false,
      (status) => {
        clearTimeout(timeout);
        if (status.status === "Success") {
          resolve();
        } else {
          reject(new Error(`exec failed: ${status.message || stderrData || "unknown"}`));
        }
      }
    ).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ── Secret Updates ─────────────────────────────────────────────────────

/**
 * Replace the K8s Secret for a deployment with updated stringData.
 * Uses replaceNamespacedSecret (not patch) to ensure removed env vars
 * are cleaned out (e.g., when a platform credential is deleted).
 */
export async function updateDeploymentSecret(
  deploymentId: string,
  userId: string,
  name: string,
  runtime: string,
  secretEntries: Record<string, string>,
  template?: string,
): Promise<void> {
  const baseData: Record<string, string> = {
    DEPLOYMENT_ID: deploymentId,
    USER_ID: userId,
    DEPLOYMENT_NAME: name,
    TEMPLATE: template || "personal",
    RUNTIME: runtime,
  };

  // Include JARBLE_API_URL for file watcher callback
  if (process.env.JARBLE_API_URL) {
    baseData.JARBLE_API_URL = process.env.JARBLE_API_URL;
  }
  // Include CONFIG_WEBHOOK_SECRET for authenticated config-changed callbacks
  if (process.env.CONFIG_WEBHOOK_SECRET) {
    baseData.CONFIG_WEBHOOK_SECRET = process.env.CONFIG_WEBHOOK_SECRET;
  }

  const fullData = { ...baseData, ...secretEntries };

  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (mockDep) {
      mockDep.secrets = fullData;
      mockDep.logs.push(`[${new Date().toISOString()}] Secret updated`);
    }
    logger.info({ deploymentId, entryCount: Object.keys(fullData).length }, "🎭 Mock: K8s Secret updated");
    return;
  }

  await coreApi!.replaceNamespacedSecret(
    `secret-${deploymentId}`,
    NAMESPACE,
    {
      metadata: { name: `secret-${deploymentId}` },
      stringData: fullData,
    }
  );

  logger.info({ deploymentId, entryCount: Object.keys(fullData).length }, "K8s Secret updated");
}

// ── Config File Reading (PVC → DB sync) ────────────────────────────────

/**
 * Read config files from a running pod's PVC.
 * Used for reverse sync: reading what's on the PVC back to the DB.
 *
 * @param deploymentId - Deployment to read from
 * @param configFileSpecs - Which files to read (from runtime handler's configFiles)
 * @returns Array of ConfigFile with current content from PVC
 */
export async function readConfigsFromPvc(
  deploymentId: string,
  configFileSpecs: ConfigFileSpec[]
): Promise<ConfigFile[]> {
  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep) {
      throw new Error(`Mock deployment ${deploymentId} not found`);
    }
    if (mockDep.status !== "running") {
      throw new Error(`Mock deployment ${deploymentId} is not running`);
    }

    const files: ConfigFile[] = [];
    for (const spec of configFileSpecs) {
      if (spec.isGlob) {
        // Glob pattern - find matching files
        const prefix = spec.path.replace("/*", "");
        for (const [path, content] of mockDep.files) {
          if (path.startsWith(prefix)) {
            files.push({ path, content });
          }
        }
      } else {
        // Exact path
        const content = mockDep.files.get(spec.path);
        if (content !== undefined) {
          files.push({ path: spec.path, content });
        }
      }
    }
    return files;
  }

  // Find the running pod
  const pods = await coreApi!.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error(`No pods found for deployment ${deploymentId}`);
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  // Check pod is running
  const isRunning = pod.status?.phase === "Running" && pod.status?.containerStatuses?.[0]?.ready;
  if (!isRunning) {
    throw new Error(`Pod ${podName} is not ready`);
  }

  const files: ConfigFile[] = [];

  for (const spec of configFileSpecs) {
    if (spec.isGlob) {
      // Glob pattern (e.g., "skills/*") — find all matching files
      const basePath = `/data/config/${spec.path.replace("/*", "")}`;
      try {
        const findOutput = await execInPod(podName, ["find", basePath, "-type", "f"]);
        const filePaths = findOutput.trim().split("\n").filter(Boolean);

        for (const fullPath of filePaths) {
          try {
            const content = await execInPod(podName, ["cat", fullPath]);
            const relativePath = fullPath.replace(/^\/data\/config\//, "");
            files.push({ path: relativePath, content });
          } catch (err) {
            logger.warn({ deploymentId, path: fullPath, err }, "Failed to read config file from PVC");
          }
        }
      } catch {
        // Directory doesn't exist yet — that's fine
        logger.debug({ deploymentId, path: basePath }, "Config directory not found on PVC");
      }
    } else {
      // Exact file path (e.g., "soul.md")
      const filePath = `/data/config/${spec.path}`;
      try {
        const content = await execInPod(podName, ["cat", filePath]);
        files.push({ path: spec.path, content });
      } catch {
        // File doesn't exist — that's fine (e.g., no soul.md set)
        logger.debug({ deploymentId, path: spec.path }, "Config file not found on PVC");
      }
    }
  }

  return files;
}

// ── Deployment Logs ──────────────────────────────────────────────────

export interface DeploymentLogsResult {
  logs: string;
  podName: string;
}

/**
 * One-shot fetch of the last N lines of logs from a deployment pod.
 * Used for initial log load on the Logs tab.
 */
export async function getDeploymentLogs(
  deploymentId: string,
  tailLines: number = 200
): Promise<DeploymentLogsResult> {
  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep) {
      throw new Error("No pods found for this deployment");
    }
    const logs = mockDep.logs.slice(-tailLines).join("\n");
    return { logs, podName: `mock-pod-${deploymentId}` };
  }

  const pods = await coreApi!.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error("No pods found for this deployment");
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  const response = await coreApi!.readNamespacedPodLog(
    podName,
    NAMESPACE,
    "runtime",     // container
    undefined,     // follow
    undefined,     // insecureSkipTLSVerifyBackend
    undefined,     // limitBytes
    undefined,     // pretty
    false,         // previous
    undefined,     // sinceSeconds
    tailLines,
    undefined      // timestamps
  );

  return {
    logs: typeof response.body === "string" ? response.body : "",
    podName,
  };
}

/**
 * Stream logs from a deployment pod in real-time.
 * Pipes log output into the provided Writable stream with follow=true.
 * Returns the underlying HTTP request so the caller can abort it on disconnect.
 */
export async function streamDeploymentLogs(
  deploymentId: string,
  writable: stream.Writable,
  options: { tailLines?: number } = {}
): Promise<{ podName: string; abort: () => void }> {
  if (MOCK_K8S) {
    const mockDep = mockStore.get(deploymentId);
    if (!mockDep) {
      throw new Error("No pods found for this deployment");
    }
    if (mockDep.status !== "running") {
      throw new Error("Pod is not running");
    }

    // Write existing logs
    const logs = mockDep.logs.slice(-(options.tailLines ?? 100)).join("\n") + "\n";
    writable.write(logs);

    // Set up interval to write new mock logs
    const interval = setInterval(() => {
      const ts = new Date().toISOString();
      const line = `${ts} [Mock] Heartbeat from ${deploymentId}\n`;
      mockDep.logs.push(line.trim());
      writable.write(line);
    }, 5000);

    return {
      podName: `mock-pod-${deploymentId}`,
      abort: () => clearInterval(interval),
    };
  }

  const pods = await coreApi!.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error("No pods found for this deployment");
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  const isRunning = pod.status?.phase === "Running"
    && pod.status?.containerStatuses?.[0]?.ready;
  if (!isRunning) {
    throw new Error("Pod is not running");
  }

  const log = new k8s.Log(kc!);
  const request = await log.log(NAMESPACE, podName, "runtime", writable, {
    follow: true,
    tailLines: options.tailLines ?? 100,
    timestamps: true,
  });

  return {
    podName,
    abort: () => {
      if (request && typeof request.abort === "function") {
        request.abort();
      }
    },
  };
}
