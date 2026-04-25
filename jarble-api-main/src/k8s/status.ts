import stream from "stream";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("k8s:status");
import { coreApi, execClient } from "./client.js";
import { NAMESPACE, RUNTIME_PORTS, getContainerName, getPvcMountPath, podLabelSelector } from "./constants.js";
import type { ManagedBy } from "./constants.js";

export interface DeploymentPodStatus {
  status: "creating" | "running" | "failed" | "not_found";
  phase?: string;
  restarts?: number;
  error?: string;
}

export async function getDeploymentPodStatus(
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<DeploymentPodStatus> {
  // JAR-126: a transient K8s API failure must not look identical to
  // "pod actually gone" — retry once before falling through to not_found.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const labelSelector = podLabelSelector(deploymentId, managedBy);
    const targetContainer = getContainerName(managedBy);

    const pods = await coreApi.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );

    if (pods.body.items.length === 0) {
      return { status: "not_found" };
    }

    const pod = pods.body.items[0];
    const phase = pod.status?.phase;

    // Find container status by name (operator pods have 2 containers: openclaw + gateway-proxy)
    const containerStatus = pod.status?.containerStatuses?.find(
      (cs) => cs.name === targetContainer
    ) ?? pod.status?.containerStatuses?.[0];

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

    // Running and ready - takes priority over restart count
    if (phase === "Running" && containerStatus?.ready) {
      return {
        status: "running",
        phase: "Running",
        restarts: containerStatus.restartCount,
      };
    }

    // Too many restarts and NOT currently running = failed
    if ((containerStatus?.restartCount || 0) >= 5) {
      return {
        status: "failed",
        phase,
        error: "Too many restarts",
        restarts: containerStatus?.restartCount,
      };
    }

    // Still creating
    return {
      status: "creating",
      phase,
    };
  } catch (err) {
    lastErr = err;
    if (attempt === 0) {
      log.warn({ deploymentId, err }, "Pod status lookup failed, retrying once");
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
  }
  }
  log.error({ deploymentId, err: lastErr }, "Failed to get pod status after retry");
  return { status: "not_found" };
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
 * Parse the stdout from `df -B1 <mountPath>` into a StorageUsage row.
 *
 * df output shape (`-B1` = sizes in bytes):
 *   Filesystem    1B-blocks    Used    Available  Use%  Mounted on
 *   /dev/longhorn 21474836480  1073741824  20401094656  5%  /data
 *
 * Returns null when the input is malformed (less than 2 lines, fewer
 * than 6 columns, or non-numeric byte counts) so callers can fall
 * back without surfacing a parse-error to the user.
 *
 * Exported for unit testing — split out of `getDeploymentStorageUsage`
 * which mixes the K8s exec orchestration with the parse step.
 */
export function parseDfOutput(stdoutData: string): StorageUsage | null {
  const lines = stdoutData.trim().split("\n");
  if (lines.length < 2) return null;

  const parts = lines[1].trim().split(/\s+/);
  if (parts.length < 6) return null;

  const totalBytes = parseInt(parts[1], 10);
  const usedBytes = parseInt(parts[2], 10);

  if (isNaN(totalBytes) || isNaN(usedBytes)) return null;

  const GB = 1024 * 1024 * 1024;
  return {
    usedBytes,
    totalBytes,
    usedGb: Math.round((usedBytes / GB) * 100) / 100,
    totalGb: Math.round((totalBytes / GB) * 100) / 100,
    percentUsed: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
  };
}

/**
 * Get storage usage for a deployment by exec-ing `df` inside the running pod.
 * Returns null if the pod isn't running or the command fails.
 */
