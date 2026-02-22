import { logger } from "../utils/logger.js";
import { coreApi } from "./client.js";
import { NAMESPACE } from "./constants.js";

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
  secretEntries: Record<string, string>,
  template?: string,
): Promise<void> {
  const baseData: Record<string, string> = {
    DEPLOYMENT_ID: deploymentId,
    USER_ID: userId,
    DEPLOYMENT_NAME: name,
    TEMPLATE: template || "personal",
    RUNTIME: runtime,
  };

  // Include JARBLE_API_URL for file watcher callback
  if (process.env.JARBLE_API_URL) {
    baseData.JARBLE_API_URL = process.env.JARBLE_API_URL;
  }
  // Include CONFIG_WEBHOOK_SECRET for authenticated config-changed callbacks
  if (process.env.CONFIG_WEBHOOK_SECRET) {
    baseData.CONFIG_WEBHOOK_SECRET = process.env.CONFIG_WEBHOOK_SECRET;
  }

  // Preserve OPENCLAW_GATEWAY_TOKEN — it's generated once at creation time
  // and not included in runtime handler's getSecretEntries(). Without this,
  // every configSync replaceNamespacedSecret call would delete the token.
  if (!secretEntries.OPENCLAW_GATEWAY_TOKEN) {
    try {
      const currentData = await readCurrentSecretData(deploymentId);
      if (currentData?.OPENCLAW_GATEWAY_TOKEN) {
        secretEntries.OPENCLAW_GATEWAY_TOKEN = currentData.OPENCLAW_GATEWAY_TOKEN;
      }
    } catch {
      // If we can't read the existing secret, proceed without the token
      logger.warn({ deploymentId }, "updateDeploymentSecret: could not read existing gateway token");
    }
  }

  const fullData = { ...baseData, ...secretEntries };

  await coreApi.replaceNamespacedSecret(
    `secret-${deploymentId}`,
    NAMESPACE,
    {
      metadata: { name: `secret-${deploymentId}` },
      stringData: fullData,
    }
  );

  logger.info({ deploymentId, entryCount: Object.keys(fullData).length }, "K8s Secret updated");
}

/**
 * Read the current K8s Secret data for a deployment.
 * Used by configSync to compare current vs desired secret entries.
 * Returns null if the secret doesn't exist.
 */
export async function readCurrentSecretData(
  deploymentId: string
): Promise<Record<string, string> | null> {
  try {
    const secret = await coreApi.readNamespacedSecret(`secret-${deploymentId}`, NAMESPACE);
    const data = secret.body.data ?? {};
    const decoded: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      decoded[key] = Buffer.from(value as string, "base64").toString("utf-8");
    }
    return decoded;
  } catch {
    return null;
  }
}
