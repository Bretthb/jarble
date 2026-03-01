/**
 * AutoFix Prop Repair — Phase 2.2
 *
 * Catches common LLM errors BEFORE Zod validation to reduce error cards.
 * Applies 20 high-confidence repair rules across 6 categories:
 *   1. Type coercion (string<->number, boolean strings)
 *   2. Enum normalization (variant aliases, chart types, sizes)
 *   3. Missing defaults (alert variant, steps current, etc.)
 *   4. Structural fixes (unwrap nested props, wrap single→array)
 *   5. Field aliases (content→body, description→message, etc.)
 *   6. Data normalization (progress percent strip, sparkline cleanup)
 *
 * Guardrails:
 *   - Never invents data — only transforms existing values
 *   - Never removes fields — only adds defaults or transforms types
 *   - Deep-clones props before mutating
 *   - High-confidence only — ambiguous transforms are skipped
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AutoFixRepair {
  rule: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface AutoFixResult {
  component: string;
  props: Record<string, unknown>;
  repairs: AutoFixRepair[];
}

// ── Component Name Normalization Map ─────────────────────────────────────────

export const COMPONENT_NAME_MAP: Record<string, string> = {
  // Casing variants — PascalCase
  DataTable: "data_table",
  MetricCard: "metric_card",
  StatGrid: "stat_grid",
  ButtonGroup: "button_group",
  CodeBlock: "code_block",
  CodeEditor: "code_editor",
  ImageGallery: "image_gallery",
  TagCloud: "tag_cloud",
  KeyValue: "key_value",
  TextMessage: "text_message",
  // Casing variants — camelCase
  dataTable: "data_table",
  metricCard: "metric_card",
  statGrid: "stat_grid",
  buttonGroup: "button_group",
  codeBlock: "code_block",
  codeEditor: "code_editor",
  imageGallery: "image_gallery",
  tagCloud: "tag_cloud",
  keyValue: "key_value",
  textMessage: "text_message",
  // Semantic aliases
  table: "data_table",
  graph: "chart",
  plot: "chart",
  kpi: "metric_card",
  stats: "stat_grid",
  notification: "alert",
  warning: "alert",
  bar_chart: "chart",
  line_chart: "chart",
  pie_chart: "chart",
  area_chart: "chart",
  markdown: "card",
  text: "card",
  quote: "blockquote",
  stepper: "steps",
  tree_view: "tree",
  status: "result",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Safely read a nested field by dot-path (e.g. "progress.value"). */
function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Safely set a nested field by dot-path. */
function setNestedField(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function isNumericString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (trimmed === "") return false;
  return !isNaN(Number(trimmed)) && isFinite(Number(trimmed));
}

function recordRepair(
  repairs: AutoFixRepair[],
  rule: string,
  field: string,
  from: unknown,
  to: unknown,
): void {
  repairs.push({ rule, field, from, to });
}

// ── Category 1: Type Coercion ────────────────────────────────────────────────

/** Fields where numeric strings should become numbers. */
const NUMERIC_FIELDS = [
  "value",
  "change",
  "progress.value",
  "steps.current",
  "current",
  "columns",
  "height",
  "zoom",
  "precision",
  "gap",
  "defaultTab",
];

/** Fields where numbers should become strings. */
const STRING_FIELDS = ["label", "title", "subtitle", "description", "text", "message"];

/** Fields where "true"/"false" strings should become booleans. */
const BOOLEAN_FIELDS = [
  "stacked",
  "bordered",
  "autoplay",
  "readOnly",
  "showValue",
  "showLegend",
  "showGrid",
  "ordered",
  "loop",
  "muted",
  "controls",
  "defaultExpandAll",
  "live",
  "divider",
];

function applyTypeCoercion(
  _component: string,
  props: Record<string, unknown>,
  repairs: AutoFixRepair[],
): void {
  // Rule 1: coerce-string-to-number
  for (const field of NUMERIC_FIELDS) {
    const val = getNestedField(props, field);
    if (isNumericString(val)) {
      const num = Number(val);
      setNestedField(props, field, num);
      recordRepair(repairs, "coerce-string-to-number", `props.${field}`, val, num);
    }
  }

  // Also handle sparkline arrays (mixed string/number → all numbers handled in data normalization)
  // And numeric strings inside stats arrays
  if (Array.isArray(props.stats)) {
    for (let i = 0; i < props.stats.length; i++) {
      const stat = props.stats[i];
      if (isPlainObject(stat) && isNumericString(stat.value)) {
        const num = Number(stat.value);
        stat.value = num;
        recordRepair(
          repairs,
          "coerce-string-to-number",
          `props.stats[${i}].value`,
          stat.value,
          num,
        );
      }
    }
  }

  // Rule 2: coerce-number-to-string
  for (const field of STRING_FIELDS) {
    const val = props[field];
    if (typeof val === "number") {
      const str = String(val);
      props[field] = str;
      recordRepair(repairs, "coerce-number-to-string", `props.${field}`, val, str);
    }
  }

  // Rule 3: coerce-boolean-strings
  for (const field of BOOLEAN_FIELDS) {
    const val = props[field];
    if (val === "true") {
      props[field] = true;
      recordRepair(repairs, "coerce-boolean-strings", `props.${field}`, val, true);
    } else if (val === "false") {
      props[field] = false;
      recordRepair(repairs, "coerce-boolean-strings", `props.${field}`, val, false);
    }
  }
}

