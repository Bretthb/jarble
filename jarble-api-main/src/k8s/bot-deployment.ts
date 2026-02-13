import * as k8s from "@kubernetes/client-node";
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

const NAMESPACE = "jarble";
const BOT_IMAGE = "jarble/bot-base:latest";

interface BotConfig {
  name: string;
  template?: string;
  platform?: string;
}

export async function createBotDeployment(
  botId: string,
  userId: string,
  config: BotConfig
): Promise<void> {
  logger.info({ botId, userId }, "Creating bot deployment");

  // 1. Create PVC for bot storage
  await coreApi.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${botId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn",
      resources: { requests: { storage: "5Gi" } },
    },
  });

  // 2. Create Secret for bot env vars
  await coreApi.createNamespacedSecret(NAMESPACE, {
    metadata: { name: `secret-${botId}` },
    stringData: {
      BOT_ID: botId,
      USER_ID: userId,
      BOT_NAME: config.name,
      TEMPLATE: config.template || "personal",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    },
  });

  // 3. Create Deployment
  await appsApi.createNamespacedDeployment(NAMESPACE, {
    metadata: { 
      name: `bot-${botId}`,
      labels: { app: `bot-${botId}`, "jarble.ai/bot-id": botId },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: `bot-${botId}` } },
      template: {
        metadata: { labels: { app: `bot-${botId}` } },
        spec: {
          containers: [{
            name: "openclaw",
            image: BOT_IMAGE,
            resources: {
              requests: { cpu: "500m", memory: "2Gi" },
              limits: { cpu: "1000m", memory: "4Gi" },
            },
            envFrom: [{ secretRef: { name: `secret-${botId}` } }],
            volumeMounts: [{ name: "data", mountPath: "/data" }],
          }],
          volumes: [{
            name: "data",
            persistentVolumeClaim: { claimName: `pvc-${botId}` },
          }],
        },
      },
    },
  });

  logger.info({ botId }, "Bot deployment created successfully");
}

export async function deleteBotDeployment(botId: string): Promise<void> {
  logger.info({ botId }, "Deleting bot deployment");

  try {
    // Delete in order: Deployment, Secret, PVC
    await appsApi.deleteNamespacedDeployment(`bot-${botId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  try {
    await coreApi.deleteNamespacedSecret(`secret-${botId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  try {
    await coreApi.deleteNamespacedPersistentVolumeClaim(`pvc-${botId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  logger.info({ botId }, "Bot deployment deleted");
}

export interface BotPodStatus {
  status: "creating" | "running" | "failed" | "not_found";
  phase?: string;
  restarts?: number;
  error?: string;
}

export async function getBotPodStatus(botId: string): Promise<BotPodStatus> {
  try {
    const pods = await coreApi.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=bot-${botId}`
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
    logger.error({ botId, err }, "Failed to get pod status");
    return { status: "not_found" };
  }
}
