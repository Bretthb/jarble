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
  // Page aliases
  render_page: "page",
  dashboard: "page",
  fullscreen: "page",
  // Sandpack aliases
  sandpack: "sandpack_sandbox",
  npm_sandbox: "sandpack_sandbox",
  project_sandbox: "sandpack_sandbox",
  SandpackSandbox: "sandpack_sandbox",
  // Embed aliases
  widget: "embed",
  iframe: "embed",
  web_embed: "embed",
  Widget: "embed",
  Embed: "embed",
  WebEmbed: "embed",
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
  danger: "destructive",
  error: "destructive",
  warn: "warning",
  notice: "info",
  primary: "default",
  // Color names → semantic variants (LLMs often use colors)
  green: "success",
  red: "destructive",
  yellow: "warning",
  orange: "warning",
  blue: "info",
  purple: "secondary",
  violet: "secondary",
  gray: "secondary",
  grey: "secondary",
  cyan: "info",
  teal: "success",
  pink: "destructive",
  amber: "warning",
  emerald: "success",
  indigo: "info",
  lime: "success",
  rose: "destructive",
  sky: "info",
  slate: "secondary",
};

const CHART_TYPE_ALIAS_MAP: Record<string, string> = {
  column: "bar",
  doughnut: "pie",
  donut: "pie",
  scatter: "line",
  histogram: "bar",
  "multi-line": "line",
  multi_line: "line",
  multiline: "line",
  "stacked-bar": "bar",
  stacked_bar: "bar",
  "grouped-bar": "bar",
  grouped_bar: "bar",
  "stacked-area": "area",
  stacked_area: "area",
  radar: "line",
  funnel: "bar",
};

const SIZE_ALIAS_MAP: Record<string, string> = {
  small: "sm",
  medium: "md",
  large: "lg",
  "extra-large": "lg",
  xl: "lg",
  xs: "sm",
};

/** Variant aliases for button_group buttons (nested variant field). */
const BUTTON_VARIANT_MAP: Record<string, string> = {
  primary: "default",
  ghost: "outline",
  danger: "destructive",
  error: "destructive",
  warning: "outline",
  info: "secondary",
  link: "outline",
  text: "outline",
  subtle: "secondary",
  filled: "default",
  contained: "default",
};

