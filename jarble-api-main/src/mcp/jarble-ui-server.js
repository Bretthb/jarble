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

const COMPONENTS_DIR = process.env.JARBLE_COMPONENTS_DIR || "/data/components";
const FILES_DIR = process.env.JARBLE_FILES_DIR || "/data/files";
const WORKSPACE_DIR = process.env.JARBLE_WORKSPACE_DIR || "/data/workspace";
const PROTOCOL_VERSION = "2024-11-05";

const FILE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// ── Migrate old /data/files/ to /data/workspace/artifacts/ ──────────
// One-time migration on first run after upgrade.
try {
  if (fs.existsSync(FILES_DIR)) {
    const wsManifestPath = path.join(WORKSPACE_DIR, "manifest.json");
    // Only migrate if workspace doesn't exist yet (first run)
    if (!fs.existsSync(wsManifestPath)) {
      const files = fs.readdirSync(FILES_DIR).filter(f => f.endsWith(".json"));
      if (files.length > 0) {
        // Ensure workspace dirs exist
        fs.mkdirSync(path.join(WORKSPACE_DIR, "artifacts"), { recursive: true });
        let migrated = 0;
        const manifestArtifacts = [];
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(FILES_DIR, file), "utf-8");
            const old = JSON.parse(raw);
            if (!old.component || typeof old.props !== "object" || old.props === null) continue;
            const rawId = file.replace(/\.json$/, "");
            const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
            if (!id) continue;
            const now = new Date().toISOString();
            const artifact = {
              id,
              component: old.component,
              props: old.props,
              title: old.name || old.description || id,
              createdAt: old.savedAt || now,
              updatedAt: now,
              pinned: false,
              source: "bot",
              dataSource: null,
            };
            const serialized = JSON.stringify(artifact, null, 2);
            if (Buffer.byteLength(serialized, "utf-8") > 1_000_000) continue;
            fs.writeFileSync(path.join(WORKSPACE_DIR, "artifacts", `${id}.json`), serialized, "utf-8");
            manifestArtifacts.push({ id, component: artifact.component, title: artifact.title, createdAt: artifact.createdAt, updatedAt: artifact.updatedAt, pinned: false });
            migrated++;
          } catch { /* skip malformed */ }
        }
        fs.writeFileSync(wsManifestPath, JSON.stringify({ version: 1, artifacts: manifestArtifacts }, null, 2), "utf-8");
        if (migrated > 0) console.error(`[MCP] Migrated ${migrated} old canvas files to workspace artifacts`);
      }
    }
  }
} catch (e) {
  console.error("[MCP] Migration failed:", e.message);
}
const MAX_FILE_SIZE = 1_000_000; // 1MB

// ── Built-in components ────────────────────────────────────────────────
// Loaded from generated JSON (shared/component-manifest/generated/component-data.json).
// To regenerate: npx tsx scripts/generate-mcp-manifest.ts (run from jarble-api-main/)
// Falls back to inline list if JSON not found (e.g. first boot before build step).

let BUILTIN_COMPONENTS;
let BUILTIN_DESCRIPTIONS;
let BUILTIN_SCHEMAS = {}; // JSON Schema draft-07 per component (loaded from generated manifest)
let PER_COMPONENT_TOOLS = []; // Per-component MCP tools (show_chart, show_data_table, etc.)

try {
  // Try to load from generated manifest JSON (created by build step)
  const manifestPath = path.resolve(__dirname, "../../../shared/component-manifest/generated/component-data.json");
  const manifestData = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  BUILTIN_COMPONENTS = manifestData.componentNames;
  BUILTIN_DESCRIPTIONS = manifestData.descriptions;
  if (manifestData.schemas) {
    BUILTIN_SCHEMAS = manifestData.schemas;
    console.error(`[MCP] Loaded ${Object.keys(BUILTIN_SCHEMAS).length} component JSON schemas`);
  }
  if (Array.isArray(manifestData.tools)) {
    PER_COMPONENT_TOOLS = manifestData.tools;
    console.error(`[MCP] Loaded ${PER_COMPONENT_TOOLS.length} per-component tools`);
  }
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

// ── Load marketplace component metadata from PVC ──────────────────────
// At startup, scan /data/marketplace/*/manifest.json for installed marketplace
// components. We do NOT merge them into BUILTIN_COMPONENTS because marketplace
// components are synced as custom component definitions to /data/components/
// and should be resolved through the custom component path in render_ui
// (template substitution), not the builtin path (which emits raw component
// names the frontend doesn't know).
//
// We track them in a separate set for list_components display purposes only.

const MARKETPLACE_DIR = process.env.JARBLE_MARKETPLACE_DIR || "/data/marketplace";
const MARKETPLACE_COMPONENT_NAMES = new Set();
try {
  if (fs.existsSync(MARKETPLACE_DIR)) {
    for (const dir of fs.readdirSync(MARKETPLACE_DIR)) {
      const manifestPath = path.join(MARKETPLACE_DIR, dir, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.name) {
          MARKETPLACE_COMPONENT_NAMES.add(manifest.name);
        }
      }
    }
    if (MARKETPLACE_COMPONENT_NAMES.size > 0) {
      console.error(`[MCP] Found ${MARKETPLACE_COMPONENT_NAMES.size} marketplace components (resolved via /data/components/)`);
    }
  }
} catch (e) {
  console.error("[MCP] Failed to scan marketplace dir:", e.message);
}

// ── JSON Schema Validator (zero dependencies) ─────────────────────────
// Validates values against JSON Schema draft-07 subset produced by zod-to-json-schema.
// Handles: type checks, required, enum, anyOf, nested objects, arrays, tuples, number ranges.
// Returns { valid: boolean, errors: string[] }.

const MAX_VALIDATION_ERRORS = 10;

function validateJsonSchema(value, schema, path) {
  const errors = [];
  _validate(value, schema, path, errors);
  return { valid: errors.length === 0, errors: errors.slice(0, MAX_VALIDATION_ERRORS) };
}

