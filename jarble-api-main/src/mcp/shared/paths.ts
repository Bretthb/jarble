/**
 * PVC path resolution + protected path list.
 *
 * Re-exports the canonical helpers from `k8s/constants.ts` so MCP tools
 * don't reach across into the k8s module, and adds the shared blocked-path
 * list used by every filesystem-mutating tool on the pod.
 */

import {
  getPvcMountPath as k8sGetPvcMountPath,
  getContainerName as k8sGetContainerName,
  type ManagedBy,
} from "../../k8s/constants.js";
import { ForbiddenError, InvalidArgsError } from "./errors.js";

export type { ManagedBy };

export const getPvcMount = (managedBy: ManagedBy): string =>
  k8sGetPvcMountPath(managedBy);

export const getContainer = (managedBy: ManagedBy): string =>
  k8sGetContainerName(managedBy);

/**
 * Paths the user must not write to, relative to the PVC mount.
 * Mirrors the list in `mcp/tools/writeFile.ts` so both the legacy tool
 * and the new local-server tools stay in lockstep.
 */
export function getProtectedPaths(pvcMount: string): string[] {
  return [
    // Infrastructure
    `${pvcMount}/.initialized`,
    `${pvcMount}/runtime`,
    `${pvcMount}/.npm`,
    // Platform config (managed by configSync)
    `${pvcMount}/config/mcp`,
    `${pvcMount}/config/soul.md`,
    `${pvcMount}/config/openclaw.json`,
    `${pvcMount}/config/service-tools.json`,
    `${pvcMount}/config/platform-skills.json`,
    `${pvcMount}/config/skills`,
    `${pvcMount}/config/.env`,
    // OpenClaw internal config
    `${pvcMount}/.openclaw`,
    // Process control
    `${pvcMount}/.openclaw.pid`,
    `${pvcMount}/.reload`,
    // Legacy soul.md / openclaw.json at root
    `${pvcMount}/soul.md`,
    `${pvcMount}/openclaw.json`,
  ];
}

/** Throws if `path` escapes the PVC mount or targets a protected location. */
export function assertSafePvcPath(path: string, managedBy: ManagedBy): void {
  const mount = getPvcMount(managedBy);
  if (!path.startsWith(`${mount}/`) && path !== mount) {
    throw new InvalidArgsError(`Path must be under ${mount}/.`);
  }
  if (path.includes("..")) {
    throw new InvalidArgsError("Path traversal (..) is not allowed.");
  }
  for (const blocked of getProtectedPaths(mount)) {
    if (path === blocked || path.startsWith(blocked + "/")) {
      throw new ForbiddenError(`Writing to ${blocked} is not allowed.`);
    }
  }
}