export async function getDeploymentStorageUsage(
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<StorageUsage | null> {
  try {
    const labelSelector = podLabelSelector(deploymentId, managedBy);
    const targetContainer = getContainerName(managedBy);
    const mountPath = getPvcMountPath(managedBy);

    // Find the running pod for this deployment
    const pods = await coreApi.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );

    if (pods.body.items.length === 0) {
      return null;
    }

    const pod = pods.body.items[0];
    const podName = pod.metadata?.name;
    const containerStatus = pod.status?.containerStatuses?.find(
      (cs) => cs.name === targetContainer
    ) ?? pod.status?.containerStatuses?.[0];
    const isRunning = pod.status?.phase === "Running" && containerStatus?.ready;

    if (!podName || !isRunning) {
      return null;
    }

    // Exec `df` inside the container to get filesystem usage
    const stdout = new stream.PassThrough();
    const stderr = new stream.PassThrough();

    let stdoutData = "";
    let stderrData = "";
    stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
    stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

    await new Promise<void>((resolve, reject) => {
      execClient.exec(
        NAMESPACE,
        podName,
        targetContainer,
        ["df", "-B1", mountPath],  // -B1 = output in bytes
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
      log.warn({ deploymentId, stderr: stderrData }, "df command stderr");
    }

    const result = parseDfOutput(stdoutData);
    if (!result) {
      log.warn({ deploymentId, output: stdoutData }, "Could not parse df output");
    }
    return result;
  } catch (err) {
    log.error({ deploymentId, err }, "Failed to get storage usage");
    return null;
  }
}

// ── Pod Address Lookup (for chat proxy) ──────────────────────────────

// In-memory TTL cache for pod address lookups. Avoids hammering the K8s
// API on every Control UI sub-resource request (CSS, JS, images). Each
// entry caches the pod IP + gateway token for POD_ADDR_CACHE_TTL_MS.
const POD_ADDR_CACHE_TTL_MS = 60_000; // 60 seconds

interface PodAddrCacheEntry {
  value: { ip: string; port: number; gatewayToken: string } | null;
  expiresAt: number;
}

const podAddrCache = new Map<string, PodAddrCacheEntry>();

/** Invalidate a cached pod address (e.g. after restart or scale-down). */
export function invalidatePodAddrCache(deploymentId: string): void {
  podAddrCache.delete(deploymentId);
}

/**
 * Get the pod's cluster IP, gateway port, and auth token for proxying
 * dashboard chat requests through the running OpenClaw pod.
 *
 * Results are cached for 60s to avoid repeated K8s API calls during
 * Control UI asset loads (which can trigger 20+ requests in quick succession).
 *
 * Returns null if mock mode, no pod is running, or the secret is missing.
 *
 * For local dev: set POD_PROXY_URL=http://localhost:18790 (kubectl port-forward)
 * to bypass unreachable pod cluster IPs.
 */
export async function getPodAddress(
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<{
  ip: string;
  port: number;
  gatewayToken: string;
} | null> {
  // Check cache first
  const cached = podAddrCache.get(deploymentId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  try {
    const labelSelector = podLabelSelector(deploymentId, managedBy);
    const targetContainer = getContainerName(managedBy);

    // Find running, ready pod
    const pods = await coreApi.listNamespacedPod(
      NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );

    if (pods.body.items.length === 0) {
      podAddrCache.set(deploymentId, { value: null, expiresAt: Date.now() + POD_ADDR_CACHE_TTL_MS });
      return null;
    }

    const pod = pods.body.items[0];
    const podIp = pod.status?.podIP;
    const containerStatus = pod.status?.containerStatuses?.find(
      (cs) => cs.name === targetContainer
    ) ?? pod.status?.containerStatuses?.[0];
    const isRunning = pod.status?.phase === "Running" && containerStatus?.ready;

    if (!podIp || !isRunning) {
      podAddrCache.set(deploymentId, { value: null, expiresAt: Date.now() + POD_ADDR_CACHE_TTL_MS });
      return null;
    }

    // Read gateway token from K8s Secret
    const secret = await coreApi.readNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    const data = secret.body.data ?? {};
    const tokenB64 = data["OPENCLAW_GATEWAY_TOKEN"];
    const gatewayToken = tokenB64 ? Buffer.from(tokenB64, "base64").toString("utf-8") : "";

    // Local dev override: POD_PROXY_URL=http://localhost:18790
    const proxyUrl = process.env.POD_PROXY_URL;
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        const result = {
          ip: u.hostname,
          port: parseInt(u.port, 10) || 18789,
          gatewayToken,
        };
        podAddrCache.set(deploymentId, { value: result, expiresAt: Date.now() + POD_ADDR_CACHE_TTL_MS });
        return result;
      } catch {
        log.warn({ proxyUrl }, "getPodAddress: invalid POD_PROXY_URL, using pod IP");
      }
    }

    // Determine port from the pod's container spec, fallback to RUNTIME_PORTS
    const containerSpec = pod.spec?.containers?.find((c) => c.name === targetContainer)
      ?? pod.spec?.containers?.[0];
    const containerPort = containerSpec?.ports?.[0]?.containerPort
      ?? RUNTIME_PORTS["openclaw"];

    const result = { ip: podIp, port: containerPort, gatewayToken };
    podAddrCache.set(deploymentId, { value: result, expiresAt: Date.now() + POD_ADDR_CACHE_TTL_MS });
    return result;
  } catch (err) {
    log.error({ deploymentId, err }, "getPodAddress failed");
    return null;
  }
}