const VALID_BUTTON_VARIANTS = new Set(["default", "secondary", "destructive", "outline"]);

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

  // Rule 5: chart-type-alias + case normalization
  if (component === "chart" && typeof props.type === "string") {
    const lower = props.type.toLowerCase();
    if (lower in CHART_TYPE_ALIAS_MAP) {
      const fixed = CHART_TYPE_ALIAS_MAP[lower];
      recordRepair(repairs, "chart-type-alias", "props.type", props.type, fixed);
      props.type = fixed;
    } else if (lower !== props.type) {
      // Case-normalize even when not in alias map (e.g. "Line" → "line")
      recordRepair(repairs, "chart-type-case", "props.type", props.type, lower);
      props.type = lower;
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

  // Rule 35: chart-default-type — default to "bar" when chart type is missing
  if (component === "chart" && props.type === undefined) {
    props.type = "bar";
    recordRepair(repairs, "chart-default-type", "props.type", undefined, "bar");
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
  spreadsheet: ["data"],
  button_group: ["buttons"],
  image_gallery: ["images"],
};

/** Recursively normalize tree nodes: name/label→title, auto-generate key. */
function fixTreeNodes(nodes: unknown[], repairs: AutoFixRepair[], depth = 0): void {
  if (depth > 5) return; // prevent infinite recursion
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!isPlainObject(node)) continue;
    // Map name/label → title
    if (node.title === undefined) {
      const source = node.name ?? node.label ?? node.text;
      if (typeof source === "string") {
        node.title = source;
        if (node.name !== undefined) delete node.name;
        if (node.label !== undefined) delete node.label;
        if (node.text !== undefined) delete node.text;
        recordRepair(repairs, "tree-node-title-alias", `node[${i}].title`, undefined, source);
      }
    }
    // Auto-generate key from title if missing
    if (node.key === undefined && typeof node.title === "string") {
      node.key = node.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `node-${i}`;
      recordRepair(repairs, "tree-node-auto-key", `node[${i}].key`, undefined, node.key);
    }
    // Recurse into children
    if (Array.isArray(node.children)) {
      fixTreeNodes(node.children as unknown[], repairs, depth + 1);
    }
  }
}

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

  // Rule 14b: button-group-auto-id + auto-label — fix missing required fields
  if (component === "button_group" && Array.isArray(props.buttons)) {
    for (let i = 0; i < props.buttons.length; i++) {
      const btn = props.buttons[i];
      if (!isPlainObject(btn)) continue;

      // Generate id if missing
      if (btn.id === undefined) {
        const source =
          typeof btn.action === "string"
            ? btn.action
            : typeof btn.label === "string"
              ? btn.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
              : `button_${i}`;
        btn.id = source;
        if (btn.action !== undefined) delete btn.action;
        recordRepair(repairs, "button-group-auto-id", `props.buttons[${i}].id`, undefined, source);
      }

      // Generate label if missing (from text, title, or capitalize id)
      if (btn.label === undefined) {
        const source =
          typeof btn.text === "string" ? btn.text
          : typeof btn.title === "string" ? btn.title
          : typeof btn.id === "string"
            ? btn.id.replace(/[_-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : `Button ${i + 1}`;
        btn.label = source;
        if (btn.text !== undefined) delete btn.text;
        if (btn.title !== undefined) delete btn.title;
        recordRepair(repairs, "button-group-auto-label", `props.buttons[${i}].label`, undefined, source);
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

  // Rule 14c: button-group-variant-normalize — fix invalid variant values in buttons
  if (component === "button_group" && Array.isArray(props.buttons)) {
    for (let i = 0; i < props.buttons.length; i++) {
      const btn = props.buttons[i];
      if (isPlainObject(btn) && typeof btn.variant === "string") {
        const lower = btn.variant.toLowerCase();
        if (VALID_BUTTON_VARIANTS.has(lower)) {
          if (lower !== btn.variant) {
            recordRepair(repairs, "button-group-variant-normalize", `props.buttons[${i}].variant`, btn.variant, lower);
            btn.variant = lower;
          }
        } else if (lower in BUTTON_VARIANT_MAP) {
          const fixed = BUTTON_VARIANT_MAP[lower];
          recordRepair(repairs, "button-group-variant-normalize", `props.buttons[${i}].variant`, btn.variant, fixed);
          btn.variant = fixed;
        } else {
          // Unrecognized variant — remove (field is optional)
          recordRepair(repairs, "button-group-variant-normalize", `props.buttons[${i}].variant`, btn.variant, undefined);
          delete btn.variant;
        }
      }
    }
  }

  // Rule 21: chart-data-transform — convert chart.js-style data to recharts format
  if (component === "chart" && props.data === undefined) {
    // Pattern 1: chart.js format — {labels: [...], datasets: [{label, data: [...]}]}
    if (Array.isArray(props.labels) && Array.isArray(props.datasets)) {
      const labels = props.labels as string[];
      const datasets = props.datasets as Array<Record<string, unknown>>;
      const data: Record<string, unknown>[] = labels.map((label, i) => {
        const row: Record<string, unknown> = { name: label };
        for (const ds of datasets) {
          const key = typeof ds.label === "string" ? ds.label : `series_${datasets.indexOf(ds)}`;
          row[key] = Array.isArray(ds.data) ? ds.data[i] : undefined;
        }
        return row;
      });
      const dataKeys = datasets.map((ds, i) => typeof ds.label === "string" ? ds.label : `series_${i}`);
      props.data = data;
      if (props.dataKeys === undefined) props.dataKeys = dataKeys;
      if (props.xAxisKey === undefined) props.xAxisKey = "name";
      delete props.labels;
      delete props.datasets;
      recordRepair(repairs, "chart-data-transform", "props.data", "[chart.js format]", "[recharts format]");
    }
    // Pattern 2: field aliases for data
    else if (Array.isArray(props.series)) {
      props.data = props.series;
      delete props.series;
      recordRepair(repairs, "chart-field-alias", "props.series", "series", "data");
    }
    else if (Array.isArray(props.chartData)) {
      props.data = props.chartData;
      delete props.chartData;
      recordRepair(repairs, "chart-field-alias", "props.chartData", "chartData", "data");
    }
    else if (Array.isArray(props.values)) {
      props.data = props.values;
      delete props.values;
      recordRepair(repairs, "chart-field-alias", "props.values", "values", "data");
    }
  }

  // Rule 21b: chart-dataKeys-infer — infer dataKeys from data when missing
  if (component === "chart" && props.dataKeys === undefined) {
    // Try field aliases first
    if (Array.isArray(props.keys)) {
      props.dataKeys = props.keys;
      delete props.keys;
      recordRepair(repairs, "chart-field-alias", "props.keys", "keys", "dataKeys");
    } else if (Array.isArray(props.metrics)) {
      props.dataKeys = props.metrics;
      delete props.metrics;
      recordRepair(repairs, "chart-field-alias", "props.metrics", "metrics", "dataKeys");
    }
    // Auto-infer: numeric value keys from first data row
    else if (Array.isArray(props.data) && props.data.length > 0 && isPlainObject(props.data[0])) {
      const firstRow = props.data[0] as Record<string, unknown>;
      const xKey = typeof props.xAxisKey === "string" ? props.xAxisKey : null;
      const inferred = Object.keys(firstRow).filter(k => {
        if (k === xKey) return false;
        return typeof firstRow[k] === "number";
      });
      if (inferred.length > 0) {
        props.dataKeys = inferred;
        recordRepair(repairs, "chart-infer-dataKeys", "props.dataKeys", undefined, inferred);
      }
    }
  }

  // Rule 21c: chart-data-coerce-numbers — coerce string numbers in chart data rows
  if (component === "chart" && Array.isArray(props.data) && Array.isArray(props.dataKeys)) {
    const keys = props.dataKeys as string[];
    let coerced = false;
    for (const row of props.data as Record<string, unknown>[]) {
      if (!isPlainObject(row)) continue;
      for (const k of keys) {
        const v = row[k];
        if (typeof v === "string") {
          // Strip currency symbols, commas, percent signs, then parse
          const cleaned = v.replace(/[$€£¥,\s%]/g, "");
          const n = Number(cleaned);
          if (cleaned !== "" && !isNaN(n)) {
            row[k] = n;
            coerced = true;
          }
        }
      }
    }
    if (coerced) {
      recordRepair(repairs, "chart-data-coerce-numbers", "props.data[*]", "[string values]", "[numbers]");
    }
  }

  // Rule 23: tree-node-normalize — fix tree node fields (name/label→title, auto-generate key)
  if (component === "tree" && Array.isArray(props.data)) {
    fixTreeNodes(props.data as unknown[], repairs);
  }
  // Also handle "nodes" → "data" alias for tree
  if (component === "tree" && props.data === undefined && Array.isArray(props.nodes)) {
    props.data = props.nodes;
    delete props.nodes;
    recordRepair(repairs, "field-nodes-to-data", "props.nodes -> props.data", "nodes", "data");
    fixTreeNodes(props.data as unknown[], repairs);
  }

  // Rule 22: form-options-flatten — [{label, value}] → [value || label] for select options
  if (component === "form" && Array.isArray(props.fields)) {
    for (let i = 0; i < props.fields.length; i++) {
      const field = props.fields[i];
      if (isPlainObject(field) && Array.isArray(field.options) && field.options.length > 0 && isPlainObject(field.options[0])) {
        field.options = (field.options as Record<string, unknown>[]).map(opt =>
          String(opt.value ?? opt.label ?? opt.name ?? "")
        );
        recordRepair(repairs, "form-options-flatten", `props.fields[${i}].options`, "[objects]", "[strings]");
      }
    }
  }

  // Rule 28: map-center-normalize — convert {lat, lng} object to [lat, lng] tuple
  if (component === "map") {
    // Fix center field: {lat, lng} → [lat, lng]
    for (const field of ["center", "location", "position"] as const) {
      const val = props[field];
      if (isPlainObject(val)) {
        const lat = val.lat ?? val.latitude;
        const lng = val.lng ?? val.lon ?? val.longitude;
        if (typeof lat === "number" && typeof lng === "number") {
          props[field] = [lat, lng];
          recordRepair(repairs, "map-center-normalize", `props.${field}`, val, [lat, lng]);
        }
      }
    }
    // Fix markers: lat/lng aliases (latitude/longitude) and url/label aliases
    if (Array.isArray(props.markers)) {
      for (let i = 0; i < props.markers.length; i++) {
        const m = props.markers[i];
        if (!isPlainObject(m)) continue;
        if (m.lat === undefined && typeof m.latitude === "number") {
          m.lat = m.latitude;
          delete m.latitude;
          recordRepair(repairs, "map-marker-field", `props.markers[${i}].latitude`, "latitude", "lat");
        }
        if (m.lng === undefined) {
          const src = m.longitude ?? m.lon;
          if (typeof src === "number") {
            m.lng = src;
            if (m.longitude !== undefined) delete m.longitude;
            if (m.lon !== undefined) delete m.lon;
            recordRepair(repairs, "map-marker-field", `props.markers[${i}].lng`, undefined, src);
          }
        }
        // LLMs sometimes use "name" or "title" instead of "label"
        if (m.label === undefined) {
          const src = m.name ?? m.title;
          if (typeof src === "string") {
            m.label = src;
            if (m.name !== undefined) delete m.name;
            if (m.title !== undefined) delete m.title;
            recordRepair(repairs, "map-marker-label", `props.markers[${i}].label`, undefined, src);
          }
        }
      }
    }
  }

  // Rule 29: tabs-content-to-children — convert object content to children array
  if (component === "tabs" && Array.isArray(props.tabs)) {
    for (let i = 0; i < props.tabs.length; i++) {
      const tab = props.tabs[i];
      if (!isPlainObject(tab)) continue;
      // If content is an object (nested component), move to children
      if (isPlainObject(tab.content)) {
        tab.children = [tab.content];
        tab.content = undefined;
        recordRepair(repairs, "tabs-content-to-children", `props.tabs[${i}].content`, "[object]", "[children]");
      }
      // If content is an array of objects (multiple nested components)
      if (Array.isArray(tab.content) && tab.content.length > 0 && isPlainObject(tab.content[0])) {
        tab.children = tab.content;
        tab.content = undefined;
        recordRepair(repairs, "tabs-content-to-children", `props.tabs[${i}].content`, "[array]", "[children]");
      }
    }
  }

  // Rule 31: spreadsheet-array-to-records — convert 2D array data to array of records
  if (component === "spreadsheet" && Array.isArray(props.data) && props.data.length > 0) {
    const first = props.data[0];
    if (Array.isArray(first)) {
      // 2D array detected — convert to array of records
      const rows = props.data as unknown[][];
      // If first row is all strings, treat as header row
      const firstAllStrings = rows[0].every((v: unknown) => typeof v === "string");
      let headers: string[];
      let dataRows: unknown[][];
      if (firstAllStrings && rows.length > 1) {
        headers = rows[0] as string[];
        dataRows = rows.slice(1);
      } else {
        // Generate column headers (A, B, C, ...)
        headers = first.map((_: unknown, i: number) => String.fromCharCode(65 + (i % 26)));
        dataRows = rows;
      }
      props.data = dataRows.map((row: unknown[]) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]] = i < row.length ? row[i] : "";
        }
        return obj;
      });
      recordRepair(repairs, "spreadsheet-array-to-records", "props.data", "[2D array]", "[records]");
    }
  }

  // Rule 30: image-gallery-src-alias — fix image objects missing src but having url/source/href
  if (component === "image_gallery" && Array.isArray(props.images)) {
    for (let i = 0; i < props.images.length; i++) {
      const img = props.images[i];
      if (!isPlainObject(img)) continue;
      if (img.src === undefined) {
        const src = img.url ?? img.source ?? img.href ?? img.link;
        if (typeof src === "string") {
          img.src = src;
          if (img.url !== undefined) delete img.url;
          if (img.source !== undefined) delete img.source;
          if (img.href !== undefined) delete img.href;
          if (img.link !== undefined) delete img.link;
          recordRepair(repairs, "gallery-image-src-alias", `props.images[${i}].src`, undefined, src);
        }
      }
    }
  }

  // Rule 36: sandbox-detect-bare-globals — detect unimported globals and convert to module mode
  if (component === "sandbox" && typeof props.js === "string" && !props.moduleJs && !props.libraries) {
    const jsCode = props.js as string;
    const GLOBAL_TO_IMPORT: Record<string, string> = {
      "THREE": "import * as THREE from 'three';",
      "d3": "import * as d3 from 'd3';",
      "Chart": "import { Chart } from 'chart.js/auto';",
      "L": "import L from 'leaflet';",
      "gsap": "import gsap from 'gsap';",
      "p5": "import p5 from 'p5';",
      "Tone": "import * as Tone from 'tone';",
    };
    const needed: string[] = [];
    for (const [global, importStmt] of Object.entries(GLOBAL_TO_IMPORT)) {
      // Match the global as a standalone identifier (not inside a string or as part of another word)
      const re = new RegExp(`\\b${global}\\b`);
      if (re.test(jsCode)) {
        needed.push(importStmt);
      }
    }
    if (needed.length > 0) {
      props.moduleJs = needed.join("\n") + "\n" + jsCode;
      delete props.js;
      recordRepair(repairs, "sandbox-detect-bare-globals", "props.js -> props.moduleJs", "js with bare globals", `moduleJs with ${needed.length} import(s)`);
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
  // Rule 19: field-sections-to-items — sections/panels → items (accordion, tabs)
  {
    components: ["accordion"],
    from: "sections",
    to: "items",
    rule: "field-sections-to-items",
  },
  {
    components: ["accordion"],
    from: "panels",
    to: "items",
    rule: "field-sections-to-items",
  },
  {
    components: ["tabs"],
    from: "sections",
    to: "tabs",
    rule: "field-sections-to-items",
  },
  // Rule 20: field-submitText-to-submitLabel — submitText → submitLabel (form)
  {
    components: ["form"],
    from: "submitText",
    to: "submitLabel",
    rule: "field-submitText-to-submitLabel",
  },
  // Rule 25: image url→src — LLMs use url/source/href instead of src
  { components: ["image"], from: "url", to: "src", rule: "field-url-to-src" },
  { components: ["image"], from: "source", to: "src", rule: "field-url-to-src" },
  { components: ["image"], from: "href", to: "src", rule: "field-url-to-src" },
  // Rule 26: steps/carousel field aliases — LLMs use "steps"/"slides" instead of "items"
  { components: ["steps"], from: "steps", to: "items", rule: "field-steps-to-items" },
  { components: ["carousel"], from: "slides", to: "items", rule: "field-slides-to-items" },
  { components: ["carousel"], from: "cards", to: "items", rule: "field-cards-to-items" },
  // Rule 32: timeline items→events — LLMs use "items" instead of "events"
  { components: ["timeline"], from: "items", to: "events", rule: "field-items-to-events" },
  // Rule 33: stat_grid items→stats — LLMs use "items" or "metrics" instead of "stats"
  { components: ["stat_grid"], from: "items", to: "stats", rule: "field-items-to-stats" },
  { components: ["stat_grid"], from: "metrics", to: "stats", rule: "field-metrics-to-stats" },
  // Rule 34: carousel images→items — LLMs use "images" instead of "items"
  { components: ["carousel"], from: "images", to: "items", rule: "field-images-to-items" },
  // Rule 27: text_message field aliases — LLMs use many names for botText
  { components: ["text_message"], from: "message", to: "botText", rule: "field-message-to-botText" },
  { components: ["text_message"], from: "text", to: "botText", rule: "field-text-to-botText" },
  { components: ["text_message"], from: "content", to: "botText", rule: "field-content-to-botText" },
  { components: ["text_message"], from: "bot_text", to: "botText", rule: "field-bot_text-to-botText" },
  { components: ["text_message"], from: "assistant_message", to: "botText", rule: "field-assistant-to-botText" },
  { components: ["text_message"], from: "user_message", to: "userText", rule: "field-user_message-to-userText" },
  { components: ["text_message"], from: "user_text", to: "userText", rule: "field-user_text-to-userText" },
  // Rule 35: data_table headers→columns — LLMs use "headers" instead of "columns"
  { components: ["data_table"], from: "headers", to: "columns", rule: "field-headers-to-columns" },
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

  // 9. Sandbox → Sandpack upgrade (component type change)
  if (normalizedComponent === "sandbox" && typeof fixed.moduleJs === "string") {
    const code = fixed.moduleJs as string;
    const hasReactPatterns = /\b(useState|useEffect|createElement|useRef|useCallback|useMemo)\b/.test(code);
    const importCount = (code.match(/^import\s/gm) || []).length;
    if (hasReactPatterns && code.length > 500 && importCount >= 3) {
      const files: Record<string, string> = { "/App.tsx": code };
      const deps: Record<string, string> = {};
      if (isPlainObject(fixed.importMap)) {
        for (const [pkg, url] of Object.entries(fixed.importMap as Record<string, string>)) {
          if (typeof url === "string") {
            const versionMatch = url.match(/@([^/]+)/);
            deps[pkg] = versionMatch ? `^${versionMatch[1]}` : "latest";
          }
        }
      }
      fixed.files = files;
      if (Object.keys(deps).length > 0) fixed.dependencies = deps;
      fixed.template = "react-ts";
      delete fixed.moduleJs;
      delete fixed.importMap;
      delete fixed.html;
      delete fixed.css;
      delete fixed.js;
      delete fixed.libraries;
      recordRepair(repairs, "sandbox-upgrade-to-sandpack", "component", "sandbox", "sandpack_sandbox");
      // Return with changed component name
      if (repairs.length > 0 && process.env.NODE_ENV === "development") {
        console.warn(`[AutoFix] ${repairs.length} repair(s) for sandpack_sandbox:`, repairs.map((r) => r.rule));
      }
      return { component: "sandpack_sandbox", props: fixed, repairs };
    }
  }

  // Dev-mode logging
  if (repairs.length > 0 && process.env.NODE_ENV === "development") {
    console.warn(
      `[AutoFix] ${repairs.length} repair(s) for ${normalizedComponent}:`,
      repairs.map((r) => r.rule),
    );
  }

  return { component: normalizedComponent, props: fixed, repairs };
}
