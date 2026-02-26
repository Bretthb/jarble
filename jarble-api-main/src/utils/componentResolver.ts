/**
 * Component Resolver — Template substitution + validation for bot-defined components.
 *
 * Custom components are JSON definitions stored on the PVC at /data/components/{name}.json.
 * They contain a `layout` array of built-in primitive blocks with {{variable}} placeholders
 * that get substituted from the caller's props.
 */

// Built-in component names that cannot be overridden
export const BUILTIN_COMPONENTS = new Set([
  "card",
  "data_table",
  "stat_grid",
  "key_value",
  "code_block",
  "alert",
  "progress",
  "image",
  "layout",
  "chart",
  "tabs",
  "accordion",
  "badge",
  "list",
  "timeline",
  "divider",
  "metric_card",
  "header",
  "button_group",
  "form",
  "code_editor",
  "spreadsheet",
  "sandbox",
  "video",
  "canvas", // alias for sandbox
]);

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
    return `Invalid component name "${name}". Must be lowercase, start with a letter, and contain only letters, digits, and underscores (max 64 chars).`;
  }
  if (BUILTIN_COMPONENTS.has(name)) {
    return `Cannot override built-in component "${name}".`;
  }
  return null;
}

export function validateComponentDefinition(def: unknown): string | null {
  if (typeof def !== "object" || def === null) {
    return "Component definition must be an object.";
  }

  const d = def as Record<string, unknown>;

  if (typeof d.name !== "string") {
    return "Component definition must have a string 'name'.";
  }

  const nameErr = validateComponentName(d.name);
  if (nameErr) return nameErr;

  if (!Array.isArray(d.layout)) {
    return "Component definition must have a 'layout' array.";
  }

  if (d.layout.length === 0) {
    return "Layout array must have at least one child.";
  }

  if (d.layout.length > MAX_CHILDREN) {
    return `Layout has ${d.layout.length} children, max is ${MAX_CHILDREN}.`;
  }

  // Validate each child
  for (let i = 0; i < d.layout.length; i++) {
    const child = d.layout[i];
    if (typeof child !== "object" || child === null) {
      return `Layout child ${i} must be an object.`;
    }
    const c = child as Record<string, unknown>;
    if (typeof c.component !== "string") {
      return `Layout child ${i} must have a string 'component'.`;
    }
    if (!BUILTIN_COMPONENTS.has(c.component)) {
      return `Layout child ${i} references unknown built-in component "${c.component}". Custom components can only use built-in primitives.`;
    }
    if (typeof c.props !== "object" || c.props === null) {
      return `Layout child ${i} must have an object 'props'.`;
    }
  }

  // Size check
  const json = JSON.stringify(def);
  if (json.length > MAX_DEFINITION_SIZE) {
    return `Component definition is ${json.length} bytes, max is ${MAX_DEFINITION_SIZE}.`;
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

/**
 * Resolve a custom component definition by substituting props into the layout template.
 * Returns an array of resolved blocks (built-in primitives with concrete props).
 */
export function resolveCustomComponent(
  definition: ComponentDefinition,
  props: Record<string, unknown>
): ResolvedBlock[] {
  return definition.layout.map((child) => ({
    component: child.component,
    props: substituteValue(child.props, props, 0) as Record<string, unknown>,
  }));
}

/**
 * Check if a component name refers to a built-in component.
 */
export function isBuiltinComponent(name: string): boolean {
  return BUILTIN_COMPONENTS.has(name);
}
