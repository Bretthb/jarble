import * as k8s from "@kubernetes/client-node";
import stream from "stream";
import { createModuleLogger } from "../utils/logger.js";
import { coreApi, kc } from "./client.js";
import { NAMESPACE, getContainerName, podLabelSelector } from "./constants.js";
import type { ManagedBy } from "./constants.js";

const log = createModuleLogger("k8s:logs");

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
  tailLines: number = 200,
  managedBy: ManagedBy = "legacy"
): Promise<DeploymentLogsResult> {
  log.debug({ deploymentId, tailLines }, "getDeploymentLogs");
  const labelSelector = podLabelSelector(deploymentId, managedBy);
  const containerName = getContainerName(managedBy);

  const pods = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    labelSelector
  );

  if (pods.body.items.length === 0) {
    throw new Error("No pods found for this deployment");
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  const response = await coreApi.readNamespacedPodLog(
    podName,
    NAMESPACE,
    containerName,  // container
    undefined,     // follow
    undefined,     // insecureSkipTLSVerifyBackend
    undefined,     // limitBytes
    undefined,     // pretty
    false,         // previous
    undefined,     // sinceSeconds
    tailLines,
    undefined      // timestamps
  );

  const result = typeof response.body === "string" ? response.body : "";
  log.debug({ podName, logLength: result.length }, "getDeploymentLogs complete");
  return {
    logs: result,
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
  options: { tailLines?: number; managedBy?: ManagedBy } = {}
): Promise<{ podName: string; abort: () => void }> {
  log.debug({ deploymentId }, "streamDeploymentLogs");
  const managedBy = options.managedBy ?? "legacy";
  const labelSelector = podLabelSelector(deploymentId, managedBy);
  const containerName = getContainerName(managedBy);

  const pods = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    labelSelector
  );

  if (pods.body.items.length === 0) {
    throw new Error("No pods found for this deployment");
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  const targetContainer = getContainerName(managedBy);
  const containerStatus = pod.status?.containerStatuses?.find(
    (cs) => cs.name === targetContainer
  ) ?? pod.status?.containerStatuses?.[0];
  const isRunning = pod.status?.phase === "Running" && containerStatus?.ready;
  if (!isRunning) {
    log.warn({ deploymentId, podName, phase: pod.status?.phase }, "streamDeploymentLogs: pod not running");
    throw new Error("Pod is not running");
  }

  const k8sLog = new k8s.Log(kc);
  const request = await k8sLog.log(NAMESPACE, podName, containerName, writable, {
    follow: true,
    tailLines: options.tailLines ?? 100,
    timestamps: true,
  });

  log.info({ podName }, "streamDeploymentLogs: stream started");

  return {
    podName,
    abort: () => {
      if (request && typeof request.abort === "function") {
        request.abort();
      }
    },
  };
}
