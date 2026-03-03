import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("k8s:config");
import { coreApi } from "./client.js";
import { NAMESPACE, getPvcMountPath } from "./constants.js";
import type { ManagedBy } from "./constants.js";
import { execInPod, findPodForDeployment, escapeShellValue } from "./exec.js";
import type { ConfigFile, ConfigFileSpec } from "../runtimes/types.js";
import archiver from "archiver";

// ── Config File Writing ───────────────────────────────────────────────

/**
 * Write config files to a deployment's PVC by exec-ing into the running pod.
 * Files are written to {pvcMount}/config/{path} — the config/ subdirectory keeps
 * Jarble-managed configs separate from runtime data (node_modules, etc.).
 */
export async function writeConfigsToPvc(
  deploymentId: string,
  files: ConfigFile[],
  managedBy: ManagedBy = "legacy"
): Promise<void> {
  if (files.length === 0) return;

  const pvcMount = getPvcMountPath(managedBy);
  const labelSelector = managedBy; // pass through to findPodForDeployment

  // Find the running pod
  const pods = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    managedBy === "operator"
      ? `app.kubernetes.io/instance=dep-${deploymentId}`
      : `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error(`No pods found for deployment ${deploymentId}`);
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  const containerName = managedBy === "operator" ? "openclaw" : "runtime";

  for (const file of files) {
    // Paths starting with "/" are absolute; otherwise relative to {pvcMount}/config/
    const filePath = file.path.startsWith("/") ? file.path : `${pvcMount}/config/${file.path}`;

    // Ensure parent directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir && dir !== `${pvcMount}/config`) {
      await execInPod(podName, ["mkdir", "-p", dir], containerName);
    }

    // Write file content via base64-encoded exec (avoids stdin WebSocket hanging issue)
    const b64 = Buffer.from(file.content).toString("base64");
    await execInPod(podName, ["sh", "-c", `echo '${b64}' | base64 -d > '${filePath}'`], containerName);

    log.info({ deploymentId, path: file.path }, "Wrote config file to PVC");
  }
}

// ── Config File Reading (PVC → DB sync) ────────────────────────────────

/**
 * Read config files from a running pod's PVC.
 * Used for reverse sync: reading what's on the PVC back to the DB.
 */
export async function readConfigsFromPvc(
  deploymentId: string,
  configFileSpecs: ConfigFileSpec[],
  managedBy: ManagedBy = "legacy"
): Promise<ConfigFile[]> {
  const pvcMount = getPvcMountPath(managedBy);

  // Find the running pod
  const pods = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    managedBy === "operator"
      ? `app.kubernetes.io/instance=dep-${deploymentId}`
      : `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error(`No pods found for deployment ${deploymentId}`);
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  if (!podName) throw new Error("Pod has no name");

  const containerName = managedBy === "operator" ? "openclaw" : "runtime";

  // Check pod is running
  const targetContainer = managedBy === "operator" ? "openclaw" : "runtime";
  const containerStatus = pod.status?.containerStatuses?.find(
    (cs) => cs.name === targetContainer
  ) ?? pod.status?.containerStatuses?.[0];
  const isRunning = pod.status?.phase === "Running" && containerStatus?.ready;
  if (!isRunning) {
    throw new Error(`Pod ${podName} is not ready`);
  }

  const files: ConfigFile[] = [];

  for (const spec of configFileSpecs) {
    if (spec.isGlob) {
      const basePath = `${pvcMount}/config/${spec.path.replace("/*", "")}`;
      try {
        const findOutput = await execInPod(podName, ["find", basePath, "-type", "f"], containerName);
        const filePaths = findOutput.trim().split("\n").filter(Boolean);

        for (const fullPath of filePaths) {
          try {
            const content = await execInPod(podName, ["cat", fullPath], containerName);
            const relativePath = fullPath.replace(new RegExp(`^${pvcMount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/config/`), "");
            files.push({ path: relativePath, content });
          } catch (err) {
            log.warn({ deploymentId, path: fullPath, err }, "Failed to read config file from PVC");
          }
        }
      } catch {
        log.debug({ deploymentId, path: basePath }, "Config directory not found on PVC");
      }
    } else {
      const filePath = `${pvcMount}/config/${spec.path}`;
      try {
        const content = await execInPod(podName, ["cat", filePath], containerName);
        files.push({ path: spec.path, content });
      } catch {
        log.debug({ deploymentId, path: spec.path }, "Config file not found on PVC");
      }
    }
  }

  return files;
}

// ── Config Export (ZIP) ──────────────────────────────────────────────

/**
 * Export all user config files from a running deployment as a ZIP archive.
 */
