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
import { createRequire } from "node:module";

// Use relative import (this script runs via tsx, not bundled)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Recursively set additionalProperties: true on all "object" type schemas.
 * This gives LLMs tolerance for extra fields — they won't cause validation errors.
 */
function setAdditionalProperties(schema: Record<string, unknown>): void {
  if (typeof schema !== "object" || schema === null) return;

  if (schema.type === "object" && schema.properties) {
    schema.additionalProperties = true;
    for (const prop of Object.values(schema.properties as Record<string, unknown>)) {
      setAdditionalProperties(prop as Record<string, unknown>);
    }
  }

  if (schema.type === "array" && schema.items) {
    setAdditionalProperties(schema.items as Record<string, unknown>);
  }

  // Handle anyOf / oneOf / allOf
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[key])) {
      for (const sub of schema[key] as Record<string, unknown>[]) {
        setAdditionalProperties(sub);
      }
    }
  }
}

async function main() {
  // Dynamic import to handle the TS manifest — use pathToFileURL for Windows compat
  const { pathToFileURL } = await import("node:url");
  const manifestPath = join(__dirname, "..", "shared", "component-manifest", "index.ts");
  const manifestModule = await import(pathToFileURL(manifestPath).href);
  const { COMPONENT_MANIFEST } = manifestModule;

  // Import COMPONENT_SCHEMAS from manifest (already loaded above)
  const { COMPONENT_SCHEMAS } = manifestModule;

  // Resolve zod-to-json-schema from the API package (where it's installed as a transitive dep)
  const apiDir = join(__dirname, "..", "jarble-api-main");
  const apiRequire = createRequire(join(apiDir, "package.json"));
  const zodToJsonSchemaPath = apiRequire.resolve("zod-to-json-schema");
  const { zodToJsonSchema } = await import(pathToFileURL(zodToJsonSchemaPath).href);

  // Build the output data
  const componentNames: string[] = [];
  const descriptions: Record<string, string> = {};
  const schemas: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(COMPONENT_MANIFEST)) {
    if (name === "canvas") continue; // skip alias for the data file
    componentNames.push(name);
    descriptions[name] = (entry as { description: string }).description;
  }

  // Convert Zod schemas to JSON Schema draft-07
  for (const [name, zodSchema] of Object.entries(COMPONENT_SCHEMAS)) {
    if (name === "canvas") continue; // skip alias
    try {
      const jsonSchema = zodToJsonSchema(zodSchema as import("zod").ZodType, {
        target: "jsonSchema7",
        $refStrategy: "none", // inline all definitions, no $ref
      });
      // Remove top-level $schema key (not needed at per-component level)
      const { $schema, ...rest } = jsonSchema as Record<string, unknown>;
      // Set additionalProperties: true on all object types for LLM tolerance
      setAdditionalProperties(rest);
      schemas[name] = rest;
    } catch (err) {
      console.warn(`[generate-mcp-manifest] Failed to convert schema for "${name}":`, err);
    }
  }

  // Build per-component MCP tool definitions (show_chart, show_data_table, etc.)
  // Each tool takes the component's props directly as arguments (not wrapped in {component, props}).
  const tools: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }> = [];

  for (const name of componentNames) {
    const schema = schemas[name];
    if (!schema) continue;
    tools.push({
      name: `show_${name}`,
      description: descriptions[name] || `Render a ${name.replace(/_/g, " ")} component on the canvas.`,
      inputSchema: schema,
    });
  }

  const output = {
    _generated: new Date().toISOString(),
    _description: "Auto-generated from @jarble/component-manifest. Do not edit manually.",
    componentNames,
    descriptions,
    schemas,
    tools,
  };

  const outDir = join(__dirname, "..", "shared", "component-manifest", "generated");
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "component-data.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(`[generate-mcp-manifest] Wrote ${outPath}`);
  console.log(`  ${componentNames.length} components`);
  console.log(`  ${Object.keys(schemas).length} JSON schemas`);
  console.log(`  ${tools.length} per-component MCP tools`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
