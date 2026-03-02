#!/usr/bin/env npx tsx
/**
 * Generate component-data.json for the MCP server (jarble-ui-server.js).
 *
 * The MCP server is plain JS running on pods and cannot import TypeScript.
 * This script reads the manifest and writes a JSON file that the MCP server
 * can load at runtime.
 *
 * Usage:
 *   npx tsx scripts/generate-mcp-manifest.ts
 *
 * Output:
 *   shared/component-manifest/generated/component-data.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Use relative import (this script runs via tsx, not bundled)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Dynamic import to handle the TS manifest — use pathToFileURL for Windows compat
  const { pathToFileURL } = await import("node:url");
  const manifestPath = join(__dirname, "..", "shared", "component-manifest", "index.ts");
  const manifestModule = await import(pathToFileURL(manifestPath).href);
  const { COMPONENT_MANIFEST } = manifestModule;

  // Build the output data
  const componentNames: string[] = [];
  const descriptions: Record<string, string> = {};

  for (const [name, entry] of Object.entries(COMPONENT_MANIFEST)) {
    if (name === "canvas") continue; // skip alias for the data file
    componentNames.push(name);
    descriptions[name] = (entry as { description: string }).description;
  }

  const output = {
    _generated: new Date().toISOString(),
    _description: "Auto-generated from @jarble/component-manifest. Do not edit manually.",
    componentNames,
    descriptions,
  };

  const outDir = join(__dirname, "..", "shared", "component-manifest", "generated");
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "component-data.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(`[generate-mcp-manifest] Wrote ${outPath}`);
  console.log(`  ${componentNames.length} components`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
