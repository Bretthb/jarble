#!/usr/bin/env node
/**
 * Jarble UI MCP Server — stdio transport (JSON-RPC 2.0)
 *
 * Exposes render_ui, update_ui, define_component, and list_components tools to OpenClaw
 * via the Model Context Protocol. Runs as a child process spawned by OpenClaw.
 *
 * Zero external dependencies — raw JSON-RPC parsing over stdin/stdout.
 * Component definitions stored at /data/components/*.json on the PVC.
 *
 * Protocol: MCP 2025-03-26 over stdio
 */

"use strict";

const fs = require("fs");
const path = require("path");

const COMPONENTS_DIR = "/data/components";
const FILES_DIR = "/data/files";
const PROTOCOL_VERSION = "2024-11-05";

const FILE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_FILE_SIZE = 1_000_000; // 1MB

// ── Built-in components ────────────────────────────────────────────────

const BUILTIN_COMPONENTS = [
  "card", "data_table", "stat_grid", "key_value",
  "code_block", "alert", "progress", "image", "layout",
  "chart", "tabs", "accordion", "badge", "list",
  "timeline", "divider", "avatar", "blockquote",
  "metric_card", "header", "button_group", "form",
  "gauge", "radar", "treemap", "funnel", "waterfall", "scatter",
  "steps", "result", "tree", "calendar_heatmap", "descriptions",
  "code_editor", "map", "carousel",
  "stock", "sankey", "sunburst", "heatmap", "wordcloud",
  "histogram", "box", "liquid", "rose", "dual_axes",
  "bullet", "radial_bar", "venn", "circle_packing",
  "statistic", "tag_cloud", "video", "image_gallery", "audio", "spreadsheet",
  "sandbox",
];

const BUILTIN_DESCRIPTIONS = {
  card: "Simple card with title, subtitle, and body text",
  data_table: "Table with column headers and data rows",
  stat_grid: "Grid of metric cards with labels, values, and optional change indicators",
  key_value: "List of key-value pairs",
  code_block: "Syntax-highlighted code snippet",
  alert: "Notification banner (info, success, warning, error)",
  progress: "Progress bar with label and percentage",
  image: "Image with optional alt text and caption",
  layout: "Container that renders an array of child components",
  chart: "Bar, line, pie, or area chart with data series (recharts)",
  tabs: "Tabbed content panels with optional nested child components",
  accordion: "Collapsible sections with titles and content",
  badge: "Small label/tag with variant styling",
  list: "Structured list with optional icons, descriptions, and badges",
  timeline: "Chronological event timeline with status indicators",
  divider: "Visual separator with optional label",
  avatar: "User avatar with name and optional subtitle",
  blockquote: "Styled quotation with optional attribution",
  metric_card: "Single metric display with optional sparkline chart",
  header: "Section heading with optional subtitle and divider",
  button_group: "Row of action buttons that dispatch UI_ACTION callbacks on click",
  form: "Input form with text, email, textarea, select, checkbox, number fields — dispatches UI_ACTION on submit",
  gauge: "Gauge/speedometer chart showing a value 0-100",
  radar: "Radar/spider chart with multiple axes",
  treemap: "Treemap visualization showing hierarchical data by area",
  funnel: "Conversion funnel chart with stages and values",
  waterfall: "Waterfall chart showing cumulative gains/losses",
  scatter: "Scatter plot with x/y coordinates and optional grouping",
  steps: "Process/wizard steps indicator with current step highlight",
  result: "Outcome display (success, error, info, warning) with title and subtitle",
  tree: "Hierarchical tree view with expandable nodes",
  calendar_heatmap: "Calendar heatmap showing date-value data as colored cells",
  descriptions: "Labeled description list (key-value pairs in bordered table)",
  code_editor: "Monaco code editor with syntax highlighting",
  map: "Interactive Leaflet map with markers and popups",
  carousel: "Image/content carousel with optional autoplay",
  stock: "Candlestick/OHLC chart for financial data",
  sankey: "Sankey flow/transfer diagram",
  sunburst: "Sunburst hierarchical pie chart",
  heatmap: "Heatmap grid visualization",
  wordcloud: "Word cloud for text/keyword frequency",
  histogram: "Histogram for distribution analysis",
  box: "Box plot for statistical distribution",
  liquid: "Liquid fill gauge",
  rose: "Nightingale/polar area rose chart",
  dual_axes: "Dual Y-axis chart for comparing two metrics",
  bullet: "Bullet chart for KPI vs target comparison",
  radial_bar: "Circular/radial bar chart",
  venn: "Venn diagram for set overlap",
  circle_packing: "Circle packing for nested hierarchy",
  statistic: "Polished KPI statistic display with optional countdown",
  tag_cloud: "Colored tag collection for categorization",
  video: "Video player (YouTube, Vimeo, MP4, etc.)",
  image_gallery: "Multi-image grid with lightbox preview",
  audio: "HTML5 audio player",
  spreadsheet: "Editable Excel-like spreadsheet grid",
  sandbox: "Sandboxed iframe for custom HTML/CSS/JS mini-apps — render anything",
};

