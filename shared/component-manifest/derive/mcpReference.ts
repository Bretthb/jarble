/**
 * Generate MCP component reference data from the manifest.
 *
 * Used by the component_reference tool and list_components tool
 * to return component metadata to the LLM.
 */

import type { ComponentManifestEntry } from "../types.js";

export interface McpReferenceEntry {
  name: string;
  description: string;
  reference: string;
}

/**
 * Generate the MCP reference array for all built-in components.
 * Used by `component_reference` and `list_components` MCP tools.
 */
export function generateMcpReference(
  manifest: Record<string, ComponentManifestEntry>
): McpReferenceEntry[] {
  return Object.values(manifest)
    .filter((e) => e.builtin)
    .map((e) => ({
      name: e.name,
      description: e.description,
      reference: e.reference,
    }));
}

/**
 * Get the component reference string for a specific component.
 * Returns null if not found.
 */
export function getComponentReference(
  manifest: Record<string, ComponentManifestEntry>,
  name: string
): string | null {
  const entry = manifest[name];
  if (!entry) return null;
  return entry.reference;
}

/**
 * Build a descriptions record keyed by name, for use in list_components.
 */
export function getComponentDescriptions(
  manifest: Record<string, ComponentManifestEntry>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of Object.values(manifest)) {
    if (entry.builtin) {
      result[entry.name] = entry.description;
    }
  }
  return result;
}