// ── Category 2: Enum Normalization ───────────────────────────────────────────

const VARIANT_ALIAS_MAP: Record<string, string> = {
  danger: "error",
  warn: "warning",
  notice: "info",
  primary: "default",
  secondary: "default",
};

const CHART_TYPE_ALIAS_MAP: Record<string, string> = {
  column: "bar",
  doughnut: "pie",
  donut: "pie",
  scatter: "line",
  histogram: "bar",
};

const SIZE_ALIAS_MAP: Record<string, string> = {
  small: "sm",
  medium: "md",
  large: "lg",
  "extra-large": "lg",
  xl: "lg",
  xs: "sm",
};

function applyEnumNormalization(
  component: string,
  props: Record<string, unknown>,
  repairs: AutoFixRepair[],
): void {
  // Rule 4: enum-variant-alias — applies to "variant" and "status" fields
  for (const field of ["variant", "status"]) {
    const val = props[field];
    if (typeof val === "string" && val in VARIANT_ALIAS_MAP) {
      const fixed = VARIANT_ALIAS_MAP[val];
      props[field] = fixed;
      recordRepair(repairs, "enum-variant-alias", `props.${field}`, val, fixed);
    }
  }

  // Rule 5: chart-type-alias
  if (component === "chart" && typeof props.type === "string") {
    const lower = props.type.toLowerCase();
    if (lower in CHART_TYPE_ALIAS_MAP) {
      const fixed = CHART_TYPE_ALIAS_MAP[lower];
      recordRepair(repairs, "chart-type-alias", "props.type", props.type, fixed);
      props.type = fixed;
    }
  }

  // Rule 6: size-enum-alias — applies to "size" and "spacing" fields
  for (const field of ["size", "spacing"]) {
    const val = props[field];
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      if (lower in SIZE_ALIAS_MAP) {
        const fixed = SIZE_ALIAS_MAP[lower];
        props[field] = fixed;
        recordRepair(repairs, "size-enum-alias", `props.${field}`, val, fixed);
      }
    }
  }
}

// ── Category 3: Missing Defaults ─────────────────────────────────────────────

function applyMissingDefaults(
  component: string,
  props: Record<string, unknown>,
  repairs: AutoFixRepair[],
): void {
  // Rule 7: alert-default-variant
  if (component === "alert" && props.variant === undefined) {
    props.variant = "info";
    recordRepair(repairs, "alert-default-variant", "props.variant", undefined, "info");
  }

  // Rule 8: steps-default-current
  if (component === "steps" && props.current === undefined) {
    props.current = 0;
    recordRepair(repairs, "steps-default-current", "props.current", undefined, 0);
  }

  // Rule 9: chart-default-xAxisKey — infer from first data object
  if (
    component === "chart" &&
    props.xAxisKey === undefined &&
    Array.isArray(props.data) &&
    props.data.length > 0 &&
    isPlainObject(props.data[0]) &&
    Array.isArray(props.dataKeys) &&
    props.dataKeys.length > 0
  ) {
    const firstRow = props.data[0] as Record<string, unknown>;
    const dataKeySet = new Set(props.dataKeys as string[]);
    // The xAxisKey is the first key in the data object that is NOT in dataKeys
    const candidate = Object.keys(firstRow).find((k) => !dataKeySet.has(k));
    if (candidate) {
      props.xAxisKey = candidate;
      recordRepair(
        repairs,
        "chart-default-xAxisKey",
        "props.xAxisKey",
        undefined,
        candidate,
      );
    }
  }

  // Rule 10: badge-default-variant
  if (component === "badge" && props.variant === undefined) {
    props.variant = "default";
    recordRepair(
      repairs,
      "badge-default-variant",
      "props.variant",
      undefined,
      "default",
    );
  }

  // Rule 11: result-default-status
  if (component === "result" && props.status === undefined) {
    props.status = "info";
    recordRepair(
      repairs,
      "result-default-status",
      "props.status",
      undefined,
      "info",
    );
  }
}