// ── Component resolver ─────────────────────────────────────────────────

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_CHILDREN = 20;
const MAX_DEF_SIZE = 50 * 1024;
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function validateName(name) {
  if (!NAME_RE.test(name)) return `Invalid name "${name}". Must be lowercase, start with letter, max 64 chars.`;
  if (BUILTIN_COMPONENTS.includes(name)) return `Cannot override built-in "${name}".`;
  return null;
}

function validateDefinition(def) {
  if (!def || typeof def !== "object") return "Definition must be an object.";
  if (typeof def.name !== "string") return "Missing string 'name'.";
  const ne = validateName(def.name);
  if (ne) return ne;
  if (!Array.isArray(def.layout)) return "Missing 'layout' array.";
  if (def.layout.length === 0) return "Layout must have at least one child.";
  if (def.layout.length > MAX_CHILDREN) return `Layout has ${def.layout.length} children, max ${MAX_CHILDREN}.`;
  for (let i = 0; i < def.layout.length; i++) {
    const c = def.layout[i];
    if (!c || typeof c !== "object") return `Child ${i} must be an object.`;
    if (typeof c.component !== "string") return `Child ${i} missing 'component'.`;
    if (!BUILTIN_COMPONENTS.includes(c.component)) return `Child ${i}: unknown built-in "${c.component}".`;
    if (!c.props || typeof c.props !== "object") return `Child ${i} missing 'props' object.`;
  }
  if (JSON.stringify(def).length > MAX_DEF_SIZE) return `Definition exceeds ${MAX_DEF_SIZE} bytes.`;
  return null;
}

function substituteValue(value, vars, depth) {
  if (depth > 3) return value;
  if (typeof value === "string") {
    const m = value.trim().match(/^\{\{(\w+)\}\}$/);
    if (m) return m[1] in vars ? vars[m[1]] : value;
    return value.replace(PLACEHOLDER_RE, (_, k) => {
      if (k in vars) {
        const v = vars[k];
        return typeof v === "string" ? v : JSON.stringify(v);
      }
      return `{{${k}}}`;
    });
  }
  if (Array.isArray(value)) return value.map(item => substituteValue(item, vars, depth + 1));
  if (typeof value === "object" && value !== null) {
    const r = {};
    for (const [k, v] of Object.entries(value)) r[k] = substituteValue(v, vars, depth + 1);
    return r;
  }
  return value;
}

function resolveCustom(def, props) {
  return def.layout.map(c => ({
    component: c.component,
    props: substituteValue(c.props, props, 0),
  }));
}

// ── File I/O helpers ───────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(COMPONENTS_DIR)) {
    fs.mkdirSync(COMPONENTS_DIR, { recursive: true });
  }
}

