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
const DEFAULT_IMAGE = "jarble/bot-base:latest";

interface DeploymentConfig {
  name: string;
  template?: string;
  platform?: string;
  runtime?: string;
  image?: string;
}

export async function createDeployment(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig
): Promise<void> {
  logger.info({ deploymentId, userId }, "Creating deployment");

  const containerImage = config.image || DEFAULT_IMAGE;

  // 1. Create PVC for deployment storage
  await coreApi.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${deploymentId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn",
      resources: { requests: { storage: "5Gi" } },
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
              requests: { cpu: "500m", memory: "2Gi" },
              limits: { cpu: "1000m", memory: "4Gi" },
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
