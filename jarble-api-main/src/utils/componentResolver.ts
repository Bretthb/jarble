/**
 * Component Resolver - Template substitution + validation for bot-defined components.
 *
 * Custom components are JSON definitions stored on the PVC at /data/components/{name}.json.
 * They contain a `layout` array of built-in primitive blocks with {{variable}} placeholders
 * that get substituted from the caller's props.
 */

// Built-in component names - imported from the shared manifest (single source of truth)
import { COMPONENT_NAME_SET } from "@jarble/component-manifest";
import { createModuleLogger } from "./logger.js";

const log = createModuleLogger("componentResolver");

export const BUILTIN_COMPONENTS: Set<string> = COMPONENT_NAME_SET;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ComponentDefinition {
  name: string;
  description?: string;
  layout: LayoutChild[];
}

export interface LayoutChild {
  component: string;
  props: Record<string, unknown>;
}

export interface ResolvedBlock {
  component: string;
  props: Record<string, unknown>;
}

// ── Validation ─────────────────────────────────────────────────────────────

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_CHILDREN = 20;
const MAX_DEFINITION_SIZE = 50 * 1024; // 50KB
const MAX_DEPTH = 3;

export function validateComponentName(name: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    const error = `Invalid component name "${name}". Must be lowercase, start with a letter, and contain only letters, digits, and underscores (max 64 chars).`;
    log.debug({ name, error }, "validateComponentName: invalid");
    return error;
  }
  if (BUILTIN_COMPONENTS.has(name)) {
    const error = `Cannot override built-in component "${name}".`;
    log.debug({ name, error }, "validateComponentName: invalid");
    return error;
  }
  return null;
}

export function validateComponentDefinition(def: unknown): string | null {
  if (typeof def !== "object" || def === null) {
    const error = "Component definition must be an object.";
    log.debug({ error }, "validateComponentDefinition: invalid");
    return error;
  }

  const d = def as Record<string, unknown>;

  if (typeof d.name !== "string") {
    const error = "Component definition must have a string 'name'.";
    log.debug({ error }, "validateComponentDefinition: invalid");
    return error;
  }

  const nameErr = validateComponentName(d.name);
  if (nameErr) return nameErr; // already logged by validateComponentName

  if (!Array.isArray(d.layout)) {
    const error = "Component definition must have a 'layout' array.";
    log.debug({ error }, "validateComponentDefinition: invalid");
    return error;
  }

  if (d.layout.length === 0) {
    const error = "Layout array must have at least one child.";
    log.debug({ error }, "validateComponentDefinition: invalid");
    return error;
  }

  if (d.layout.length > MAX_CHILDREN) {
    const error = `Layout has ${d.layout.length} children, max is ${MAX_CHILDREN}.`;
    log.debug({ error }, "validateComponentDefinition: invalid");
    return error;
  }

  // Validate each child
  for (let i = 0; i < d.layout.length; i++) {
    const child = d.layout[i];
    if (typeof child !== "object" || child === null) {
      const error = `Layout child ${i} must be an object.`;
      log.debug({ error }, "validateComponentDefinition: invalid");
      return error;
    }
    const c = child as Record<string, unknown>;
    if (typeof c.component !== "string") {
      const error = `Layout child ${i} must have a string 'component'.`;
      log.debug({ error }, "validateComponentDefinition: invalid");
      return error;
    }
    if (!BUILTIN_COMPONENTS.has(c.component)) {
      const error = `Layout child ${i} references unknown built-in component "${c.component}". Custom components can only use built-in primitives.`;
      log.debug({ error }, "validateComponentDefinition: invalid");
      return error;
    }
    if (typeof c.props !== "object" || c.props === null) {
      const error = `Layout child ${i} must have an object 'props'.`;
      log.debug({ error }, "validateComponentDefinition: invalid");
      return error;
    }
  }

  // Size check
  const json = JSON.stringify(def);
  if (json.length > MAX_DEFINITION_SIZE) {
    const error = `Component definition is ${json.length} bytes, max is ${MAX_DEFINITION_SIZE}.`;
    log.debug({ error }, "validateComponentDefinition: invalid");
    return error;
  }

  return null;
}

// ── Template Substitution ──────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/**
 * Substitute {{variable}} placeholders in a value.
 *
 * - If the entire value is a single "{{variable}}" string, replace with the raw value
 *   (preserves arrays, objects, numbers).
 * - If the value contains mixed text + placeholders, do string interpolation.
 * - Recurse into objects and arrays up to MAX_DEPTH.
 */
function substituteValue(
  value: unknown,
  vars: Record<string, unknown>,
  depth: number = 0
): unknown {
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "string") {
    // Check if the entire string is a single placeholder
    const trimmed = value.trim();
    const singleMatch = trimmed.match(/^\{\{(\w+)\}\}$/);
    if (singleMatch) {
      const key = singleMatch[1];
      return key in vars ? vars[key] : value;
    }

    // Mixed string interpolation
    return value.replace(PLACEHOLDER_RE, (_, key) => {
      if (key in vars) {
        const v = vars[key];
        return typeof v === "string" ? v : JSON.stringify(v);
      }
      return `{{${key}}}`;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteValue(item, vars, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = substituteValue(v, vars, depth + 1);
    }
    return result;
  }

  return value;
}

/** Max total resolved blocks from a single custom component expansion */
const MAX_EXPANDED = 50;

/** Max serialized size (in bytes) of resolved props after substitution - prevents memory bombs */
const MAX_RESOLVED_PROPS_SIZE = 256 * 1024; // 256KB

/**
 * Resolve a custom component definition by substituting props into the layout template.
 * Returns an array of resolved blocks (built-in primitives with concrete props).
 *
 * Enforces expansion limits to prevent unbounded resource usage from malicious
 * or buggy custom component definitions.
 */
export function resolveCustomComponent(
  definition: ComponentDefinition,
  props: Record<string, unknown>
): ResolvedBlock[] {
  log.debug({ name: definition.name, propCount: Object.keys(props).length }, "resolveCustomComponent");

  const expanded = definition.layout.map((child) => ({
    component: child.component,
    props: substituteValue(child.props, props, 0) as Record<string, unknown>,
  }));

  // Guard: limit total expanded children
  if (expanded.length > MAX_EXPANDED) {
    log.warn(
      { name: definition.name, expandedCount: expanded.length, max: MAX_EXPANDED },
      "Custom component expanded to too many children, truncating"
    );
    return expanded.slice(0, MAX_EXPANDED);
  }

  // Guard: limit total resolved props size to prevent memory bombs
  try {
    const totalSize = JSON.stringify(expanded).length;
    if (totalSize > MAX_RESOLVED_PROPS_SIZE) {
      log.warn(
        { name: definition.name, totalSize, max: MAX_RESOLVED_PROPS_SIZE },
        "Custom component resolved props too large, returning empty"
      );
      return [];
    }
  } catch {
    log.warn({ name: definition.name }, "Failed to measure resolved props size (non-serializable)");
    return [];
  }

  return expanded;
}

/**
 * Check if a component name refers to a built-in component.
 */
export function isBuiltinComponent(name: string): boolean {
  return BUILTIN_COMPONENTS.has(name);
}