function readComponent(name) {
  const fp = path.join(COMPONENTS_DIR, `${name}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    console.log("[MCP] File read:", fp);
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (err) {
    console.error("[MCP] Failed to parse JSON from file:", fp, err.message);
    return null;
  }
}

function writeComponent(name, def) {
  ensureDir();
  const fp = path.join(COMPONENTS_DIR, `${name}.json`);
  console.log("[MCP] File write:", fp);
  fs.writeFileSync(fp, JSON.stringify(def, null, 2), "utf8");
}

function listCustomComponents() {
  if (!fs.existsSync(COMPONENTS_DIR)) return [];
  const results = [];
  for (const file of fs.readdirSync(COMPONENTS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(COMPONENTS_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      results.push({ name: parsed.name || file.replace(".json", ""), description: parsed.description || "" });
    } catch (err) {
      console.error("[MCP] Failed to parse JSON from file:", filePath, err.message);
    }
  }
  return results;
}

// ── Tool definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: "render_ui",
    description: "Render a UI component on the Jarble canvas. The result will be displayed as a rich visual component in the user's dashboard. Supports built-in components (card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout, chart, tabs, accordion, badge, list, timeline, divider, avatar, blockquote, metric_card, header, button_group, form, gauge, radar, treemap, funnel, waterfall, scatter, steps, result, tree, calendar_heatmap, descriptions, code_editor, map, carousel, stock, sankey, sunburst, heatmap, wordcloud, histogram, box, liquid, rose, dual_axes, bullet, radial_bar, venn, circle_packing, statistic, tag_cloud, video, image_gallery, audio, spreadsheet) and custom bot-defined components. IMPORTANT: Return the result text to the user as-is so the frontend can parse and render it.",
    inputSchema: {
      type: "object",
      properties: {
        component: { type: "string", description: "Component name (built-in or custom)" },
        props: { type: "object", description: "Component props — structure depends on the component type. See component reference for required fields.", additionalProperties: true },
      },
      required: ["component", "props"],
    },
  },
  {
    name: "define_component",
    description: "Create a reusable UI component template saved to the bot's storage. Components are composed of built-in primitives with {{variable}} placeholders that get filled when rendered.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Component name (lowercase, letters/digits/underscores)" },
        description: { type: "string", description: "Human-readable description" },
        layout: {
          type: "array",
          description: "Array of built-in component blocks with {{variable}} placeholders",
          items: {
            type: "object",
            properties: {
              component: { type: "string" },
              props: { type: "object" },
            },
            required: ["component", "props"],
          },
        },
      },
      required: ["name", "layout"],
    },
  },
  {
    name: "list_components",
    description: "List all available UI components (built-in + custom). Returns a summary of what's available for render_ui.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "save_canvas_file",
    description: "Save canvas component data to a file on the bot's filesystem. Used when the user saves a component to their personal library or edits an editable component. Returns the saved metadata for confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "File identifier (alphanumeric, hyphens, underscores, max 64 chars)" },
        component: { type: "string", description: "Component type (e.g. data_table, card)" },
        props: { type: "object", description: "Component props to persist" },
        name: { type: "string", description: "Human-readable display name (e.g. 'Q4 Revenue Dashboard')" },
        description: { type: "string", description: "Brief description of what this component shows" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization (e.g. ['finance', 'dashboard'])" },
      },
      required: ["fileId", "component", "props"],
    },
  },
  {
    name: "load_canvas_file",
    description: "Load previously saved canvas component data from a file.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "File identifier to load" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "list_canvas_files",
    description: "List all saved canvas files in /data/files/ with their metadata (name, description, component type, tags, saved date). Use this when the user asks to see their saved components.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "component_reference",
    description: "Get detailed prop schema and usage for UI components. Call with a specific component name to get its props, or without a name to get the full reference for all 56 built-in components. ALWAYS call this before rendering a component if you are unsure of its props.",
    inputSchema: {
      type: "object",
      properties: {
        component: { type: "string", description: "Optional component name. Omit to get full reference." },
      },
    },
  },
  {
    name: "update_ui",
    description: "Update an existing UI component on the canvas by its card ID. Use this instead of render_ui when modifying an existing component (e.g., after a user interaction or when asked to edit a component). Supports merge (partial prop update) or replace (full prop replacement).",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The ID of the card to update (from the [UI_ACTION] message or the user's @reference)" },
        props: { type: "object", description: "New or updated props. In merge mode, only provided keys are updated." },
        merge: { type: "boolean", description: "If true (default), merge with existing props. If false, replace all props.", default: true },
        component: { type: "string", description: "Optional: change the component type entirely (e.g., chart type: bar -> line)" },
      },
      required: ["card_id", "props"],
    },
  },
];

// ── Tool execution ─────────────────────────────────────────────────────

function executeRenderUi(args) {
  const { component, props } = args;
  if (!component) return { isError: true, text: "Missing 'component' parameter." };

  // Built-in — emit as jarble_ui fenced block so the frontend renders it
  if (BUILTIN_COMPONENTS.includes(component)) {
    const block = JSON.stringify({ component, props: props || {} });
    return { isError: false, text: "```jarble_ui\n" + block + "\n```" };
  }

  // Custom — resolve from PVC
  const def = readComponent(component);
  if (!def) {
    return { isError: true, text: `Component "${component}" not found. Use list_components to see available components.` };
  }

  const children = resolveCustom(def, props || {});
  const layoutBlock = JSON.stringify({
    component: "layout",
    props: { title: def.description || undefined, children },
  });
  return { isError: false, text: "```jarble_ui\n" + layoutBlock + "\n```" };
}

function executeDefineComponent(args) {
  const { name, description, layout } = args;
  if (!name || !layout) return { isError: true, text: "Missing 'name' and 'layout'." };

  const nameErr = validateName(name);
  if (nameErr) return { isError: true, text: nameErr };

  const def = { name, ...(description ? { description } : {}), layout };
  const defErr = validateDefinition(def);
  if (defErr) return { isError: true, text: defErr };

  try {
    writeComponent(name, def);
    console.log("[MCP] Component defined:", name);
    return { isError: false, text: `Component "${name}" saved. Use render_ui with component="${name}" to display it.` };
  } catch (err) {
    console.error("[MCP] Failed to define component:", name, err.message);
    return { isError: true, text: `Failed to save: ${err.message}` };
  }
}

function executeListComponents() {
  const custom = listCustomComponents();
  const lines = ["**Built-in components:**"];
  for (const name of BUILTIN_COMPONENTS) {
    lines.push(`- \`${name}\` — ${BUILTIN_DESCRIPTIONS[name]}`);
  }
  if (custom.length > 0) {
    lines.push("", "**Custom components:**");
    for (const c of custom) {
      lines.push(`- \`${c.name}\`${c.description ? ` — ${c.description}` : ""}`);
    }
  }
  lines.push("", `${BUILTIN_COMPONENTS.length} built-in + ${custom.length} custom component(s) available.`);
  return { isError: false, text: lines.join("\n") };
}

