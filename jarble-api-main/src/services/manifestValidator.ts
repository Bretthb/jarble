/**
 * Manifest Validator — Pure validation for marketplace component packages.
 *
 * Validates marketplace manifests, template JSON (Tier 1), and sandbox HTML
 * (Tier 2) before they're accepted into the marketplace. All functions are
 * pure (no DB access, no side effects) — they just validate data and return
 * structured results.
 */

import { COMPONENT_NAME_SET } from "@jarble/component-manifest";
import { createModuleLogger } from "../utils/logger.js";
import { MARKETPLACE_CATEGORIES } from "./marketplace.types.js";

const log = createModuleLogger("manifest");
import type { MarketplaceCategory } from "./marketplace.types.js";

// ── Result Type ─────────────────────────────────────────────────────────────

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  tier: "template" | "sandbox" | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const VALID_TIERS = new Set(["template", "sandbox"]);
const VALID_PRICING_MODELS = new Set(["free", "one_time", "subscription"]);
const CATEGORY_SET: Set<string> = new Set(MARKETPLACE_CATEGORIES as readonly string[]);
const MAX_EXAMPLE_PROMPTS = 5;
const MAX_TEMPLATE_SIZE = 50 * 1024; // 50KB
const MAX_SANDBOX_SIZE = 1 * 1024 * 1024; // 1MB

