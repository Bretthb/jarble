/**
 * Tambo Canvas Component Registry
 *
 * Maps all canvas components from CANVAS_COMPONENTS to TamboComponent format
 * so Tambo's registry can resolve and render them directly (e.g. in config sidebar).
 *
 * Zod v4 implements StandardSchemaV1, so schemas work natively with Tambo.
 *
 * Tambo's registry converts propsSchema to JSON Schema internally. Schemas that
 * use z.record(), z.unknown(), or .transform() cannot be serialized and will
 * throw at registration time. We filter these out automatically by testing each
 * schema with Zod's toJSONSchema() before including it.
 */

import { toJSONSchema, type ZodType } from "zod";
import { CANVAS_COMPONENTS } from "@/components/canvas/registry";
import { COMPONENT_MANIFEST } from "@jarble/component-manifest";
import type { TamboComponent } from "@tambo-ai/react";

/** Check if a JSON Schema subtree contains any record pattern (additionalProperties
 *  as an object). Mirrors Tambo's assertNoRecordInJsonSchema validation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasRecordPattern(schema: any): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (
    schema.type === "object" &&
    typeof schema.additionalProperties === "object" &&
    schema.additionalProperties !== null
  ) return true;
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) {
      if (hasRecordPattern(v)) return true;
    }
  }
  if (schema.items) {
    if (Array.isArray(schema.items)) {
      for (const item of schema.items) { if (hasRecordPattern(item)) return true; }
    } else if (hasRecordPattern(schema.items)) return true;
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
    if (Array.isArray(schema[key])) {
      for (const sub of schema[key]) { if (hasRecordPattern(sub)) return true; }
    }
  }
  return false;
}

/** Test whether a Zod schema is compatible with Tambo's registry.
 *  Returns false for schemas using z.record(), z.unknown(), .transform(), etc. */
function isTamboCompatible(schema: unknown): boolean {
  try {
    const jsonSchema = toJSONSchema(schema as ZodType);
    return !hasRecordPattern(jsonSchema);
  } catch {
    return false;
  }
}

export const tamboCanvasComponents: TamboComponent[] = Object.entries(CANVAS_COMPONENTS)
  .filter(([, entry]) => isTamboCompatible(entry.propsSchema))
  .map(([name, entry]) => ({
    name,
    description:
      COMPONENT_MANIFEST[name]?.description ?? `Render a ${name.replace(/_/g, " ")} component`,
    component: entry.component,
    propsSchema: entry.propsSchema,
  }));
