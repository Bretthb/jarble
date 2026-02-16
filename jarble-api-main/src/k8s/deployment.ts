import * as k8s from "@kubernetes/client-node";
import stream from "stream";
import { logger } from "../utils/logger.js";

// Initialize K8s client
const kc = new k8s.KubeConfig();

// Load config - in-cluster when deployed, local kubeconfig for dev
if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const exec = new k8s.Exec(kc);

const NAMESPACE = "jarble";
const DEFAULT_IMAGE = "jarble/bot-base:latest";

interface DeploymentConfig {
  name: string;
  template?: string;
  platform?: string;
  runtime?: string;
  image?: string;
  cpuLimit?: string;     // e.g. "2.0" — vCPU allocation
  memoryMb?: number;     // e.g. 2048 — RAM in MB
  storageMb?: number;    // e.g. 30 — persistent storage in GB (historical naming)
}

export async function createDeployment(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  logger.info({ deploymentId, userId }, "Creating deployment");

  const containerImage = config.image || DEFAULT_IMAGE;

  // Derive resource values from config (with sensible defaults)
  const cpuLimit = config.cpuLimit || "2.0";
  const memoryMb = config.memoryMb || 2048;
  const storageGbVal = config.storageMb || 30; // "storageMb" is actually GB (historical naming)

  // Convert to K8s resource units
  // CPU: "2.0" → "2000m" (millicores). Request = limit (guaranteed QoS).
  const cpuMillicores = `${Math.round(parseFloat(cpuLimit) * 1000)}m`;
  // Memory: MB → "XMi"
  const memoryMi = `${memoryMb}Mi`;
  // Storage: Value is already in GB → "XGi" (minimum 1Gi)
  const storageGi = `${Math.max(1, storageGbVal)}Gi`;

  // 1. Create PVC for deployment storage
  await coreApi.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${deploymentId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn",
      resources: { requests: { storage: storageGi } },
    },
  });

  // 2. Create Secret for deployment env vars
  await coreApi.createNamespacedSecret(NAMESPACE, {
    metadata: { name: `secret-${deploymentId}` },
    stringData: {
      DEPLOYMENT_ID: deploymentId,
      USER_ID: userId,
      DEPLOYMENT_NAME: config.name,
      TEMPLATE: config.template || "personal",
      RUNTIME: config.runtime || "openclaw",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    },
  });

  // 3. Create Deployment
  await appsApi.createNamespacedDeployment(NAMESPACE, {
    metadata: {
      name: `dep-${deploymentId}`,
      labels: { app: `dep-${deploymentId}`, "jarble.ai/deployment-id": deploymentId },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: `dep-${deploymentId}` } },
      template: {
        metadata: { labels: { app: `dep-${deploymentId}` } },
        spec: {
          containers: [{
            name: "runtime",
            image: containerImage,
            resources: {
              requests: { cpu: cpuMillicores, memory: memoryMi },
              limits: { cpu: cpuMillicores, memory: memoryMi },
            },
            envFrom: [{ secretRef: { name: `secret-${deploymentId}` } }],
            volumeMounts: [{ name: "data", mountPath: "/data" }],
          }],
          volumes: [{
            name: "data",
            persistentVolumeClaim: { claimName: `pvc-${deploymentId}` },
          }],
        },
      },
    },
  });

  logger.info({ deploymentId }, "Deployment created successfully");
}

export async function deleteDeployment(deploymentId: string): Promise<void> {
  logger.info({ deploymentId }, "Deleting deployment");

  try {
    // Delete in order: Deployment, Secret, PVC
    await appsApi.deleteNamespacedDeployment(`dep-${deploymentId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  try {
    await coreApi.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  logger.info({ deploymentId }, "Deployment deleted");
}

export interface DeploymentPodStatus {
  status: "creating" | "running" | "failed" | "not_found";
  phase?: string;
  restarts?: number;
  error?: string;
}

export async function getDeploymentPodStatus(deploymentId: string): Promise<DeploymentPodStatus> {
  try {
    const pods = await coreApi.listNamespacedPod(
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
  try {
    // Find the running pod for this deployment
    const pods = await coreApi.listNamespacedPod(
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
      exec.exec(
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