// ── Dangerous patterns for sandbox HTML static analysis ─────────────────────

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /document\.cookie/g, description: "Access to document.cookie" },
  { pattern: /localStorage/g, description: "Access to localStorage" },
  { pattern: /sessionStorage/g, description: "Access to sessionStorage" },
  { pattern: /window\.top(?!\w)/g, description: "Access to window.top" },
  { pattern: /\beval\s*\(/g, description: "Use of eval()" },
  { pattern: /\bnew\s+Function\s*\(/g, description: "Use of Function() constructor" },
  { pattern: /<iframe[\s>]/gi, description: "Embedded <iframe> tag" },
  { pattern: /<object[\s>]/gi, description: "Embedded <object> tag" },
  { pattern: /<embed[\s>]/gi, description: "Embedded <embed> tag" },
];

/**
 * window.parent access is allowed in the jarble bridge pattern:
 *   window.parent.postMessage(...)
 * But disallowed for other uses like window.parent.document, etc.
 */
const WINDOW_PARENT_PATTERN = /window\.parent(?!\.postMessage)/g;

/**
 * Hardcoded script sources that aren't from known CDNs.
 * Matches <script src="..."> where src is not a known CDN.
 */
const KNOWN_CDNS = [
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "cdn.skypack.dev",
  "esm.sh",
  "threejs.org",
  "d3js.org",
];

const SCRIPT_SRC_PATTERN = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function tryParseJson(val: unknown): boolean {
  if (typeof val === "string") {
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }
  // Already an object/array — valid JSON value
  return isPlainObject(val) || Array.isArray(val);
}

// ── Manifest Validation ─────────────────────────────────────────────────────

/**
 * Validate a marketplace component manifest.
 *
 * Checks required fields, name format, version format, tier validity,
 * category, pricing model, and optional structured fields (propsSchema,
 * exampleProps, examplePrompts).
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  log.debug({ name: (manifest as any)?.name, tier: (manifest as any)?.tier }, "validateManifest");
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Must be a valid JSON object
  if (!isPlainObject(manifest)) {
    return { valid: false, errors: ["Manifest must be a valid JSON object."], warnings: [], tier: null };
  }

  const m = manifest as Record<string, unknown>;

  // 2. Required fields
  const requiredFields = ["name", "displayName", "description", "version", "tier"];
  for (const field of requiredFields) {
    if (!(field in m) || m[field] === undefined || m[field] === null) {
      errors.push(`Missing required field: "${field}".`);
    } else if (typeof m[field] !== "string") {
      errors.push(`Field "${field}" must be a string.`);
    }
  }

  // If we're missing critical fields, return early — subsequent checks depend on them
  if (errors.length > 0) {
    return { valid: false, errors, warnings, tier: null };
  }

  const name = m.name as string;
  const tier = m.tier as string;
  const version = m.version as string;

  // 3. Name format
  if (!NAME_PATTERN.test(name)) {
    errors.push(
      `Invalid name "${name}". Must start with a lowercase letter, contain only lowercase letters, digits, and underscores, and be 1-64 characters.`
    );
  }

  // 4. Tier
  if (!VALID_TIERS.has(tier)) {
    errors.push(`Invalid tier "${tier}". Must be "template" or "sandbox".`);
  }

  // 5. Version (simple semver)
  if (!SEMVER_PATTERN.test(version)) {
    errors.push(`Invalid version "${version}". Must be semantic versioning (e.g., "1.0.0").`);
  }

  // 6. Category
  if ("category" in m) {
    if (typeof m.category !== "string") {
      errors.push(`Field "category" must be a string.`);
    } else if (!CATEGORY_SET.has(m.category)) {
      errors.push(
        `Invalid category "${m.category}". Must be one of: ${MARKETPLACE_CATEGORIES.join(", ")}.`
      );
    }
  }

  // 7. propsSchema — must be valid JSON if present
  if ("propsSchema" in m && m.propsSchema !== undefined) {
    if (!tryParseJson(m.propsSchema)) {
      errors.push(`Field "propsSchema" must be valid JSON.`);
    }
  }

  // 8. exampleProps — must be valid JSON if present
  if ("exampleProps" in m && m.exampleProps !== undefined) {
    if (!tryParseJson(m.exampleProps)) {
      errors.push(`Field "exampleProps" must be valid JSON.`);
    }
  }

  // 9. examplePrompts — must be array of strings, max 5
  if ("examplePrompts" in m && m.examplePrompts !== undefined) {
    if (!Array.isArray(m.examplePrompts)) {
      errors.push(`Field "examplePrompts" must be an array.`);
    } else {
      if (m.examplePrompts.length > MAX_EXAMPLE_PROMPTS) {
        errors.push(`Field "examplePrompts" has ${m.examplePrompts.length} items, max is ${MAX_EXAMPLE_PROMPTS}.`);
      }
      for (let i = 0; i < m.examplePrompts.length; i++) {
        if (typeof m.examplePrompts[i] !== "string") {
          errors.push(`examplePrompts[${i}] must be a string.`);
        }
      }
    }
  }

  // 10. pricingModel
  if ("pricingModel" in m && m.pricingModel !== undefined) {
    if (typeof m.pricingModel !== "string" || !VALID_PRICING_MODELS.has(m.pricingModel)) {
      errors.push(`Invalid pricingModel "${m.pricingModel}". Must be "free", "one_time", or "subscription".`);
    }
  }

  // 11. priceUsdCents required when pricingModel is not "free"
  if ("pricingModel" in m && m.pricingModel !== "free" && m.pricingModel !== undefined) {
    if (!("priceUsdCents" in m) || typeof m.priceUsdCents !== "number" || m.priceUsdCents <= 0) {
      errors.push(`Field "priceUsdCents" must be a positive number when pricingModel is not "free".`);
    }
  }

  // 12. configSchema validation (sandbox tier only)
  if ("configSchema" in m && m.configSchema !== undefined) {
    if (tier !== "sandbox") {
      errors.push(`Field "configSchema" is only allowed for sandbox tier components.`);
    } else {
      const configResult = validateConfigSchema(m.configSchema);
      errors.push(...configResult.errors.map((e) => `configSchema: ${e}`));
      warnings.push(...configResult.warnings.map((w) => `configSchema: ${w}`));
    }
  }

  // 13. sdkVersion — optional, must be a valid version string if present
  if ("sdkVersion" in m && m.sdkVersion !== undefined) {
    if (typeof m.sdkVersion !== "string" || !/^\d+\.\d+$/.test(m.sdkVersion)) {
      errors.push(`Field "sdkVersion" must be a version string (e.g., "1.0").`);
    }
  }

  const valid = errors.length === 0;
  const resolvedTier = VALID_TIERS.has(tier) ? (tier as "template" | "sandbox") : null;
  log.info({ valid, errorCount: errors.length, warningCount: warnings.length }, "validateManifest complete");
  return { valid, errors, warnings, tier: resolvedTier };
}

// ── Template JSON Validation (Tier 1) ───────────────────────────────────────

/**
 * Validate a Tier 1 template JSON package.
 *
 * Ensures the template has a valid layout array where each item references
 * a known built-in component (no sandbox references allowed in templates).
 * Also enforces a 50KB size limit.
 */
export function validateTemplateJson(
  template: unknown,
  manifest: Record<string, unknown>
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Must be valid JSON object
  if (!isPlainObject(template)) {
    return { valid: false, errors: ["Template must be a valid JSON object."], warnings: [], tier: "template" };
  }

  const t = template as Record<string, unknown>;

  // 2. Must have `layout` array
  if (!("layout" in t) || !Array.isArray(t.layout)) {
    errors.push(`Template must have a "layout" array.`);
    return { valid: false, errors, warnings, tier: "template" };
  }

  const layout = t.layout as unknown[];

  // 3. Validate each layout item
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];

    if (!isPlainObject(item)) {
      errors.push(`layout[${i}] must be an object.`);
      continue;
    }

    const entry = item as Record<string, unknown>;

    // Must have `component` (string)
    if (typeof entry.component !== "string") {
      errors.push(`layout[${i}] must have a string "component" field.`);
      continue;
    }

    // Must have `props` (object)
    if (!isPlainObject(entry.props)) {
      errors.push(`layout[${i}] must have an object "props" field.`);
    }

    // 4. Component must be a known built-in
    if (!COMPONENT_NAME_SET.has(entry.component)) {
      errors.push(
        `layout[${i}] references unknown component "${entry.component}". Only built-in components are allowed in templates.`
      );
    }

    // 5. No sandbox component references
    if (entry.component === "sandbox" || entry.component === "canvas") {
      errors.push(
        `layout[${i}] references "${entry.component}". Template tier cannot embed sandbox components.`
      );
    }
  }

  // 6. Total JSON size < 50KB
  const jsonStr = JSON.stringify(template);
  if (jsonStr.length > MAX_TEMPLATE_SIZE) {
    errors.push(
      `Template JSON is ${jsonStr.length} bytes, max is ${MAX_TEMPLATE_SIZE} (50KB).`
    );
  }

  return { valid: errors.length === 0, errors, warnings, tier: "template" };
}