function _validate(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (errors.length >= MAX_VALIDATION_ERRORS) return;

  // anyOf — try each sub-schema; pass if at least one matches
  if (Array.isArray(schema.anyOf)) {
    const anyErrors = [];
    for (const sub of schema.anyOf) {
      const subErrs = [];
      _validate(value, sub, path, subErrs);
      if (subErrs.length === 0) return; // one branch matched
      anyErrors.push(subErrs);
    }
    // None matched — report the shortest error list (most likely intended type)
    const best = anyErrors.reduce((a, b) => a.length <= b.length ? a : b, anyErrors[0]);
    for (const e of best) errors.push(e);
    return;
  }

  // Type check — handles both "type": "string" and "type": ["string", "number"]
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = _jsonType(value);
    if (!types.includes(actualType)) {
      const expected = types.length === 1 ? types[0] : `one of: ${types.join(", ")}`;
      errors.push(`${path}: expected ${expected}, got ${actualType}`);
      return; // skip deeper checks if type is wrong
    }
  }

  // Enum validation
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      const allowed = schema.enum.map(v => JSON.stringify(v)).join(", ");
      errors.push(`${path}: must be one of [${allowed}], got ${JSON.stringify(value)}`);
    }
    return;
  }

  // Number range
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}, got ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}, got ${value}`);
    }
  }

  // Object validation
  if (schema.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    // Required fields
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value) || value[key] === undefined) {
          // Add type hint for required fields
          const propSchema = schema.properties?.[key];
          const hint = _typeHint(propSchema);
          errors.push(`${path}.${key}: required field missing${hint}`);
        }
      }
    }
    // Validate known properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value && value[key] !== undefined) {
          _validate(value[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }
    return;
  }

  // Array validation
  if (schema.type === "array" && Array.isArray(value)) {
    // Tuple validation (minItems === maxItems with array of item schemas)
    if (Array.isArray(schema.items)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: expected at most ${schema.maxItems} items, got ${value.length}`);
      }
      // Validate each tuple position
      for (let i = 0; i < Math.min(value.length, schema.items.length); i++) {
        _validate(value[i], schema.items[i], `${path}[${i}]`, errors);
      }
      return;
    }
    // Regular array items
    if (schema.items && typeof schema.items === "object") {
      for (let i = 0; i < value.length; i++) {
        if (errors.length >= MAX_VALIDATION_ERRORS) break;
        _validate(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: expected at most ${schema.maxItems} items, got ${value.length}`);
    }
  }
}

function _jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "string", "number", "boolean", "object", "undefined"
}

function _typeHint(propSchema) {
  if (!propSchema) return "";
  if (Array.isArray(propSchema.enum)) {
    return ` (one of: ${propSchema.enum.join(", ")})`;
  }
  if (propSchema.type === "array") return " (array)";
  if (propSchema.type === "object") return " (object)";
  if (propSchema.type) {
    const t = Array.isArray(propSchema.type) ? propSchema.type.join(" | ") : propSchema.type;
    return ` (${t})`;
  }
  return "";
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
  // Legacy canvas file tools removed from TOOLS array — replaced by artifact tools above.
  // The old tool names (save_canvas_file, load_canvas_file, list_canvas_files, delete_canvas_file)
  // are still handled as aliases in executeTool() for backward compatibility.
  // ── Artifact workspace tools (replace old canvas file tools) ────────
  {
    name: "save_artifact",
    description: "Save or update a UI artifact in the workspace. Artifacts persist across sessions and can be restored on the user's canvas. Use this instead of save_canvas_file.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Unique artifact ID (alphanumeric, hyphens, underscores, max 64 chars)" },
        component: { type: "string", description: "Component type (e.g. 'spreadsheet', 'chart', 'data_table')" },
        props: { type: "object", description: "Full component props" },
        title: { type: "string", description: "Human-readable title" },
        pinned: { type: "boolean", description: "If true, auto-restores on session start. Default: false" },
        dataSource: {
          type: "object",
          description: "Optional live data configuration for auto-updating artifacts",
          properties: {
            type: { type: "string", enum: ["file", "skill"] },
            path: { type: "string", description: "PVC file path (required for type: file)" },
            skill: { type: "string", description: "Skill name (required for type: skill)" },
            args: { type: "object", description: "Arguments for skill execution" },
            pollInterval: { type: "number", description: "Seconds between updates (min 5, max 3600)" },
            transform: { type: "string", description: "Dot-path to extract data from response" },
          },
        },
      },
      required: ["id", "component", "props", "title"],
    },
  },
  {
    name: "load_artifact",
    description: "Load a saved artifact from the workspace by ID. Returns full artifact data including props.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact ID to load" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_artifacts",
    description: "List all saved artifacts in the workspace. Returns metadata (no props) sorted by most recently updated. Use this at session start to see what the user has saved.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "delete_artifact",
    description: "Delete an artifact from the workspace by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact ID to delete" },
      },
      required: ["id"],
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
  {
    name: "skill_reference",
    description: "Get detailed rendering guides and best practices. Available skills: component-rendering (selection matrix, props examples, design principles), sandbox-mastery (CDN allowlist, bridge API, theme, heartbeat), generative-ui-patterns (when to render UI vs text, text+UI harmony), platform-awareness (canvas system, MCP tools, multi-platform), dashboard-composition (ordering, layout strategy, data consistency), service-hosting (create/host/publish HTTP services on your pod). Call without a name to list all, or with a specific skill name for full content.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill name (e.g. 'component-rendering', 'sandbox-mastery'). Omit to list all available skills." },
      },
    },
  },
  {
    name: "create_dashboard",
    description: "Render a multi-component dashboard. Emits multiple UI components as a visual group with a shared title. Use when the user asks for a dashboard, overview, or summary with multiple data views. Max 8 components.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Dashboard title displayed above the grouped components" },
        components: {
          type: "array",
          description: "Array of components to render in the dashboard",
          items: {
            type: "object",
            properties: {
              component: { type: "string", description: "Component name (e.g. 'chart', 'stat_grid', 'data_table')" },
              props: { type: "object", description: "Props for the component" },
            },
            required: ["component", "props"],
          },
          minItems: 1,
          maxItems: 8,
        },
      },
      required: ["title", "components"],
    },
  },
  // ── Service hosting tools ───────────────────────────────────────────
  {
    name: "start_http_service",
    description: "Start an HTTP service on this pod. Writes a Node.js server script to /data/services/{name}/ and spawns it as a background process. The service is accessible from other pods in the cluster via this pod's internal IP. Use ports 19001-19099. The service auto-restarts when the pod restarts.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Service name (lowercase, letters/digits/hyphens, e.g. 'time-sync')" },
        port: { type: "number", description: "Port to listen on (19001-19099). If omitted, auto-assigns next available port." },
        code: { type: "string", description: "Node.js server code. Must call http.createServer() and listen on the specified port. Use process.env.SERVICE_PORT to get the assigned port." },
        description: { type: "string", description: "Human-readable description of what this service does" },
      },
      required: ["name", "code"],
    },
  },
  {
    name: "stop_http_service",
    description: "Stop a running HTTP service on this pod and remove it from the service registry.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Service name to stop" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_http_services",
    description: "List all HTTP services registered on this pod, including their status (running/stopped), port, and PID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "publish_to_marketplace",
    description: "Publish a running HTTP service to the Jarble marketplace so other bots can install and use it. The service must already be started via start_http_service. Creates a marketplace service entry with the instruction snippet you provide.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Service name (must match a running service from start_http_service)" },
        displayName: { type: "string", description: "Human-readable display name for the marketplace listing" },
        description: { type: "string", description: "Description for the marketplace listing" },
        instructionSnippet: { type: "string", description: "Instruction text that gets injected into the installing bot's system prompt. Tell the bot how to use your service's API endpoint." },
        category: { type: "string", description: "Marketplace category: dashboard, chart, form, media, utility, game, visualization, layout, social" },
      },
      required: ["name", "displayName", "description", "instructionSnippet"],
    },
  },
  // ── Marketplace browse/install tools ─────────────────────────────────
  {
    name: "browse_marketplace",
    description: "Browse the Jarble marketplace for published components and services. Search by name, description, or category. Returns a list of available items other bots have published.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["all", "component", "service"], description: "Filter by item type. Default: all" },
        query: { type: "string", description: "Search query to filter by name or description" },
        category: { type: "string", description: "Filter by category (dashboard, chart, form, media, utility, game, visualization, layout, social)" },
      },
    },
  },
  {
    name: "get_marketplace_item",
    description: "Get detailed information about a specific marketplace component or service by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The marketplace item ID (e.g. 'cmp_xyz' for components, 'pkg_xyz' for services)" },
      },
      required: ["id"],
    },
  },
  {
    name: "install_marketplace_item",
    description: "Install a marketplace component or service onto this deployment. For services, this also installs bundled components and skills, and updates the system prompt with the service's instruction snippet.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The marketplace item ID to install" },
        type: { type: "string", enum: ["component", "service"], description: "Whether this is a component or service" },
      },
      required: ["id", "type"],
    },
  },
  {
    name: "uninstall_marketplace_item",
    description: "Uninstall a marketplace component or service from this deployment.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The marketplace item ID to uninstall" },
        type: { type: "string", enum: ["component", "service"], description: "Whether this is a component or service" },
      },
      required: ["id", "type"],
    },
  },
  {
    name: "list_installed_marketplace",
    description: "List all marketplace components and services currently installed on this deployment.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "publish_component",
    description: "Publish a custom component to the Jarble marketplace. The component will be reviewed by the automated review agent before appearing in the marketplace.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Component name (lowercase, letters/digits/underscores)" },
        displayName: { type: "string", description: "Human-readable display name" },
        description: { type: "string", description: "Description of what this component does (min 10 chars)" },
        tier: { type: "string", enum: ["template", "sandbox"], description: "template = safe JSON, sandbox = custom HTML/CSS/JS" },
        category: { type: "string", description: "Category: dashboard, chart, form, media, utility, game, visualization, layout, social" },
        propsSchema: { type: "object", description: "JSON Schema describing the component's props" },
        exampleProps: { type: "object", description: "Example props demonstrating usage" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for discoverability" },
      },
      required: ["name", "displayName", "description"],
    },
  },
];

// ── Service hosting — process manager ─────────────────────────────────

const SERVICES_DIR = process.env.JARBLE_SERVICES_DIR || "/data/services";
const SERVICE_MANIFEST_PATH = path.join(SERVICES_DIR, "manifest.json");
const SERVICE_PORT_MIN = 19001;
const SERVICE_PORT_MAX = 19099;
const SERVICE_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

// In-memory tracking of running child processes
const runningServices = new Map(); // name -> { process, port, pid, startedAt }

/**
 * Read the service manifest from PVC.
 * Format: { services: { [name]: { port, code, description, createdAt, updatedAt } } }
 */
function readServiceManifest() {
  try {
    if (fs.existsSync(SERVICE_MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(SERVICE_MANIFEST_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("[MCP] Failed to read service manifest:", e.message);
  }
  return { services: {} };
}

function writeServiceManifest(manifest) {
  fs.mkdirSync(SERVICES_DIR, { recursive: true });
  fs.writeFileSync(SERVICE_MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

function getUsedPorts(manifest) {
  const ports = new Set();
  for (const svc of Object.values(manifest.services)) {
    if (svc.port) ports.add(svc.port);
  }
  return ports;
}

function allocatePort(manifest) {
  const used = getUsedPorts(manifest);
  for (let p = SERVICE_PORT_MIN; p <= SERVICE_PORT_MAX; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

/**
 * Get this pod's cluster IP for cross-pod service discovery.
 * Works in both Docker and K3s/K8s environments.
 */
function getPodIP() {
  // K8s injects POD_IP via downward API, or we can read from hostname resolution
  if (process.env.POD_IP) return process.env.POD_IP;
  try {
    const os = require("os");
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) return addr.address;
      }
    }
  } catch { /* fallback */ }
  return "127.0.0.1";
}

/**
 * Spawn a service process from its code on the PVC.
 */
function spawnService(name, port, codeFilePath) {
  const { spawn } = require("child_process");
  const child = spawn("node", [codeFilePath], {
    env: { ...process.env, SERVICE_PORT: String(port), SERVICE_NAME: name },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stdout.on("data", (d) => console.error(`[service:${name}] ${d.toString().trim()}`));
  child.stderr.on("data", (d) => console.error(`[service:${name}:err] ${d.toString().trim()}`));

  child.on("exit", (code, signal) => {
    console.error(`[MCP] Service "${name}" exited (code=${code}, signal=${signal})`);
    runningServices.delete(name);
  });

  runningServices.set(name, {
    process: child,
    port,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });

  console.error(`[MCP] Service "${name}" started on port ${port} (PID ${child.pid})`);
  return child.pid;
}

/**
 * Auto-restart services from manifest on MCP server boot.
 */
function autoRestartServices() {
  const manifest = readServiceManifest();
  let restarted = 0;
  for (const [name, svc] of Object.entries(manifest.services)) {
    const codeFile = path.join(SERVICES_DIR, name, "server.js");
    if (!fs.existsSync(codeFile)) {
      console.error(`[MCP] Service "${name}" code missing at ${codeFile}, skipping auto-restart`);
      continue;
    }
    try {
      spawnService(name, svc.port, codeFile);
      restarted++;
    } catch (e) {
      console.error(`[MCP] Failed to auto-restart service "${name}":`, e.message);
    }
  }
  if (restarted > 0) {
    console.error(`[MCP] Auto-restarted ${restarted} service(s) from manifest`);
  }
}

// Run auto-restart on startup (delayed slightly to let MCP init finish)
setTimeout(autoRestartServices, 1000);

// ── Tool execution ─────────────────────────────────────────────────────

function _formatValidationErrors(component, errors) {
  const lines = [`Invalid props for "${component}". ${errors.length} error(s):`];
  for (let i = 0; i < errors.length; i++) {
    lines.push(`  ${i + 1}. ${errors[i]}`);
  }
  lines.push("");
  lines.push(`Fix the props and call render_ui again. Use component_reference("${component}") for the full schema.`);
  return lines.join("\n");
}

function executeRenderUi(args) {
  const { component, props } = args;
  if (!component) return { isError: true, text: "Missing 'component' parameter." };

  // Built-in — validate props against JSON Schema, then emit fenced block
  if (BUILTIN_COMPONENTS.includes(component)) {
    const schema = BUILTIN_SCHEMAS[component];
    if (schema && props && typeof props === "object") {
      const result = validateJsonSchema(props, schema, "props");
      if (!result.valid) {
        console.error(`[MCP] render_ui validation failed for "${component}":`, result.errors.length, "errors");
        return { isError: true, text: _formatValidationErrors(component, result.errors) };
      }
    }
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

function executeCreateDashboard(args) {
  const { title, components } = args;
  if (!title || !Array.isArray(components) || components.length === 0) {
    return { isError: true, text: "Missing 'title' or 'components' array." };
  }
  if (components.length > 8) {
    return { isError: true, text: "Maximum 8 components per dashboard." };
  }

  const dashboardId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const blocks = [];
  const errors = [];

  for (let i = 0; i < components.length; i++) {
    const { component, props } = components[i];
    if (!component) {
      errors.push(`Component ${i + 1}: missing 'component' name.`);
      continue;
    }

    if (BUILTIN_COMPONENTS.includes(component)) {
      const schema = BUILTIN_SCHEMAS[component];
      if (schema && props && typeof props === "object") {
        const result = validateJsonSchema(props, schema, "props");
        if (!result.valid) {
          errors.push(`Component ${i + 1} ("${component}"): ${result.errors[0]}`);
          continue;
        }
      }
      blocks.push(JSON.stringify({
        component,
        props: props || {},
        dashboardId,
        dashboardTitle: title,
      }));
    } else {
      const def = readComponent(component);
      if (!def) {
        errors.push(`Component ${i + 1}: "${component}" not found.`);
        continue;
      }
      const children = resolveCustom(def, props || {});
      blocks.push(JSON.stringify({
        component: "layout",
        props: { title: def.description || undefined, children },
        dashboardId,
        dashboardTitle: title,
      }));
    }
  }

  if (blocks.length === 0) {
    return { isError: true, text: "All components failed validation:\n" + errors.join("\n") };
  }

  let output = blocks.map(b => "```jarble_ui\n" + b + "\n```").join("\n\n");
  if (errors.length > 0) {
    output += "\n\nNote: " + errors.length + " component(s) skipped due to errors:\n" + errors.join("\n");
  }

  console.error(`[MCP] create_dashboard: "${title}" with ${blocks.length} components (dashboardId=${dashboardId})`);
  return { isError: false, text: output };
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

// Legacy canvas file handlers — kept for reference. New code uses executeSaveArtifact etc.
// Old tools (save_canvas_file, etc.) now redirect through artifact system in executeTool().
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

// ── Artifact workspace (persistent UI components) ─────────────────────
// Artifacts stored at /data/workspace/manifest.json + /data/workspace/artifacts/*.json
// Replaces old /data/files/ system. Supports pinning, live data sources, etc.

const ARTIFACT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ARTIFACT_SIZE = 1_000_000; // 1MB

function ensureArtifactWorkspace() {
  const artDir = path.join(WORKSPACE_DIR, "artifacts");
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  if (!fs.existsSync(artDir)) fs.mkdirSync(artDir, { recursive: true });
  const mPath = path.join(WORKSPACE_DIR, "manifest.json");
  if (!fs.existsSync(mPath)) {
    fs.writeFileSync(mPath, JSON.stringify({ version: 1, artifacts: [] }, null, 2), "utf-8");
  }
}

function readArtifactManifest() {
  ensureArtifactWorkspace();
  const mPath = path.join(WORKSPACE_DIR, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(mPath, "utf-8"));
  } catch {
    // Corrupted manifest — rebuild from artifact files
    return rebuildArtifactManifest();
  }
}

function rebuildArtifactManifest() {
  const artDir = path.join(WORKSPACE_DIR, "artifacts");
  const artifacts = [];
  if (fs.existsSync(artDir)) {
    for (const file of fs.readdirSync(artDir).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"))) {
      try {
        const raw = fs.readFileSync(path.join(artDir, file), "utf-8");
        const a = JSON.parse(raw);
        if (a.id && a.component) {
          artifacts.push({ id: a.id, component: a.component, title: a.title, createdAt: a.createdAt, updatedAt: a.updatedAt, pinned: !!a.pinned });
        }
      } catch { /* skip corrupted */ }
    }
  }
  const manifest = { version: 1, artifacts };
  writeArtifactManifest(manifest);
  return manifest;
}

function writeArtifactManifest(manifest) {
  const mPath = path.join(WORKSPACE_DIR, "manifest.json");
  const tmpPath = mPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  fs.renameSync(tmpPath, mPath);
}

function validateArtifactDataSource(ds) {
  if (!ds) return;
  if (ds.type !== undefined && ds.type !== "file" && ds.type !== "skill") {
    throw new Error(`dataSource type must be "file" or "skill", got "${ds.type}"`);
  }
  if (ds.pollInterval !== undefined) {
    const val = Number(ds.pollInterval);
    if (!Number.isFinite(val) || val < 5 || val > 3600) {
      throw new Error(`pollInterval must be a number between 5 and 3600 seconds, got ${ds.pollInterval}`);
    }
  }
  if (ds.type === "file" && !ds.path) throw new Error('dataSource type "file" requires a "path" field');
  if (ds.type === "skill" && !ds.skill) throw new Error('dataSource type "skill" requires a "skill" field');
}

function executeSaveArtifact(args) {
  const { id, component, props, title, pinned, dataSource } = args;
  if (!id || !component || !props || !title) return { isError: true, text: "Missing required fields: id, component, props, title." };
  if (!ARTIFACT_ID_RE.test(id)) return { isError: true, text: `Invalid artifact ID "${id}". Must match /^[a-zA-Z0-9_-]{1,64}$/.` };

  try {
    validateArtifactDataSource(dataSource);
  } catch (err) {
    return { isError: true, text: err.message };
  }

  ensureArtifactWorkspace();
  const now = new Date().toISOString();
  const manifest = readArtifactManifest();
  const existingIdx = manifest.artifacts.findIndex(a => a.id === id);

  // Load existing for update semantics
  let existing = null;
  const filePath = path.join(WORKSPACE_DIR, "artifacts", `${id}.json`);
  if (existingIdx !== -1 && fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { /* treat as new */ }
  }

  const artifact = {
    id,
    component,
    props,
    title,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    pinned: pinned !== undefined ? pinned : (existing ? !!existing.pinned : false),
    source: "bot",
    dataSource: dataSource !== undefined ? dataSource : (existing ? existing.dataSource : null),
  };

  const serialized = JSON.stringify(artifact, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_ARTIFACT_SIZE) {
    return { isError: true, text: `Artifact "${id}" exceeds 1 MB limit.` };
  }

  // Atomic write: artifact file
  const tmpFilePath = filePath + ".tmp";
  fs.writeFileSync(tmpFilePath, serialized, "utf-8");
  fs.renameSync(tmpFilePath, filePath);

  // Update manifest
  const meta = { id, component, title, createdAt: artifact.createdAt, updatedAt: artifact.updatedAt, pinned: artifact.pinned };
  if (existingIdx !== -1) {
    manifest.artifacts[existingIdx] = meta;
  } else {
    manifest.artifacts.push(meta);
  }
  writeArtifactManifest(manifest);

  console.error("[MCP] Artifact saved:", id, component);
  return { isError: false, text: `Saved artifact "${title}" (${id}) — ${artifact.pinned ? "pinned" : "not pinned"}` };
}

function executeLoadArtifact(args) {
  const { id } = args;
  if (!id) return { isError: true, text: "Missing artifact ID." };
  if (!ARTIFACT_ID_RE.test(id)) return { isError: true, text: `Invalid artifact ID "${id}".` };

  ensureArtifactWorkspace();
  // Check artifacts/ subdirectory first, then workspace root (legacy layout)
  let filePath = path.join(WORKSPACE_DIR, "artifacts", `${id}.json`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(WORKSPACE_DIR, `${id}.json`);
  }
  if (!fs.existsSync(filePath)) return { isError: true, text: `Artifact "${id}" not found.` };

  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { isError: false, text: JSON.stringify(content, null, 2) };
  } catch (err) {
    return { isError: true, text: `Failed to read artifact: ${err.message}` };
  }
}

function executeListArtifacts() {
  const manifest = readArtifactManifest();
  const sorted = [...manifest.artifacts].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (sorted.length === 0) {
    return { isError: false, text: "No saved artifacts in workspace." };
  }

  const lines = [`**${sorted.length} artifact(s) in workspace:**`, ""];
  for (const a of sorted) {
    let line = `- **${a.title}** (\`${a.id}\`) — ${a.component}`;
    if (a.pinned) line += " [pinned]";
    if (a.updatedAt) line += ` _(updated ${a.updatedAt.split("T")[0]})_`;
    lines.push(line);
  }
  lines.push("", "Use `load_artifact` with an ID to recall, then `render_ui` to display.");
  return { isError: false, text: lines.join("\n") };
}

function executeDeleteArtifact(args) {
  const { id } = args;
  if (!id || !ARTIFACT_ID_RE.test(id)) return { isError: true, text: "Invalid or missing artifact ID." };

  ensureArtifactWorkspace();
  const manifest = readArtifactManifest();
  const idx = manifest.artifacts.findIndex(a => a.id === id);

  const filePath = path.join(WORKSPACE_DIR, "artifacts", `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  if (idx !== -1) {
    manifest.artifacts.splice(idx, 1);
    writeArtifactManifest(manifest);
    console.error("[MCP] Artifact deleted:", id);
    return { isError: false, text: `Deleted artifact "${id}" from workspace.` };
  }

  return { isError: false, text: `Artifact "${id}" was not in the manifest (may have already been removed).` };
}

// ── Skill reference (on-demand rendering guides) ────────────────────────

const BOT_SKILLS = {
  "component-rendering": {
    description: "Component selection matrix, props examples, dashboard composition, design principles",
    content: `## UI Component Rendering Guide

### Component Selection Matrix

Match user intent to the correct component. Call \`component_reference\` for full prop schemas.

**Metrics & KPIs:**
- Single headline number with trend → \`metric_card\` (include \`sparkline\` array for mini-chart, \`change\` for delta like "+12%")
- 2-4 related metrics side by side → emit 2-4 separate \`metric_card\` blocks (grid arranges them automatically)
- 5+ metrics in a compact grid → \`stat_grid\` (one block, all stats in the \`stats\` array)
- Countdown or formatted number → \`statistic\` (supports \`prefix\`, \`suffix\`, \`precision\`)

**Data Visualization:**
- Trend over time → \`chart\` type \`"line"\` (time series on x-axis)
- Comparison across categories → \`chart\` type \`"bar"\` (categories on x-axis)
- Part-of-whole / distribution → \`chart\` type \`"pie"\` (no x-axis needed)
- Cumulative or stacked trends → \`chart\` type \`"area"\` (use \`stacked: true\`)
- Tabular data, sortable → \`data_table\` (columns as string array, rows as 2D string/number array)
- Editable spreadsheet → \`spreadsheet\` (data as array of record objects)
- Novel visualization (heatmap, treemap, sankey, 3D) → \`sandbox\` with library

**Structured Content:**
- Key-value pairs (specs, config) → \`key_value\` or \`descriptions\`
- Chronological events → \`timeline\` (use \`status\`: completed/active/pending)
- Process with numbered steps → \`steps\` (set \`current\` to highlight active step)
- Hierarchical / nested → \`tree\`
- Enumerated items → \`list\`
- Categorized content → \`tabs\` (each tab can contain text or nested children)
- Expandable sections → \`accordion\`

**Communication:**
- Status notification → \`alert\` (variant: info/success/warning/error)
- Operation outcome → \`result\` (status: success/error/info/warning)
- Highlighted quote → \`blockquote\`
- Code snippet → \`code_block\` (set \`language\`)
- Editable code → \`code_editor\`

**User Interaction:**
- Collect input → \`form\` (fields with type: text/email/textarea/select/checkbox/number)
- Present choices → \`button_group\` (each button needs \`id\` and \`label\`)

**Media:**
- Location/geography → \`map\` (center as \`[lat, lng]\` tuple)
- Photo grid → \`image_gallery\`
- Slides → \`carousel\`
- Third-party widget → \`embed\` (Google Maps, TradingView, YouTube, Spotify — just pass the URL)

### Props Examples (Most Error-Prone Components)

**Charts:**
\\\`\\\`\\\`json
{"component":"chart","props":{"type":"bar","title":"Q4 Revenue by Region","data":[{"region":"NA","revenue":4200000,"target":4000000},{"region":"EU","revenue":3100000,"target":3500000}],"dataKeys":["revenue","target"],"xAxisKey":"region","showLegend":true,"showGrid":true},"layout_hint":"half"}
\\\`\\\`\\\`
- \`data\` = array of flat objects with same keys
- \`dataKeys\` = which keys contain numeric values to plot (NOT the x-axis key)
- \`xAxisKey\` = the label/category key
- Always set \`title\`, \`showLegend: true\` for multi-series

**Tables:**
\\\`\\\`\\\`json
{"component":"data_table","props":{"title":"Top Customers","columns":["Customer","Revenue","Growth"],"rows":[["Acme Corp",420000,"+15%"],["Globex",380000,"+8%"]]}}
\\\`\\\`\\\`
- \`rows\` must be 2D arrays matching column order — NOT objects

**Metric Cards:**
\\\`\\\`\\\`json
{"component":"metric_card","props":{"label":"Monthly Active Users","value":"12,847","change":"+23.5%","sparkline":[8200,9100,9800,10500,11200,12847]},"layout_hint":"third"}
\\\`\\\`\\\`

### Design Principles

- **Hierarchy**: Most important info first and biggest. Lead with the answer.
- **Less is more**: 4 well-chosen metrics beat 12 crammed stats.
- **Titles are content**: "Monthly Recurring Revenue" not "MRR". "Support Tickets by Priority" not "Table".
- **Context over raw numbers**: "$1.2M (+15% vs Q3)" tells a story; "$1.2M" alone is noise.
- **Separate concerns**: Each component answers one question.`
  },

  "sandbox-mastery": {
    description: "Sandbox architecture, design patterns, CDN allowlist, bridge API, theme support, heartbeat, templates, common mistakes",
    content: `## Sandbox Component Mastery Guide

### When to Use
Use \`sandbox\` for: 3D (Three.js), animations, custom charts (candlestick, heatmap, gauge, treemap, sankey), interactive visualizations, games, physics simulations, or anything not covered by built-in components. Prefer built-ins when they fit — sandbox is last resort.

### Architecture: How Sandboxes Work
Your sandbox runs in a double-isolated iframe (sandbox="allow-scripts allow-popups" — NO same-origin). The pipeline:
1. Your \`html\` prop is sanitized: <script>, <style>, <link> tags are auto-extracted into js/css/libraries
2. A full HTML document is constructed with CSP, theme CSS, error overlay, bridge API, heartbeat
3. Libraries load SEQUENTIALLY (dependency order preserved), then your JS runs at GLOBAL scope
4. Bridge API (\`window.jarble\`) provides communication with parent app

### Props Schema
\\\`\\\`\\\`json
{
  "html": "<div id='app'></div>",
  "css": "body { margin: 0; } #app { width: 100%; height: 100%; }",
  "js": "const el = document.getElementById('app'); // your code here",
  "libraries": ["https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js"],
  "title": "My Visualization",
  "height": 500,
  "props": { "color": "#ff0000", "speed": 1.5 },
  "configSchema": { "type": "object", "properties": { "speed": { "type": "number", "default": 1 } } }
}
\\\`\\\`\\\`

### Critical Rules
1. \`html\` = body content ONLY (divs, canvas elements, containers). <script>/<style> tags ARE extracted automatically but putting code in the proper fields is cleaner.
2. \`css\` = ALL styles. Global styles, responsive rules, dark mode, animations.
3. \`js\` = ALL JavaScript. Runs AFTER all libraries finish loading. Runs at GLOBAL scope (const/let/var are global).
4. \`libraries\` = array of CDN URLs. Loaded as <script> tags IN ORDER (sequential, not parallel). Put dependencies first.
5. \`props\` = custom data passed to sandbox. Access via \`window.__JARBLE_PROPS__\`.
6. \`title\` = card title. ALWAYS provide a descriptive title.

### Allowed CDN Origins (ONLY these work — CSP blocks everything else)
| Origin | Use For |
|--------|---------|
| cdn.jsdelivr.net | npm packages (Three.js, D3, Chart.js, anime.js, Leaflet, p5.js) |
| cdnjs.cloudflare.com | Classic CDN mirror |
| unpkg.com | npm mirror |
| cdn.tailwindcss.com | Tailwind CSS |
| esm.sh | ES modules |
| threejs.org | Three.js examples/addons |
| d3js.org | D3 official |
| cdn.plot.ly | Plotly |
| fonts.googleapis.com | Google Fonts CSS |
| fonts.gstatic.com | Google Fonts files |

### Common Library URLs (TESTED, USE THESE EXACT URLs)
\\\`\\\`\\\`
Three.js:     https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js
D3.js:        https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js
Chart.js:     https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js
anime.js:     https://cdn.jsdelivr.net/npm/animejs@3/lib/anime.min.js
Plotly:       https://cdn.plot.ly/plotly-2.35.0.min.js
Leaflet JS:   https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.js
Leaflet CSS:  https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.css (put in css as @import)
p5.js:        https://cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js
Matter.js:    https://cdn.jsdelivr.net/npm/matter-js@0.19/build/matter.min.js
GSAP:         https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js
\\\`\\\`\\\`

### Design Patterns & Templates

**Pattern: Basic Canvas Animation**
\\\`\\\`\\\`json
{
  "html": "<canvas id='c'></canvas>",
  "css": "body { margin: 0; overflow: hidden; background: transparent; } canvas { display: block; width: 100%; height: 100%; }",
  "js": "const canvas = document.getElementById('c');\\nconst ctx = canvas.getContext('2d');\\nfunction resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }\\nresize(); window.addEventListener('resize', resize);\\nfunction draw() { ctx.clearRect(0, 0, canvas.width, canvas.height); /* your drawing */ requestAnimationFrame(draw); }\\ndraw();",
  "title": "Canvas Animation"
}
\\\`\\\`\\\`

**Pattern: Three.js Scene**
\\\`\\\`\\\`json
{
  "html": "<div id='container'></div>",
  "css": "body { margin: 0; overflow: hidden; background: transparent; } #container { width: 100%; height: 100%; }",
  "js": "const container = document.getElementById('container');\\nconst renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });\\nrenderer.setSize(container.clientWidth, container.clientHeight);\\ncontainer.appendChild(renderer.domElement);\\nconst scene = new THREE.Scene();\\nconst camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);\\ncamera.position.z = 5;\\n// Add objects, lights, animate...\\nfunction animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }\\nanimate();",
  "libraries": ["https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js"],
  "title": "3D Scene"
}
\\\`\\\`\\\`

**Pattern: D3 Visualization**
\\\`\\\`\\\`json
{
  "html": "<svg id='chart'></svg>",
  "css": "body { margin: 0; background: transparent; } svg { width: 100%; height: 100%; } @media (prefers-color-scheme: dark) { text { fill: #e5e5e5; } .axis line, .axis path { stroke: #555; } }",
  "js": "const svg = d3.select('#chart');\\nconst width = window.innerWidth, height = window.innerHeight;\\nsvg.attr('viewBox', \\\"0 0 \\\" + width + \\\" \\\" + height);\\n// Your D3 code...",
  "libraries": ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"],
  "title": "D3 Chart"
}
\\\`\\\`\\\`

**Pattern: Interactive with Props & Config**
\\\`\\\`\\\`json
{
  "html": "<div id='viz'></div>",
  "css": "#viz { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }",
  "js": "const props = window.__JARBLE_PROPS__;\\nconst speed = props.speed || 1;\\n// Use props...\\nwindow.addEventListener('jarble:props', e => { /* handle updates */ });",
  "props": { "speed": 1.5, "color": "#3b82f6" },
  "configSchema": { "type": "object", "properties": { "speed": { "type": "number", "title": "Speed", "default": 1, "minimum": 0.1, "maximum": 5 } } },
  "title": "Interactive Viz"
}
\\\`\\\`\\\`

### Theme Support (REQUIRED for all sandboxes)
\\\`\\\`\\\`css
body { color: #1a1a1a; background: transparent; }
@media (prefers-color-scheme: dark) {
  body { color: #e5e5e5; }
  .panel { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
}
\\\`\\\`\\\`
ALWAYS set \`background: transparent\` on body so the card background shows through. Use media queries for text/border colors.

### Bridge API (window.jarble)
\\\`\\\`\\\`
jarble.send(action, payload)          — Send action to parent app
jarble.canvas.resize(width, height)   — Request card resize (200-1200w, 100-800h)
jarble.canvas.setTitle(title)         — Update card title (max 100 chars)
jarble.reportProgress(percent)        — Show loading progress (0-100)
await jarble.storage.set(key, value)  — Persistent storage (1MB quota, string values)
await jarble.storage.get(key)         — Returns string|null
jarble.events.on(channel, handler)    — Inter-sandbox pub/sub
jarble.events.emit(channel, data)     — Broadcast to other sandboxes
\\\`\\\`\\\`

Access initial props: \`window.__JARBLE_PROPS__\`
Listen for updates: \`window.addEventListener("jarble:props", e => { const data = e.detail; })\`

### Heartbeat & Lifecycle
- Sandbox auto-pings parent every 5s. Parent kills after 15s silence (3 missed).
- requestAnimationFrame/setInterval keep heartbeat alive — animations are safe.
- Heavy synchronous loops >15s will kill the sandbox. Use setTimeout chunking or Web Workers.
- Variables declared with const/let/var in your JS are GLOBAL (not scoped to a function).
- The auto-resize system looks for global \`renderer\` and \`camera\` vars for Three.js.

### Responsive Design Checklist
1. Root container: \`width: 100%; height: 100%;\` (fills card)
2. SVG: use \`viewBox\` for scaling
3. Canvas: resize on window resize events (auto-resize handles Three.js)
4. Text: use relative units (em, rem, %) not fixed px
5. Touch: add touch event handlers for mobile

### Common Mistakes (AVOID THESE)
1. **Wrong library URL** — Use EXACT URLs from the list above. Wrong versions or paths fail silently.
2. **Non-allowlisted CDN** — CSP blocks silently. ONLY the 10 origins above work.
3. **Blocking main thread** — Heavy sync loops kill heartbeat. Chunk with \`setTimeout(fn, 0)\`.
4. **No responsive sizing** — Use \`width: 100%; height: 100%\` on root elements.
5. **fetch() to external APIs** — ONLY CDN origins work in connect-src. Pass data via props instead.
6. **Forgetting dark mode** — ALWAYS add \`@media (prefers-color-scheme: dark)\` styles.
7. **Opaque background** — ALWAYS use \`background: transparent\` on body.
8. **Missing title** — Every sandbox MUST have a descriptive title prop.
9. **No error handling** — Wrap risky code in try/catch. Errors show as red overlay in iframe.
10. **Library version mismatch** — Pin specific versions in URLs (e.g. \`@0.169\` not \`@latest\`).`
  },

  "generative-ui-patterns": {
    description: "When to render UI vs text, text+UI harmony, multi-component orchestration, quality checklist",
    content: `## Generative UI Best Practices

### Core Principle
You are both a conversationalist and a UI designer. Text introduces, UI presents, together they tell the story.

### When to Render UI
- Data in the answer — ALWAYS render a visual. Numbers, comparisons, trends deserve charts/tables/metrics.
- "Show me" / "display" / "visualize" — User explicitly wants UI.
- Structured results — API responses, search results, config summaries.
- Complex explanations — Multi-step processes → steps/timeline. Categorized → tabs/accordion.
- Actionable output — Choices → button_group/form. Success/failure → alert/result.

### When NOT to Render UI
- Simple conversation ("Hello!", "Thanks!")
- Clarifying questions ("Which date range?")
- Short factual answers without data
- Error acknowledgments (unless you have a suggested action)

### Text + UI Harmony
1. Introduce before rendering — "Here's your revenue breakdown:" then the chart.
2. Don't duplicate — If chart shows data, add insight in text: "Revenue peaked in Q3, driven by enterprise."
3. Be concise when UI is present — 1-2 sentences of context, then the component.
4. Reference the UI — "As shown in the chart above..."
5. Insight over narration — Text explains why, UI shows what.

### Multi-Component Responses
- Limit to 3-4 components per response. Build dashboards across conversation, not one message.
- Follow the rendering order: overview (KPIs) → detail (charts/tables) → actions (forms/buttons).
- Each component stands alone. Users can minimize, reorder, split cards. Title everything.
- Narrative flow: Overview → detail → action.

### Component Selection Judgment
1. Is there a built-in for this? Call component_reference when unsure.
2. Would a human designer pick this? metric_card for metrics, steps for processes.
3. Are props complete? Every chart needs a title. No "Card 1" titles.
4. Does the layout hint match? KPIs = "third". Charts = "half". Wide tables = "full-width".

### Quality Checklist
- Right component type for this data
- Props complete — title, labels, data all populated
- Real data, not placeholders
- Text introduces the UI and adds insight
- Layout hints set for multi-component responses`
  },

  "platform-awareness": {
    description: "Canvas system, MCP tools inventory, multi-platform behavior, artifact workspace, essential behaviors",
    content: `## Jarble Platform Guide

### How Your UI Appears
Components render as interactive cards on a canvas. Users can:
- Drag to reposition, resize (grid-snapped at 20px)
- Minimize/maximize cards
- Split multi-item components (stat_grid, data_table, tabs, list, timeline, key_value, descriptions)
- Merge compatible cards back together
- Pin cards to survive clears, save/bookmark to artifact workspace
- Group related cards under a shared dashboard title

Canvas holds up to 100 cards. Older unpinned cards are evicted at limit.

### Canvas Grid Layout
3-column responsive grid:
- full-width = 3 columns: header, steps, wide data_table, sandbox, map
- half = 2 columns: chart, timeline, list, tabs, accordion
- third = 1 column: metric_card, statistic, badge, progress, alert
- compact = smallest: badge, avatar, divider

Components flow top-to-bottom in emission order. Users can drag to reorder.

### Your MCP Tools
Rendering: render_ui (new card), update_ui (edit existing), create_dashboard (grouped, max 8)
Discovery: list_components (all 37+ types), component_reference (prop schema), skill_reference (guides)
Templates: define_component (reusable templates with {{variable}} placeholders)
Persistence: save_artifact / load_artifact / list_artifacts / delete_artifact
Memory: store_memory / recall_memory / list_memories / forget_memory (cross-platform)

### Multi-Platform
- Jarble web dashboard — full canvas with rich UI. Messages contain [CANVAS_STATE] or [UI_ACTION].
- Telegram, Discord, Slack, WhatsApp — text and markdown only. No UI rendering.

### Essential Behaviors
1. Right-size responses — simple questions get text, data-rich answers get UI
2. Title specifically — "Q1 Revenue by Region" not "Chart"
3. Limit density — max 4-6 components unless building an explicit dashboard
4. Built-ins over sandbox — call component_reference before unfamiliar components
5. Sandbox is last resort — only for 3D, games, custom animations
6. Real data only — never fabricate placeholder data
7. Memory proactively — store preferences without being asked; recall at session start`
  },

  "dashboard-composition": {
    description: "Dashboard ordering, layout hint strategy, data consistency, density guidelines, interactive dashboards",
    content: `## Dashboard Composition Guide

### When to Build a Dashboard
Build multi-component dashboards for: overviews/summaries/reports, analytics dashboards, status pages, comparison views. For single-topic responses, prefer one well-chosen component.

### Composition Order (emit in this order)
1. Header (title/subtitle)
2. KPI row — 1-4 metric_card OR stat_grid (5+ metrics)
3. Status/progress — badge, progress, result, alert
4. Structure — steps, timeline, descriptions
5. Charts — chart (bar/line/pie/area)
6. Data — data_table, list, key_value, tree
7. Rich content — card, blockquote, code_block
8. Media — image, image_gallery, carousel, video
9. Interactive — form, button_group, tabs, accordion
10. Full-screen — sandbox, map, code_editor, spreadsheet

### Layout Strategy (3-column grid)
Classic KPI + Chart + Table:
  [metric_card third] [metric_card third] [metric_card third]
  [chart half] [list third]
  [data_table full-width]

Status Dashboard:
  [header full-width]
  [stat_grid full-width]
  [chart half] [chart half]
  [alert third] [alert third] [alert third]

### Data Consistency Rules
- Same source, same numbers. If stat_grid shows "$1.2M", chart must include that data point.
- Consistent units. Don't mix "$1.2M" and "1200000".
- Time alignment. Title says "Q4 2025" → all components show Q4 2025 data.
- Labels match. "Active Users" in metric_card → "Active Users" in chart legend.

### Density Guidelines
- 3-4 components — ideal for focused answer
- 5-6 — comprehensive dashboard
- 7-8 — maximum (use create_dashboard for grouping)
- 9+ — too many. Split across turns or use tabs/accordion

### Dashboard Anti-Patterns
1. Wall of metric_cards — Don't emit 10 individual cards. Use stat_grid for 5+.
2. Chart without context — Every chart should follow KPIs that frame its significance.
3. Missing titles — Every component MUST have a specific, descriptive title.
4. Random ordering — Follow composition order.
5. Redundant components — Chart AND table showing exact same data without additional detail.

### Saving Dashboards
For dashboards user will revisit: save_artifact + pinned: true. Descriptive IDs: "sales-dashboard-q4" not "dashboard-1". For live data, set dataSource with pollInterval.`
  },
  "service-hosting": {
    description: "How to create, host, and publish HTTP services on your pod for other bots to consume via the marketplace",
    content: `## Service Hosting Guide

### Overview
You can create HTTP services that run on your pod and publish them to the Jarble marketplace. Other bots in the cluster can install your service and call your API endpoint.

### Architecture
- Your pod runs in a K8s cluster (currently Docker for dev, K3s on Hetzner VPS in production)
- Each pod has an internal cluster IP reachable by other pods
- Services you host run as child processes managed by the MCP server
- Services persist across pod restarts (code saved to PVC, auto-restarted on boot)

### Port Range
- Port 18789 is reserved for the OpenClaw gateway — NEVER use it
- Use ports **19001-19099** for your services
- The \`start_http_service\` tool auto-allocates the next available port if you don't specify one

### Available Tools
1. **start_http_service** — Write and start a Node.js HTTP server
   - \`name\`: lowercase with hyphens (e.g. "time-sync", "weather-api")
   - \`port\`: 19001-19099 (optional, auto-assigned if omitted)
   - \`code\`: Complete Node.js server script
   - \`description\`: What this service does

2. **stop_http_service** — Stop and remove a running service

3. **list_http_services** — Show all registered services with status

4. **publish_to_marketplace** — Submit a running service to the marketplace
   - Requires: name, displayName, description, instructionSnippet
   - The instruction snippet tells installing bots how to use your API

### Writing Service Code
Your code runs as a standalone Node.js script. Use only Node.js built-in modules (http, https, url, crypto, fs, path, os, etc.) — no npm packages.

Access the assigned port via \`process.env.SERVICE_PORT\`:
\`\`\`javascript
const http = require("http");
const PORT = process.env.SERVICE_PORT || 19001;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  // Your API logic here
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Hello from my service" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Service listening on port " + PORT);
});
\`\`\`

### Best Practices
- Always include a \`/health\` endpoint returning \`{"status":"ok"}\`
- Listen on \`0.0.0.0\` (not localhost) so other pods can reach you
- Return JSON with \`Content-Type: application/json\`
- Handle errors gracefully — a crash kills the service
- Keep services focused — one API per service
- Include the hostname in responses so consumers can verify which pod they're calling

### Networking
- **Within the cluster**: Other pods reach you via \`http://<pod-ip>:<port>\`
- **Pod IPs change** when pods restart — the marketplace stores the endpoint at install time
- **No external access needed** — this is pod-to-pod communication
- Docker networking and K3s overlay networking both support this
- No firewall rules or NetworkPolicy restrictions between pods in the jarble namespace

### Publishing to Marketplace
After starting your service, publish it:
1. Verify the service is running: \`list_http_services\`
2. Test the endpoint manually
3. Call \`publish_to_marketplace\` with:
   - A clear display name and description
   - An instruction snippet that tells the installing bot exactly how to call your API
   - The snippet should reference the endpoint URL and expected request/response format

The automated review agent will evaluate your submission for:
- Quality and coherence
- Security (no prompt injection in the instruction snippet)
- Legitimate use case

### Instruction Snippet Tips
The instruction snippet gets injected into the installing bot's system prompt. Keep it:
- Focused: Only describe how to use YOUR service
- Safe: No attempts to override other instructions
- Clear: Include the endpoint URL, HTTP method, expected response format
- Scoped: "When the user asks about X, use the Y skill to call Z endpoint"

Example:
"When users ask about the current time or need timestamps, make an HTTP GET request to {endpoint}/time. The response is JSON: {iso, unix, utc, timezone, hostname}. Present the time clearly."
`
  },
};

// ── Dynamic skill loading from API ────────────────────────────────────────────
// On boot, fetch latest platform skills from the API. If the API has newer
// skills, they override the hardcoded BOT_SKILLS above. This lets us update
// skills by redeploying the API — pods pick up changes on next restart.

const SKILLS_CACHE_PATH = "/data/config/platform-skills.json";

async function fetchAndMergeSkills() {
  const apiUrl = process.env.JARBLE_API_URL || process.env.API_BASE_URL || "http://host.docker.internal:3001";
  const url = `${apiUrl}/debug/platform-skills`;

  try {
    console.error("[MCP] Fetching latest platform skills from", url);
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000), // 10s timeout
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      console.error("[MCP] Skills fetch failed:", resp.status, resp.statusText);
      return loadCachedSkills();
    }

    const data = await resp.json();
    if (!data.skills || typeof data.skills !== "object") {
      console.error("[MCP] Invalid skills response — missing skills object");
      return loadCachedSkills();
    }

    // Merge: API skills override baked-in skills, baked-in skills fill gaps
    let updated = 0;
    for (const [name, skill] of Object.entries(data.skills)) {
      if (skill && typeof skill === "object" && skill.content) {
        BOT_SKILLS[name] = skill;
        updated++;
      }
    }

    console.error(`[MCP] Merged ${updated} skills from API (version ${data.version || "?"})`);

    // Cache to PVC for offline fallback
    try {
      fs.mkdirSync(path.dirname(SKILLS_CACHE_PATH), { recursive: true });
      fs.writeFileSync(SKILLS_CACHE_PATH, JSON.stringify(data, null, 2));
      console.error("[MCP] Cached skills to", SKILLS_CACHE_PATH);
    } catch (cacheErr) {
      console.error("[MCP] Failed to cache skills:", cacheErr.message);
    }
  } catch (err) {
    console.error("[MCP] Skills fetch error:", err.message || err);
    return loadCachedSkills();
  }
}

