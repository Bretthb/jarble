import * as k8s from "@kubernetes/client-node";
import stream from "stream";
import archiver from "archiver";
import { logger } from "../utils/logger.js";
import type { ConfigFile, ConfigFileSpec } from "../runtimes/types.js";

// Mock mode for local development without K8s cluster
const MOCK_K8S = process.env.MOCK_K8S === "true";

if (MOCK_K8S) {
  logger.info("🎭 K8s mock mode enabled - no real cluster operations will be performed");
}

// Initialize K8s client (only if not in mock mode)
let coreApi: k8s.CoreV1Api | null = null;
let appsApi: k8s.AppsV1Api | null = null;
let exec: k8s.Exec | null = null;

if (!MOCK_K8S) {
  const kc = new k8s.KubeConfig();

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

  // Mock mode: simulate successful deployment creation
  if (MOCK_K8S) {
    logger.info({ deploymentId }, "🎭 Mock: Deployment created successfully");
    return;
  }

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
  await coreApi!.createNamespacedPersistentVolumeClaim(NAMESPACE, {
    metadata: { name: `pvc-${deploymentId}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "longhorn",
      resources: { requests: { storage: storageGi } },
    },
  });

  // 2. Create Secret for deployment env vars
  // Base entries are always included; runtime handler provides extras (e.g. LLM keys)
  const baseSecretData: Record<string, string> = {
    DEPLOYMENT_ID: deploymentId,
    USER_ID: userId,
    DEPLOYMENT_NAME: config.name,
    TEMPLATE: config.template || "personal",
    RUNTIME: config.runtime || "openclaw",
  };

  // Include JARBLE_API_URL for file watcher callback (PVC → DB sync)
  if (process.env.JARBLE_API_URL) {
    baseSecretData.JARBLE_API_URL = process.env.JARBLE_API_URL;
  }

  const secretData = { ...baseSecretData, ...(config.extraSecretEntries ?? {}) };

  await coreApi!.createNamespacedSecret(NAMESPACE, {
    metadata: { name: `secret-${deploymentId}` },
    stringData: secretData,
  });

  // 3. Create Deployment
  await appsApi!.createNamespacedDeployment(NAMESPACE, {
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
            ports: [{
              containerPort: config.containerPort || RUNTIME_PORTS[config.runtime || "openclaw"] || 18789,
              name: "gateway",
            }],
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

  // 4. Write initial config files to PVC (if any provided by the runtime handler)
  if (config.initialConfigs && config.initialConfigs.length > 0) {
    try {
      // Wait for pod to be ready (poll every 2s, max 60s)
      let ready = false;
      for (let i = 0; i < 30; i++) {
        const status = await getDeploymentPodStatus(deploymentId);
        if (status.status === "running") { ready = true; break; }
        if (status.status === "failed") {
          logger.warn({ deploymentId }, "Pod failed to start, skipping initial config write");
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (ready) {
        await writeConfigsToPvc(deploymentId, config.initialConfigs);
      } else {
        logger.warn({ deploymentId }, "Pod not ready after 60s, skipping initial config write");
      }
    } catch (err) {
      // Don't fail the entire deployment if config write fails — deployment still exists
      logger.error({ deploymentId, err }, "Failed to write initial config files");
    }
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
  // Brief pause to let K8s terminate the pod
  await new Promise((r) => setTimeout(r, 2000));
  await startDeployment(deploymentId);

  logger.info({ deploymentId }, "Deployment restarted");
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteDeployment(deploymentId: string): Promise<void> {
  logger.info({ deploymentId }, "Deleting deployment");

  if (MOCK_K8S) {
    logger.info({ deploymentId }, "🎭 Mock: Deployment deleted");
    return;
  }

  try {
    // Delete in order: Deployment, Secret, PVC
    await appsApi!.deleteNamespacedDeployment(`dep-${deploymentId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  try {
    await coreApi!.deleteNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
  } catch (err: unknown) {
    if (err instanceof Object && "statusCode" in err && err.statusCode !== 404) throw err;
  }

  try {
    await coreApi!.deleteNamespacedPersistentVolumeClaim(`pvc-${deploymentId}`, NAMESPACE);
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
  // Mock mode: always return "running"
  if (MOCK_K8S) {
    return { status: "running", phase: "Running", restarts: 0 };
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
  // Mock mode: return simulated storage usage
  if (MOCK_K8S) {
    return {
      usedBytes: 524288000,  // ~500MB
      totalBytes: 21474836480,  // 20GB
      usedGb: 0.5,
      totalGb: 20,
      percentUsed: 2.5,
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
  // Mock mode: return empty zip
  if (MOCK_K8S) {
    logger.info({ deploymentId }, "🎭 Mock: Returning mock config export");
    return { filename: `config-${deploymentId}.zip`, data: "" };
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

  // Mock mode: log and return
  if (MOCK_K8S) {
    logger.info({ deploymentId, fileCount: files.length }, "🎭 Mock: Config files written to PVC");
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

    // Write file content via stdin pipe
    await execInPodWithStdin(podName, ["sh", "-c", `cat > ${filePath}`], file.content);

    logger.info({ deploymentId, path: file.path }, "Wrote config file to PVC");
  }
}

/**
 * Execute a command in a pod (no stdin, capture stdout/stderr).
 */
export async function execInPod(podName: string, command: string[]): Promise<string> {
  // Mock mode: return empty output
  if (MOCK_K8S) {
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
 * Returns the pod name or null if no running pod exists.
 */
export async function findPodForDeployment(deploymentId: string): Promise<string | null> {
  // Mock mode: return mock pod name
  if (MOCK_K8S) {
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
  const isRunning = pod.status?.phase === "Running" && pod.status?.containerStatuses?.[0]?.ready;

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
  // Mock mode: send a few mock lines and exit successfully
  if (MOCK_K8S) {
    onLine("🎭 Mock exec started");
    setTimeout(() => onExit(true), 100);
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
  stdinContent: string
): Promise<void> {
  const stdout = new stream.PassThrough();
  const stderr = new stream.PassThrough();

  let stderrData = "";
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
    ).then((ws) => {
      // Pipe stdin content and close
      if (ws) {
        ws.send(Buffer.from(stdinContent));
        ws.close();
      }
    }).catch(reject);
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
  secretEntries: Record<string, string>
): Promise<void> {
  // Mock mode: log and return
  if (MOCK_K8S) {
    logger.info({ deploymentId, entryCount: Object.keys(secretEntries).length }, "🎭 Mock: K8s Secret updated");
    return;
  }

  const baseData: Record<string, string> = {
    DEPLOYMENT_ID: deploymentId,
    USER_ID: userId,
    DEPLOYMENT_NAME: name,
    TEMPLATE: "personal",
    RUNTIME: runtime,
  };

  // Include JARBLE_API_URL for file watcher callback
  if (process.env.JARBLE_API_URL) {
    baseData.JARBLE_API_URL = process.env.JARBLE_API_URL;
  }

  const fullData = { ...baseData, ...secretEntries };

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
  // Mock mode: return empty array
  if (MOCK_K8S) {
    logger.info({ deploymentId }, "🎭 Mock: Reading configs from PVC (returning empty)");
    return [];
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
  // Mock mode: return simulated logs
  if (MOCK_K8S) {
    const mockLogs = [
      `[${new Date().toISOString()}] 🎭 Mock mode active - no real K8s cluster`,
      `[${new Date().toISOString()}] Deployment ${deploymentId} is running in mock mode`,
      `[${new Date().toISOString()}] Bot started successfully (simulated)`,
      `[${new Date().toISOString()}] Listening for messages...`,
    ].join("\n");
    return { logs: mockLogs, podName: `mock-pod-${deploymentId}` };
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

  const response = await coreApi.readNamespacedPodLog(
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
  // Mock mode: write simulated logs periodically
  if (MOCK_K8S) {
    const podName = `mock-pod-${deploymentId}`;
    writable.write(`[${new Date().toISOString()}] 🎭 Mock log stream started\n`);

    const interval = setInterval(() => {
      writable.write(`[${new Date().toISOString()}] Mock heartbeat - deployment ${deploymentId} running\n`);
    }, 5000);

    return {
      podName,
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

  const log = new k8s.Log(kc);
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
