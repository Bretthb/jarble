/**
 * Derive component name lists from the manifest.
 */

import type { ComponentManifestEntry } from "../types.js";

/**
 * Extract sorted component names from the manifest.
 */
export function deriveComponentNames(
  manifest: Record<string, ComponentManifestEntry>
): string[] {
  return Object.keys(manifest);
}

/**
 * Build a Set of component names for O(1) lookups.
 */
export function deriveComponentNameSet(
  manifest: Record<string, ComponentManifestEntry>
): Set<string> {
  return new Set(Object.keys(manifest));
}
