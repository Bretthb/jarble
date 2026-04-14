/**
 * Zod-based argument validation helper.
 *
 * Tools declare their input shape as a Zod v3 schema. This helper runs the
 * parse and throws a typed `InvalidArgsError` on failure so the proxy / SDK
 * adapter can render a uniform error response.
 */

import type { z } from "zod";
import { InvalidArgsError } from "./errors.js";

export function validateArgs<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  toolName: string,
): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new InvalidArgsError(
      `Invalid arguments for tool "${toolName}"`,
      issues,
    );
  }
  return result.data;
}