function executeSaveCanvasFile(args) {
  const { fileId, component, props, name, description, tags } = args;
  if (!fileId || !component || !props) return { isError: true, text: "Missing required fields: fileId, component, props." };
  if (!FILE_ID_RE.test(fileId)) return { isError: true, text: `Invalid fileId "${fileId}". Must be alphanumeric/hyphens/underscores, max 64 chars.` };

  const fileData = {
    component,
    props,
    name: name || fileId,
    description: description || "",
    tags: Array.isArray(tags) ? tags : [],
    savedAt: new Date().toISOString(),
  };

  const payload = JSON.stringify(fileData, null, 2);
  if (payload.length > MAX_FILE_SIZE) return { isError: true, text: `Payload exceeds max size of ${MAX_FILE_SIZE} bytes.` };

  try {
    if (!fs.existsSync(FILES_DIR)) {
      fs.mkdirSync(FILES_DIR, { recursive: true });
    }
    const filePath = path.join(FILES_DIR, `${fileId}.json`);
    console.log("[MCP] File write:", filePath);
    fs.writeFileSync(filePath, payload, "utf8");
    const displayName = name || fileId;
    return { isError: false, text: `Saved "${displayName}" (${component}) to library as "${fileId}".` };
  } catch (err) {
    console.error("[MCP] Failed to save canvas file:", fileId, err.message);
    return { isError: true, text: `Failed to save: ${err.message}` };
  }
}

