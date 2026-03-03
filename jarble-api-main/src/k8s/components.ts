import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("k8s:components");
import { findPodForDeployment, execInPod } from "./exec.js";
import { getContainerName, getPvcMountPath } from "./constants.js";
import type { ManagedBy } from "./constants.js";

// ── Component PVC Helpers ────────────────────────────────────────────

/**
 * Write a custom component definition to the PVC at {pvcMount}/components/{name}.json.
 */
export async function writeComponentToPvc(
  deploymentId: string,
  name: string,
  definition: Record<string, unknown>,
  managedBy: ManagedBy = "legacy"
): Promise<void> {
  const pvcMount = getPvcMountPath(managedBy);
  const containerName = getContainerName(managedBy);
  const filePath = `${pvcMount}/components/${name}.json`;
  const content = JSON.stringify(definition, null, 2);

  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  // Use base64 to avoid stdin/tee hanging and shell escaping issues
  const b64 = Buffer.from(content).toString("base64");
  await execInPod(podName, [
    "sh", "-c",
    `mkdir -p ${pvcMount}/components && echo '${b64}' | base64 -d > '${filePath}'`,
  ], containerName);
  log.info({ deploymentId, name }, "Wrote component to PVC");
}

/**
 * Read a custom component definition from the PVC.
 * Returns null if the component doesn't exist.
 */
export async function readComponentFromPvc(
  deploymentId: string,
  name: string,
  managedBy: ManagedBy = "legacy"
): Promise<Record<string, unknown> | null> {
  const pvcMount = getPvcMountPath(managedBy);
  const containerName = getContainerName(managedBy);
  const filePath = `${pvcMount}/components/${name}.json`;

  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) return null;

  try {
    const content = await execInPod(podName, ["cat", filePath], containerName);
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
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<Array<{ name: string; description?: string }>> {
  const pvcMount = getPvcMountPath(managedBy);
  const containerName = getContainerName(managedBy);
  const componentsDir = `${pvcMount}/components`;

  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) return [];

  try {
    const output = await execInPod(podName, ["find", componentsDir, "-name", "*.json", "-type", "f"], containerName);
    const filePaths = output.trim().split("\n").filter(Boolean);
    const components: Array<{ name: string; description?: string }> = [];

    for (const fp of filePaths) {
      try {
        const content = await execInPod(podName, ["cat", fp], containerName);
        const parsed = JSON.parse(content);
        components.push({
          name: parsed.name || fp.replace(`${componentsDir}/`, "").replace(".json", ""),
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
 */
export async function getCustomComponentsWithDefinitions(
  deploymentId: string,
  managedBy: ManagedBy = "legacy"
): Promise<Array<{ name: string; description?: string; layout: Array<{ component: string; props: Record<string, unknown> }> }>> {
  const pvcMount = getPvcMountPath(managedBy);
  const containerName = getContainerName(managedBy);
  const componentsDir = `${pvcMount}/components`;

  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) return [];

  try {
    const output = await execInPod(podName, ["find", componentsDir, "-name", "*.json", "-type", "f"], containerName);
    const filePaths = output.trim().split("\n").filter(Boolean);
    const components: Array<{ name: string; description?: string; layout: Array<{ component: string; props: Record<string, unknown> }> }> = [];

    for (const fp of filePaths) {
      try {
        const content = await execInPod(podName, ["cat", fp], containerName);
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
  name: string,
  managedBy: ManagedBy = "legacy"
): Promise<boolean> {
  const pvcMount = getPvcMountPath(managedBy);
  const containerName = getContainerName(managedBy);

  const podName = await findPodForDeployment(deploymentId, { managedBy });
  if (!podName) {
    throw new Error(`No running pod found for deployment ${deploymentId}`);
  }

  const filePath = `${pvcMount}/components/${name}.json`;
  try {
    await execInPod(podName, ["rm", filePath], containerName);
    log.info({ deploymentId, name }, "Deleted component from PVC");
    return true;
  } catch {
    return false;
  }
}
