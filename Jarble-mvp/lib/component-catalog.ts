/**
 * Component Catalog — Types + template resolution for custom bot components.
 *
 * Ported from jarble-api-main/src/utils/componentResolver.ts for client-side use.
 * Custom components are templates composed of built-in primitives with {{variable}} placeholders.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface LayoutChild {
  component: string;
  props: Record<string, unknown>;
}

export interface ComponentDefinition {
  name: string;
  description?: string;
  layout: LayoutChild[];
}

export interface ComponentCatalog {
  builtins: Array<{ name: string; description: string }>;
  customs: ComponentDefinition[];
}

export interface ResolvedBlock {
  component: string;
  props: Record<string, unknown>;
}

// ── Template Substitution ──────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;
const MAX_DEPTH = 3;

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
    const trimmed = value.trim();
    const singleMatch = trimmed.match(/^\{\{(\w+)\}\}$/);
    if (singleMatch) {
      const key = singleMatch[1];
      return key in vars ? vars[key] : value;
    }

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
 * Extract unique variable names from a component template's layout.
 * Used to generate Zod schemas for Tambo component registration.
 */
export function extractTemplateVars(definition: ComponentDefinition): string[] {
  const vars = new Set<string>();

  function scan(value: unknown, depth: number = 0): void {
    if (depth > MAX_DEPTH) return;

    if (typeof value === "string") {
      let match: RegExpExecArray | null;
      const re = /\{\{(\w+)\}\}/g;
      while ((match = re.exec(value)) !== null) {
        vars.add(match[1]);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) scan(item, depth + 1);
      return;
    }

    if (typeof value === "object" && value !== null) {
      for (const v of Object.values(value)) scan(v, depth + 1);
    }
  }

  for (const child of definition.layout) {
    scan(child.props);
  }

  return Array.from(vars);
}
