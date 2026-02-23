#!/usr/bin/env node
/**
 * Jarble UI MCP Server — stdio transport (JSON-RPC 2.0)
 *
 * Exposes render_ui, define_component, and list_components tools to OpenClaw
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
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return null; }
}

function writeComponent(name, def) {
  ensureDir();
  const fp = path.join(COMPONENTS_DIR, `${name}.json`);
  fs.writeFileSync(fp, JSON.stringify(def, null, 2), "utf8");
}

function listCustomComponents() {
  if (!fs.existsSync(COMPONENTS_DIR)) return [];
  const results = [];
  for (const file of fs.readdirSync(COMPONENTS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(COMPONENTS_DIR, file), "utf8"));
      results.push({ name: parsed.name || file.replace(".json", ""), description: parsed.description || "" });
    } catch { /* skip */ }
  }
  return results;
}

// ── Tool definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: "render_ui",
    description: "Render a UI component on the Jarble canvas. The result will be displayed as a rich visual component in the user's dashboard. Supports built-in components (card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout) and custom bot-defined components. IMPORTANT: Return the result text to the user as-is so the frontend can parse and render it.",
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
    description: "Save canvas component data to a file on the bot's filesystem. Used when the user edits an editable component and saves it.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "File identifier (alphanumeric, hyphens, underscores, max 64 chars)" },
        component: { type: "string", description: "Component type (e.g. data_table, card)" },
        props: { type: "object", description: "Component props to persist" },
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
    description: "List all saved canvas files in /data/files/.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
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
    return { isError: false, text: `Component "${name}" saved. Use render_ui with component="${name}" to display it.` };
  } catch (err) {
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
  const { fileId, component, props } = args;
  if (!fileId || !component || !props) return { isError: true, text: "Missing required fields: fileId, component, props." };
  if (!FILE_ID_RE.test(fileId)) return { isError: true, text: `Invalid fileId "${fileId}". Must be alphanumeric/hyphens/underscores, max 64 chars.` };

  const payload = JSON.stringify({ component, props }, null, 2);
  if (payload.length > MAX_FILE_SIZE) return { isError: true, text: `Payload exceeds max size of ${MAX_FILE_SIZE} bytes.` };

  try {
    if (!fs.existsSync(FILES_DIR)) {
      fs.mkdirSync(FILES_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(FILES_DIR, `${fileId}.json`), payload, "utf8");
    return { isError: false, text: `File "${fileId}" saved successfully.` };
  } catch (err) {
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
    return { isError: true, text: `Failed to read: ${err.message}` };
  }
}

function executeListCanvasFiles() {
  if (!fs.existsSync(FILES_DIR)) return { isError: false, text: "No canvas files found." };

  const files = [];
  for (const file of fs.readdirSync(FILES_DIR)) {
    if (!file.endsWith(".json")) continue;
    const fileId = file.replace(".json", "");
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(FILES_DIR, file), "utf8"));
      files.push({ fileId, component: parsed.component || "unknown" });
    } catch { /* skip */ }
  }

  if (files.length === 0) return { isError: false, text: "No canvas files found." };
  const lines = files.map(f => `- ${f.fileId} (${f.component})`);
  return { isError: false, text: `${files.length} canvas file(s):\n${lines.join("\n")}` };
}

function executeTool(name, args) {
  switch (name) {
    case "render_ui": return executeRenderUi(args || {});
    case "define_component": return executeDefineComponent(args || {});
    case "list_components": return executeListComponents();
    case "save_canvas_file": return executeSaveCanvasFile(args || {});
    case "load_canvas_file": return executeLoadCanvasFile(args || {});
    case "list_canvas_files": return executeListCanvasFiles();
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

    const result = executeTool(toolName, toolArgs);
    if (!result) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
      };
    }

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
