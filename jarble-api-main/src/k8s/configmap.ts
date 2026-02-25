import { logger } from "../utils/logger.js";
import { coreApi } from "./client.js";
import { NAMESPACE } from "./constants.js";
import type { ConfigFile } from "../runtimes/types.js";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * K8s ConfigMap management for deployment config files
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Config files (soul.md, openclaw.json, etc.) are stored in a K8s ConfigMap
 * per deployment. An init container copies them onto the PVC before the main
 * container starts, eliminating the chicken-and-egg race condition where
 * configSync had to exec into a running pod to write files.
 *
 * ConfigMap naming: `config-{deploymentId}`
 *
 * Data keys use sanitized file paths:
 *   - Relative paths (e.g. "soul.md") → key "soul.md"
 *   - Absolute paths (e.g. "/data/.openclaw/openclaw.json")
 *     → key "abs--data--.openclaw--openclaw.json"
 *
 * The init container reverses this encoding to write files to the correct paths.
 */

// ── Key encoding ────────────────────────────────────────────────────────

/**
 * Encode a config file path into a valid ConfigMap data key.
 * K8s ConfigMap keys must be valid DNS subdomain names (alphanumeric, -, ., _).
 * We encode "/" as "--" and prefix absolute paths with "abs-".
 */
export function encodeConfigKey(path: string): string {
  if (path.startsWith("/")) {
    // Absolute path: strip leading /, replace / with --, prefix with "abs-"
    return "abs-" + path.slice(1).replace(/\//g, "--");
  }
  // Relative path: use as-is (already valid for ConfigMap keys)
  return path;
}

/**
 * Decode a ConfigMap data key back into the original file path.
 */
export function decodeConfigKey(key: string): string {
  if (key.startsWith("abs-")) {
    return "/" + key.slice(4).replace(/--/g, "/");
  }
  return key;
}

// ── CRUD ────────────────────────────────────────────────────────────────

/**
 * Create a ConfigMap for a deployment with the given config files.
 */
export async function createDeploymentConfigMap(
  deploymentId: string,
  files: ConfigFile[]
): Promise<void> {
  const data: Record<string, string> = {};
  for (const file of files) {
    data[encodeConfigKey(file.path)] = file.content;
  }

  await coreApi.createNamespacedConfigMap(NAMESPACE, {
    metadata: {
      name: `config-${deploymentId}`,
      labels: {
        app: `dep-${deploymentId}`,
        "jarble.ai/deployment-id": deploymentId,
      },
    },
    data,
  });

  logger.info(
    { deploymentId, fileCount: files.length, keys: Object.keys(data) },
    "ConfigMap created"
  );
}

/**
 * Update (replace) a deployment's ConfigMap with new config files.
 * Creates the ConfigMap if it doesn't exist.
 */
export async function updateDeploymentConfigMap(
  deploymentId: string,
  files: ConfigFile[]
): Promise<void> {
  const data: Record<string, string> = {};
  for (const file of files) {
    data[encodeConfigKey(file.path)] = file.content;
  }

  try {
    await coreApi.replaceNamespacedConfigMap(
      `config-${deploymentId}`,
      NAMESPACE,
      {
        metadata: {
          name: `config-${deploymentId}`,
          labels: {
            app: `dep-${deploymentId}`,
            "jarble.ai/deployment-id": deploymentId,
          },
        },
        data,
      }
    );
    logger.info(
      { deploymentId, fileCount: files.length },
      "ConfigMap updated"
    );
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as any).statusCode : null;
    if (statusCode === 404) {
      // ConfigMap doesn't exist yet (old deployment) — create it
      await createDeploymentConfigMap(deploymentId, files);
    } else {
      throw err;
    }
  }
}

/**
 * Delete a deployment's ConfigMap. Ignores 404 (already gone).
 */
export async function deleteDeploymentConfigMap(
  deploymentId: string
): Promise<void> {
  try {
    await coreApi.deleteNamespacedConfigMap(`config-${deploymentId}`, NAMESPACE);
    logger.debug({ deploymentId }, "ConfigMap deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as any).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "ConfigMap already gone (404)");
    } else {
      logger.error({ deploymentId, err }, "Failed to delete ConfigMap");
      throw err;
    }
  }
}
