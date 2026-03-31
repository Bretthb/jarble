import { logger } from "../utils/logger.js";
import { coreApi, customApi } from "./client.js";
import { NAMESPACE } from "./constants.js";

export interface PodMetrics {
  nodeName: string | null;
  cpuUsageMillicores: number | null;
  cpuLimitMillicores: number | null;
  memoryUsageMb: number | null;
  memoryLimitMb: number | null;
  uptimeSeconds: number | null;
  restarts: number;
}

// Circuit breaker: skip metrics API calls for 60s after a failure
let metricsAvailable = true;
let metricsRetryAfter = 0;

/**
 * Parse K8s CPU resource string to millicores.
 * Examples: "500m" → 500, "2" → 2000, "42379n" → 0 (nanocores)
 */
function parseCpuToMillicores(cpu: string): number {
  if (cpu.endsWith("n")) {
    return Math.round(parseInt(cpu, 10) / 1_000_000);
  }
  if (cpu.endsWith("m")) {
    return parseInt(cpu, 10);
  }
  // Plain number = whole cores
  return Math.round(parseFloat(cpu) * 1000);
}

/**
 * Parse K8s memory resource string to MB.
 * Examples: "128Mi" → 128, "1Gi" → 1024, "131072Ki" → 128, "134217728" → 128
 */
function parseMemoryToMb(mem: string): number {
  if (mem.endsWith("Ki")) {
    return Math.round(parseInt(mem, 10) / 1024);
  }
  if (mem.endsWith("Mi")) {
    return parseInt(mem, 10);
  }
  if (mem.endsWith("Gi")) {
    return Math.round(parseFloat(mem) * 1024);
  }
  if (mem.endsWith("Ti")) {
    return Math.round(parseFloat(mem) * 1024 * 1024);
  }
  // Plain bytes
  return Math.round(parseInt(mem, 10) / (1024 * 1024));
}

/**
 * Get resource metrics for a deployment's pod.
 * Returns null if pod isn't found or not running.
 */
export async function getDeploymentMetrics(deploymentId: string): Promise<PodMetrics | null> {
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
      return null;
    }

    const pod = pods.body.items[0];
    const containerStatus = pod.status?.containerStatuses?.[0];
    const isRunning = pod.status?.phase === "Running" && containerStatus?.ready;

    if (!isRunning) {
      return null;
    }

    // Extract pod metadata (always available from pod spec)
    const nodeName = pod.spec?.nodeName ?? null;
    const startTime = pod.status?.startTime;
    const restarts = containerStatus?.restartCount ?? 0;

    // Resource limits from container spec
    const limits = pod.spec?.containers?.[0]?.resources?.limits;
    const cpuLimitMillicores = limits?.cpu ? parseCpuToMillicores(limits.cpu) : null;
    const memoryLimitMb = limits?.memory ? parseMemoryToMb(limits.memory) : null;

    // Uptime
    const uptimeSeconds = startTime
      ? Math.round((Date.now() - new Date(startTime).getTime()) / 1000)
      : null;

    // Actual usage from metrics API (with circuit breaker)
    let cpuUsageMillicores: number | null = null;
    let memoryUsageMb: number | null = null;

    if (metricsAvailable || Date.now() > metricsRetryAfter) {
      const podName = pod.metadata?.name;
      if (podName) {
        try {
          const metricsResp = await customApi.getNamespacedCustomObject(
            "metrics.k8s.io",
            "v1beta1",
            NAMESPACE,
            "pods",
            podName
          );
          const body = metricsResp.body as {
            containers?: Array<{
              usage?: { cpu?: string; memory?: string };
            }>;
          };
          const containerUsage = body.containers?.[0]?.usage;
          if (containerUsage) {
            cpuUsageMillicores = containerUsage.cpu
              ? parseCpuToMillicores(containerUsage.cpu)
              : null;
            memoryUsageMb = containerUsage.memory
              ? parseMemoryToMb(containerUsage.memory)
              : null;
          }
          metricsAvailable = true;
        } catch {
          // Metrics API unavailable - set circuit breaker
          if (metricsAvailable) {
            logger.warn("Metrics API unavailable, disabling for 60s");
          }
          metricsAvailable = false;
          metricsRetryAfter = Date.now() + 60_000;
        }
      }
    }

    return {
      nodeName,
      cpuUsageMillicores,
      cpuLimitMillicores,
      memoryUsageMb,
      memoryLimitMb,
      uptimeSeconds,
      restarts,
    };
  } catch (err) {
    logger.error({ deploymentId, err }, "Failed to get deployment metrics");
    return null;
  }
}