export async function exportDeploymentConfigs(
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<{ filename: string; data: string }> {
  const pvcMount = getPvcMountPath(managedBy);
  const containerName = managedBy === "operator" ? "openclaw" : "runtime";
  const configPath = `${pvcMount}/config`;

  const pods = await coreApi.listNamespacedPod(
    NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    managedBy === "operator"
      ? `app.kubernetes.io/instance=dep-${deploymentId}`
      : `app=dep-${deploymentId}`
  );

  if (pods.body.items.length === 0) {
    throw new Error(`No pods found for deployment ${deploymentId}`);
  }

  const pod = pods.body.items[0];
  const podName = pod.metadata?.name;
  const targetContainer = managedBy === "operator" ? "openclaw" : "runtime";
  const containerStatus = pod.status?.containerStatuses?.find(
    (cs) => cs.name === targetContainer
  ) ?? pod.status?.containerStatuses?.[0];
  const isRunning = pod.status?.phase === "Running" && containerStatus?.ready;

  if (!podName || !isRunning) {
    throw new Error("Pod is not running — cannot export configs");
  }

  // List all config files
  const fileListOutput = await execInPod(podName, ["find", configPath, "-type", "f"], containerName);
  const filePaths = fileListOutput.trim().split("\n").filter(Boolean);

  if (filePaths.length === 0) {
    throw new Error(`No config files found in ${configPath}`);
  }

  // Read each file's content via exec
  const files: Array<{ path: string; content: string }> = [];
  for (const fullPath of filePaths) {
    try {
      const content = await execInPod(podName, ["cat", fullPath], containerName);
      const relativePath = fullPath.replace(new RegExp(`^${configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), "");
      files.push({ path: relativePath, content });
    } catch (err) {
      log.warn({ deploymentId, path: fullPath, err }, "Skipping unreadable config file");
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
  log.info({ deploymentId, fileCount: files.length, sizeBytes: zipBuffer.length }, "Exported deployment configs");

  return {
    filename,
    data: zipBuffer.toString("base64"),
  };
}

// ── Process Restart (Zero-Downtime Config Reload) ────────────────────

/**
 * Signal a running deployment to reload its config without a full pod restart.
 *
 * Returns true if the signal was sent, false if the pod doesn't support it
 * (caller should fall back to full pod restart).
 *
 * For operator mode, always returns false — process restart is not supported
 * (the operator manages the pod lifecycle).
 */
export async function signalProcessRestart(
  deploymentId: string,
  envOverrides: Record<string, string>,
  managedBy: ManagedBy = "legacy"
): Promise<boolean> {
  // Operator mode: process restart not supported — fall through to Tier 3
  if (managedBy === "operator") {
    log.debug({ deploymentId }, "signalProcessRestart: operator mode, falling back to pod restart");
    return false;
  }

  // 1. Find running pod (don't require readiness — it may be briefly unready during reload)
  const podName = await findPodForDeployment(deploymentId, { requireReady: false });
  if (!podName) {
    log.debug({ deploymentId }, "signalProcessRestart: no running pod found");
    return false;
  }

  // 2. Check PID file exists (indicates image supports restart loop)
  let pid: string;
  try {
    pid = (await execInPod(podName, ["cat", "/data/.openclaw.pid"])).trim();
    if (!pid || isNaN(parseInt(pid, 10))) {
      log.debug({ deploymentId, pid }, "signalProcessRestart: invalid PID file content");
      return false;
    }
  } catch {
    // PID file doesn't exist — old image without restart loop support
    log.debug({ deploymentId }, "signalProcessRestart: no PID file (old image), falling back");
    return false;
  }

  // 3. Write .env file with env overrides (validate key names to prevent shell injection)
  const SAFE_ENV_KEY = /^[A-Z_][A-Z0-9_]*$/i;
  const envContent = Object.entries(envOverrides)
    .filter(([key]) => {
      if (!SAFE_ENV_KEY.test(key)) {
        log.warn({ deploymentId, key }, "signalProcessRestart: skipping invalid env key name");
        return false;
      }
      return true;
    })
    .map(([key, value]) => `export ${key}='${escapeShellValue(value)}'`)
    .join("\n") + "\n";
  const b64Env = Buffer.from(envContent).toString("base64");
  await execInPod(podName, ["sh", "-c", `echo '${b64Env}' | base64 -d > '/data/config/.env'`]);

  // 4. Touch .reload marker (entrypoint checks this after process exits)
  await execInPod(podName, ["touch", "/data/.reload"]);

  // 5. Kill OpenClaw process — entrypoint loop will detect .reload and restart
  try {
    await execInPod(podName, ["kill", pid]);
  } catch {
    log.debug({ deploymentId, pid }, "signalProcessRestart: kill failed (process may have exited)");
  }

  log.info({ deploymentId, pid, envKeys: Object.keys(envOverrides) }, "signalProcessRestart: reload signaled");
  return true;
}
