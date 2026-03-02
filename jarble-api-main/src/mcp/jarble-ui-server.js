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
// Loaded from generated JSON (shared/component-manifest/generated/component-data.json).
// To regenerate: npx tsx scripts/generate-mcp-manifest.ts (run from jarble-api-main/)
// Falls back to inline list if JSON not found (e.g. first boot before build step).

let BUILTIN_COMPONENTS;
let BUILTIN_DESCRIPTIONS;

try {
  // Try to load from generated manifest JSON (created by build step)
  const manifestPath = path.resolve(__dirname, "../../../shared/component-manifest/generated/component-data.json");
  const manifestData = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  BUILTIN_COMPONENTS = manifestData.componentNames;
  BUILTIN_DESCRIPTIONS = manifestData.descriptions;
} catch {
  // Fallback: inline list for first boot / when JSON not yet generated
  BUILTIN_COMPONENTS = [
    "card", "data_table", "stat_grid", "key_value",
    "code_block", "alert", "progress", "image", "layout",
    "chart", "tabs", "accordion", "badge", "list",
    "timeline", "divider", "metric_card", "header",
    "button_group", "form", "code_editor", "spreadsheet",
    "sandbox", "video",
    "audio", "avatar", "blockquote", "text_message",
    "image_gallery", "map",
    "descriptions", "steps", "result", "carousel",
    "statistic", "tag_cloud",
    "tree", "marketplace_sandbox",
  ];
  BUILTIN_DESCRIPTIONS = {};
}

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
    console.error("[MCP] File read:", fp);
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (err) {
    console.error("[MCP] Failed to parse JSON from file:", fp, err.message);
    return null;
  }
}

function writeComponent(name, def) {
  ensureDir();
  const fp = path.join(COMPONENTS_DIR, `${name}.json`);
  console.error("[MCP] File write:", fp);
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
    description: "Render a UI component on the Jarble canvas. The result will be displayed as a rich visual component in the user's dashboard. Supports built-in components (card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout, chart, tabs, accordion, badge, list, timeline, divider, metric_card, header, button_group, form, code_editor, spreadsheet, sandbox) and custom bot-defined components. For anything beyond these — charts, gauges, maps, 3D, animations, custom visualizations — use the sandbox component with HTML/CSS/JS. IMPORTANT: Return the result text to the user as-is so the frontend can parse and render it.",
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
    description: "Get detailed prop schema and usage for UI components. Call with a specific component name to get its props, or without a name to get the full reference for all built-in components. ALWAYS call this before rendering a component if you are unsure of its props.",
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
  // ── Memory tools ──────────────────────────────────────────────────────
  {
    name: "store_memory",
    description: "Store information in long-term memory. Extracts discrete facts from the text, checks for duplicates/contradictions, and either inserts new memories or updates existing ones (compaction). Use this when the user shares personal info, preferences, important context, or anything worth remembering across conversations and platforms. Memory persists across Jarble dashboard, Telegram, Discord, WhatsApp, etc.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text containing facts to remember. Can be conversational — facts will be automatically extracted." },
        category: { type: "string", description: "Optional category: general, preference, personal, context, goal", default: "general" },
        source_platform: { type: "string", description: "Optional: which platform this info came from (jarble, telegram, discord, whatsapp, slack)" },
      },
      required: ["text"],
    },
  },
  {
    name: "recall_memory",
    description: "Search long-term memory for information relevant to a query. Returns the most relevant memories ranked by semantic similarity. Use this at the start of conversations or when the user asks about something you might have stored. Memory is cross-platform — recalling works regardless of which platform the info was stored from.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for in memory (natural language)" },
        limit: { type: "number", description: "Max number of memories to return (default 10, max 50)", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "List all stored memories, optionally filtered by category. Shows the full memory inventory sorted by most recently updated.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional: filter by category (general, preference, personal, context, goal)" },
        limit: { type: "number", description: "Max memories to return (default 50, max 200)", default: 50 },
      },
    },
  },
  {
    name: "forget_memory",
    description: "Delete a specific memory by ID or by semantic search. Use when the user asks you to forget something.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact memory ID to delete (from list_memories)" },
        query: { type: "string", description: "Natural language query to find the memory to delete (uses semantic search)" },
      },
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
    console.error("[MCP] Component defined:", name);
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
    console.error("[MCP] File write:", filePath);
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
    const content = JSON.parse(fs.readFileSync(fp, "utf8"));
    return { isError: false, text: JSON.stringify(content) };
  } catch (err) {
    console.error("[MCP] Failed to parse JSON from file:", fp, err.message);
    return { isError: true, text: `Failed to read: ${err.message}` };
  }
}

