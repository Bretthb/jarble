import { logger } from "../utils/logger.js";
import { coreApi } from "./client.js";
import { NAMESPACE } from "./constants.js";
import { execInPod, execInPodWithStdin, findPodForDeployment, escapeShellValue } from "./exec.js";
import type { ConfigFile, ConfigFileSpec } from "../runtimes/types.js";
import archiver from "archiver";

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

  // Find the running pod
  const pods = await coreApi.listNamespacedPod(
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
    // Paths starting with "/" are absolute; otherwise relative to /data/config/
    const filePath = file.path.startsWith("/") ? file.path : `/data/config/${file.path}`;

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
  // Find the running pod
  const pods = await coreApi.listNamespacedPod(
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

// ── Config Export (ZIP) ──────────────────────────────────────────────

/**
 * Export all user config files from a running deployment as a ZIP archive.
 * Reads `/data/config/` from the pod, builds a ZIP in memory, returns as base64.
 */
export async function exportDeploymentConfigs(deploymentId: string): Promise<{ filename: string; data: string }> {
  // Find the running pod
  const pods = await coreApi.listNamespacedPod(
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

// ── Process Restart (Zero-Downtime Config Reload) ────────────────────

/**
 * Signal a running deployment to reload its config without a full pod restart.
 *
 * Flow:
 *   1. Find running pod
 *   2. Check PID file exists (old images without restart loop return false)
 *   3. Write /data/config/.env with env var overrides
 *   4. Touch /data/.reload marker
 *   5. Kill OpenClaw process — entrypoint loop detects .reload, re-sources .env, restarts
 *
 * Returns true if the signal was sent, false if the pod doesn't support it
 * (caller should fall back to full pod restart).
 */
export async function signalProcessRestart(
  deploymentId: string,
  envOverrides: Record<string, string>
): Promise<boolean> {
  // 1. Find running pod (don't require readiness — it may be briefly unready during reload)
  const podName = await findPodForDeployment(deploymentId, { requireReady: false });
  if (!podName) {
    logger.debug({ deploymentId }, "signalProcessRestart: no running pod found");
    return false;
  }

  // 2. Check PID file exists (indicates image supports restart loop)
  let pid: string;
  try {
    pid = (await execInPod(podName, ["cat", "/data/.openclaw.pid"])).trim();
    if (!pid || isNaN(parseInt(pid, 10))) {
      logger.debug({ deploymentId, pid }, "signalProcessRestart: invalid PID file content");
      return false;
    }
  } catch {
    // PID file doesn't exist — old image without restart loop support
    logger.debug({ deploymentId }, "signalProcessRestart: no PID file (old image), falling back");
    return false;
  }

  // 3. Write .env file with env overrides (validate key names to prevent shell injection)
  const SAFE_ENV_KEY = /^[A-Z_][A-Z0-9_]*$/i;
  const envContent = Object.entries(envOverrides)
    .filter(([key]) => {
      if (!SAFE_ENV_KEY.test(key)) {
        logger.warn({ deploymentId, key }, "signalProcessRestart: skipping invalid env key name");
        return false;
      }
      return true;
    })
    .map(([key, value]) => `export ${key}='${escapeShellValue(value)}'`)
    .join("\n") + "\n";
  await execInPodWithStdin(podName, ["tee", "/data/config/.env"], envContent);

  // 4. Touch .reload marker (entrypoint checks this after process exits)
  await execInPod(podName, ["touch", "/data/.reload"]);

  // 5. Kill OpenClaw process — entrypoint loop will detect .reload and restart
  try {
    await execInPod(podName, ["kill", pid]);
  } catch {
    // Process may have already exited — that's fine, entrypoint will still see .reload
    logger.debug({ deploymentId, pid }, "signalProcessRestart: kill failed (process may have exited)");
  }

  logger.info({ deploymentId, pid, envKeys: Object.keys(envOverrides) }, "signalProcessRestart: reload signaled");
  return true;
}
