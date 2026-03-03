import { TRPCError } from "@trpc/server";

/**
 * Validates that a string is a valid JSON Schema draft-07 object suitable
 * for describing component props (must have root type "object" with "properties").
 *
 * Throws a descriptive TRPCError on validation failure.
 */
export function validatePropsSchema(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "propsSchema must be valid JSON",
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "propsSchema must be a JSON object",
    });
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.type !== "object") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: 'propsSchema root type must be "object"',
    });
  }

  if (!obj.properties || typeof obj.properties !== "object") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: 'propsSchema must have a "properties" key',
    });
  }
}
