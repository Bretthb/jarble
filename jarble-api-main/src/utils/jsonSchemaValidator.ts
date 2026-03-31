/**
 * Lightweight JSON Schema (draft-07) validator for native component props.
 *
 * Ported from the inline implementation in jarble-ui-server.js.
 * Handles the subset of JSON Schema features used by component schemas:
 * type, required, enum, anyOf/oneOf, nested objects, arrays, string/number/boolean.
 *
 * Also includes an autofix pass that corrects common LLM prop errors
 * before validation (inspired by frontend autoFixProps.ts).
 */

interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a value against a JSON Schema.
 * Returns an array of errors (empty = valid).
 */
export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "",
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!schema || typeof schema !== "object") return errors;

  // anyOf / oneOf - valid if any sub-schema passes
  const anyOf = (schema.anyOf || schema.oneOf) as Record<string, unknown>[] | undefined;
  if (anyOf && Array.isArray(anyOf)) {
    const anyMatch = anyOf.some((sub) => validateJsonSchema(value, sub, path).length === 0);
    if (!anyMatch) {
      errors.push({ path: path || "/", message: `Value does not match any of the allowed schemas` });
    }
    return errors;
  }

  const schemaType = schema.type as string | string[] | undefined;

  // Type checking
  if (schemaType) {
    const types = Array.isArray(schemaType) ? schemaType : [schemaType];
    const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (!types.includes(actualType)) {
      errors.push({ path: path || "/", message: `Expected ${types.join("|")}, got ${actualType}` });
      return errors;
    }
  }

  // Enum
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues && !enumValues.includes(value)) {
    errors.push({ path: path || "/", message: `Value "${value}" not in enum: ${JSON.stringify(enumValues)}` });
  }

  // Object properties
  if (schemaType === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const required = schema.required as string[] | undefined;

    if (required) {
      for (const key of required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}/${key}`, message: `Required field "${key}" is missing` });
        }
      }
    }

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj) {
          errors.push(...validateJsonSchema(obj[key], propSchema, `${path}/${key}`));
        }
      }
    }
  }

  // Array items
  if (schemaType === "array" && Array.isArray(value)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateJsonSchema(value[i], items, `${path}[${i}]`));
      }
    }
    const minItems = schema.minItems as number | undefined;
    if (minItems !== undefined && value.length < minItems) {
      errors.push({ path, message: `Array must have at least ${minItems} items, got ${value.length}` });
    }
  }

  return errors;
}

/**
 * Auto-fix common LLM errors in native component props.
 * Mutates and returns the props object.
 */
export function autofixNativeProps(
  component: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  // data_table: rows must be arrays, not objects
  if (component === "data_table" && Array.isArray(props.rows)) {
    props.rows = (props.rows as unknown[]).map((row) => {
      if (Array.isArray(row)) return row;
      if (typeof row === "object" && row !== null) return Object.values(row);
      return [row];
    });
  }

  // chart: ensure dataKeys exist and match data
  if (component === "chart" && Array.isArray(props.data) && props.data.length > 0) {
    const firstRow = props.data[0] as Record<string, unknown>;
    if (typeof firstRow === "object" && firstRow !== null) {
      // Auto-derive dataKeys if missing
      if (!props.dataKeys || !Array.isArray(props.dataKeys) || props.dataKeys.length === 0) {
        const keys = Object.keys(firstRow).filter((k) => k !== props.xAxisKey && typeof firstRow[k] === "number");
        if (keys.length > 0) props.dataKeys = keys;
      }
      // Auto-derive xAxisKey if missing
      if (!props.xAxisKey) {
        const strKey = Object.keys(firstRow).find((k) => typeof firstRow[k] === "string");
        if (strKey) props.xAxisKey = strKey;
      }
    }
  }

  // stat_grid: wrap single stat in array
  if (component === "stat_grid" && props.stats && !Array.isArray(props.stats)) {
    props.stats = [props.stats];
  }

  // form: wrap single field in array
  if (component === "form" && props.fields && !Array.isArray(props.fields)) {
    props.fields = [props.fields];
  }

  // Common field name aliases
  if (component === "card") {
    if (props.content && !props.body) { props.body = props.content; delete props.content; }
  }
  if (component === "alert") {
    if (props.description && !props.message) { props.message = props.description; delete props.description; }
  }

  return props;
}