function executeListCanvasFiles(args) {
  if (!fs.existsSync(FILES_DIR)) {
    if (args && args.format === "json") return { isError: false, text: JSON.stringify([]) };
    return { isError: false, text: "No saved components found. Users can save components from the canvas using the bookmark button." };
  }

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

  // JSON format — used by frontend gallery
  if (args && args.format === "json") {
    return { isError: false, text: JSON.stringify(files) };
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

function executeDeleteCanvasFile(args) {
  const { fileId } = args;
  if (!fileId || !FILE_ID_RE.test(fileId)) {
    return { isError: true, text: "Invalid or missing fileId." };
  }
  const fp = path.join(FILES_DIR, `${fileId}.json`);
  if (!fs.existsSync(fp)) {
    return { isError: true, text: `File "${fileId}" not found.` };
  }
  try {
    fs.unlinkSync(fp);
    return { isError: false, text: `Deleted "${fileId}" from library.` };
  } catch (err) {
    return { isError: true, text: `Failed to delete: ${err.message}` };
  }
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
  metric_card: "`{label, value, change?, changeLabel?, icon?, sparkline?: number[]}`",
  header: "`{title, subtitle?, level?: 1|2|3, divider?}`",
  button_group: "`{buttons: [{id, label, variant?: default|secondary|destructive|outline, icon?, disabled?}]}`",
  form: "`{title?, fields: [{name, label, type: text|email|textarea|select|checkbox|number, placeholder?, required?, options?, defaultValue?}], submitLabel?}`",
  code_editor: "`{code, language?, title?, readOnly?, height?}` — Monaco code editor",
  spreadsheet: "`{data?: [{...}], title?, height?}` — editable Excel-like grid",
  sandbox: "`{html, css?, js?, props?: {}, height?, title?, libraries?: string[]}` — sandboxed iframe for live JS/animations/3D. CRITICAL: html=ONLY body HTML (divs etc), NEVER <script>/<style>/<html>/<head> tags. css=all styles. js=all JavaScript (runs AFTER libraries load). libraries=CDN URLs loaded dynamically. Use for: gauges, maps, scatter plots, heatmaps, 3D, animations, candlestick charts, word clouds, or ANY custom visualization. NEVER use code_editor for running JS — use sandbox instead.",
  video: "`{url, title?, controls?: true, loop?: false, muted?: false}` — video/livestream player. Supports YouTube, Twitch, Vimeo, SoundCloud, Dailymotion, direct MP4/HLS URLs. Use for livestreams (e.g. YouTube Live, Twitch channels). Just pass the URL.",
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
    "Display": ["card", "data_table", "stat_grid", "key_value", "code_block", "alert", "progress", "image", "chart", "tabs", "accordion", "badge", "list", "timeline", "divider", "metric_card", "header", "layout"],
    "Interactive": ["button_group", "form"],
    "Data": ["spreadsheet"],
    "Specialized": ["code_editor"],
    "Sandbox": ["sandbox"],
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

  console.error("[MCP] update_ui:", card_id, "merge:", merge !== false);

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

// ── Memory System ─────────────────────────────────────────────────────
// Cross-platform long-term memory with semantic search and compaction.
// Stores memories as JSON on PVC with embeddings for similarity search.
// Uses the bot's LLM provider for embeddings and fact extraction.

const MEMORY_DIR = "/data/memory";
const MEMORY_FILE = path.join(MEMORY_DIR, "store.json");
const MEMORY_VERSION = 1;
const EMBEDDING_DIMS = 512;
const SIMILARITY_THRESHOLD = 0.82; // cosine sim threshold for dedup/compaction
const MAX_MEMORIES = 10000;

// ── Embedding provider detection ──────────────────────────────────────

function getEmbeddingConfig() {
  // OpenAI and OpenRouter both support /v1/embeddings with text-embedding-3-small
  if (process.env.OPENAI_API_KEY) {
    return {
      url: "https://api.openai.com/v1/embeddings",
      key: process.env.OPENAI_API_KEY,
      model: "text-embedding-3-small",
      authHeader: "Bearer",
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      url: "https://openrouter.ai/api/v1/embeddings",
      key: process.env.OPENROUTER_API_KEY,
      model: "openai/text-embedding-3-small",
      authHeader: "Bearer",
    };
  }
  if (process.env.GOOGLE_API_KEY) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_API_KEY}`,
      key: process.env.GOOGLE_API_KEY,
      model: "text-embedding-004",
      authHeader: null, // key in URL
      isGoogle: true,
    };
  }
  // No dedicated embedding provider — will use local hashing fallback
  return null;
}

// ── Local embedding fallback (no API needed) ──────────────────────────
// Simple bag-of-words hash embedding using character trigrams.
// Not as good as neural embeddings, but works offline with zero cost.
// Produces a 512-dim vector from text via seeded hashing.

function localEmbed(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const vec = new Float64Array(EMBEDDING_DIMS);

  // Character trigram hashing for better semantic signal
  for (const word of words) {
    // Word-level hash
    let h = 0;
    for (let i = 0; i < word.length; i++) h = ((h << 5) - h + word.charCodeAt(i)) | 0;
    vec[Math.abs(h) % EMBEDDING_DIMS] += 1;
    // Trigram hashes for substring matching
    for (let i = 0; i <= word.length - 3; i++) {
      const tri = word.slice(i, i + 3);
      let th = 0;
      for (let j = 0; j < 3; j++) th = ((th << 5) - th + tri.charCodeAt(j)) | 0;
      vec[Math.abs(th) % EMBEDDING_DIMS] += 0.5;
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIMS; i++) vec[i] /= norm;

  return Array.from(vec);
}

// ── LLM provider detection (for fact extraction / compaction) ─────────

function getLLMConfig() {
  const provider = process.env.LLM_PROVIDER || "openrouter";

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const key = process.env.ANTHROPIC_API_KEY;
    // Claude Max (sk-ant-oat*) tokens can't be used for direct API calls
    // They only work through the Claude app. Skip for memory operations.
    if (key.startsWith("sk-ant-oat")) {
      console.error("[MCP:Memory] Claude Max token detected — using simple extraction (no API access for memory ops)");
      // Fall through to try other providers
    } else {
      return {
        url: "https://api.anthropic.com/v1/messages",
        key,
        model: "claude-haiku-4-5-20251001",
        provider: "anthropic",
        isClaudeMax: false,
      };
    }
  }
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      key: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini",
      provider: "openai",
    };
  }
  if (provider === "google" && process.env.GOOGLE_API_KEY) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      key: process.env.GOOGLE_API_KEY,
      model: "gemini-2.0-flash",
      provider: "google",
    };
  }
  // Default: OpenRouter (works with any key type)
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (key) {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      key,
      model: "openai/gpt-4o-mini",
      provider: "openrouter",
    };
  }
  return null;
}

// ── Embedding API call ────────────────────────────────────────────────

async function embed(text) {
  const config = getEmbeddingConfig();
  if (!config) {
    // Fallback to local embedding when no API is available (e.g. Anthropic-only)
    console.error("[MCP:Memory] Using local embedding fallback (no embedding API available)");
    return localEmbed(text);
  }

  if (config.isGoogle) {
    // Google uses a different API shape
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });
    if (!res.ok) throw new Error(`Google embedding API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const values = data.embedding?.values;
    if (!values) throw new Error("No embedding returned from Google API");
    // Truncate or pad to EMBEDDING_DIMS
    return values.slice(0, EMBEDDING_DIMS);
  }

  // OpenAI / OpenRouter compatible endpoint
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "Authorization": `${config.authHeader} ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
      dimensions: EMBEDDING_DIMS,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Embedding API error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error("No embedding returned from API");
  }
  return data.data[0].embedding;
}

// ── Batch embed (up to 20 texts at once) ──────────────────────────────

async function embedBatch(texts) {
  const config = getEmbeddingConfig();
  if (!config) {
    // Local fallback — embed each text independently
    return texts.map(t => localEmbed(t));
  }

  if (config.isGoogle) {
    // Google doesn't support batch — fall back to sequential
    const results = [];
    for (const t of texts) results.push(await embed(t));
    return results;
  }

  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "Authorization": `${config.authHeader} ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Embedding batch API error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.data) throw new Error("No embeddings returned from batch API");
  // Sort by index in case API returns out of order
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

// ── LLM call (for fact extraction and compaction) ─────────────────────

async function callLLM(systemPrompt, userMessage) {
  const config = getLLMConfig();
  if (!config) throw new Error("No LLM provider available for memory operations.");

  if (config.provider === "anthropic") {
    // Claude Max tokens (sk-ant-oat*) use Bearer auth; regular keys use x-api-key
    const headers = {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
    if (config.isClaudeMax) {
      headers["Authorization"] = `Bearer ${config.key}`;
    } else {
      headers["x-api-key"] = config.key;
    }

    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errBody.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || "";
  }

  if (config.provider === "google") {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
      }),
    });
    if (!res.ok) throw new Error(`Google API error: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // OpenAI / OpenRouter compatible
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Vector math ───────────────────────────────────────────────────────

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Memory store I/O ──────────────────────────────────────────────────

function loadMemoryStore() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      return { version: MEMORY_VERSION, embeddingModel: "text-embedding-3-small", dims: EMBEDDING_DIMS, memories: [] };
    }
    const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    if (raw.version !== MEMORY_VERSION) {
      console.error("[MCP:Memory] Store version mismatch, starting fresh");
      return { version: MEMORY_VERSION, embeddingModel: "text-embedding-3-small", dims: EMBEDDING_DIMS, memories: [] };
    }
    return raw;
  } catch (err) {
    console.error("[MCP:Memory] Failed to load store:", err.message);
    return { version: MEMORY_VERSION, embeddingModel: "text-embedding-3-small", dims: EMBEDDING_DIMS, memories: [] };
  }
}

function saveMemoryStore(store) {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store), "utf8");
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Fact extraction via LLM ───────────────────────────────────────────

async function extractFacts(text) {
  // Try LLM-powered extraction first (higher quality)
  const llmConfig = getLLMConfig();
  if (llmConfig) {
    try {
      const systemPrompt = `You extract discrete factual memories from conversational text. Return a JSON array of short, self-contained fact strings. Each fact should be a complete statement that makes sense on its own.

Rules:
- Only extract things worth remembering long-term: personal info, preferences, opinions, important context, relationships, goals
- Skip transient info: greetings, questions being asked, filler, technical commands
- Be concise: "User's favorite color is red" not "The user mentioned that their favorite color is the color red"
- Write in third person: "User likes pizza" not "I like pizza"
- If there's nothing worth remembering, return an empty array: []

Return ONLY the JSON array, no other text.`;

      const response = await callLLM(systemPrompt, text);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const facts = JSON.parse(jsonMatch[0]);
        if (Array.isArray(facts)) {
          return facts.filter(f => typeof f === "string" && f.length > 0 && f.length < 500);
        }
      }
    } catch (err) {
      console.error("[MCP:Memory] LLM extraction failed, using simple extraction:", err.message);
    }
  }

  // Fallback: simple sentence-based extraction (no LLM needed)
  // Split into sentences and filter out questions/greetings
  console.error("[MCP:Memory] Using simple fact extraction (no LLM available)");
  const sentences = text
    .replace(/\n+/g, ". ")
    .split(/[.!]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10 && s.length < 500)
    .filter(s => !s.match(/^(hi|hey|hello|thanks|ok|sure|yes|no|what|how|why|when|where|who|can you|could you|please|do you)/i))
    .filter(s => !s.endsWith("?"));

  if (sentences.length === 0 && text.length > 10 && text.length < 500) {
    // If no sentences extracted, use the whole text as a single fact
    return [text.trim()];
  }

  return sentences;
}

// ── Compaction decision via LLM ───────────────────────────────────────

async function compactDecision(existingText, newFact) {
  // Try LLM-powered compaction first
  const llmConfig = getLLMConfig();
  if (llmConfig) {
    try {
      const systemPrompt = `You decide how to handle a new piece of information relative to an existing memory.

Respond with exactly ONE of these actions on the first line, followed by the resulting memory text on the second line:

REPLACE — The new info contradicts or supersedes the old (e.g., preference change, updated fact). Output the new version.
MERGE — The new info adds to or enriches the old without contradicting. Output a combined version.
SKIP — The new info is redundant or already captured. Output nothing.

Format:
ACTION
resulting memory text (or empty for SKIP)`;

      const userMsg = `Existing memory: "${existingText}"\nNew information: "${newFact}"`;
      const response = await callLLM(systemPrompt, userMsg);
      const lines = response.trim().split("\n");
      const action = (lines[0] || "").trim().toUpperCase();

      if (action === "SKIP") return { action: "SKIP", result: "" };
      if (action === "REPLACE" || action === "MERGE") {
        const result = lines.slice(1).join("\n").trim();
        return { action, result: result || newFact };
      }
    } catch (err) {
      console.error("[MCP:Memory] Compaction LLM call failed, using simple compaction:", err.message);
    }
  }

  // Fallback: simple heuristic compaction (no LLM)
  // If texts are very similar (>90% word overlap), SKIP
  // Otherwise, REPLACE (assume new info supersedes old for same topic)
  const oldWords = new Set(existingText.toLowerCase().split(/\s+/));
  const newWords = newFact.toLowerCase().split(/\s+/);
  const overlap = newWords.filter(w => oldWords.has(w)).length / Math.max(newWords.length, 1);

  if (overlap > 0.9) return { action: "SKIP", result: "" };
  return { action: "REPLACE", result: newFact };
}

// ── Memory tool implementations ───────────────────────────────────────

async function executeStoreMemory(args) {
  const { text, category, source_platform } = args;
  if (!text || typeof text !== "string") return { isError: true, text: "Missing 'text' parameter." };
  if (text.length > 5000) return { isError: true, text: "Text too long (max 5000 chars). Summarize first." };

  const store = loadMemoryStore();
  const platform = source_platform || process.env.RUNTIME || "unknown";
  const actions = [];

  try {
    // 1. Extract discrete facts from the text
    console.error("[MCP:Memory] Extracting facts from text...");
    const facts = await extractFacts(text);

    if (facts.length === 0) {
      return { isError: false, text: "No memorable facts found in the text. Nothing stored." };
    }
    console.error(`[MCP:Memory] Extracted ${facts.length} fact(s)`);

    // 2. Embed all facts in one batch call
    const embeddings = await embedBatch(facts);

    // 3. For each fact, check for similar existing memories and compact
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const factEmb = embeddings[i];

      // Find most similar existing memory
      // Use both vector similarity AND word overlap for robustness
      // (local embeddings are less precise than neural ones)
      let bestSim = 0;
      let bestIdx = -1;
      const hasEmbeddingAPI = !!getEmbeddingConfig();
      const simThreshold = hasEmbeddingAPI ? SIMILARITY_THRESHOLD : 0.45; // Lower threshold for local embeddings

      for (let j = 0; j < store.memories.length; j++) {
        let sim = cosineSim(factEmb, store.memories[j].embedding);

        // Boost similarity with word overlap for local embeddings
        if (!hasEmbeddingAPI) {
          const factWords = new Set(fact.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
          const memWords = new Set(store.memories[j].text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
          const intersection = [...factWords].filter(w => memWords.has(w) && w.length > 2);
          const union = new Set([...factWords, ...memWords]);
          const jaccard = intersection.length / union.size;
          // Blend: 50% vector sim + 50% word overlap (for local embeddings)
          sim = sim * 0.5 + jaccard * 0.5;
        }

        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }

      if (bestSim >= simThreshold && bestIdx >= 0) {
        // Similar memory found — ask LLM to decide
        const existing = store.memories[bestIdx];
        console.error(`[MCP:Memory] Similar memory found (sim=${bestSim.toFixed(3)}): "${existing.text.slice(0, 60)}"`);

        const decision = await compactDecision(existing.text, fact);

        if (decision.action === "SKIP") {
          actions.push(`Skipped (redundant): "${fact.slice(0, 60)}"`);
          continue;
        }

        if (decision.action === "REPLACE" || decision.action === "MERGE") {
          // Re-embed the compacted result
          const newEmb = await embed(decision.result);
          store.memories[bestIdx] = {
            ...existing,
            text: decision.result,
            embedding: newEmb,
            updatedAt: new Date().toISOString(),
            sourcePlatform: platform,
          };
          actions.push(`${decision.action === "REPLACE" ? "Updated" : "Merged"}: "${decision.result.slice(0, 60)}"`);
          continue;
        }
      }

      // No similar memory — insert new
      if (store.memories.length >= MAX_MEMORIES) {
        // Evict oldest memory
        store.memories.sort((a, b) => new Date(a.updatedAt || a.createdAt).getTime() - new Date(b.updatedAt || b.createdAt).getTime());
        store.memories.shift();
      }

      store.memories.push({
        id: generateId(),
        text: fact,
        category: category || "general",
        embedding: factEmb,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourcePlatform: platform,
      });
      actions.push(`Stored: "${fact.slice(0, 60)}"`);
    }

    // 4. Save
    saveMemoryStore(store);

    const summary = actions.length > 0 ? actions.join("\n") : "No changes made.";
    return {
      isError: false,
      text: `Memory updated (${store.memories.length} total memories):\n${summary}`,
    };
  } catch (err) {
    console.error("[MCP:Memory] store_memory failed:", err.message);
    return { isError: true, text: `Memory store failed: ${err.message}` };
  }
}

async function executeRecallMemory(args) {
  const { query, limit } = args;
  if (!query || typeof query !== "string") return { isError: true, text: "Missing 'query' parameter." };

  const store = loadMemoryStore();
  if (store.memories.length === 0) {
    return { isError: false, text: "No memories stored yet." };
  }

  const maxResults = Math.min(limit || 10, 50);

  try {
    // Embed the query
    const queryEmb = await embed(query);

    // Compute similarities
    const scored = store.memories.map((m, idx) => ({
      ...m,
      score: cosineSim(queryEmb, m.embedding),
      idx,
    }));

    // Sort by relevance, filter low scores
    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter(m => m.score > 0.3).slice(0, maxResults);

    if (relevant.length === 0) {
      return { isError: false, text: "No relevant memories found for this query." };
    }

    const lines = relevant.map((m, i) =>
      `${i + 1}. [${(m.score * 100).toFixed(0)}%] ${m.text} (${m.category}, via ${m.sourcePlatform}, ${m.updatedAt?.split("T")[0] || "unknown"})`
    );

    return {
      isError: false,
      text: `Found ${relevant.length} relevant memory/memories:\n${lines.join("\n")}`,
    };
  } catch (err) {
    console.error("[MCP:Memory] recall_memory failed:", err.message);
    return { isError: true, text: `Memory recall failed: ${err.message}` };
  }
}

async function executeListMemories(args) {
  const store = loadMemoryStore();
  const category = args?.category;
  const limit = Math.min(args?.limit || 50, 200);

  let memories = store.memories;
  if (category) {
    memories = memories.filter(m => m.category === category);
  }

  // Sort by most recently updated
  memories.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  memories = memories.slice(0, limit);

  if (memories.length === 0) {
    return { isError: false, text: category ? `No memories in category "${category}".` : "No memories stored yet." };
  }

  const lines = memories.map((m, i) =>
    `${i + 1}. [${m.id}] ${m.text} (${m.category}, via ${m.sourcePlatform}, updated ${m.updatedAt?.split("T")[0] || "unknown"})`
  );

  return {
    isError: false,
    text: `${store.memories.length} total memories${category ? ` (showing ${memories.length} in "${category}")` : ""}:\n${lines.join("\n")}`,
  };
}

async function executeForgetMemory(args) {
  const { id, query } = args;
  if (!id && !query) return { isError: true, text: "Provide either 'id' (exact) or 'query' (semantic search) to find the memory to delete." };

  const store = loadMemoryStore();

  if (id) {
    const idx = store.memories.findIndex(m => m.id === id);
    if (idx === -1) return { isError: true, text: `Memory "${id}" not found.` };
    const removed = store.memories.splice(idx, 1)[0];
    saveMemoryStore(store);
    return { isError: false, text: `Deleted memory: "${removed.text.slice(0, 80)}"` };
  }

  // Semantic search to find the memory to delete
  try {
    const queryEmb = await embed(query);
    let bestSim = 0, bestIdx = -1;
    for (let i = 0; i < store.memories.length; i++) {
      const sim = cosineSim(queryEmb, store.memories[i].embedding);
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }

    if (bestIdx === -1 || bestSim < 0.5) {
      return { isError: true, text: `No memory found matching "${query}".` };
    }

    const removed = store.memories.splice(bestIdx, 1)[0];
    saveMemoryStore(store);
    return {
      isError: false,
      text: `Deleted memory (${(bestSim * 100).toFixed(0)}% match): "${removed.text.slice(0, 80)}"`,
    };
  } catch (err) {
    return { isError: true, text: `Forget failed: ${err.message}` };
  }
}

// ── Tool dispatch (async-aware) ───────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case "render_ui": return executeRenderUi(args || {});
    case "define_component": return executeDefineComponent(args || {});
    case "list_components": return executeListComponents();
    case "save_canvas_file": return executeSaveCanvasFile(args || {});
    case "load_canvas_file": return executeLoadCanvasFile(args || {});
    case "list_canvas_files": return executeListCanvasFiles(args || {});
    case "delete_canvas_file": return executeDeleteCanvasFile(args || {});
    case "component_reference": return executeComponentReference(args || {});
    case "update_ui": return executeUpdateUi(args || {});
    case "store_memory": return executeStoreMemory(args || {});
    case "recall_memory": return executeRecallMemory(args || {});
    case "list_memories": return executeListMemories(args || {});
    case "forget_memory": return executeForgetMemory(args || {});
    default: return null;
  }
}

// ── JSON-RPC handler ───────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Initialize handshake
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "jarble-ui", version: "2.0.0" },
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

    console.error("[MCP] Tool called:", toolName, "args:", JSON.stringify(toolArgs).slice(0, 200));

    const result = await executeTool(toolName, toolArgs);
    if (!result) {
      console.error("[MCP] Unknown tool:", toolName);
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
      };
    }

    console.error("[MCP] Tool result:", toolName, result.isError ? "ERROR" : "OK");

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
      handleMessage(msg).then((response) => {
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      }).catch((err) => {
        console.error("[MCP] Handler error:", err.message);
        if (msg.id !== undefined) {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32603, message: err.message },
          }) + "\n");
        }
      });
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