// ── Sandbox HTML Validation (Tier 2) ────────────────────────────────────────

/**
 * Validate a Tier 2 sandbox HTML package.
 *
 * Performs size checks and static analysis for dangerous patterns. Dangerous
 * patterns are returned as warnings (flagged for review), not errors, since
 * some legitimate libraries may trigger them. The only hard error is the
 * size limit.
 */
export function validateSandboxHtml(html: string): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Must be a string
  if (typeof html !== "string") {
    return { valid: false, errors: ["Sandbox HTML must be a string."], warnings: [], tier: "sandbox" };
  }

  // 2. Size < 1MB
  const sizeBytes = Buffer.byteLength(html, "utf8");
  if (sizeBytes > MAX_SANDBOX_SIZE) {
    errors.push(
      `Sandbox HTML is ${sizeBytes} bytes, max is ${MAX_SANDBOX_SIZE} (1MB).`
    );
  }

  // 3. Static analysis for dangerous patterns (warnings, not errors)
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    if (pattern.test(html)) {
      warnings.push(`Flagged for review: ${description}`);
    }
  }

  // window.parent check (allowed for jarble bridge postMessage)
  WINDOW_PARENT_PATTERN.lastIndex = 0;
  if (WINDOW_PARENT_PATTERN.test(html)) {
    warnings.push("Flagged for review: Access to window.parent (non-postMessage usage)");
  }

  // Hardcoded non-CDN script sources
  let scriptMatch: RegExpExecArray | null;
  SCRIPT_SRC_PATTERN.lastIndex = 0;
  while ((scriptMatch = SCRIPT_SRC_PATTERN.exec(html)) !== null) {
    const src = scriptMatch[1];
    try {
      const url = new URL(src);
      const isKnownCdn = KNOWN_CDNS.some((cdn) => url.hostname === cdn || url.hostname.endsWith(`.${cdn}`));
      if (!isKnownCdn) {
        warnings.push(`Flagged for review: Non-CDN script source "${src}"`);
      }
    } catch {
      // Relative paths are fine — only flag absolute URLs from unknown origins
    }
  }

  // 4. Check for required jarble bridge setup
  if (!html.includes("window.__JARBLE_PROPS__")) {
    warnings.push("Missing jarble bridge setup: expected window.__JARBLE_PROPS__ reference.");
  }

  if (warnings.length > 0) {
    log.warn({ warningCount: warnings.length }, "validateSandboxHtml: security flags detected");
  }
  return { valid: errors.length === 0, errors, warnings, tier: "sandbox" };
}

// ── Config Schema Validation ─────────────────────────────────────────────────

/** Valid JSON Schema types for config panel fields. */
const VALID_JSON_SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

/**
 * Validate a sandbox configSchema (JSON Schema format).
 *
 * Ensures the schema is a valid JSON Schema object with supported field types
 * for rendering in SandboxConfigPanel. Returns warnings for advanced features
 * that the config panel may not fully support.
 */
export function validateConfigSchema(schema: unknown): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(schema)) {
    return { valid: false, errors: ["configSchema must be a JSON object."], warnings: [] };
  }

  const s = schema as Record<string, unknown>;

  // Must be type "object" at root level
  if (s.type !== "object") {
    errors.push(`configSchema root must have type "object", got "${String(s.type || "undefined")}".`);
  }

  // Must have properties
  if (!isPlainObject(s.properties)) {
    errors.push(`configSchema must have a "properties" object.`);
    return { valid: errors.length === 0, errors, warnings };
  }

  const properties = s.properties as Record<string, unknown>;
  const propertyCount = Object.keys(properties).length;
  log.debug({ propertyCount }, "validateConfigSchema");

  if (propertyCount === 0) {
    errors.push(`configSchema.properties must have at least one property.`);
  }

  if (propertyCount > 50) {
    errors.push(`configSchema.properties has ${propertyCount} fields, max is 50.`);
  }

  // Validate each property definition
  for (const [key, value] of Object.entries(properties)) {
    if (!isPlainObject(value)) {
      errors.push(`configSchema.properties["${key}"] must be an object.`);
      continue;
    }

    const prop = value as Record<string, unknown>;

    // Must have a type
    if (typeof prop.type !== "string") {
      errors.push(`configSchema.properties["${key}"] must have a string "type" field.`);
      continue;
    }

    if (!VALID_JSON_SCHEMA_TYPES.has(prop.type)) {
      errors.push(`configSchema.properties["${key}"] has unsupported type "${prop.type}".`);
    }

    // Warn about advanced features the config panel renders as plain inputs
    if (prop.type === "object") {
      warnings.push(`configSchema.properties["${key}"] has type "object" — rendered as JSON textarea.`);
    }
    if (prop.type === "array") {
      warnings.push(`configSchema.properties["${key}"] has type "array" — rendered as JSON textarea.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