function loadCachedSkills() {
  try {
    if (fs.existsSync(SKILLS_CACHE_PATH)) {
      const cached = JSON.parse(fs.readFileSync(SKILLS_CACHE_PATH, "utf-8"));
      if (cached.skills && typeof cached.skills === "object") {
        let updated = 0;
        for (const [name, skill] of Object.entries(cached.skills)) {
          if (skill && typeof skill === "object" && skill.content) {
            BOT_SKILLS[name] = skill;
            updated++;
          }
        }
        console.error(`[MCP] Loaded ${updated} cached skills from PVC (version ${cached.version || "?"})`);
      }
    } else {
      console.error("[MCP] No cached skills on PVC, using baked-in defaults");
    }
  } catch (err) {
    console.error("[MCP] Failed to load cached skills:", err.message);
  }
}

// Fetch skills after a short delay (let the API server start first in dev)
setTimeout(fetchAndMergeSkills, 3000);

function executeSkillReference(args) {
  const name = args?.skill;

  if (name) {
    const skill = BOT_SKILLS[name];
    if (!skill) {
      const available = Object.keys(BOT_SKILLS).join(", ");
      return { isError: true, text: `Unknown skill "${name}". Available skills: ${available}` };
    }
    return { isError: false, text: skill.content };
  }

  // List all available skills
  const lines = ["# Available Rendering Skills", ""];
  for (const [skillName, skill] of Object.entries(BOT_SKILLS)) {
    lines.push(`- **${skillName}** — ${skill.description}`);
  }
  lines.push("");
  lines.push("Call `skill_reference` with a specific skill name (e.g. `{\"skill\": \"component-rendering\"}`) to get the full guide.");
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
    // Check built-in components first
    if (COMPONENT_REFERENCE[name]) {
      const lines = [`**${name}** — props: ${COMPONENT_REFERENCE[name]}`];
      if (BUILTIN_SCHEMAS[name]) {
        lines.push("");
        lines.push("**JSON Schema:**");
        lines.push("```json");
        lines.push(JSON.stringify(BUILTIN_SCHEMAS[name], null, 2));
        lines.push("```");
      }
      return { isError: false, text: lines.join("\n") };
    }

    // Fall back to custom/marketplace components from /data/components/
    const customDef = readComponent(name);
    if (customDef) {
      const lines = [`**${name}** (custom component) — ${customDef.description || "No description"}`];
      lines.push("");
      if (customDef.layout && Array.isArray(customDef.layout)) {
        lines.push("**Template layout:** This component resolves to built-in primitives with `{{variable}}` placeholders.");
        lines.push("");
        // Extract available variables from the layout template
        const variables = new Set();
        const layoutJson = JSON.stringify(customDef.layout);
        const varMatches = layoutJson.match(/\{\{(\w+)\}\}/g);
        if (varMatches) {
          for (const m of varMatches) variables.add(m.slice(2, -2));
        }
        if (variables.size > 0) {
          lines.push(`**Props (template variables):** \`${[...variables].join("`, `")}\``);
          lines.push("");
        }
        lines.push("**Layout definition:**");
        lines.push("```json");
        lines.push(JSON.stringify(customDef.layout, null, 2));
        lines.push("```");
      }
      return { isError: false, text: lines.join("\n") };
    }

    return { isError: true, text: `Unknown component "${name}". Use list_components to see available components.` };
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

  // Include custom/marketplace components
  const custom = listCustomComponents();
  if (custom.length > 0) {
    lines.push("");
    lines.push("## Installed Components");
    for (const c of custom) {
      lines.push(`- \`${c.name}\` — ${c.description || "Custom component"}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("**Tip:** Call `component_reference` with a specific component name (e.g. `{\"component\": \"chart\"}`) to get the full JSON Schema with all accepted props, types, and constraints.");

  return { isError: false, text: lines.join("\n") };
}

function executeUpdateUi(args) {
  const { card_id, props, merge, component } = args;
  if (!card_id) return { isError: true, text: "Missing 'card_id' parameter." };
  if (!props || typeof props !== "object") return { isError: true, text: "Missing or invalid 'props' parameter." };

  console.error("[MCP] update_ui:", card_id, "merge:", merge !== false);

  // Validate props if a component is specified (for merge mode, skip required-field checks)
  const targetComponent = component || null;
  if (targetComponent && BUILTIN_SCHEMAS[targetComponent]) {
    const schema = BUILTIN_SCHEMAS[targetComponent];
    // For merge mode, validate only the provided fields (strip "required" from schema)
    const effectiveSchema = (merge !== false)
      ? { ...schema, required: undefined }
      : schema;
    const result = validateJsonSchema(props, effectiveSchema, "props");
    if (!result.valid) {
      console.error(`[MCP] update_ui validation failed for "${targetComponent}":`, result.errors.length, "errors");
      return { isError: true, text: _formatValidationErrors(targetComponent, result.errors) };
    }
  }

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

const MEMORY_DIR = process.env.JARBLE_MEMORY_DIR || "/data/memory";
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

// ── Service hosting tool execution ────────────────────────────────────

function executeStartHttpService(args) {
  const { name, code, description } = args;
  let { port } = args;

  if (!name || !SERVICE_NAME_RE.test(name)) {
    return { isError: true, text: `Invalid service name "${name}". Must be lowercase letters, digits, hyphens, 1-64 chars, starting with a letter.` };
  }
  if (!code || typeof code !== "string" || code.trim().length < 10) {
    return { isError: true, text: "Service code is missing or too short. Provide a complete Node.js HTTP server script." };
  }

  // If already running, stop the old instance first (allows code updates)
  if (runningServices.has(name)) {
    const old = runningServices.get(name);
    try { old.process.kill("SIGTERM"); } catch { /* already dead */ }
    runningServices.delete(name);
    console.error(`[MCP] Stopped old instance of "${name}" (PID ${old.pid}) for update`);
  }

  const manifest = readServiceManifest();
  const existing = manifest.services[name];

  // Port allocation — reuse existing port if service was previously registered
  if (port) {
    if (port < SERVICE_PORT_MIN || port > SERVICE_PORT_MAX) {
      return { isError: true, text: `Port ${port} is out of range. Use ${SERVICE_PORT_MIN}-${SERVICE_PORT_MAX}.` };
    }
    const used = getUsedPorts(manifest);
    if (used.has(port) && !(existing && existing.port === port)) {
      return { isError: true, text: `Port ${port} is already in use by another service.` };
    }
  } else if (existing && existing.port) {
    // Reuse the previously assigned port
    port = existing.port;
  } else {
    port = allocatePort(manifest);
    if (!port) {
      return { isError: true, text: `No ports available in range ${SERVICE_PORT_MIN}-${SERVICE_PORT_MAX}. Stop an existing service first.` };
    }
  }

  // Write service code to PVC
  const serviceDir = path.join(SERVICES_DIR, name);
  const codeFile = path.join(serviceDir, "server.js");
  try {
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(codeFile, code, "utf-8");
  } catch (e) {
    return { isError: true, text: `Failed to write service code: ${e.message}` };
  }

  // Update manifest
  const now = new Date().toISOString();
  manifest.services[name] = {
    port,
    description: description || "",
    createdAt: manifest.services[name]?.createdAt || now,
    updatedAt: now,
  };
  writeServiceManifest(manifest);

  // Spawn the process
  try {
    const pid = spawnService(name, port, codeFile);
    const podIP = getPodIP();
    return {
      isError: false,
      text: [
        `Service "${name}" started successfully.`,
        `  Port: ${port}`,
        `  PID: ${pid}`,
        `  Internal URL: http://${podIP}:${port}`,
        `  Code: ${codeFile}`,
        ``,
        `Other pods in the cluster can reach this service at http://${podIP}:${port}`,
        `The service will auto-restart when this pod restarts.`,
      ].join("\n"),
    };
  } catch (e) {
    return { isError: true, text: `Failed to start service: ${e.message}` };
  }
}

function executeStopHttpService(args) {
  const { name } = args;
  if (!name) return { isError: true, text: "Missing service name." };

  const running = runningServices.get(name);
  if (running) {
    try {
      running.process.kill("SIGTERM");
    } catch { /* already dead */ }
    runningServices.delete(name);
  }

  // Remove from manifest
  const manifest = readServiceManifest();
  if (manifest.services[name]) {
    delete manifest.services[name];
    writeServiceManifest(manifest);
  }

  // Clean up code directory
  const serviceDir = path.join(SERVICES_DIR, name);
  try {
    if (fs.existsSync(serviceDir)) {
      fs.rmSync(serviceDir, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup failures */ }

  return {
    isError: false,
    text: running
      ? `Service "${name}" stopped and removed (was PID ${running.pid} on port ${running.port}).`
      : `Service "${name}" removed from registry (was not currently running).`,
  };
}

function executeListHttpServices() {
  const manifest = readServiceManifest();
  const podIP = getPodIP();
  const entries = Object.entries(manifest.services);

  if (entries.length === 0) {
    return { isError: false, text: "No services registered. Use start_http_service to create one." };
  }

  const lines = [`${entries.length} registered service(s) on this pod (${podIP}):\n`];
  for (const [name, svc] of entries) {
    const running = runningServices.get(name);
    const status = running ? `RUNNING (PID ${running.pid})` : "STOPPED";
    lines.push(`  ${name}`);
    lines.push(`    Status: ${status}`);
    lines.push(`    Port: ${svc.port}`);
    lines.push(`    URL: http://${podIP}:${svc.port}`);
    if (svc.description) lines.push(`    Description: ${svc.description}`);
    lines.push(`    Created: ${svc.createdAt}`);
    lines.push("");
  }

  return { isError: false, text: lines.join("\n") };
}

async function executePublishToMarketplace(args) {
  const { name, displayName, description, instructionSnippet, category } = args;

  if (!name) return { isError: true, text: "Missing service name." };
  if (!displayName) return { isError: true, text: "Missing display name." };
  if (!description || description.length < 10) return { isError: true, text: "Description must be at least 10 characters." };
  if (!instructionSnippet) return { isError: true, text: "Missing instruction snippet." };

  // Verify the service is running
  const running = runningServices.get(name);
  if (!running) {
    return { isError: true, text: `Service "${name}" is not running. Start it first with start_http_service.` };
  }

  const podIP = getPodIP();
  const endpoint = `http://${podIP}:${running.port}`;

  // Build the marketplace submission
  const deploymentId = process.env.DEPLOYMENT_ID;
  const userId = process.env.USER_ID;

  if (!deploymentId || !userId) {
    return { isError: true, text: "Cannot publish: DEPLOYMENT_ID or USER_ID not set in environment." };
  }

  // Try to publish via the Jarble API
  const apiUrl = process.env.JARBLE_API_URL || process.env.API_BASE_URL || "http://host.docker.internal:3001";
  const http = require("http");
  const https = require("https");

  const payload = JSON.stringify({
    name: name.replace(/-/g, "_"),
    displayName,
    description,
    hostingModel: "hosted",
    instructionSnippet,
    remoteApiEndpoint: endpoint,
    category: category || "utility",
    pricingModel: "free",
    priceUsdCents: 0,
    creatorId: userId,
  });

  return new Promise((resolve) => {
    const url = new URL(`${apiUrl}/debug/marketplace/publish-service`);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (res) => {
      let body = "";
      res.on("data", (d) => body += d);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(body);
            resolve({
              isError: false,
              text: [
                `Service "${displayName}" published to marketplace!`,
                `  ID: ${result.id || "pending"}`,
                `  Status: submitted (pending review)`,
                `  Endpoint: ${endpoint}`,
                ``,
                `The automated review agent will evaluate your submission.`,
                `Once approved, other bots can install it from the marketplace.`,
              ].join("\n"),
            });
          } catch {
            resolve({ isError: false, text: `Published successfully. Response: ${body}` });
          }
        } else {
          resolve({ isError: true, text: `Marketplace API returned ${res.statusCode}: ${body}` });
        }
      });
    });
    req.on("error", (e) => {
      resolve({ isError: true, text: `Failed to reach marketplace API at ${apiUrl}: ${e.message}` });
    });
    req.write(payload);
    req.end();
  });
}

// ── Marketplace browse/install tool execution ─────────────────────────

/**
 * Helper: Make an HTTP request to the Jarble API.
 * Pods have JARBLE_API_URL (or defaults to localhost:3001).
 */
function apiRequest(method, path, body) {
  const apiUrl = process.env.JARBLE_API_URL || process.env.API_BASE_URL || "http://host.docker.internal:3001";
  const http = require("http");
  const https = require("https");
  const url = new URL(`${apiUrl}${path}`);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: payload
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        : {},
    };

    const req = transport.request(opts, (res) => {
      let data = "";
      res.on("data", (d) => data += d);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function executeBrowseMarketplace(args) {
  try {
    const params = new URLSearchParams();
    if (args.type) params.set("type", args.type);
    if (args.query) params.set("q", args.query);
    if (args.category) params.set("category", args.category);

    const res = await apiRequest("GET", `/debug/marketplace/browse?${params.toString()}`);
    if (res.status !== 200) {
      return { isError: true, text: `Marketplace API error: ${JSON.stringify(res.data)}` };
    }

    const { results, count } = res.data;
    if (count === 0) {
      return { isError: false, text: "No items found in the marketplace matching your criteria." };
    }

    const lines = [`Found ${count} marketplace item(s):\n`];
    for (const item of results) {
      const price = item.pricingModel === "free" ? "Free" : `$${(item.priceUsdCents / 100).toFixed(2)}`;
      if (item.type === "component") {
        lines.push(`  [Component] ${item.displayName} (${item.id})`);
        lines.push(`    ${item.description || "No description"}`);
        lines.push(`    Category: ${item.category} | Tier: ${item.tier} | Price: ${price} | Installs: ${item.totalInstalls || 0}`);
      } else {
        lines.push(`  [Service] ${item.displayName} (${item.id})`);
        lines.push(`    ${item.description || "No description"}`);
        lines.push(`    Hosting: ${item.hostingModel} | Price: ${price} | Installs: ${item.totalInstalls || 0}`);
      }
      lines.push("");
    }

    lines.push("Use get_marketplace_item with an ID for full details, or install_marketplace_item to install.");
    return { isError: false, text: lines.join("\n") };
  } catch (err) {
    return { isError: true, text: `Failed to browse marketplace: ${err.message}` };
  }
}

async function executeGetMarketplaceItem(args) {
  if (!args.id) return { isError: true, text: "Missing item ID." };

  try {
    const res = await apiRequest("GET", `/debug/marketplace/item/${args.id}`);
    if (res.status === 404) {
      return { isError: true, text: `Item "${args.id}" not found in the marketplace.` };
    }
    if (res.status !== 200) {
      return { isError: true, text: `Marketplace API error: ${JSON.stringify(res.data)}` };
    }

    const { type, item, components, skills } = res.data;
    const lines = [`## ${item.displayName} (${type})\n`];
    lines.push(`**ID:** ${item.id}`);
    lines.push(`**Name:** ${item.name}`);
    lines.push(`**Status:** ${item.status}`);

    if (type === "component") {
      lines.push(`**Tier:** ${item.tier}`);
      lines.push(`**Category:** ${item.category}`);
      if (item.description) lines.push(`\n### Description\n${item.description}`);
      if (item.propsSchema) lines.push(`\n### Props Schema\n\`\`\`json\n${item.propsSchema}\n\`\`\``);
      if (item.exampleProps) lines.push(`\n### Example Props\n\`\`\`json\n${item.exampleProps}\n\`\`\``);
    } else {
      lines.push(`**Hosting:** ${item.hostingModel}`);
      if (item.description) lines.push(`\n### Description\n${item.description}`);
      if (item.instructionSnippet) lines.push(`\n### Instruction Snippet\n\`\`\`\n${item.instructionSnippet}\n\`\`\``);
      if (item.remoteApiEndpoint) lines.push(`\n### API Endpoint\n${item.remoteApiEndpoint}`);
      if (components && components.length > 0) {
        lines.push(`\n### Bundled Components (${components.length})`);
        components.forEach(c => lines.push(`- ${c.componentId}`));
      }
      if (skills && skills.length > 0) {
        lines.push(`\n### Bundled Skills (${skills.length})`);
        skills.forEach(s => lines.push(`- ${s.skillId}`));
      }
    }

    return { isError: false, text: lines.join("\n") };
  } catch (err) {
    return { isError: true, text: `Failed to get item details: ${err.message}` };
  }
}

async function executeInstallMarketplaceItem(args) {
  if (!args.id) return { isError: true, text: "Missing item ID." };
  if (!args.type) return { isError: true, text: "Missing type (component or service)." };

  const deploymentId = process.env.DEPLOYMENT_ID;
  const userId = process.env.USER_ID;
  if (!deploymentId || !userId) {
    return { isError: true, text: "Cannot install: DEPLOYMENT_ID or USER_ID not set in environment." };
  }

  try {
    const res = await apiRequest("POST", "/debug/marketplace/install", {
      itemId: args.id,
      type: args.type,
      deploymentId,
      userId,
    });

    if (res.status === 409) {
      return { isError: true, text: `This ${args.type} is already installed on this deployment.` };
    }
    if (res.status === 404) {
      return { isError: true, text: `${args.type} "${args.id}" not found in the marketplace.` };
    }
    if (res.status !== 200) {
      return { isError: true, text: `Install failed: ${JSON.stringify(res.data)}` };
    }

    return {
      isError: false,
      text: [
        `Successfully installed ${args.type} "${args.id}"!`,
        res.data.message || "",
        "",
        args.type === "service"
          ? "The service's instruction snippet has been added to your system prompt. ConfigSync is updating your configuration."
          : "The component is now available for use with render_ui.",
      ].join("\n"),
    };
  } catch (err) {
    return { isError: true, text: `Failed to install: ${err.message}` };
  }
}

async function executeUninstallMarketplaceItem(args) {
  if (!args.id) return { isError: true, text: "Missing item ID." };
  if (!args.type) return { isError: true, text: "Missing type (component or service)." };

  const deploymentId = process.env.DEPLOYMENT_ID;
  if (!deploymentId) {
    return { isError: true, text: "Cannot uninstall: DEPLOYMENT_ID not set in environment." };
  }

  try {
    const res = await apiRequest("POST", "/debug/marketplace/uninstall", {
      itemId: args.id,
      type: args.type,
      deploymentId,
    });

    if (res.status === 404) {
      return { isError: true, text: `This ${args.type} is not installed on this deployment.` };
    }
    if (res.status !== 200) {
      return { isError: true, text: `Uninstall failed: ${JSON.stringify(res.data)}` };
    }

    return {
      isError: false,
      text: `Successfully uninstalled ${args.type} "${args.id}". ConfigSync is updating your configuration.`,
    };
  } catch (err) {
    return { isError: true, text: `Failed to uninstall: ${err.message}` };
  }
}

async function executeListInstalledMarketplace() {
  const deploymentId = process.env.DEPLOYMENT_ID;
  if (!deploymentId) {
    return { isError: true, text: "Cannot list installed: DEPLOYMENT_ID not set in environment." };
  }

  try {
    const res = await apiRequest("GET", `/debug/marketplace/installed/${deploymentId}`);
    if (res.status !== 200) {
      return { isError: true, text: `API error: ${JSON.stringify(res.data)}` };
    }

    const { components, services } = res.data;
    const total = (components?.length || 0) + (services?.length || 0);

    if (total === 0) {
      return { isError: false, text: "No marketplace items installed on this deployment. Use browse_marketplace to discover items." };
    }

    const lines = [`${total} marketplace item(s) installed:\n`];

    if (components && components.length > 0) {
      lines.push(`### Components (${components.length})`);
      for (const c of components) {
        lines.push(`  - ${c.displayName || c.name} (${c.componentId})`);
        if (c.description) lines.push(`    ${c.description}`);
        lines.push(`    Tier: ${c.tier} | Installed: ${c.installedAt}`);
      }
      lines.push("");
    }

    if (services && services.length > 0) {
      lines.push(`### Services (${services.length})`);
      for (const s of services) {
        lines.push(`  - ${s.displayName || s.name} (${s.serviceId})`);
        if (s.description) lines.push(`    ${s.description}`);
        lines.push(`    Hosting: ${s.hostingModel} | Installed: ${s.installedAt}`);
      }
    }

    return { isError: false, text: lines.join("\n") };
  } catch (err) {
    return { isError: true, text: `Failed to list installed: ${err.message}` };
  }
}

async function executePublishComponent(args) {
  const { name, displayName, description, tier, category, propsSchema, exampleProps, tags } = args;

  if (!name) return { isError: true, text: "Missing component name." };
  if (!displayName) return { isError: true, text: "Missing display name." };
  if (!description || description.length < 10) return { isError: true, text: "Description must be at least 10 characters." };

  const userId = process.env.USER_ID;
  if (!userId) {
    return { isError: true, text: "Cannot publish: USER_ID not set in environment." };
  }

  try {
    const res = await apiRequest("POST", "/debug/marketplace/publish-component", {
      name,
      displayName,
      description,
      tier: tier || "template",
      category: category || "utility",
      propsSchema: propsSchema ? JSON.stringify(propsSchema) : null,
      exampleProps: exampleProps ? JSON.stringify(exampleProps) : null,
      tags: tags ? JSON.stringify(tags) : null,
      pricingModel: "free",
      priceUsdCents: 0,
      creatorId: userId,
    });

    if (res.status !== 200) {
      return { isError: true, text: `Publish failed: ${JSON.stringify(res.data)}` };
    }

    return {
      isError: false,
      text: [
        `Component "${displayName}" submitted to marketplace!`,
        `  ID: ${res.data.id}`,
        `  Status: submitted (pending review)`,
        ``,
        `The automated review agent will evaluate your submission.`,
        `Once approved, other bots can install it via install_marketplace_item.`,
      ].join("\n"),
    };
  } catch (err) {
    return { isError: true, text: `Failed to publish component: ${err.message}` };
  }
}

// ── Tool dispatch (async-aware) ───────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case "render_ui": return executeRenderUi(args || {});
    case "define_component": return executeDefineComponent(args || {});
    case "list_components": return executeListComponents();
    // New artifact tools
    case "save_artifact": return executeSaveArtifact(args || {});
    case "load_artifact": return executeLoadArtifact(args || {});
    case "list_artifacts": return executeListArtifacts();
    case "delete_artifact": return executeDeleteArtifact(args || {});
    // Legacy canvas file tools — redirect to artifact system
    case "save_canvas_file": return executeSaveArtifact({
      id: (args || {}).fileId,
      component: (args || {}).component,
      props: (args || {}).props,
      title: (args || {}).name || (args || {}).fileId,
    });
    case "load_canvas_file": return executeLoadArtifact({ id: (args || {}).fileId });
    case "list_canvas_files": return executeListArtifacts();
    case "delete_canvas_file": return executeDeleteArtifact({ id: (args || {}).fileId });
    case "component_reference": return executeComponentReference(args || {});
    case "skill_reference": return executeSkillReference(args || {});
    case "update_ui": return executeUpdateUi(args || {});
    case "store_memory": return executeStoreMemory(args || {});
    case "recall_memory": return executeRecallMemory(args || {});
    case "list_memories": return executeListMemories(args || {});
    case "forget_memory": return executeForgetMemory(args || {});
    case "create_dashboard": return executeCreateDashboard(args || {});
    // Service hosting tools
    case "start_http_service": return executeStartHttpService(args || {});
    case "stop_http_service": return executeStopHttpService(args || {});
    case "list_http_services": return executeListHttpServices();
    case "publish_to_marketplace": return executePublishToMarketplace(args || {});
    // Marketplace browse/install tools
    case "browse_marketplace": return executeBrowseMarketplace(args || {});
    case "get_marketplace_item": return executeGetMarketplaceItem(args || {});
    case "install_marketplace_item": return executeInstallMarketplaceItem(args || {});
    case "uninstall_marketplace_item": return executeUninstallMarketplaceItem(args || {});
    case "list_installed_marketplace": return executeListInstalledMarketplace();
    case "publish_component": return executePublishComponent(args || {});
    default:
      // Per-component tools: show_chart, show_data_table, etc.
      // The tool's arguments ARE the props directly (not wrapped in {component, props}).
      if (name.startsWith("show_")) {
        const component = name.slice(5); // "show_chart" -> "chart"
        return executeRenderUi({ component, props: args || {} });
      }
      return null;
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

  // List tools — includes core TOOLS + per-component show_* tools
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: [...TOOLS, ...PER_COMPONENT_TOOLS] },
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
