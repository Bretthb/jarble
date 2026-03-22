/**
 * Lightweight JSON Schema validation for ServiceCard skill input/output schemas.
 *
 * Supports a useful subset of JSON Schema draft-07:
 *   - Type checking: string, number, integer, boolean, object, array, null
 *   - Required fields
 *   - Nested object validation (recursive)
 *   - Array items type checking
 *   - Enum validation
 *
 * Does NOT support: $ref, allOf/anyOf/oneOf, pattern, format, min/max,
 * additionalProperties enforcement, or any advanced keywords. This is
 * intentional — we want a zero-dependency validator for the proxy hot path.
 *
 * For full JSON Schema validation, use a dedicated library like Ajv.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

interface JsonSchemaProperty {
  type?: string | string[];
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
  enum?: unknown[];
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Type Checking ──────────────────────────────────────────────────────────

/**
 * Check if a value matches a JSON Schema type string.
 * Supports: string, number, integer, boolean, object, array, null.
 */
function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value) && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      // Unknown type — don't reject (be lenient with extensions)
      return true;
  }
}

/**
 * Validate a value against a type constraint (string or string[]).
 * Returns true if the value matches any of the allowed types.
 */
function validateType(
  value: unknown,
  type: string | string[] | undefined,
  path: string,
  errors: string[],
): void {
  if (type === undefined) return;

  const types = Array.isArray(type) ? type : [type];
  const matches = types.some((t) => matchesType(value, t));
  if (!matches) {
    const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const expected = types.join(" | ");
    errors.push(`${path}: expected type ${expected}, got ${actualType}`);
  }
}

// ── Property Validation ────────────────────────────────────────────────────

/**
 * Recursively validate a value against a JSON Schema property definition.
 */
function validateProperty(
  value: unknown,
  schema: JsonSchemaProperty,
  path: string,
  errors: string[],
): void {
  // Type checking
  validateType(value, schema.type, path, errors);

  // Enum validation
  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    const found = schema.enum.some((e) => {
      if (typeof e === "object" && typeof value === "object") {
        // Shallow comparison for objects — don't recurse deeply for enums
        return JSON.stringify(e) === JSON.stringify(value);
      }
      return e === value;
    });
    if (!found) {
      errors.push(`${path}: value must be one of [${schema.enum.map((e) => JSON.stringify(e)).join(", ")}]`);
    }
  }

  // Nested object validation
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // Required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          errors.push(`${path}: missing required field "${field}"`);
        }
      }
    }

    // Nested property validation
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateProperty(obj[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }
  }

  // Array items validation
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      validateProperty(value[i], schema.items, `${path}[${i}]`, errors);
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate data against a JSON Schema object.
 *
 * Only validates the subset of JSON Schema described in the module header.
 * Designed for speed and simplicity on the proxy hot path.
 *
 * @param data   - The value to validate (typically `req.body`).
 * @param schema - A JSON Schema object with `type: "object"` and `properties`.
 * @returns An object with `valid: boolean` and `errors: string[]`.
 *
 * @example
 *   const result = validateJsonSchema(req.body, skill.inputSchema);
 *   if (!result.valid) {
 *     res.status(400).json({ error: "Input validation failed", details: result.errors });
 *   }
 */
export function validateJsonSchema(
  data: unknown,
  schema: JsonSchemaObject,
): ValidationResult {
  const errors: string[] = [];

  // Root must be an object if schema says type: "object"
  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { valid: false, errors: ["$: expected an object"] };
    }
  }

  const obj = data as Record<string, unknown>;

  // Check required fields at root level
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (!(field in obj)) {
        errors.push(`$: missing required field "${field}"`);
      }
    }
  }

  // Validate each property that's present and has a schema definition
  if (schema.properties && typeof schema.properties === "object") {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        validateProperty(obj[key], propSchema, `$.${key}`, errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
