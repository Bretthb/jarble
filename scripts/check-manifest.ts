#!/usr/bin/env npx tsx
/**
 * Manifest CI check — verifies the component manifest is in sync with the codebase.
 *
 * Checks:
 *   1. Every manifest entry has a corresponding React component file
 *   2. No orphaned Canvas*.tsx files exist without a manifest entry
 *   3. Every key in CANVAS_COMPONENTS (registry.ts) has a manifest entry
 *
 * Usage:
 *   npx tsx scripts/check-manifest.ts
 *
 * Exit code:
 *   0 — all checks pass
 *   1 — one or more mismatches found
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, "..");
const MANIFEST_FILE = join(ROOT, "shared", "component-manifest", "index.ts");
const CANVAS_DIR = join(ROOT, "Jarble-mvp", "components", "canvas", "components");
const REGISTRY_FILE = join(ROOT, "Jarble-mvp", "components", "canvas", "registry.ts");

// ── Special cases ────────────────────────────────────────────────────────────

/**
 * Names to skip when checking for Canvas{PascalName}.tsx files.
 * "canvas" is an alias for "sandbox" — the sandbox entry already covers the file.
 */
const SKIP_MANIFEST_TO_FILE = new Set(["canvas"]);

/**
 * Components whose file doesn't follow the Canvas{PascalName}.tsx convention.
 * Key: manifest name, Value: path relative to ROOT.
 */
const SPECIAL_FILE_MAP: Record<string, string> = {
  marketplace_sandbox: join(
    "Jarble-mvp",
    "components",
    "canvas",
    "components",
    "MarketplaceSandbox.tsx"
  ),
};

/**
 * Files in the Canvas*.tsx directory that are NOT standard Canvas components
 * and should be excluded from the orphan check.
 */