// ── Category 4: Structural Fixes ─────────────────────────────────────────────

/** Components and the fields that expect arrays. */
const ARRAY_FIELDS: Record<string, string[]> = {
  chart: ["data"],
  list: ["items"],
  stat_grid: ["stats"],
  timeline: ["events", "items"],
  tabs: ["tabs"],
  accordion: ["items"],
  key_value: ["items"],
  carousel: ["items"],
  descriptions: ["items"],
  steps: ["items"],
  tag_cloud: ["tags"],
  tree: ["data"],
  button_group: ["buttons"],
  image_gallery: ["images"],
};

function applyStructuralFixes(
  component: string,
  props: Record<string, unknown>,
  repairs: AutoFixRepair[],
): void {
  // Rule 12: unwrap-nested-props — {props: {title: "..."}} → {title: "..."}
  if (
    isPlainObject(props.props) &&
    Object.keys(props).length === 1
  ) {
    const inner = props.props as Record<string, unknown>;
    // Only unwrap if the inner object has real content (not just a sandbox "props" field)
    // Sandboxes legitimately have a "props" field, so skip them
    if (component !== "sandbox") {
      const innerKeys = Object.keys(inner);
      if (innerKeys.length > 0) {
        recordRepair(
          repairs,
          "unwrap-nested-props",
          "props",
          { props: inner },
          inner,
        );
        // Move all inner keys into props
        for (const key of innerKeys) {
          props[key] = inner[key];
        }
        delete props.props;
      }
    }
  }

  // Rule 13: wrap-single-to-array — single object → array where array expected
  const arrayFieldsForComponent = ARRAY_FIELDS[component];
  if (arrayFieldsForComponent) {
    for (const field of arrayFieldsForComponent) {
      const val = props[field];
      if (isPlainObject(val)) {
        const wrapped = [val];
        props[field] = wrapped;
        recordRepair(
          repairs,
          "wrap-single-to-array",
          `props.${field}`,
          val,
          wrapped,
        );
      }
    }
  }

  // Rule 14: rows-object-to-array — data_table rows as array of objects → array of arrays
  if (component === "data_table" && Array.isArray(props.rows) && Array.isArray(props.columns)) {
    const rows = props.rows;
    const columns = props.columns as string[];
    // Check if rows are objects instead of arrays
    if (rows.length > 0 && isPlainObject(rows[0])) {
      const converted = rows.map((row) => {
        if (!isPlainObject(row)) return row;
        return columns.map((col) => {
          const val = (row as Record<string, unknown>)[col];
          return val === undefined ? "" : val;
        });
      });
      props.rows = converted;
      recordRepair(
        repairs,
        "rows-object-to-array",
        "props.rows",
        "[objects]",
        "[arrays]",
      );
    }
  }
}

// ── Category 5: Field Aliases ────────────────────────────────────────────────

interface FieldAliasRule {
  /** Components this alias applies to. Empty array = all components. */
  components: string[];
  /** Source field name (the alias the LLM used). */
  from: string;
  /** Target field name (what the schema expects). */
  to: string;
  /** Rule name for the repair log. */
  rule: string;
}

const FIELD_ALIAS_RULES: FieldAliasRule[] = [
  // Rule 15: field-content-to-body — content → body (card)
  {
    components: ["card"],
    from: "content",
    to: "body",
    rule: "field-content-to-body",
  },
  // Rule 16: field-description-to-message — description → message (alert)
  {
    components: ["alert"],
    from: "description",
    to: "message",
    rule: "field-description-to-message",
  },
  // Rule 17: field-name-to-label — name → label (metric_card, stat items)
  {
    components: ["metric_card"],
    from: "name",
    to: "label",
    rule: "field-name-to-label",
  },
  // Rule 18: field-data-to-items — data → items (list, timeline, steps, accordion, tabs)
  {
    components: ["list", "steps", "accordion"],
    from: "data",
    to: "items",
    rule: "field-data-to-items",
  },
  {
    components: ["timeline"],
    from: "data",
    to: "events",
    rule: "field-data-to-items",
  },
  {
    components: ["tabs"],
    from: "data",
    to: "tabs",
    rule: "field-data-to-items",
  },
];

