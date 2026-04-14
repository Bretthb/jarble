/**
 * Shared helpers for local-server (pod-side) MCP tools.
 *
 * Everything in here must be bundle-friendly for esbuild:
 * - Node built-ins only (fs/promises, path, crypto, etc.)
 * - No @kubernetes/client-node, no drizzle-orm, no MCP SDK server imports
 * - No runtime dependency on the ToolContext.db field (undefined on pod)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getPvcMount, type ManagedBy } from "../../shared/paths.js";
import type { McpResult } from "../../shared/types.js";

/**
 * Resolve the deployment's K8s management mode from the pod environment.
 *
 * Set by the runtime handler when the pod is created. Defaults to "legacy"
 * because that matches the hard-coded /data path the legacy jarble-ui-server.js
 * has been using for every openclaw pod shipped to date.
 */
export function resolveManagedBy(): ManagedBy {
  const raw = (process.env.JARBLE_MANAGED_BY || "legacy").toLowerCase();
  return raw === "operator" ? "operator" : "legacy";
}

/** PVC mount root for the pod this MCP server is running inside. */
export function pvcRoot(): string {
  return getPvcMount(resolveManagedBy());
}

/** Utility — build a text-only McpResult. */
export function textResult(text: string, isError = false): McpResult {
  return { content: [{ type: "text", text }], isError };
}

/** Utility — build a JSON text McpResult. */
export function jsonResult(data: unknown, isError = false): McpResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/** Ensure a directory exists (recursive mkdir, idempotent). */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Atomic JSON write: writes to `.tmp` then renames. */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  const tmp = filePath + ".tmp";
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

/** Read JSON file, returning `fallback` if missing or malformed. */
export async function readJsonOrDefault<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** True when a file/dir exists. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