const SKIP_ORPHAN_FILES = new Set(["MarketplaceSandbox.tsx"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert snake_case to PascalCase: "data_table" -> "DataTable" */
function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** Convert PascalCase to snake_case: "DataTable" -> "data_table" */
function toSnakeCase(pascal: string): string {
  return pascal
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

// ── Extract manifest names ───────────────────────────────────────────────────

function getManifestNames(): string[] {
  const content = readFileSync(MANIFEST_FILE, "utf-8");

  // Find the COMPONENT_MANIFEST object and extract keys.
  // Each entry looks like:  card: cardEntry,  or  canvas: { ...sandboxEntry, ... },
  const manifestBlock = content.match(
    /export const COMPONENT_MANIFEST[^{]*\{([\s\S]*?)\n\};/
  );
  if (!manifestBlock) {
    console.error("ERROR: Could not parse COMPONENT_MANIFEST from", MANIFEST_FILE);
    process.exit(2);
  }

  const names: string[] = [];
  // Match lines like "  card: cardEntry," or "  canvas: { ...sandboxEntry, ... },"
  const linePattern = /^\s+(\w+)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(manifestBlock[1])) !== null) {
    names.push(match[1]);
  }

  return names;
}

// ── Extract registry keys ────────────────────────────────────────────────────

function getRegistryKeys(): string[] {
  const content = readFileSync(REGISTRY_FILE, "utf-8");

  const registryBlock = content.match(
    /export const CANVAS_COMPONENTS[^{]*\{([\s\S]*?)\n\};/
  );
  if (!registryBlock) {
    console.error("ERROR: Could not parse CANVAS_COMPONENTS from", REGISTRY_FILE);
    process.exit(2);
  }

  const keys: string[] = [];
  const linePattern = /^\s+(\w+)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(registryBlock[1])) !== null) {
    keys.push(match[1]);
  }

  return keys;
}

// ── Checks ───────────────────────────────────────────────────────────────────

let errors = 0;

const manifestNames = getManifestNames();
console.log(`Found ${manifestNames.length} manifest entries.`);

// Check 1: Every manifest entry has a corresponding React component file
console.log("\n--- Check 1: Manifest entries -> React component files ---");
let check1Errors = 0;

for (const name of manifestNames) {
  if (SKIP_MANIFEST_TO_FILE.has(name)) continue;

  if (SPECIAL_FILE_MAP[name]) {
    const specialPath = join(ROOT, SPECIAL_FILE_MAP[name]);
    if (!existsSync(specialPath)) {
      console.error(`  MISSING: ${name} -> expected ${SPECIAL_FILE_MAP[name]}`);
      check1Errors++;
    }
    continue;
  }

  const pascal = toPascalCase(name);
  const filePath = join(CANVAS_DIR, `Canvas${pascal}.tsx`);
  if (!existsSync(filePath)) {
    console.error(`  MISSING: ${name} -> expected Canvas${pascal}.tsx`);
    check1Errors++;
  }
}

if (check1Errors === 0) {
  console.log("  All manifest entries have matching component files.");
} else {
  errors += check1Errors;
}

// Check 2: No orphaned Canvas*.tsx files without manifest entries
console.log("\n--- Check 2: Orphaned Canvas*.tsx files ---");
let check2Errors = 0;

const canvasFiles = readdirSync(CANVAS_DIR).filter(
  (f) => f.startsWith("Canvas") && f.endsWith(".tsx")
);

const manifestNameSet = new Set(manifestNames);

for (const file of canvasFiles) {
  if (SKIP_ORPHAN_FILES.has(file)) continue;

  const pascal = file.replace(/^Canvas/, "").replace(/\.tsx$/, "");
  const snakeName = toSnakeCase(pascal);

  if (!manifestNameSet.has(snakeName)) {
    console.error(`  ORPHANED: ${file} -> no manifest entry for "${snakeName}"`);
    check2Errors++;
  }
}

if (check2Errors === 0) {
  console.log("  No orphaned Canvas*.tsx files found.");
} else {
  errors += check2Errors;
}

// Check 3: Registry keys match manifest entries
console.log("\n--- Check 3: Registry keys -> Manifest entries ---");
let check3Errors = 0;

const registryKeys = getRegistryKeys();
console.log(`  Found ${registryKeys.length} registry entries.`);

for (const key of registryKeys) {
  if (!manifestNameSet.has(key)) {
    console.error(
      `  UNMATCHED: registry key "${key}" has no manifest entry`
    );
    check3Errors++;
  }
}

// Also check reverse: manifest entries that are missing from registry
for (const name of manifestNames) {
  if (SKIP_MANIFEST_TO_FILE.has(name)) continue; // "canvas" alias may or may not be in registry
  if (!registryKeys.includes(name)) {
    console.error(
      `  UNMATCHED: manifest entry "${name}" has no registry key`
    );
    check3Errors++;
  }
}

if (check3Errors === 0) {
  console.log("  All registry keys match manifest entries.");
} else {
  errors += check3Errors;
}

// Check 4: Every component has a corresponding generated JSON Schema
console.log("\n--- Check 4: Generated JSON schemas ---");
let check4Errors = 0;

const generatedDataPath = join(ROOT, "shared", "component-manifest", "generated", "component-data.json");
if (!existsSync(generatedDataPath)) {
  console.error("  MISSING: component-data.json not found. Run: npx tsx scripts/generate-mcp-manifest.ts");
  check4Errors++;
} else {
  const generatedData = JSON.parse(readFileSync(generatedDataPath, "utf-8"));
  if (!generatedData.schemas || typeof generatedData.schemas !== "object") {
    console.error("  MISSING: component-data.json has no 'schemas' field. Regenerate with: npx tsx scripts/generate-mcp-manifest.ts");
    check4Errors++;
  } else {
    const schemaNames = Object.keys(generatedData.schemas);
    console.log(`  Found ${schemaNames.length} generated schemas.`);

    // Every non-alias manifest entry should have a schema
    for (const name of manifestNames) {
      if (SKIP_MANIFEST_TO_FILE.has(name)) continue;
      if (!generatedData.schemas[name]) {
        console.error(`  MISSING SCHEMA: manifest entry "${name}" has no generated JSON schema`);
        check4Errors++;
      }
    }

    // Every schema should have a manifest entry
    for (const name of schemaNames) {
      if (!manifestNameSet.has(name)) {
        console.error(`  EXTRA SCHEMA: schema "${name}" has no manifest entry`);
        check4Errors++;
      }
    }
  }
}

if (check4Errors === 0) {
  console.log("  All components have matching generated schemas.");
} else {
  errors += check4Errors;
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("");
if (errors > 0) {
  console.error(`FAIL: ${errors} manifest check error(s) found.`);
  process.exit(1);
} else {
  console.log(
    "PASS: Manifest check passed — all components in sync."
  );
  process.exit(0);
}
