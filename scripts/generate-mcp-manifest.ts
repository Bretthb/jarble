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

// Dynamic import to handle the TS manifest
const manifestModule = await import(join(__dirname, "..", "shared", "component-manifest", "index.ts"));
const { COMPONENT_MANIFEST } = manifestModule;

// Build the output data
const componentNames: string[] = [];
const descriptions: Record<string, string> = {};
const references: Record<string, string> = {};
const categories: Record<string, string[]> = {
  Display: [],
  Interactive: [],
  Data: [],
  Specialized: [],
  Sandbox: [],
  Media: [],
  Chart: [],
};

// Category mapping for the MCP server's component_reference grouped output
const mcpCategoryMap: Record<string, string> = {
  card: "Display", data_table: "Display", stat_grid: "Display", key_value: "Display",
  code_block: "Display", alert: "Display", progress: "Display", image: "Display",
  chart: "Display", tabs: "Display", accordion: "Display", badge: "Display",
  list: "Display", timeline: "Display", divider: "Display", metric_card: "Display",
  header: "Display", layout: "Display",
  button_group: "Interactive", form: "Interactive",
  spreadsheet: "Data",
  code_editor: "Specialized",
  sandbox: "Sandbox",
};

for (const [name, entry] of Object.entries(COMPONENT_MANIFEST)) {
  if (name === "canvas") continue; // skip alias for the data file
  componentNames.push(name);
  descriptions[name] = entry.description;
  references[name] = entry.reference;

  const cat = mcpCategoryMap[name];
  if (cat && categories[cat]) {
    categories[cat].push(name);
  }
}

const output = {
  _generated: new Date().toISOString(),
  _description: "Auto-generated from @jarble/component-manifest. Do not edit manually.",
  componentNames,
  descriptions,
  references,
  categories,
};

const outDir = join(__dirname, "..", "shared", "component-manifest", "generated");
mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, "component-data.json");
writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

console.log(`[generate-mcp-manifest] Wrote ${outPath}`);
console.log(`  ${componentNames.length} components`);
