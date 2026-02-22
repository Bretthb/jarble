import { logger } from "../utils/logger.js";
import { findPodForDeployment, execInPod } from "./exec.js";

// ── Component PVC Helpers ────────────────────────────────────────────

/**
 * Write a custom component definition to the PVC at /data/components/{name}.json.
 * In mock mode, stores in the mock deployment's file map.
 */
export async function writeComponentToPvc(
  deploymentId: string,
  name: string,
  definition: Record<string, unknown>
): Promise<void> {
  const filePath = `/data/components/${name}.json`;
  const content = JSON.stringify(definition, null, 2);

  const podName = await findPodForDeployment(deploymentId);
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  // Use base64 to avoid stdin/tee hanging and shell escaping issues
  const b64 = Buffer.from(content).toString("base64");
  await execInPod(podName, [
    "sh", "-c",
    `mkdir -p /data/components && echo '${b64}' | base64 -d > '${filePath}'`,
  ]);
  logger.info({ deploymentId, name }, "Wrote component to PVC");
}

/**
 * Read a custom component definition from the PVC.
 * Returns null if the component doesn't exist.
 */
export async function readComponentFromPvc(
  deploymentId: string,
  name: string
): Promise<Record<string, unknown> | null> {
  const filePath = `/data/components/${name}.json`;

  const podName = await findPodForDeployment(deploymentId);
  if (!podName) return null;

  try {
    const content = await execInPod(podName, ["cat", filePath]);
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * List all custom component definitions on the PVC.
 * Returns an array of { name, description } objects.
 */
export async function listComponentsOnPvc(
  deploymentId: string
): Promise<Array<{ name: string; description?: string }>> {
  const podName = await findPodForDeployment(deploymentId);
  if (!podName) return [];

  try {
    const output = await execInPod(podName, ["find", "/data/components", "-name", "*.json", "-type", "f"]);
    const filePaths = output.trim().split("\n").filter(Boolean);
    const components: Array<{ name: string; description?: string }> = [];

    for (const fp of filePaths) {
      try {
        const content = await execInPod(podName, ["cat", fp]);
        const parsed = JSON.parse(content);
        components.push({
          name: parsed.name || fp.replace("/data/components/", "").replace(".json", ""),
          description: parsed.description,
        });
      } catch {
        // Skip unreadable files
      }
    }
    return components;
  } catch {
    return []; // Directory doesn't exist yet
  }
}

/**
 * List all custom component definitions on the PVC with full definitions (including layout).
 * Used by the frontend catalog endpoint so it can resolve templates client-side.
 */
export async function getCustomComponentsWithDefinitions(
  deploymentId: string
): Promise<Array<{ name: string; description?: string; layout: Array<{ component: string; props: Record<string, unknown> }> }>> {
  const podName = await findPodForDeployment(deploymentId);
  if (!podName) return [];

  try {
    const output = await execInPod(podName, ["find", "/data/components", "-name", "*.json", "-type", "f"]);
    const filePaths = output.trim().split("\n").filter(Boolean);
    const components: Array<{ name: string; description?: string; layout: Array<{ component: string; props: Record<string, unknown> }> }> = [];

    for (const fp of filePaths) {
      try {
        const content = await execInPod(podName, ["cat", fp]);
        const parsed = JSON.parse(content);
        if (parsed.name && Array.isArray(parsed.layout)) {
          components.push({
            name: parsed.name,
            description: parsed.description,
            layout: parsed.layout,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
    return components;
  } catch {
    return []; // Directory doesn't exist yet
  }
}

/**
 * Delete a custom component definition from the PVC.
 * Returns true if deleted, false if not found.
 */
export async function deleteComponentFromPvc(
  deploymentId: string,
  name: string
): Promise<boolean> {
  const podName = await findPodForDeployment(deploymentId);
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const filePath = `/data/components/${name}.json`;
  try {
    await execInPod(podName, ["rm", filePath]);
    logger.info({ deploymentId, name }, "Deleted component from PVC");
    return true;
  } catch {
    return false;
  }
}