function executeLoadCanvasFile(args) {
  const { fileId } = args;
  if (!fileId) return { isError: true, text: "Missing fileId." };
  if (!FILE_ID_RE.test(fileId)) return { isError: true, text: `Invalid fileId "${fileId}".` };

  const fp = path.join(FILES_DIR, `${fileId}.json`);
  if (!fs.existsSync(fp)) return { isError: true, text: `File "${fileId}" not found.` };

  try {
    console.log("[MCP] File read:", fp);
    const content = JSON.parse(fs.readFileSync(fp, "utf8"));
    return { isError: false, text: JSON.stringify(content) };
  } catch (err) {
    console.error("[MCP] Failed to parse JSON from file:", fp, err.message);
    return { isError: true, text: `Failed to read: ${err.message}` };
  }
}

function executeListCanvasFiles() {
  if (!fs.existsSync(FILES_DIR)) return { isError: false, text: "No saved components found. Users can save components from the canvas using the bookmark button." };

  const files = [];
  for (const file of fs.readdirSync(FILES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const fileId = file.replace(".json", "");
    const filePath = path.join(FILES_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      files.push({
        fileId,
        component: parsed.component || "unknown",
        name: parsed.name || fileId,
        description: parsed.description || "",
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        savedAt: parsed.savedAt || null,
      });
    } catch (err) {
      console.error("[MCP] Failed to parse JSON from file:", filePath, err.message);
    }
  }

  if (files.length === 0) return { isError: false, text: "No saved components found. Users can save components from the canvas using the bookmark button." };

  const lines = [`**${files.length} saved component(s):**`, ""];
  for (const f of files) {
    let line = `- **${f.name}** (\`${f.fileId}\`) — ${f.component}`;
    if (f.description) line += `: ${f.description}`;
    if (f.tags.length > 0) line += ` [${f.tags.join(", ")}]`;
    if (f.savedAt) line += ` _(saved ${f.savedAt.split("T")[0]})_`;
    lines.push(line);
  }
  lines.push("", "Use `load_canvas_file` with a fileId to recall any of these, then `render_ui` to display it.");
  return { isError: false, text: lines.join("\n") };
}

// ── Component reference (detailed prop schemas) ────────────────────────

const COMPONENT_REFERENCE = {
  card: "`{title?, subtitle?, body?}`",
  data_table: "`{title?, columns: string[], rows: (string|number)[][]}`",
  stat_grid: "`{stats: [{label, value, change?, icon?}]}`",
  key_value: "`{title?, items: [{key, value}]}`",
  code_block: "`{code, language?, title?}`",
  alert: "`{title?, message, variant: info|success|warning|error}`",
  progress: "`{label?, value: 0-100, variant?: default|success|warning|error}`",
  image: "`{src, alt?, caption?}`",
  layout: "`{title?, children: [{component, props}]}` — container for nesting",
  chart: "`{type: bar|line|pie|area, data: [{...}], dataKeys: string[], xAxisKey?, title?, colors?, stacked?, showLegend?, showGrid?}`",
  tabs: "`{tabs: [{label, content?, children?: [{component, props}]}], defaultTab?}`",
  accordion: "`{items: [{title, content?, children?, defaultOpen?}], type?: single|multiple}`",
  badge: "`{text, variant?: default|secondary|destructive|outline|success|warning|info, icon?}`",
  list: "`{title?, items: [{text, description?, icon?, badge?, badgeVariant?}], ordered?}`",
  timeline: "`{title?, events: [{label, description?, timestamp?, icon?, status?: completed|active|pending}]}`",
  divider: "`{label?, variant?: solid|dashed|dotted, spacing?: sm|md|lg}`",
  avatar: "`{name, src?, subtitle?, size?: sm|md|lg}`",
  blockquote: "`{text, attribution?, variant?: default|info|warning}`",
  metric_card: "`{label, value, change?, changeLabel?, icon?, sparkline?: number[]}`",
  header: "`{title, subtitle?, level?: 1|2|3, divider?}`",
  button_group: "`{buttons: [{id, label, variant?: default|secondary|destructive|outline, icon?, disabled?}]}`",
  form: "`{title?, fields: [{name, label, type: text|email|textarea|select|checkbox|number, placeholder?, required?, options?, defaultValue?}], submitLabel?}`",
  gauge: "`{value: 0-100, title?, suffix?, color?}` — gauge/speedometer",
  radar: "`{data: [{axis, value, group?}], title?}` — radar/spider chart",
  treemap: "`{data: {name, children: [{name, value}]}, title?}` — treemap",
  funnel: "`{data: [{stage, value}], title?}` — conversion funnel",
  waterfall: "`{data: [{label, value}], title?}` — waterfall chart",
  scatter: "`{data: [{x, y, label?, group?}], title?, xLabel?, yLabel?}` — scatter plot",
  stock: "`{data: [{date, open, close, high, low}], title?}` — candlestick/OHLC chart",
  sankey: "`{data: [{source, target, value}], title?}` — flow/transfer diagram",
  sunburst: "`{data: {name, children: [{name, value}]}, title?}` — hierarchical sunburst",
  heatmap: "`{data: [{x, y, value}], title?}` — heatmap grid",
  wordcloud: "`{data: [{text, value}], title?}` — word/keyword cloud",
  histogram: "`{data: [{value}], title?, binWidth?}` — distribution histogram",
  box: "`{data: [{group, value}], title?}` — box plot",
  liquid: "`{value: 0-1, title?, color?}` — liquid fill gauge",
  rose: "`{data: [{category, value}], title?}` — nightingale/polar area chart",
  dual_axes: "`{data: [{...}], title?, xField?, yFields?: [string, string]}` — dual Y-axis chart",
  bullet: "`{data: [{title, ranges: number[], measures: number[], target: number}], title?}` — KPI bullet chart",
  radial_bar: "`{data: [{name, value}], title?}` — circular bar chart",
  venn: "`{data: [{sets: string[], size, label?}], title?}` — set overlap diagram",
  circle_packing: "`{data: {name, children: [{name, value}]}, title?}` — nested circle hierarchy",
  steps: "`{current: number, items: [{title, description?, icon?}], direction?: vertical|horizontal}` — process steps",
  result: "`{status: success|error|info|warning, title, subtitle?}` — outcome display",
  tree: "`{data: [{title, key, children?}], title?, defaultExpandAll?}` — tree view",
  calendar_heatmap: "`{data: [{date, value}], title?}` — calendar heatmap",
  descriptions: "`{title?, items: [{label, value, span?}], columns?, bordered?}` — description list",
  carousel: "`{items: [{title?, description?, image?}], autoplay?}` — content carousel",
  code_editor: "`{code, language?, title?, readOnly?, height?}` — Monaco code editor",
  map: "`{center: [lat, lng], zoom?, markers?: [{lat, lng, label?}], title?}` — interactive map",
  statistic: "`{value, title?, prefix?, suffix?, precision?, isCountdown?, countdownTarget?}` — KPI statistic",
  tag_cloud: "`{tags: [{text, color?, size?: small|medium|large}], title?}` — colored tags",
  video: "`{url, title?, controls?, loop?, muted?}` — video player (YouTube, Vimeo, MP4)",
  image_gallery: "`{images: [{src, alt?, caption?}], title?, columns?}` — image grid with lightbox",
  audio: "`{src, title?, autoplay?}` — audio player",
  spreadsheet: "`{data?: [{...}], title?, height?}` — editable Excel-like grid",
  sandbox: "`{html, css?, js?, props?: {}, height?, title?, libraries?: string[]}` — sandboxed iframe for live JS/animations/3D. CRITICAL: html=ONLY body HTML (divs etc), NEVER <script>/<style>/<html>/<head> tags. css=all styles. js=all JavaScript (runs AFTER libraries load). libraries=CDN URLs loaded dynamically. Use for: live charts, 3D, animations, interactive widgets. NEVER embed third-party widgets. NEVER use code_editor for running JS — use sandbox instead.",
};

function executeComponentReference(args) {
  const name = args?.component;

  if (name) {
    if (!COMPONENT_REFERENCE[name]) {
      return { isError: true, text: `Unknown component "${name}". Use list_components to see available components.` };
    }
    return { isError: false, text: `**${name}** — props: ${COMPONENT_REFERENCE[name]}` };
  }

  // Return full reference grouped by category
  const lines = [
    "# Jarble UI Component Reference",
    "",
    "Use these with \\`jarble_ui\\` fenced blocks: \\`{\"component\": \"name\", \"props\": {...}}\\`",
    "",
    "## Display",
  ];
  const categories = {
    "Display": ["card", "data_table", "stat_grid", "key_value", "code_block", "alert", "progress", "image", "chart", "tabs", "accordion", "badge", "list", "timeline", "divider", "avatar", "blockquote", "metric_card", "header", "layout"],
    "Charts": ["gauge", "radar", "treemap", "funnel", "waterfall", "scatter", "stock", "sankey", "sunburst", "heatmap", "wordcloud", "histogram", "box", "liquid", "rose", "dual_axes", "bullet", "radial_bar", "venn", "circle_packing"],
    "Advanced UI": ["steps", "result", "tree", "calendar_heatmap", "descriptions", "carousel"],
    "Specialized": ["code_editor", "map"],
    "Data Display": ["statistic", "tag_cloud"],
    "Media": ["video", "image_gallery", "audio"],
    "Data": ["spreadsheet"],
    "Interactive": ["button_group", "form"],
  };

  let first = true;
  for (const [cat, comps] of Object.entries(categories)) {
    if (!first) lines.push("");
    lines.push(`## ${cat}`);
    for (const c of comps) {
      lines.push(`- \`${c}\` — ${COMPONENT_REFERENCE[c]}`);
    }
    first = false;
  }

  return { isError: false, text: lines.join("\n") };
}

function executeUpdateUi(args) {
  const { card_id, props, merge, component } = args;
  if (!card_id) return { isError: true, text: "Missing 'card_id' parameter." };
  if (!props || typeof props !== "object") return { isError: true, text: "Missing or invalid 'props' parameter." };

  console.log("[MCP] update_ui:", card_id, "merge:", merge !== false);

  const block = JSON.stringify({
    card_id,
    props,
    merge: merge !== false,
    ...(component ? { component } : {}),
  });

  return {
    isError: false,
    text: "```jarble_ui_update\n" + block + "\n```\n\nUpdated card " + card_id + " successfully.",
  };
}

function executeTool(name, args) {
  switch (name) {
    case "render_ui": return executeRenderUi(args || {});
    case "define_component": return executeDefineComponent(args || {});
    case "list_components": return executeListComponents();
    case "save_canvas_file": return executeSaveCanvasFile(args || {});
    case "load_canvas_file": return executeLoadCanvasFile(args || {});
    case "list_canvas_files": return executeListCanvasFiles();
    case "component_reference": return executeComponentReference(args || {});
    case "update_ui": return executeUpdateUi(args || {});
    default: return null;
  }
}

// ── JSON-RPC handler ───────────────────────────────────────────────────

function handleMessage(msg) {
  const { id, method, params } = msg;

  // Initialize handshake
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "jarble-ui", version: "1.0.0" },
      },
    };
  }

  // Initialized notification (no response needed)
  if (method === "notifications/initialized") {
    return null;
  }

  // List tools
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    };
  }

  // Call tool
  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    console.log("[MCP] Tool called:", toolName, "args:", JSON.stringify(toolArgs).slice(0, 200));

    const result = executeTool(toolName, toolArgs);
    if (!result) {
      console.error("[MCP] Unknown tool:", toolName);
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
      };
    }

    console.log("[MCP] Tool result:", toolName, result.isError ? "ERROR" : "OK");

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: result.text }],
        isError: result.isError,
      },
    };
  }

  // Ping
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  // Unknown method
  if (id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  return null; // Notifications we don't handle
}

// ── stdio transport ────────────────────────────────────────────────────

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;

  // MCP stdio uses newline-delimited JSON
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);

    if (!line) continue;

    try {
      const msg = JSON.parse(line);
      const response = handleMessage(msg);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (err) {
      // Parse error
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }) + "\n");
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

// Prevent unhandled errors from crashing
process.on("uncaughtException", (err) => {
  process.stderr.write(`[jarble-ui-server] Uncaught: ${err.message}\n`);
});

// Export for direct invocation (used by canvasFiles proxy)
if (typeof module !== "undefined") {
  module.exports = { executeTool };
}