function applyFieldAliases(
  component: string,
  props: Record<string, unknown>,
  repairs: AutoFixRepair[],
): void {
  for (const alias of FIELD_ALIAS_RULES) {
    // Check if this alias applies to the current component
    if (alias.components.length > 0 && !alias.components.includes(component)) {
      continue;
    }

    // Only apply if source exists and target does NOT exist
    // (never overwrite an existing target field)
    if (props[alias.from] !== undefined && props[alias.to] === undefined) {
      props[alias.to] = props[alias.from];
      delete props[alias.from];
      recordRepair(
        repairs,
        alias.rule,
        `props.${alias.from} -> props.${alias.to}`,
        alias.from,
        alias.to,
      );
    }
  }

  // Rule 17 extended: name → label inside stat_grid stats items
  if (component === "stat_grid" && Array.isArray(props.stats)) {
    for (let i = 0; i < props.stats.length; i++) {
      const stat = props.stats[i];
      if (
        isPlainObject(stat) &&
        stat.name !== undefined &&
        stat.label === undefined
      ) {
        stat.label = stat.name;
        delete stat.name;
        recordRepair(
          repairs,
          "field-name-to-label",
          `props.stats[${i}].name -> props.stats[${i}].label`,
          "name",
          "label",
        );
      }
    }
  }
}

// ── Category 6: Data Normalization ───────────────────────────────────────────

function applyDataNormalization(
  component: string,
  props: Record<string, unknown>,
  repairs: AutoFixRepair[],
): void {
  // Rule 19: progress-percent-strip — "75%" → 75 for progress.value
  if (component === "progress" && typeof props.value === "string") {
    const stripped = props.value.replace(/%$/, "").trim();
    if (isNumericString(stripped)) {
      const num = Number(stripped);
      recordRepair(
        repairs,
        "progress-percent-strip",
        "props.value",
        props.value,
        num,
      );
      props.value = num;
    }
  }

  // Rule 20: sparkline-normalize — mixed string/number sparkline arrays → all numbers
  if (
    (component === "metric_card" || component === "statistic") &&
    Array.isArray(props.sparkline)
  ) {
    let anyFixed = false;
    const original = [...props.sparkline];
    const normalized = props.sparkline.map((v: unknown) => {
      if (typeof v === "number") return v;
      if (isNumericString(v)) {
        anyFixed = true;
        return Number(v);
      }
      // Non-numeric entries — keep as-is (Zod will catch truly invalid data)
      return v;
    });
    if (anyFixed) {
      props.sparkline = normalized;
      recordRepair(
        repairs,
        "sparkline-normalize",
        "props.sparkline",
        original,
        normalized,
      );
    }
  }
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Applies high-confidence automatic fixes to component props before Zod validation.
 *
 * Returns the (possibly modified) component name, fixed props, and a list of all
 * repairs applied. Safe to call on any input — null/undefined/empty objects are
 * handled gracefully.
 */
export function autoFixProps(
  component: string,
  props: Record<string, unknown>,
): AutoFixResult {
  const repairs: AutoFixRepair[] = [];

  // Handle null/undefined/non-object props gracefully
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return {
      component: COMPONENT_NAME_MAP[component] ?? component,
      props: props ?? {},
      repairs: [],
    };
  }

  // 1. Normalize component name
  const normalizedComponent = COMPONENT_NAME_MAP[component] ?? component;
  if (normalizedComponent !== component) {
    recordRepair(
      repairs,
      "normalize-component-name",
      "component",
      component,
      normalizedComponent,
    );
  }

  // 2. Deep clone props to avoid mutating the original
  let fixed: Record<string, unknown>;
  try {
    fixed = structuredClone(props);
  } catch {
    // structuredClone can fail on non-cloneable values (functions, DOM nodes, etc.)
    // Fall back to a JSON round-trip which strips those anyway
    try {
      fixed = JSON.parse(JSON.stringify(props));
    } catch {
      // If even JSON fails, return unchanged
      return { component: normalizedComponent, props, repairs };
    }
  }

  // 3. Structural fixes first (unwrap nested props, wrap single→array, rows conversion)
  applyStructuralFixes(normalizedComponent, fixed, repairs);

  // 4. Type coercion (string↔number, boolean strings)
  applyTypeCoercion(normalizedComponent, fixed, repairs);

  // 5. Enum normalization (variant aliases, chart types, sizes)
  applyEnumNormalization(normalizedComponent, fixed, repairs);

  // 6. Missing defaults (alert variant, steps current, etc.)
  applyMissingDefaults(normalizedComponent, fixed, repairs);

  // 7. Field aliases (content→body, description→message, etc.)
  applyFieldAliases(normalizedComponent, fixed, repairs);

  // 8. Data normalization (progress percent strip, sparkline cleanup)
  applyDataNormalization(normalizedComponent, fixed, repairs);

  // Dev-mode logging
  if (repairs.length > 0 && process.env.NODE_ENV === "development") {
    console.warn(
      `[AutoFix] ${repairs.length} repair(s) for ${normalizedComponent}:`,
      repairs.map((r) => r.rule),
    );
  }

  return { component: normalizedComponent, props: fixed, repairs };
}
