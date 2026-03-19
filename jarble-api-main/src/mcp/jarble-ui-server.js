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

// ── Load service tools from /data/config/service-tools.json ───────────
// These are dynamically registered MCP tools for installed marketplace services.
// Each entry has { name, description, inputSchema, proxyUrl, serviceId }.
// Written by configSync's openclaw handler during Tier 1 updates.

let SERVICE_TOOLS = []; // Array of MCP tool definitions
const SERVICE_TOOLS_PATH = process.env.JARBLE_SERVICE_TOOLS_PATH || "/data/config/service-tools.json";

function loadServiceTools() {
  try {
    if (fs.existsSync(SERVICE_TOOLS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SERVICE_TOOLS_PATH, "utf-8"));
      if (Array.isArray(raw)) {
        SERVICE_TOOLS = raw.map(function(t) {
          return {
            name: "svc_" + t.name,
            description: t.description || "Service skill: " + t.name,
            inputSchema: t.inputSchema || { type: "object", properties: {} },
            _proxyUrl: t.proxyUrl,
            _serviceId: t.serviceId,
          };
        });
        console.error("[MCP] Loaded " + SERVICE_TOOLS.length + " service tools from " + SERVICE_TOOLS_PATH);
      }
    }
  } catch (e) {
    console.error("[MCP] Failed to load service tools:", e.message);
  }
}
loadServiceTools();

// Watch for changes to service-tools.json (configSync writes this on service install/uninstall)
try {
  const serviceToolsDir = path.dirname(SERVICE_TOOLS_PATH);
  if (fs.existsSync(serviceToolsDir)) {
    fs.watch(serviceToolsDir, function(eventType, filename) {
      if (filename === path.basename(SERVICE_TOOLS_PATH)) {
        console.error("[MCP] service-tools.json changed, reloading...");
        loadServiceTools();
      }
    });
  }
} catch (e) {
  // fs.watch may fail on some platforms — non-fatal, tools reload on MCP restart
  console.error("[MCP] Could not watch for service-tools.json changes:", e.message);
}

// ── Agent tools — per-agent MCP tools for delegation ─────────────────
// These are statically defined tools that delegate to platform-level specialist agents.
// Each agent runs on the API server (not in the pod) with its own system prompt.

const AGENT_TOOLS = [
  {
    name: "delegate_to_data_agent",
    description: "Delegate data analysis tasks to the Data Agent. Use for CSV parsing, statistical analysis, data cleaning, trend detection, and producing structured summaries.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to analyze or compute" },
        data: { description: "The dataset to analyze (JSON array, CSV text, or structured object)" },
        outputFormat: { type: "string", enum: ["json", "markdown", "chart_data"], description: "Desired output format" },
      },
      required: ["task"],
    },
    _agentName: "data",
  },
  {
    name: "delegate_to_workflow_agent",
    description: "Delegate workflow planning to the Workflow Agent. Use when a task requires orchestrating multiple service calls, data transformations, or conditional logic.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The end goal of the workflow" },
        availableServices: { type: "array", items: { type: "string" }, description: "Names of installed services" },
        constraints: { type: "string", description: "Constraints like time budget, cost limits, etc." },
      },
      required: ["goal"],
    },
    _agentName: "workflow",
  },
];

/**
 * Execute an agent delegation by POSTing to the API server's agent endpoint.
 */
async function executeAgentTool(agentTool, args) {
  try {
    const http = require("http");
    const https = require("https");

    const apiBase = process.env.JARBLE_API_URL || process.env.API_BASE_URL || "http://localhost:3001";
    const agentUrl = apiBase + "/api/pod/agent/" + agentTool._agentName;
    const url = new URL(agentUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const bodyJson = JSON.stringify(args);

    return new Promise(function(resolve) {
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyJson),
          "X-Gateway-Token": process.env.OPENCLAW_GATEWAY_TOKEN || "",
          "X-Deployment-Id": process.env.DEPLOYMENT_ID || "",
        },
        timeout: 60000,
      }, function(res) {
        let data = "";
        res.on("data", function(chunk) { data += chunk; });
        res.on("end", function() {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve({ isError: false, text: JSON.stringify(parsed.result || parsed) });
            } catch {
              resolve({ isError: false, text: data });
            }
          } else {
            resolve({ isError: true, text: "Agent call failed (" + res.statusCode + "): " + data.slice(0, 500) });
          }
        });
      });

      req.on("error", function(err) {
        resolve({ isError: true, text: "Agent call error: " + err.message });
      });
      req.on("timeout", function() {
        req.destroy();
        resolve({ isError: true, text: "Agent call timed out (60s)" });
      });

      req.write(bodyJson);
      req.end();
    });
  } catch (err) {
    return { isError: true, text: "Agent tool error: " + err.message };
  }
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
    description: "Render a UI component on the Jarble canvas. The result will be displayed as a rich visual component in the user's dashboard. Supports built-in components (card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout, chart, tabs, accordion, badge, list, timeline, divider, metric_card, header, button_group, form, code_editor, spreadsheet, sandbox) and custom bot-defined components. For data display (charts, tables, KPIs, metrics), use built-in components for speed and reliability. For anything creative, custom, or visually rich — dashboards with custom styling, interactive widgets, data visualizations beyond basic charts, landing pages, custom UIs — use sandbox (HTML/CSS/JS) or sandpack_sandbox (full React/TypeScript). Sandbox components support Tailwind CSS via CDN (https://cdn.tailwindcss.com/3.4.1), modern animations, and the full power of any allowed CDN library. Sandbox supports moduleJs (ES module code with import statements) and importMap (bare specifier to CDN URL mapping). Default imports include three, d3, chart.js, leaflet, react, react-dom, gsap, p5, tone — just use import statements. IMPORTANT: Return the result text to the user as-is so the frontend can parse and render it.",
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
    name: "knowledge_search",
    description: "Search uploaded knowledge base documents for information relevant to a query. Uses keyword matching (TF-IDF) to find the most relevant chunks from ingested documents. Always cite sources when returning results. Use this when the user asks questions that might be answered by their uploaded documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (natural language)" },
        limit: { type: "number", description: "Max number of results to return (default 5, max 20)", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "list_knowledge",
    description: "List all knowledge base collections (uploaded documents). Returns collection names, chunk counts, file types, and upload dates.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "delete_knowledge",
    description: "Delete a knowledge base collection by ID. Permanently removes the document and all its chunks.",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The collection ID to delete (from list_knowledge)" },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "skill_reference",
    description: "Get detailed rendering guides and best practices. Available skills: component-rendering (selection matrix, props examples, design principles), sandbox-mastery (CDN allowlist, bridge API, theme, heartbeat), generative-ui-patterns (when to render UI vs text, text+UI harmony), platform-awareness (canvas system, MCP tools, multi-platform), dashboard-composition (ordering, layout strategy, data consistency), service-hosting (create/host/publish HTTP services on your pod), page-composition (full-screen page layouts — dashboard, kanban, CRM, settings). Call without a name to list all, or with a specific skill name for full content.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill name (e.g. 'component-rendering', 'sandbox-mastery'). Omit to list all available skills." },
      },
    },
  },
  {
    name: "create_draft_service",
    description: "Create a draft marketplace service from a canvas component. Called during the Publish flow when the user wants to package a component as a service. The bot should first ask about hosting model, define skills, and generate an instruction snippet before calling this tool.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Service name (lowercase, letters/digits/hyphens, 1-64 chars)" },
        displayName: { type: "string", description: "Human-readable display name" },
        description: { type: "string", description: "Service description (what it does, min 10 chars)" },
        hostingModel: { type: "string", enum: ["self_hosted", "remote"], description: "'self_hosted' = skills run in buyer's pod. 'remote' = skills route through creator's deployment via proxy." },
        instructionSnippet: { type: "string", description: "Text injected into installing bot's system prompt teaching it how to use the service" },
        componentName: { type: "string", description: "The canvas component type (e.g. 'chart', 'sandbox', 'data_table')" },
        skills: {
          type: "array", description: "Skill names to include from this deployment",
          items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] },
        },
      },
      required: ["name", "displayName", "description", "hostingModel"],
    },
  },
  {
    name: "set_theme",
    description: "Set the visual theme for this deployment's web chat page. Changes are applied instantly. Supports presets (midnight, forest, cyberpunk, ocean, rose, amber, terminal), skins (default, minimal, terminal, neobrutalist, glass) that change bubble shapes/animations/layout, and custom color overrides. Use 'default' preset to reset to platform defaults.",
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["default", "midnight", "forest", "cyberpunk", "ocean", "rose", "amber", "terminal"],
          description: "Theme preset name. 'default' resets to platform defaults.",
        },
        colors: {
          type: "object",
          description: "Custom color overrides (hex values like '#ff0000'). Merged on top of preset. Keys: background, foreground, primary, primary-foreground, secondary, secondary-foreground, card, card-foreground, muted, muted-foreground, accent, accent-foreground, destructive, border, input, ring, chart-1 through chart-5.",
          additionalProperties: { type: "string" },
        },
        radius: {
          type: "string",
          description: "Border radius value, e.g. '0.75rem', '0', '1rem'",
        },
        fontFamily: {
          type: "string",
          description: "CSS font-family for body text, e.g. \"'Fira Code', monospace\"",
        },
        headingFontFamily: {
          type: "string",
          description: "CSS font-family for headings, e.g. \"'Playfair Display', serif\"",
        },
        skin: {
          type: "string",
          enum: ["default", "minimal", "terminal", "neobrutalist", "glass", "retro", "handdrawn", "win98"],
          description: "Chat skin/visual style. Changes bubble shapes, animations, and chat layout. 'win98' gives a classic Windows 98 look.",
        },
      },
    },
  },
  {
    name: "update_design_context",
    description: "Save your current design choices (color palette, chart style, typography, layout preferences) so they persist across the session. Call this after rendering your first charts/components to lock in a consistent visual style. The saved context is automatically included in subsequent messages via [DESIGN_CONTEXT] so you can maintain consistency without re-specifying styles.",
    inputSchema: {
      type: "object",
      properties: {
        colorPalette: {
          type: "array",
          items: { type: "string" },
          description: "Array of hex color strings used across charts and components (e.g. ['#8884d8', '#82ca9d', '#ffc658'])",
        },
        chartStyle: {
          type: "string",
          description: "Preferred chart type for similar data (e.g. 'bar', 'line', 'area', 'pie')",
        },
        typography: {
          type: "object",
          properties: {
            heading: { type: "string", description: "Font family for headings" },
            body: { type: "string", description: "Font family for body text" },
          },
          description: "Typography preferences",
        },
        layoutPreference: {
          type: "string",
          description: "Preferred layout style (e.g. 'grid-2x2', 'stacked', 'sidebar-main')",
        },
        customStyles: {
          type: "object",
          description: "Any additional style preferences (e.g. { borderRadius: '8px', gradientFills: true })",
          additionalProperties: true,
        },
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
        layout: {
          type: "string",
          enum: ["auto", "grid-2x2", "grid-3x2", "sidebar-main", "stacked"],
          description: "Dashboard layout preset. 'auto' uses smart auto-layout based on component types. 'grid-2x2': 2 columns, 'grid-3x2': 3 columns, 'sidebar-main': narrow sidebar + wide main, 'stacked': single column.",
          default: "auto",
        },
        components: {
          type: "array",
          description: "Array of components to render in the dashboard",
          items: {
            type: "object",
            properties: {
              component: { type: "string", description: "Component name (e.g. 'chart', 'stat_grid', 'data_table')" },
              props: { type: "object", description: "Props for the component" },
              layout_hint: {
                type: "string",
                enum: ["full-width", "half", "third", "compact", "auto"],
                description: "Column span hint for this component. Overrides the layout preset for this specific component.",
              },
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
  // ── Full-screen page layout tool ─────────────────────────────────────
  {
    name: "render_page",
    description: "Render a full-screen multi-section page layout (dashboard, kanban, CRM, settings, etc.). Pages auto-open in a fullscreen overlay. Each section contains standard components (chart, data_table, metric_card, etc.). Users can UNGROUP a page back to individual canvas cards. Use this instead of create_dashboard when you need a structured multi-section layout with sidebar, grid, or stacked sections.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["dashboard", "settings", "kanban", "crm", "landing", "data_explorer", "form_wizard"],
          description: "Page layout type. Each type has predefined sections.",
        },
        title: { type: "string", description: "Page title displayed in the header" },
        subtitle: { type: "string", description: "Optional subtitle" },
        sections: {
          type: "object",
          description: "Map of section ID to array of child components. Section IDs must match the page type's template (e.g., dashboard has: header, kpi_row, charts, tables).",
          additionalProperties: {
            type: "array",
            items: {
              type: "object",
              properties: {
                component: { type: "string", description: "Component name (chart, data_table, metric_card, etc.)" },
                props: { type: "object", description: "Props for the component" },
              },
              required: ["component", "props"],
            },
          },
        },
        navigation: {
          type: "object",
          description: "Optional navigation config (used by settings pages)",
          properties: {
            tabs: { type: "array", items: { type: "string" }, description: "Tab labels for navigation" },
          },
        },
      },
      required: ["type", "title", "sections"],
    },
  },
  // ── Component Agent tool ────────────────────────────────────────────
  {
    name: "create_component",
    description: "Delegate complex component creation to Jarble's specialist Component Agent. Use this for sandbox components that need custom HTML/CSS/JS — dashboards, 3D scenes, interactive widgets, data visualizations. The agent produces production-quality code optimized for the Jarble sandbox environment. For simple built-in components (chart, data_table, form, etc.), use render_ui directly instead. NOT for theming — use set_theme for visual style changes (skins: win98, glass, terminal, retro, etc.). IMPORTANT: Do NOT call set_theme alongside this tool — only create the component itself.",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "What component to create. Be specific: 'interactive 3D solar system with planet info on click' not just '3D thing'",
        },
        data: {
          description: "Optional data to embed in the component (arrays, objects, etc.)",
        },
        render: {
          type: "boolean",
          default: true,
          description: "If true (default), automatically render the component via render_ui. If false, return the HTML only.",
        },
      },
      required: ["intent"],
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
  {
    name: "register_service",
    description: "Register a platform-managed service. The Jarble platform handles all routing, authentication, health monitoring, and execution. You provide skill definitions with handler code (JS functions) or agent mode. This is the recommended way to create services — no HTTP server or port management needed.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Service name (lowercase, letters/digits/hyphens, 1-64 chars, e.g. 'weather-api')"
        },
        displayName: {
          type: "string",
          description: "Human-readable display name (e.g. 'Weather Service')"
        },
        description: {
          type: "string",
          description: "What this service does (min 10 chars)"
        },
        skills: {
          type: "array",
          description: "Skills this service provides",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Skill name (lowercase_underscores, e.g. 'get_weather')"
              },
              description: {
                type: "string",
                description: "What this skill does"
              },
              mode: {
                type: "string",
                enum: ["handler", "agent"],
                description: "'handler' = platform runs your JS code in the pod (fast, deterministic). 'agent' = request forwarded to your LLM (smart, creative). Default: 'handler'"
              },
              handlerCode: {
                type: "string",
                description: "For handler mode: async JS function body. Receives (args, context). Must return JSON-serializable result. Has access to fetch() and require(). Example: 'const r = await fetch(`https://api.example.com/${args.query}`); return await r.json();'"
              },
              inputSchema: {
                type: "object",
                description: "JSON Schema for skill input arguments"
              },
              outputSchema: {
                type: "object",
                description: "JSON Schema for skill output (optional)"
              }
            },
            required: ["name", "description", "inputSchema"]
          }
        },
        instructionSnippet: {
          type: "string",
          description: "Text injected into installing bot's system prompt, teaching it how to use your service"
        },
        category: {
          type: "string",
          description: "Category: utility, dashboard, social, game, visualization, media"
        }
      },
      required: ["name", "displayName", "description", "skills"]
    }
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
  // ── Web & Search tools (no API key required) ────────────────────────
  {
    name: "web_fetch",
    description: "Fetch a URL and extract its text content. Strips HTML tags, scripts, styles, nav elements. Returns cleaned text with title. Use for reading web pages, documentation, articles.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        maxLength: { type: "number", description: "Maximum text length to return (default 10000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description: "Search the web using DuckDuckGo. Returns titles, URLs, and snippets for top results. No API key needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum results to return (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "hacker_news",
    description: "Search Hacker News stories and comments via Algolia API. Find tech discussions, Show HNs, and community insights.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 10)" },
        type: { type: "string", enum: ["story", "comment"], description: "Search stories or comments (default: story)" },
      },
      required: ["query"],
    },
  },
  {
    name: "github_search",
    description: "Search GitHub public repositories. Find repos by name, description, or topic. Returns stars, forks, language, and description.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'react state management', 'language:rust stars:>1000')" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 10)" },
        sort: { type: "string", enum: ["stars", "updated", "forks"], description: "Sort order (default: stars)" },
      },
      required: ["query"],
    },
  },
  {
    name: "npm_search",
    description: "Search npm packages. Returns name, version, description, author, and weekly downloads.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "academic_search",
    description: "Search arXiv for academic papers. Returns titles, authors, abstracts, and links to papers in physics, CS, math, biology, and more.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'transformer attention mechanism', 'quantum computing')" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "news_search",
    description: "Search recent news articles via DuckDuckGo. Returns headlines, URLs, and snippets from the past week.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "News search query" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  // ── Image search ────────────────────────────────────────────────────
  {
    name: "search_images",
    description: "Search for images using Unsplash. Returns high-quality photo URLs you can use in cards, image galleries, and sandbox components. Each result includes the image URL, photographer credit, and alt text. ALWAYS credit the photographer when using images.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'mountain sunset', 'modern architecture', 'great wall of china')" },
        count: { type: "number", description: "Number of images (default 3, max 10)" },
        orientation: { type: "string", enum: ["landscape", "portrait", "squarish"], description: "Image orientation (default: landscape)" },
      },
      required: ["query"],
    },
  },
  // ── Reference & Data tools ──────────────────────────────────────────
  {
    name: "dictionary",
    description: "Look up English word definitions, phonetics, and examples using the Free Dictionary API.",
    inputSchema: {
      type: "object",
      properties: {
        word: { type: "string", description: "Word to look up" },
      },
      required: ["word"],
    },
  },
  {
    name: "currency_exchange",
    description: "Get live currency exchange rates from Frankfurter API (European Central Bank data). Convert between currencies.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source currency ISO 4217 code (e.g. 'USD', 'EUR', 'GBP')" },
        to: { type: "string", description: "Target currency code. Omit for all available rates." },
        amount: { type: "number", description: "Amount to convert (optional)" },
      },
      required: ["from"],
    },
  },
  {
    name: "timezone",
    description: "Get current time in any timezone, or list all available timezones. Uses WorldTimeAPI.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "Timezone name (e.g. 'America/New_York', 'Europe/London'). Use 'list' to see all available timezones." },
      },
      required: ["timezone"],
    },
  },
  {
    name: "country_info",
    description: "Look up country information: capital, population, region, currencies, languages, flag, timezones, area.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Country name (e.g. 'France', 'Japan', 'Brazil')" },
      },
      required: ["name"],
    },
  },
  {
    name: "open_library",
    description: "Search for books using Open Library. Returns title, author, publication year, ISBN, and cover image URL.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Book search query (title, author, or ISBN)" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 20)" },
      },
      required: ["query"],
    },
  },
  // ── Utility tools ───────────────────────────────────────────────────
  {
    name: "code_runner",
    description: "Execute JavaScript code in a sandboxed VM. Has access to Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, and console.log. No filesystem or network access. Use for calculations, data transformations, and quick scripts.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript code to execute. The result of the last expression is returned." },
        timeout: { type: "number", description: "Execution timeout in ms (default 5000, max 10000)" },
      },
      required: ["code"],
    },
  },
  {
    name: "url_metadata",
    description: "Extract Open Graph metadata, title, description, and favicon from a URL. Useful for link previews and URL inspection.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to inspect" },
      },
      required: ["url"],
    },
  },
  {
    name: "rss_reader",
    description: "Read RSS or Atom feed. Returns feed title and items with title, link, description, and publish date.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "RSS/Atom feed URL" },
        maxItems: { type: "number", description: "Maximum items to return (default 10)" },
      },
      required: ["url"],
    },
  },
  {
    name: "wikipedia",
    description: "Search and read Wikipedia articles. Returns article summary, thumbnail, and related topics.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Wikipedia article title or search query" },
        sentences: { type: "number", description: "Number of sentences in summary (default 5, max 20)" },
      },
      required: ["query"],
    },
  },
  // ── Human-in-the-Loop Confirmation ──────────────────────────────────
  {
    name: "confirm_action",
    description: "Request user confirmation before executing a sensitive or destructive action. Renders a confirmation card on the user's canvas with Approve/Reject buttons. The bot should wait for the user's response (delivered as a [CONFIRMATION_RESPONSE] message) before proceeding.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title describing the action (e.g. 'Delete all records')" },
        description: { type: "string", description: "Detailed explanation of what will happen" },
        severity: { type: "string", enum: ["info", "warning", "danger"], description: "info = routine, warning = reversible but important, danger = irreversible/destructive" },
        actions: {
          type: "array",
          description: "Action buttons. First action is treated as the primary/approve action.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique action ID" },
              label: { type: "string", description: "Button label" },
            },
            required: ["id", "label"],
          },
        },
        timeout: { type: "number", description: "Optional timeout in seconds. Confirmation expires if user doesn't respond in time." },
        metadata: { type: "object", description: "Optional metadata to attach (passed back in the response)", additionalProperties: true },
      },
      required: ["title", "description", "severity", "actions"],
    },
  },
  {
    name: "check_confirmation",
    description: "Check the status of a pending confirmation request. Returns whether the user has approved, rejected, or if it expired.",
    inputSchema: {
      type: "object",
      properties: {
        confirmationId: { type: "string", description: "The confirmation ID returned by confirm_action" },
      },
      required: ["confirmationId"],
    },
  },
  // ── Agent Marketplace Tools ──────────────────────────────────────────
  {
    name: "discover_agents",
    description: "Search for other agents in the marketplace that can help with specialized tasks. Returns a list of available agents with their skills and pricing. Each call to another agent costs 1 credit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to filter agents by name/description" },
        category: { type: "string", description: "Filter by category" },
        limit: { type: "number", description: "Max results (default 10, max 50)" },
      },
    },
  },
  {
    name: "call_agent",
    description: "Invoke another agent's skill via the Agent Marketplace Hub. Each call costs 1 credit, deducted from the user's balance. Use discover_agents first to find available agents and their skills.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "The service/agent ID from discover_agents results" },
        skillName: { type: "string", description: "The skill name to invoke" },
        args: { type: "object", description: "Arguments to pass to the skill", additionalProperties: true },
      },
      required: ["serviceId", "skillName"],
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

  // Re-register platform-managed services from saved registrations
  try {
    const registrationDirs = fs.readdirSync(SERVICES_DIR).filter(d => {
      const regPath = path.join(SERVICES_DIR, d, "registration.json");
      return fs.existsSync(regPath);
    });

    for (const dir of registrationDirs) {
      try {
        const regPath = path.join(SERVICES_DIR, dir, "registration.json");
        const registration = JSON.parse(fs.readFileSync(regPath, "utf8"));

        // Re-read handler code from disk
        const skills = (registration.skills || []).map(skill => {
          const handlerPath = path.join(SERVICES_DIR, dir, "handlers", `${skill.name}.js`);
          let handlerCode = null;
          if (skill.mode === "handler" && fs.existsSync(handlerPath)) {
            handlerCode = fs.readFileSync(handlerPath, "utf8");
          }
          return { ...skill, handlerCode };
        });

        // Re-register with API (fire and forget)
        apiRequest("POST", "/api/pod/marketplace/register-service", {
          ...registration,
          skills,
        }).then(res => {
          if (res.status === 200) {
            console.error(`[service-recovery] Re-registered platform service: ${registration.name}`);
          }
        }).catch(() => {});
      } catch (err) {
        console.error(`[service-recovery] Failed to re-register ${dir}: ${err.message}`);
      }
    }
  } catch (err) {
    // /data/services may not exist yet
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
    // Auto-infer design context from rendered component (non-blocking)
    let designContextBlock = "";
    try {
      const inferred = inferDesignContext(component, props);
      if (inferred) {
        designContextBlock = "\n```jarble_design_context\n" + JSON.stringify(inferred) + "\n```";
      }
    } catch (_) { /* best-effort */ }
    return { isError: false, text: "```jarble_ui\n" + block + "\n```" + designContextBlock };
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

function resolveHintFromPreset(preset, index, total, componentType) {
  if (!preset || preset === "auto") return "auto";
  switch (preset) {
    case "grid-2x2": return "half";
    case "grid-3x2": return "third";
    case "sidebar-main": return index % 2 === 0 ? "third" : "half";
    case "stacked": return "full-width";
    default: return "auto";
  }
}

function executeCreateDashboard(args) {
  const { title, components, layout } = args;
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
    const { component, props, layout_hint: itemHint } = components[i];
    if (!component) {
      errors.push(`Component ${i + 1}: missing 'component' name.`);
      continue;
    }

    const layout_hint = itemHint || resolveHintFromPreset(layout, i, components.length, component);

    if (BUILTIN_COMPONENTS.includes(component)) {
      const schema = BUILTIN_SCHEMAS[component];
      if (schema && props && typeof props === "object") {
        const result = validateJsonSchema(props, schema, "props");
        if (!result.valid) {
          errors.push(`Component ${i + 1} ("${component}"): ${result.errors[0]}`);
          continue;
        }
      }
      const block = {
        component,
        props: props || {},
        dashboardId,
        dashboardTitle: title,
      };
      if (layout_hint && layout_hint !== "auto") {
        block.layout_hint = layout_hint;
      }
      blocks.push(JSON.stringify(block));
    } else {
      const def = readComponent(component);
      if (!def) {
        errors.push(`Component ${i + 1}: "${component}" not found.`);
        continue;
      }
      const children = resolveCustom(def, props || {});
      const block = {
        component: "layout",
        props: { title: def.description || undefined, children },
        dashboardId,
        dashboardTitle: title,
      };
      if (layout_hint && layout_hint !== "auto") {
        block.layout_hint = layout_hint;
      }
      blocks.push(JSON.stringify(block));
    }
  }

  if (blocks.length === 0) {
    return { isError: true, text: "All components failed validation:\n" + errors.join("\n") };
  }

  let output = blocks.map(b => "```jarble_ui\n" + b + "\n```").join("\n\n");
  if (errors.length > 0) {
    output += "\n\nNote: " + errors.length + " component(s) skipped due to errors:\n" + errors.join("\n");
  }

  console.error(`[MCP] create_dashboard: "${title}" (layout=${layout || "auto"}) with ${blocks.length} components (dashboardId=${dashboardId})`);
  return { isError: false, text: output };
}

function executeRenderPage(args) {
  var type = args.type;
  var title = args.title;
  var subtitle = args.subtitle;
  var sections = args.sections;
  var navigation = args.navigation;

  var validTypes = ["dashboard", "settings", "kanban", "crm", "landing", "data_explorer", "form_wizard"];
  if (!type || validTypes.indexOf(type) === -1) {
    return { isError: true, text: "Invalid or missing 'type'. Must be one of: " + validTypes.join(", ") };
  }
  if (!title) {
    return { isError: true, text: "Missing required 'title' parameter." };
  }
  if (!sections || typeof sections !== "object" || Object.keys(sections).length === 0) {
    return { isError: true, text: "Missing or empty 'sections'. Provide at least one section with child components." };
  }

  // Validate each section's children have component + props
  var errors = [];
  var totalChildren = 0;
  for (var sectionId in sections) {
    if (!Array.isArray(sections[sectionId])) {
      errors.push("Section '" + sectionId + "' must be an array of components.");
      continue;
    }
    var children = sections[sectionId];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child.component) {
        errors.push("Section '" + sectionId + "' child " + (i + 1) + ": missing 'component' name.");
        continue;
      }
      // Validate built-in child props against schema
      if (BUILTIN_COMPONENTS.includes(child.component)) {
        var schema = BUILTIN_SCHEMAS[child.component];
        if (schema && child.props && typeof child.props === "object") {
          var result = validateJsonSchema(child.props, schema, "props");
          if (!result.valid) {
            errors.push("Section '" + sectionId + "' child " + (i + 1) + " (\"" + child.component + "\"): " + result.errors[0]);
          }
        }
      }
      totalChildren++;
    }
  }

  if (totalChildren === 0) {
    return { isError: true, text: "All sections are empty or invalid:\n" + errors.join("\n") };
  }

  var pageProps = { type: type, title: title, sections: sections };
  if (subtitle) pageProps.subtitle = subtitle;
  if (navigation) pageProps.navigation = navigation;

  var block = JSON.stringify({ component: "page", props: pageProps });
  var output = "```jarble_ui\n" + block + "\n```";

  if (errors.length > 0) {
    output += "\n\nNote: " + errors.length + " issue(s) found:\n" + errors.join("\n");
  }

  console.error("[MCP] render_page: \"" + title + "\" (type=" + type + ") with " + totalChildren + " children across " + Object.keys(sections).length + " sections");
  return { isError: false, text: output };
}

async function executeCreateComponent(args) {
  const { intent, data, render = true } = args;
  if (!intent || typeof intent !== "string") {
    return { isError: true, text: "Missing required 'intent' parameter." };
  }

  try {
    const res = await apiRequest("POST", "/api/pod/agent/component", {
      intent,
      data,
      theme: "dark",
    });

    if (res.status !== 200 || !res.data || res.data.error) {
      const errMsg = res.data?.error || `HTTP ${res.status}`;
      return { isError: true, text: `Component Agent error: ${errMsg}` };
    }

    const html = res.data.html;
    if (!html) {
      return { isError: true, text: "Component Agent returned empty HTML." };
    }

    console.error(`[MCP] create_component: "${intent}" (${html.length} chars)`);

    if (render) {
      // Auto-render via render_ui as a sandbox component
      const block = JSON.stringify({
        component: "sandbox",
        props: { html, title: intent },
        layout_hint: "full-width",
      });
      return { isError: false, text: "```jarble_ui\n" + block + "\n```" };
    }

    return { isError: false, text: html };
  } catch (err) {
    return { isError: true, text: `Component Agent request failed: ${err.message || err}` };
  }
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
    return { isError: false, text: `Component "${name}" saved. Use render_ui with component="${name}" to display it.\n\nTip: To share this component with other bots, use the publish_component tool.` };
  } catch (err) {
    console.error("[MCP] Failed to define component:", name, err.message);
    return { isError: true, text: `Failed to save: ${err.message}` };
  }
}

function executeListComponents() {
  const custom = listCustomComponents();
  const lines = [
    "**IMPORTANT:** For dashboards, analytics, charts, or any response needing 2+ visual elements, use `sandbox` (Tailwind + Chart.js/D3 in one component). Only use typed components below for simple standalone displays.",
    "",
    "**Built-in components:**",
  ];
  // List sandbox first, then the rest
  const sandboxFirst = ["sandbox", "sandpack_sandbox"];
  for (const name of sandboxFirst) {
    if (BUILTIN_COMPONENTS.includes(name)) {
      lines.push(`- \`${name}\` — ${BUILTIN_DESCRIPTIONS[name]} ★ PREFERRED for rich content`);
    }
  }
  for (const name of BUILTIN_COMPONENTS) {
    if (sandboxFirst.includes(name)) continue;
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

**Creative/Visual (use sandbox):**
- Premium styled dashboards → \`sandbox\` with Tailwind CSS (gradients, glassmorphism, custom layout)
- Custom data visualizations → \`sandbox\` with D3, Chart.js, or Plotly (heatmaps, treemaps, gauges, sankey)
- Landing pages / showcases → \`sandbox\` with Tailwind CSS (hero sections, feature grids, CTAs)
- Interactive tools / calculators → \`sandbox\` with custom JS logic
- 3D scenes / animations → \`sandbox\` with Three.js, GSAP, p5.js
- Games / simulations → \`sandbox\` with canvas/WebGL
- Anything the user wants to look "beautiful" or "premium" → \`sandbox\` with Tailwind CSS
- Call \`skill_reference("premium-components")\` for ready-to-use premium templates

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
Use \`sandbox\` for any request that benefits from custom styling, layout, or interactivity beyond what built-in components offer. This includes: styled dashboards, landing pages, interactive tools, custom visualizations (candlestick, heatmap, gauge, treemap, sankey), 3D (Three.js), animations, games, physics simulations, and anything where visual quality matters. For standard data display (basic charts, tables, KPIs), built-in components are faster and more reliable. For everything else — especially when the user wants something "beautiful", "cool", "modern", or "premium" — sandbox is the right choice.

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
3. \`js\` = Classic JavaScript. Runs AFTER all libraries finish loading. Runs at GLOBAL scope (const/let/var are global).
4. \`moduleJs\` = ES module JavaScript with \`import\` statements. Rendered as \`<script type="module">\`. Runs after classic js.
5. \`importMap\` = maps bare package names to CDN URLs for clean imports (e.g. \`{"react": "https://esm.sh/react@18"}\`).
6. \`libraries\` = array of CDN URLs. Loaded as <script> tags IN ORDER (sequential, not parallel). Put dependencies first.
7. \`props\` = custom data passed to sandbox. Access via \`window.__JARBLE_PROPS__\`.
8. \`title\` = card title. ALWAYS provide a descriptive title.

### Allowed CDN Origins (ONLY these work — CSP blocks everything else)
| Origin | Use For |
|--------|---------|
| cdn.jsdelivr.net | npm packages (Three.js, D3, Chart.js, anime.js, Leaflet, p5.js) |
| cdnjs.cloudflare.com | Classic CDN mirror |
| unpkg.com | npm mirror |
| cdn.tailwindcss.com | Tailwind CSS |
| esm.sh | ES modules (React, Vue, Svelte, lodash, any npm package) |
| esm.run | ES modules (jsDelivr CDN, fallback for esm.sh) |
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

### ES Module Imports (Modern Pattern)

Use \`moduleJs\` prop for ES module JavaScript with \`import\` statements. Use \`importMap\` prop to map bare package names to CDN URLs.

**Key props:**
- \`moduleJs\` — JavaScript string with import statements. Rendered as \`<script type="module">\`.
- \`importMap\` — Object mapping bare specifiers to CDN URLs (e.g. \`{"react": "https://esm.sh/react@18"}\`).

**esm.sh URL patterns:**
\\\`\\\`\\\`
https://esm.sh/PACKAGE@VERSION           — e.g. https://esm.sh/react@18
https://esm.sh/PACKAGE@VERSION/SUBPATH   — e.g. https://esm.sh/react-dom@18/client
https://esm.sh/PACKAGE@VERSION?bundle    — force bundled (includes deps)
\\\`\\\`\\\`

**When to use classic vs module:**
| Pattern | Use When | Props |
|---------|----------|-------|
| Classic (UMD) | Three.js, D3, Chart.js, p5.js, anime.js — libraries that set globals | \`libraries\` + \`js\` |
| Module (ESM) | React, Vue, Svelte, lodash-es, date-fns — modern npm packages | \`moduleJs\` + \`importMap\` |
| Mixed | Three.js scene + React UI overlay | All four props together |

**You can use BOTH classic and module in one sandbox.** Classic scripts load first (as globals), then module JS runs.

**Pattern: React Component (ESM)**
\\\`\\\`\\\`json
{
  "html": "<div id='root'></div>",
  "moduleJs": "import React from 'react';\\nimport { createRoot } from 'react-dom/client';\\nconst App = () => React.createElement('div', { style: { padding: 20, fontFamily: 'system-ui' } },\\n  React.createElement('h1', null, 'Hello from React!'),\\n  React.createElement('p', null, 'Running inside sandbox via esm.sh'));\\ncreateRoot(document.getElementById('root')).render(React.createElement(App));",
  "importMap": { "react": "https://esm.sh/react@18", "react-dom/client": "https://esm.sh/react-dom@18/client" },
  "title": "React App"
}
\\\`\\\`\\\`

**Pattern: Vue 3 (ESM)**
\\\`\\\`\\\`json
{
  "html": "<div id='app'>{{ message }}</div>",
  "moduleJs": "import { createApp } from 'vue';\\ncreateApp({ data: () => ({ message: 'Hello from Vue 3!' }) }).mount('#app');",
  "importMap": { "vue": "https://esm.sh/vue@3" },
  "title": "Vue App"
}
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
2. **Non-allowlisted CDN** — CSP blocks silently. ONLY the 11 origins above work.
3. **Blocking main thread** — Heavy sync loops kill heartbeat. Chunk with \`setTimeout(fn, 0)\`.
4. **No responsive sizing** — Use \`width: 100%; height: 100%\` on root elements.
5. **fetch() to external APIs** — ONLY CDN origins work in connect-src. Pass data via props instead.
6. **Forgetting dark mode** — ALWAYS add \`@media (prefers-color-scheme: dark)\` styles.
7. **Opaque background** — ALWAYS use \`background: transparent\` on body.
8. **Missing title** — Every sandbox MUST have a descriptive title prop.
9. **No error handling** — Wrap risky code in try/catch. Errors show as red overlay in iframe.
10. **Library version mismatch** — Pin specific versions in URLs (e.g. \`@0.169\` not \`@latest\`).
11. **Using import in js prop** — ES module \`import\` statements ONLY work in \`moduleJs\`, not \`js\`. The \`js\` prop runs as a classic script.

### Tailwind CSS Support
Sandbox supports Tailwind CSS via CDN for rapid, beautiful styling:
- Add \`"https://cdn.tailwindcss.com/3.4.1"\` as the **first entry** in your \`libraries\` array
- Use Tailwind utility classes freely in your HTML (\`flex\`, \`grid\`, \`bg-gradient-to-r\`, \`rounded-xl\`, \`shadow-lg\`, etc.)
- Dark mode: use \`dark:\` prefix — Tailwind reads \`prefers-color-scheme\` automatically
- Theme colors: use CSS variables for integration with the Jarble theme: \`var(--primary)\`, \`var(--background)\`, \`var(--foreground)\`, \`var(--muted)\`, \`var(--accent)\`
- Combine with custom CSS for animations (\`@keyframes\`) and effects Tailwind doesn't cover
- Transparent background rule still applies — use \`bg-transparent\` on body, theme colors on cards/panels

### Premium Design Patterns
When creating visually impressive sandbox components:
- **Glassmorphism**: \`bg-white/10 backdrop-blur-xl border border-white/20\`
- **Gradients**: \`bg-gradient-to-br from-purple-500 via-pink-500 to-red-500\`
- **Depth & shadow**: \`shadow-2xl shadow-purple-500/25 rounded-2xl\`
- **Smooth transitions**: \`transition-all duration-300 hover:scale-105\`
- **Modern spacing**: \`p-6 space-y-4\` for breathing room
- **Typography**: \`text-4xl font-bold tracking-tight\` for headlines
- **Subtle animations**: CSS \`@keyframes\` for pulse, float, shimmer effects`
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

### When to Generate Bespoke Components
Use sandbox to create custom-styled components when:
- The user asks for something "beautiful", "cool", "modern", or "premium"
- The request involves custom layout composition (hero + stats + chart combined)
- You need gradients, animations, glassmorphism, or other visual effects
- The built-in component would work but look generic/plain
- The user asks for a "dashboard", "landing page", "showcase", or "portfolio"
- The request is creative or artistic in nature (infographics, styled reports)
- You want to combine multiple data visualizations into a single cohesive panel

Template approach: Use Tailwind CSS (add \`https://cdn.tailwindcss.com/3.4.1\` to libraries), transparent background on body, theme CSS variables for colors (\`var(--primary)\`, \`var(--foreground)\`, etc.), and modern design patterns. Call \`skill_reference("premium-components")\` for ready-to-use templates.

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
Rendering: render_ui (new card), update_ui (edit existing), create_dashboard (grouped, max 8), render_page (full-screen multi-section layout)
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
4. Built-ins for data — use built-in components (chart, data_table, metric_card) for standard data display
5. Sandbox for custom visuals — use for premium-styled components, creative requests, 3D, games, animations, and anything requiring custom design beyond built-in styling
6. Real data only — never fabricate placeholder data
7. Memory proactively — store preferences without being asked; recall at session start`
  },

  "dashboard-composition": {
    description: "Dashboard ordering, layout presets, layout hint strategy, data consistency, density guidelines, interactive dashboards",
    content: `## Dashboard Composition Guide

### When to Build a Dashboard
Build multi-component dashboards for: overviews/summaries/reports, analytics dashboards, status pages, comparison views. For single-topic responses, prefer one well-chosen component.

### Layout Presets (create_dashboard \`layout\` parameter)
The \`layout\` parameter controls default column spans for all components:
- **auto** (default) — Smart auto-layout based on component types
- **grid-2x2** — 2 equal columns (each component gets "half")
- **grid-3x2** — 3 equal columns (each component gets "third")
- **sidebar-main** — Alternating narrow/wide: odd components get "third", even get "half"
- **stacked** — Single column, every component is "full-width"

### Per-Component Layout Hints
Each component can override the preset with \`layout_hint\`:
- **full-width** — Spans entire row
- **half** — Spans 2 of 3 columns (or 1 of 2 in 2-col grid)
- **third** — Spans 1 of 3 columns
- **compact** — Minimal width
- **auto** — Use the preset default (or smart auto-layout)

Explicit \`layout_hint\` on a component always overrides the dashboard \`layout\` preset.

### Choosing a Layout Preset
| Use Case | Preset | Why |
|----------|--------|-----|
| KPI overview with charts | grid-2x2 | Clean 2-col for metric/chart pairs |
| Multi-metric dashboard | grid-3x2 | Fits 3 KPIs per row |
| Sidebar nav + main content | sidebar-main | Nav list narrow, detail wide |
| Step-by-step report | stacked | Each section full-width, reads top-to-bottom |
| Mixed component types | auto | Let the system decide based on component types |

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

### Layout Strategy Examples
Classic KPI + Chart + Table (layout: "grid-3x2"):
  [metric_card] [metric_card] [metric_card]
  [chart layout_hint:"half"] [list layout_hint:"third"]
  [data_table layout_hint:"full-width"]

Status Dashboard (layout: "auto", override per-component):
  [header full-width]
  [stat_grid full-width]
  [chart half] [chart half]
  [alert third] [alert third] [alert third]

Sidebar Report (layout: "sidebar-main"):
  [list third] [chart half]
  [key_value third] [data_table half]

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
6. Ignoring layout presets — Don't manually set layout_hint on every component when a preset does the job.

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
  "data-formatting": {
    description: "Data format cheat sheet — recharts data, data_table rows, map center, form options, timeline events, stat_grid stats, layout hints",
    content: `## Data Formatting Cheat Sheet

### Chart Data (recharts format)
\\\`\\\`\\\`json
{"type": "bar", "title": "Revenue by Quarter", "data": [{"quarter": "Q1", "revenue": 250000, "target": 200000}, {"quarter": "Q2", "revenue": 310000, "target": 280000}], "dataKeys": ["revenue", "target"], "xAxisKey": "quarter", "showLegend": true, "showGrid": true}
\\\`\\\`\\\`
- \`data\`: array of flat objects — every object has the SAME keys
- \`dataKeys\`: numeric fields to plot (NOT the label field)
- \`xAxisKey\`: the category/label field (string values)
- Chart types: \`bar\`, \`line\`, \`pie\`, \`area\` ONLY
- For multi-series: add multiple entries to \`dataKeys\`
- For stacked: add \`"stacked": true\`
- **NEVER** use Chart.js format (\`labels\` + \`datasets\`)

### data_table Rows (2D arrays, not objects)
\\\`\\\`\\\`json
{"title": "Top Customers", "columns": ["Customer", "Revenue", "Growth"], "rows": [["Acme Corp", "$420K", "+15%"], ["Globex Inc", "$380K", "+8%"]]}
\\\`\\\`\\\`
- \`rows\`: array of arrays — each inner array matches column order
- **NEVER** use objects: \`[{"Customer": "Acme"}]\` is WRONG

### metric_card
\\\`\\\`\\\`json
{"label": "Monthly Revenue", "value": "$1.2M", "change": "+15%", "changeLabel": "vs last month", "sparkline": [800, 920, 1050, 1100, 1150, 1200]}
\\\`\\\`\\\`
- Use \`label\` (NOT \`name\` or \`title\`)
- \`value\` is a string (pre-formatted)
- \`change\` includes sign: "+15%" or "-3%"

### stat_grid (5+ metrics)
\\\`\\\`\\\`json
{"stats": [{"label": "Revenue", "value": "$1.2M", "change": "+15%"}, {"label": "Users", "value": "12,847", "change": "+23%"}]}
\\\`\\\`\\\`
- Use \`stats\` array (NOT \`items\` or \`data\`)
- Each stat uses \`label\` (NOT \`name\`)

### timeline
\\\`\\\`\\\`json
{"title": "Project Timeline", "events": [{"label": "Planning", "description": "Requirements gathered", "timestamp": "Jan 2024", "status": "completed"}, {"label": "Development", "timestamp": "Mar 2024", "status": "active"}]}
\\\`\\\`\\\`
- Use \`events\` array (NOT \`items\` or \`data\`)
- Status values: \`completed\`, \`active\`, \`pending\`

### map
\\\`\\\`\\\`json
{"center": [48.8566, 2.3522], "zoom": 12, "markers": [{"lat": 48.8566, "lng": 2.3522, "label": "Paris"}]}
\\\`\\\`\\\`
- \`center\` is a \`[lat, lng]\` tuple (NOT an object)

### form
\\\`\\\`\\\`json
{"title": "Contact", "fields": [{"name": "role", "label": "Role", "type": "select", "options": ["Engineer", "Designer", "Manager"]}], "submitLabel": "Send"}
\\\`\\\`\\\`
- Select options: flat strings (NOT \`{label, value}\` objects)
- Use \`submitLabel\` (NOT \`submitText\`)

### alert
\\\`\\\`\\\`json
{"title": "Deploy Complete", "message": "v2.3.1 is live", "variant": "success"}
\\\`\\\`\\\`
- Use \`message\` (NOT \`description\`)
- Variants: \`info\`, \`success\`, \`warning\`, \`destructive\` (NOT \`error\` or \`danger\`)

### Layout Hints (REQUIRED on every component)
- \`"full-width"\`: headers, wide tables, sandboxes, maps
- \`"half"\`: charts, timelines, tabs, accordions
- \`"third"\`: metric_cards, badges, alerts, progress bars
- \`"compact"\`: dividers, avatars`
  },
  "page-composition": {
    description: "Guide for building full-screen page layouts with render_page — page types, sections, composition patterns, when to use pages vs cards",
    content: `## Page Composition Guide

### Overview
\`render_page\` creates full-screen multi-section layouts. Pages auto-open in a fullscreen overlay (chat stays visible on the left). Users can UNGROUP a page back to individual canvas cards.

### Page Types & Sections

#### dashboard
KPI overview + analytics. Sections:
- \`header\` (row) — 1-2 components: header, breadcrumbs
- \`kpi_row\` (row) — 1-6 components: metric_card, statistic
- \`charts\` (grid) — 1-6 components: chart (bar, line, area, pie)
- \`tables\` (stack) — 0-4 components: data_table, spreadsheet

Example:
\\\`\\\`\\\`json
{"type":"dashboard","title":"Sales Dashboard","sections":{"header":[{"component":"header","props":{"title":"Sales Dashboard","subtitle":"Q1 2025"}}],"kpi_row":[{"component":"metric_card","props":{"label":"Revenue","value":"$1.2M","change":"+15%"}},{"component":"metric_card","props":{"label":"Orders","value":"3,847","change":"+8%"}}],"charts":[{"component":"chart","props":{"type":"area","title":"Revenue Trend","data":[{"month":"Jan","revenue":380000}],"dataKeys":["revenue"],"xAxisKey":"month"}}],"tables":[{"component":"data_table","props":{"title":"Top Deals","columns":["Deal","Value","Stage"],"rows":[["Acme Corp","$120K","Closing"]]}}]}}
\\\`\\\`\\\`

#### settings
Config panel with sidebar nav. Sections:
- \`sidebar_nav\` (sidebar) — 1 component: list or button_group for navigation
- \`content_area\` (stack) — 1-10 components: form, card, accordion, key_value
Supports \`navigation.tabs\` for tab-based navigation.

#### kanban
Task/project board. Sections:
- \`header\` (row) — 1-2 components: header, button_group
- \`columns\` (row) — 2-8 components: each is a list or card representing a column

#### crm
Contact management. Sections:
- \`header\` (row) — 1-2 components
- \`summary\` (row) — 1-6 metric_cards
- \`contacts\` (grid) — 1-4 components: data_table, list, card
- \`activity\` (stack) — 0-4 components: timeline, list

#### landing
Marketing page. Sections:
- \`hero\` (stack) — 1-3 components: header, image, card
- \`features\` (grid) — 1-8 components: card, metric_card
- \`testimonials\` (row) — 0-6 components: blockquote, card
- \`cta\` (stack) — 1-2 components: card, button_group, form

#### data_explorer
Data browsing. Sections:
- \`filters\` (sidebar) — 1-4 components: form, list, button_group
- \`data_view\` (stack) — 1-4 components: data_table, spreadsheet, chart
- \`detail\` (stack) — 0-4 components: key_value, descriptions, card

#### form_wizard
Multi-step form. Sections:
- \`steps\` (row) — 1 component: steps (step indicator)
- \`form_area\` (stack) — 1-6 components: form, card, alert
- \`actions\` (row) — 1-3 components: button_group

### Composition Rules
1. Section IDs must match the template's section definitions
2. Each section contains an array of standard components (chart, data_table, metric_card, etc.)
3. Section layout determines arrangement: row = horizontal, grid = 2-3 col grid, sidebar = narrow left panel, stack = vertical
4. Use \`render_page\` for 4+ related components forming a cohesive view; use individual \`render_ui\` for single visualizations`
  },

  "premium-components": {
    description: "Premium sandbox component templates — beautiful dashboards, feature showcases, data panels, status boards using Tailwind CSS, gradients, glassmorphism, and modern design patterns",
    content: "## Premium Component Templates\n\nUse these as starting points for visually impressive sandbox components. Each template uses Tailwind CSS from CDN and follows modern design patterns. Customize colors, data, and layout to match the user's request.\n\n### Design Foundation\nAll premium templates share these principles:\n- Tailwind CSS via CDN (`https://cdn.tailwindcss.com/3.4.1`) as first library\n- Transparent body background (`bg-transparent`) — cards/panels use semi-transparent backgrounds\n- Theme CSS variables: `var(--primary)`, `var(--foreground)`, `var(--background)`, `var(--muted)`\n- Dark mode support via `prefers-color-scheme` media query\n- Smooth animations and transitions for polish\n- Responsive layout using Tailwind's flex/grid utilities\n\n---\n\n### Template 1: Premium Dashboard Card\nA metrics card with gradient accent, glassmorphism, animated count-up number, and inline sparkline.\n\n```json\n{\"component\":\"sandbox\",\"props\":{\"title\":\"Premium Metrics Card\",\"height\":280,\"libraries\":[\"https://cdn.tailwindcss.com/3.4.1\"],\"html\":\"<div id='app' class='p-4 h-full flex items-center justify-center bg-transparent'><div class='w-full max-w-sm relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl shadow-2xl shadow-purple-500/10'><div class='absolute inset-0 bg-gradient-to-br from-purple-500/20 via-transparent to-pink-500/10 pointer-events-none'></div><div class='relative p-6 space-y-4'><div class='flex items-center justify-between'><span class='text-sm font-medium text-white/60 uppercase tracking-wider'>Monthly Revenue</span><span class='inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400'>+23.5%</span></div><div class='flex items-end gap-3'><span id='counter' class='text-4xl font-bold text-white tracking-tight'>$0</span></div><div class='h-12'><canvas id='spark' class='w-full h-full'></canvas></div><div class='flex justify-between text-xs text-white/40'><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span></div></div></div></div>\",\"js\":\"var data=[42000,48000,51000,49000,58000,67500];var target=67500;var counter=document.getElementById('counter');var current=0;function animateCount(){if(current<target){current+=Math.ceil((target-current)/20);counter.textContent='$'+current.toLocaleString();requestAnimationFrame(animateCount)}else{counter.textContent='$'+target.toLocaleString()}}animateCount();var canvas=document.getElementById('spark');var ctx=canvas.getContext('2d');function drawSparkline(){canvas.width=canvas.offsetWidth*2;canvas.height=canvas.offsetHeight*2;ctx.scale(2,2);var max=Math.max.apply(null,data);var min=Math.min.apply(null,data);var points=data.map(function(v,i){return{x:i*(canvas.offsetWidth/(data.length-1)),y:canvas.offsetHeight-((v-min)/(max-min))*canvas.offsetHeight*0.8-canvas.offsetHeight*0.1}});var grad=ctx.createLinearGradient(0,0,0,canvas.offsetHeight);grad.addColorStop(0,'rgba(168,85,247,0.4)');grad.addColorStop(1,'rgba(168,85,247,0)');ctx.beginPath();ctx.moveTo(points[0].x,canvas.offsetHeight);points.forEach(function(p){ctx.lineTo(p.x,p.y)});ctx.lineTo(points[points.length-1].x,canvas.offsetHeight);ctx.fillStyle=grad;ctx.fill();ctx.beginPath();points.forEach(function(p,i){if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)});ctx.strokeStyle='#a855f7';ctx.lineWidth=2;ctx.stroke();var last=points[points.length-1];ctx.beginPath();ctx.arc(last.x,last.y,4,0,Math.PI*2);ctx.fillStyle='#a855f7';ctx.fill()}drawSparkline();window.addEventListener('resize',drawSparkline);\",\"css\":\"body{margin:0;background:transparent;font-family:system-ui,-apple-system,sans-serif}\"},\"layout_hint\":\"third\"}\n```\n\n---\n\n### Template 2: Feature Showcase Grid\nA responsive grid of feature cards with icons, gradient accents, and hover animations.\n\n```json\n{\"component\":\"sandbox\",\"props\":{\"title\":\"Feature Showcase\",\"height\":420,\"libraries\":[\"https://cdn.tailwindcss.com/3.4.1\"],\"html\":\"<div class='p-6 bg-transparent min-h-full'><h2 class='text-2xl font-bold text-white mb-2 tracking-tight'>Platform Features</h2><p class='text-white/50 mb-6 text-sm'>Everything you need to build amazing products</p><div class='grid grid-cols-2 gap-4' id='grid'></div></div>\",\"js\":\"var features=[{icon:'\\u26a1',title:'Lightning Fast',desc:'Sub-100ms response times with edge computing',gradient:'from-amber-500 to-orange-600'},{icon:'\\ud83d\\udd12',title:'Enterprise Security',desc:'SOC2 compliant with end-to-end encryption',gradient:'from-emerald-500 to-teal-600'},{icon:'\\ud83d\\udcca',title:'Real-time Analytics',desc:'Live dashboards with custom metrics and alerts',gradient:'from-blue-500 to-indigo-600'},{icon:'\\ud83c\\udf10',title:'Global Scale',desc:'Deploy to 40+ regions with automatic failover',gradient:'from-purple-500 to-pink-600'}];var grid=document.getElementById('grid');features.forEach(function(f,i){var card=document.createElement('div');card.className='group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-5 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:shadow-lg hover:-translate-y-1 cursor-pointer';card.style.animationDelay=i*100+'ms';card.innerHTML='<div class=\\\"w-10 h-10 rounded-lg bg-gradient-to-br '+f.gradient+' flex items-center justify-center text-xl mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300\\\">'+f.icon+'</div><h3 class=\\\"text-white font-semibold mb-1 text-sm\\\">'+f.title+'</h3><p class=\\\"text-white/40 text-xs leading-relaxed\\\">'+f.desc+'</p><div class=\\\"absolute inset-0 bg-gradient-to-br '+f.gradient+' opacity-0 group-hover:opacity-5 transition-opacity duration-300\\\"></div>';grid.appendChild(card)});\",\"css\":\"body{margin:0;background:transparent;font-family:system-ui,-apple-system,sans-serif}\"},\"layout_hint\":\"half\"}\n```\n\n---\n\n### Template 3: Interactive Tabbed Data Panel\nA tabbed panel combining chart visualization and stats, built with Chart.js and Tailwind CSS.\n\n```json\n{\"component\":\"sandbox\",\"props\":{\"title\":\"Analytics Dashboard\",\"height\":480,\"libraries\":[\"https://cdn.tailwindcss.com/3.4.1\",\"https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js\"],\"html\":\"<div class='p-5 bg-transparent h-full flex flex-col'><div class='flex items-center justify-between mb-4'><h2 class='text-xl font-bold text-white tracking-tight'>Revenue Analytics</h2><div class='flex gap-1 bg-white/5 rounded-lg p-1' id='tabs'><button data-tab='chart' class='tab-btn px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 bg-white/10 text-white'>Chart</button><button data-tab='stats' class='tab-btn px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 text-white/50 hover:text-white'>Stats</button></div></div><div class='flex gap-3 mb-4' id='kpis'></div><div id='chart-panel' class='flex-1 relative'><canvas id='chart'></canvas></div><div id='stats-panel' class='flex-1 hidden'><div class='grid grid-cols-2 gap-3 h-full' id='stats-grid'></div></div></div>\",\"js\":\"var months=['Jan','Feb','Mar','Apr','May','Jun'];var revenue=[42,48,51,49,58,67];var costs=[28,30,32,31,35,38];var kpiData=[{label:'Total Revenue',value:'$315K',change:'+18%',positive:true},{label:'Avg Monthly',value:'$52.5K',change:'+12%',positive:true},{label:'Profit Margin',value:'43%',change:'+3%',positive:true}];var kpis=document.getElementById('kpis');kpiData.forEach(function(k){var el=document.createElement('div');el.className='flex-1 bg-white/5 rounded-xl p-3 border border-white/10';el.innerHTML='<div class=\\\"text-xs text-white/40 mb-1\\\">'+k.label+'</div><div class=\\\"flex items-end gap-2\\\"><span class=\\\"text-lg font-bold text-white\\\">'+k.value+'</span><span class=\\\"text-xs font-semibold '+(k.positive?'text-emerald-400':'text-red-400')+'\\\">'+k.change+'</span></div>';kpis.appendChild(el)});var ctx=document.getElementById('chart').getContext('2d');new Chart(ctx,{type:'line',data:{labels:months,datasets:[{label:'Revenue',data:revenue,borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.1)',fill:true,tension:0.4,pointBackgroundColor:'#8b5cf6',pointRadius:4,pointHoverRadius:6},{label:'Costs',data:costs,borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.05)',fill:true,tension:0.4,borderDash:[5,5],pointBackgroundColor:'#6366f1',pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'bottom',labels:{color:'rgba(255,255,255,0.5)',font:{size:11},padding:15,usePointStyle:true}}},scales:{x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'rgba(255,255,255,0.4)',font:{size:11}}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'rgba(255,255,255,0.4)',font:{size:11},callback:function(v){return '$'+v+'K'}}}}}});var statsData=[{label:'Best Month',value:'Jun \\u2014 $67K',icon:'\\ud83d\\udcc8'},{label:'Growth Rate',value:'8.2% MoM',icon:'\\ud83d\\ude80'},{label:'Total Profit',value:'$136K',icon:'\\ud83d\\udcb0'},{label:'Customers',value:'2,847',icon:'\\ud83d\\udc65'}];var sg=document.getElementById('stats-grid');statsData.forEach(function(s){var el=document.createElement('div');el.className='bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col justify-between';el.innerHTML='<span class=\\\"text-2xl mb-2\\\">'+s.icon+'</span><div><div class=\\\"text-xs text-white/40 mb-1\\\">'+s.label+'</div><div class=\\\"text-lg font-bold text-white\\\">'+s.value+'</div></div>';sg.appendChild(el)});document.querySelectorAll('.tab-btn').forEach(function(btn){btn.addEventListener('click',function(){var tab=btn.dataset.tab;document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('bg-white/10','text-white');b.classList.add('text-white/50')});btn.classList.add('bg-white/10','text-white');btn.classList.remove('text-white/50');document.getElementById('chart-panel').classList.toggle('hidden',tab!=='chart');document.getElementById('stats-panel').classList.toggle('hidden',tab!=='stats')})});\",\"css\":\"body{margin:0;background:transparent;font-family:system-ui,-apple-system,sans-serif}\"},\"layout_hint\":\"full-width\"}\n```\n\n---\n\n### Template 4: Status Board\nA real-time-looking status grid with pulse animations, colored indicators, and uptime bars.\n\n```json\n{\"component\":\"sandbox\",\"props\":{\"title\":\"System Status\",\"height\":400,\"libraries\":[\"https://cdn.tailwindcss.com/3.4.1\"],\"html\":\"<div class='p-5 bg-transparent h-full'><div class='flex items-center justify-between mb-5'><div><h2 class='text-xl font-bold text-white tracking-tight'>System Status</h2><p class='text-white/40 text-sm mt-0.5'>All systems operational</p></div><div class='flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full'><span class='relative flex h-2.5 w-2.5'><span class='animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75'></span><span class='relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500'></span></span><span class='text-xs font-semibold text-emerald-400'>Operational</span></div></div><div class='space-y-3' id='services'></div><div class='mt-5 pt-4 border-t border-white/10 flex items-center justify-between'><span class='text-xs text-white/30'>Last checked: just now</span><span class='text-xs text-white/30'>90-day uptime: 99.98%</span></div></div>\",\"js\":\"var services=[{name:'API Gateway',status:'operational',latency:'12ms',uptime:99.99,history:[1,1,1,1,1,1,1,1,1,1,1,1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},{name:'Database Cluster',status:'operational',latency:'3ms',uptime:99.99,history:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},{name:'Auth Service',status:'operational',latency:'8ms',uptime:100,history:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]},{name:'CDN / Edge',status:'degraded',latency:'45ms',uptime:99.92,history:[1,1,1,1,1,1,0.5,1,1,1,1,1,1,1,1,1,0.5,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5]},{name:'Worker Queue',status:'operational',latency:'5ms',uptime:99.97,history:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,1,1,1,1,1,1,1,1,1,1,1]}];var container=document.getElementById('services');var statusColors={operational:{dot:'bg-emerald-500',text:'text-emerald-400',label:'Operational'},degraded:{dot:'bg-amber-500',text:'text-amber-400',label:'Degraded'},down:{dot:'bg-red-500',text:'text-red-400',label:'Down'}};services.forEach(function(s){var sc=statusColors[s.status];var el=document.createElement('div');el.className='flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/8 transition-colors';var bars=s.history.map(function(h){var color=h===1?'bg-emerald-500':h===0.5?'bg-amber-500':'bg-red-500';return '<div class=\\\"flex-1 h-full rounded-sm '+color+' opacity-80 hover:opacity-100 transition-opacity\\\" title=\\\"'+(h===1?'Operational':h===0.5?'Degraded':'Down')+'\\\"></div>'}).join('');el.innerHTML='<div class=\\\"flex-1 min-w-0\\\"><div class=\\\"flex items-center gap-2\\\"><span class=\\\"w-2 h-2 rounded-full '+sc.dot+'\\\"></span><span class=\\\"text-sm font-medium text-white truncate\\\">'+s.name+'</span></div></div><div class=\\\"flex gap-px h-6 w-36\\\">'+bars+'</div><div class=\\\"text-right w-20\\\"><div class=\\\"text-xs '+sc.text+' font-medium\\\">'+sc.label+'</div><div class=\\\"text-xs text-white/30\\\">'+s.latency+' \\u2022 '+s.uptime+'%</div></div>';container.appendChild(el)});\",\"css\":\"body{margin:0;background:transparent;font-family:system-ui,-apple-system,sans-serif}\"},\"layout_hint\":\"full-width\"}\n```\n\n---\n\n### Customization Guide\nWhen adapting these templates:\n1. **Change data**: Replace the hardcoded arrays/objects with the user's actual data\n2. **Change colors**: Swap gradient classes (`from-purple-500` to `from-blue-500`), adjust accent colors\n3. **Change layout**: Modify grid columns (`grid-cols-2` to `grid-cols-3`), card sizes, spacing\n4. **Add interactivity**: Attach click handlers, hover effects, toggles\n5. **Combine patterns**: Mix a KPI row from Template 1 with a chart from Template 3\n6. **Always use Tailwind CDN**: `\"https://cdn.tailwindcss.com/3.4.1\"` as first entry in `libraries`\n7. **Always transparent body**: `body{background:transparent}` in CSS\n8. **Always descriptive title**: Set the `title` prop to describe what the component shows"
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
  sandbox: "`{html, css?, js?, moduleJs?, importMap?: {}, props?: {}, height?, title?, libraries?: string[]}` — sandboxed iframe for live JS/animations/3D. CRITICAL: html=ONLY body HTML. js=classic JavaScript (UMD globals). moduleJs=ES module JS with import statements. importMap=maps bare specifiers to CDN URLs (e.g. {\"react\":\"https://esm.sh/react@18\"}). libraries=CDN URLs loaded as <script> tags. Default import map includes: three, d3, chart.js, leaflet, react, react-dom, gsap, p5, tone — no importMap needed for these packages, just use import statements in moduleJs. Use for: gauges, maps, scatter plots, heatmaps, 3D, animations, candlestick charts, word clouds, React/Vue/Svelte components, or ANY custom visualization.",
  video: "`{url, title?, controls?: true, loop?: false, muted?: false}` — video/livestream player. Supports YouTube, Twitch, Vimeo, SoundCloud, Dailymotion, direct MP4/HLS URLs. Use for livestreams (e.g. YouTube Live, Twitch channels). Just pass the URL.",
};

// Copy-paste examples for the most error-prone components
const COMPONENT_EXAMPLES = {
  chart: '```jarble_ui\n{"component": "chart", "props": {"type": "bar", "title": "Revenue by Region", "data": [{"region": "NA", "revenue": 4200000}, {"region": "EU", "revenue": 3100000}], "dataKeys": ["revenue"], "xAxisKey": "region", "showLegend": true, "showGrid": true}, "layout_hint": "half"}\n```',
  data_table: '```jarble_ui\n{"component": "data_table", "props": {"title": "Top Customers", "columns": ["Customer", "Revenue", "Growth"], "rows": [["Acme Corp", "$420K", "+15%"], ["Globex", "$380K", "+8%"]]}, "layout_hint": "full-width"}\n```',
  metric_card: '```jarble_ui\n{"component": "metric_card", "props": {"label": "Monthly Revenue", "value": "$1.2M", "change": "+15%", "sparkline": [800, 920, 1050, 1200]}, "layout_hint": "third"}\n```',
  stat_grid: '```jarble_ui\n{"component": "stat_grid", "props": {"stats": [{"label": "Revenue", "value": "$1.2M", "change": "+15%"}, {"label": "Users", "value": "12,847", "change": "+23%"}]}, "layout_hint": "full-width"}\n```',
  timeline: '```jarble_ui\n{"component": "timeline", "props": {"title": "Project Timeline", "events": [{"label": "Planning", "timestamp": "Jan 2024", "status": "completed"}, {"label": "Dev", "timestamp": "Mar 2024", "status": "active"}]}, "layout_hint": "half"}\n```',
  map: '```jarble_ui\n{"component": "map", "props": {"center": [48.8566, 2.3522], "zoom": 12, "markers": [{"lat": 48.8566, "lng": 2.3522, "label": "Paris"}]}, "layout_hint": "full-width"}\n```',
  form: '```jarble_ui\n{"component": "form", "props": {"title": "Contact", "fields": [{"name": "email", "label": "Email", "type": "email", "required": true}, {"name": "role", "label": "Role", "type": "select", "options": ["Engineer", "Designer"]}], "submitLabel": "Send"}, "layout_hint": "half"}\n```',
  alert: '```jarble_ui\n{"component": "alert", "props": {"title": "Deploy Complete", "message": "v2.3.1 is live", "variant": "success"}, "layout_hint": "third"}\n```',
};

// Components that should redirect to sandbox for dashboard/multi-viz use cases
const SANDBOX_REDIRECT_COMPONENTS = new Set(["chart", "data_table", "metric_card", "stat_grid", "spreadsheet"]);

function executeComponentReference(args) {
  const name = args?.component;

  if (name) {
    // Check built-in components first
    if (COMPONENT_REFERENCE[name]) {
      const lines = [];

      // For chart-like components, prepend a strong sandbox redirect
      if (SANDBOX_REDIRECT_COMPONENTS.has(name)) {
        lines.push(`**RECOMMENDATION:** For dashboards, analytics, or any response with 2+ visual elements, use **sandbox** instead of ${name}. Build the entire UI in one sandbox with Tailwind CSS (cdn.tailwindcss.com) + Chart.js (esm.sh/chart.js@4/auto). This produces dramatically better, more cohesive results.`);
        lines.push("");
        lines.push(`Only use the typed \`${name}\` component for simple standalone displays. Here are its props if you still need them:`);
        lines.push("");
      }

      lines.push(`**${name}** — props: ${COMPONENT_REFERENCE[name]}`);
      if (BUILTIN_SCHEMAS[name]) {
        lines.push("");
        lines.push("**JSON Schema:**");
        lines.push("```json");
        lines.push(JSON.stringify(BUILTIN_SCHEMAS[name], null, 2));
        lines.push("```");
      }
      // Add copy-paste example if available
      if (COMPONENT_EXAMPLES[name]) {
        lines.push("");
        lines.push("**Copy-paste example:**");
        lines.push(COMPONENT_EXAMPLES[name]);
      }
      // Add default import map note for sandbox
      if (name === "sandbox") {
        lines.push("");
        lines.push("**Default import map:** three, d3, chart.js, leaflet, react, react-dom, gsap, p5, tone — no importMap needed for these packages, just use import statements in moduleJs.");
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

// ── Knowledge Base tool execution ─────────────────────────────────────

const KNOWLEDGE_DIR = process.env.JARBLE_KNOWLEDGE_DIR || "/data/knowledge";

function ensureKnowledgeDir() {
  if (!fs.existsSync(path.join(KNOWLEDGE_DIR, "chunks"))) {
    fs.mkdirSync(path.join(KNOWLEDGE_DIR, "chunks"), { recursive: true });
  }
}

function readKnowledgeManifest() {
  const manifestPath = path.join(KNOWLEDGE_DIR, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try { return JSON.parse(fs.readFileSync(manifestPath, "utf-8")); }
    catch { return { collections: [] }; }
  }
  return { collections: [] };
}

function writeKnowledgeManifest(manifest) {
  ensureKnowledgeDir();
  fs.writeFileSync(path.join(KNOWLEDGE_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Simple TF-IDF keyword search over knowledge chunks.
 * Tokenizes query into words, scores each chunk by keyword frequency.
 */
function knowledgeSearch(query, limit) {
  ensureKnowledgeDir();
  const chunksDir = path.join(KNOWLEDGE_DIR, "chunks");
  if (!fs.existsSync(chunksDir)) return [];

  // Tokenize query into lowercase keywords (strip common stop words)
  const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "because", "but", "and", "or", "if", "while", "about", "what",
    "which", "who", "whom", "this", "that", "these", "those", "i", "me",
    "my", "myself", "we", "our", "ours", "you", "your", "yours", "he",
    "him", "his", "she", "her", "hers", "it", "its", "they", "them",
    "their", "theirs",
  ]);

  const queryWords = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(function(w) { return w.length > 1 && !STOP_WORDS.has(w); });

  if (queryWords.length === 0) return [];

  // Load all chunk files
  var allChunks = [];
  try {
    var files = fs.readdirSync(chunksDir).filter(function(f) { return f.endsWith(".json"); });
    for (var fi = 0; fi < files.length; fi++) {
      try {
        var chunks = JSON.parse(fs.readFileSync(path.join(chunksDir, files[fi]), "utf-8"));
        if (Array.isArray(chunks)) {
          for (var ci = 0; ci < chunks.length; ci++) {
            allChunks.push(chunks[ci]);
          }
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* no chunks dir */ }

  if (allChunks.length === 0) return [];

  // Score each chunk via TF-IDF-like scoring
  // TF = term frequency in chunk / chunk length
  // IDF = log(totalChunks / chunks containing term)

  // Pre-compute document frequency for each query word
  var docFreq = {};
  for (var qi = 0; qi < queryWords.length; qi++) {
    docFreq[queryWords[qi]] = 0;
  }

  var chunkWordCounts = [];
  for (var i = 0; i < allChunks.length; i++) {
    var text = (allChunks[i].text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    var words = text.split(/\s+/);
    var wordCount = {};
    for (var w = 0; w < words.length; w++) {
      wordCount[words[w]] = (wordCount[words[w]] || 0) + 1;
    }
    chunkWordCounts.push({ wordCount: wordCount, totalWords: words.length });

    // Count doc frequency
    for (var qi2 = 0; qi2 < queryWords.length; qi2++) {
      if (wordCount[queryWords[qi2]]) {
        docFreq[queryWords[qi2]]++;
      }
    }
  }

  // Score chunks
  var scored = [];
  for (var s = 0; s < allChunks.length; s++) {
    var score = 0;
    var wc = chunkWordCounts[s];
    for (var qi3 = 0; qi3 < queryWords.length; qi3++) {
      var qw = queryWords[qi3];
      var tf = (wc.wordCount[qw] || 0) / Math.max(wc.totalWords, 1);
      var idf = Math.log((allChunks.length + 1) / (1 + (docFreq[qw] || 0)));
      score += tf * idf;
    }
    if (score > 0) {
      scored.push({ chunk: allChunks[s], score: score });
    }
  }

  // Sort by score descending, return top-K
  scored.sort(function(a, b) { return b.score - a.score; });
  return scored.slice(0, limit);
}

function executeKnowledgeSearch(args) {
  var query = args.query;
  var limit = Math.min(Math.max(args.limit || 5, 1), 20);

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { isError: true, text: "Please provide a search query." };
  }

  var results = knowledgeSearch(query.trim(), limit);

  if (results.length === 0) {
    return {
      isError: false,
      text: "No relevant knowledge base results found for that query. The knowledge base may be empty or the query may not match any uploaded documents.",
    };
  }

  var lines = ["Found " + results.length + " relevant chunk(s):\n"];
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var meta = r.chunk.metadata || {};
    var source = meta.source || "unknown";
    var section = meta.section ? " > " + meta.section : "";
    lines.push("---");
    lines.push("**Source**: " + source + section + " (relevance: " + (r.score * 100).toFixed(1) + "%)");
    lines.push(r.chunk.text);
    lines.push("");
  }

  return { isError: false, text: lines.join("\n") };
}

function executeListKnowledge() {
  ensureKnowledgeDir();
  var manifest = readKnowledgeManifest();

  if (!manifest.collections || manifest.collections.length === 0) {
    return { isError: false, text: "No documents in the knowledge base. Upload documents through the Knowledge panel to give your bot knowledge." };
  }

  var lines = ["Knowledge base: " + manifest.collections.length + " document(s)\n"];
  for (var i = 0; i < manifest.collections.length; i++) {
    var c = manifest.collections[i];
    var sizeKb = ((c.fileSize || 0) / 1024).toFixed(1);
    lines.push("- **" + c.filename + "** (ID: `" + c.id + "`)");
    lines.push("  Type: " + c.detectedType + " | Chunks: " + c.chunkCount + " | Size: " + sizeKb + " KB | Uploaded: " + c.uploadedAt);
  }

  return { isError: false, text: lines.join("\n") };
}

function executeDeleteKnowledge(args) {
  var collectionId = args.collection_id;
  if (!collectionId) {
    return { isError: true, text: "Please provide a collection_id to delete. Use list_knowledge to see available collections." };
  }

  ensureKnowledgeDir();
  var manifest = readKnowledgeManifest();
  var idx = -1;
  for (var i = 0; i < manifest.collections.length; i++) {
    if (manifest.collections[i].id === collectionId) { idx = i; break; }
  }

  if (idx === -1) {
    return { isError: true, text: "Collection \"" + collectionId + "\" not found. Use list_knowledge to see available collections." };
  }

  var removed = manifest.collections.splice(idx, 1)[0];
  writeKnowledgeManifest(manifest);

  // Delete chunk file
  try {
    var chunksPath = path.join(KNOWLEDGE_DIR, "chunks", collectionId + ".json");
    if (fs.existsSync(chunksPath)) fs.unlinkSync(chunksPath);
  } catch { /* file might be gone */ }

  return { isError: false, text: "Deleted knowledge collection: \"" + removed.filename + "\" (" + removed.chunkCount + " chunks)" };
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
    const url = new URL(`${apiUrl}/api/pod/marketplace/publish-service`);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Deployment-Id": process.env.DEPLOYMENT_ID || "",
        "X-Gateway-Token": process.env.OPENCLAW_GATEWAY_TOKEN || "",
      },
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

// ── Platform-managed service registration ─────────────────────────────

async function executeRegisterService(args) {
  // 1. Validate environment
  const deploymentId = process.env.DEPLOYMENT_ID;
  const userId = process.env.USER_ID;
  if (!deploymentId || !userId) {
    return { isError: true, text: "Missing DEPLOYMENT_ID or USER_ID environment variables." };
  }

  // 2. Validate inputs
  const name = (args.name || "").trim();
  const displayName = (args.displayName || "").trim();
  const description = (args.description || "").trim();
  const skills = args.skills || [];

  if (!name || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    return { isError: true, text: "Invalid service name. Must be lowercase letters, digits, and hyphens (1-64 chars), starting with a letter." };
  }
  if (!displayName) {
    return { isError: true, text: "displayName is required." };
  }
  if (!description || description.length < 10) {
    return { isError: true, text: "description must be at least 10 characters." };
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    return { isError: true, text: "At least one skill is required." };
  }

  // 3. Validate each skill
  for (const skill of skills) {
    if (!skill.name || !/^[a-z][a-z0-9_]*$/.test(skill.name)) {
      return { isError: true, text: `Invalid skill name "${skill.name}". Must be lowercase letters, digits, and underscores.` };
    }
    if (!skill.description) {
      return { isError: true, text: `Skill "${skill.name}" missing description.` };
    }
    const mode = skill.mode || "handler";
    if (mode === "handler" && !skill.handlerCode) {
      return { isError: true, text: `Skill "${skill.name}" is handler mode but missing handlerCode.` };
    }
  }

  // 4. Persist handler code to PVC for restart recovery
  const serviceDir = path.join(SERVICES_DIR, name);
  const handlersDir = path.join(serviceDir, "handlers");

  try {
    fs.mkdirSync(handlersDir, { recursive: true });

    // Save registration manifest
    const registration = {
      name,
      displayName,
      description,
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        mode: s.mode || "handler",
        inputSchema: s.inputSchema || {},
        outputSchema: s.outputSchema || null,
      })),
      instructionSnippet: args.instructionSnippet || null,
      category: args.category || "utility",
      registeredAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(serviceDir, "registration.json"), JSON.stringify(registration, null, 2));

    // Save handler code files
    for (const skill of skills) {
      if (skill.handlerCode) {
        fs.writeFileSync(path.join(handlersDir, `${skill.name}.js`), skill.handlerCode);
      }
    }
  } catch (err) {
    return { isError: true, text: `Failed to persist service files: ${err.message}` };
  }

  // 5. Register with the Jarble API
  try {
    const res = await apiRequest("POST", "/api/pod/marketplace/register-service", {
      name,
      displayName,
      description,
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        mode: s.mode || "handler",
        handlerCode: s.handlerCode || null,
        inputSchema: s.inputSchema || {},
        outputSchema: s.outputSchema || null,
      })),
      instructionSnippet: args.instructionSnippet || null,
      category: args.category || "utility",
    });

    if (res.status !== 200) {
      return { isError: true, text: `API error (${res.status}): ${JSON.stringify(res.data)}` };
    }

    const result = res.data;
    return {
      isError: false,
      text: [
        `Service "${displayName}" registered successfully!`,
        ``,
        `ID: ${result.id}`,
        `Status: ${result.status}`,
        `Skills: ${skills.length} (${skills.map(s => s.name).join(", ")})`,
        ``,
        `The platform now manages routing, authentication, and execution.`,
        `Other bots can install this service via: install_marketplace_item { id: "${result.id}", type: "service" }`,
        `Handler code is persisted to /data/services/${name}/ and survives pod restarts.`,
      ].join("\n"),
    };
  } catch (err) {
    return { isError: true, text: `Failed to register service: ${err.message}` };
  }
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
    const headers = payload
      ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      : {};
    // Auth headers so the API can identify which pod/deployment is calling
    headers["X-Deployment-Id"] = process.env.DEPLOYMENT_ID || "";
    headers["X-Gateway-Token"] = process.env.OPENCLAW_GATEWAY_TOKEN || "";

    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
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

// ── Agent Marketplace: discover_agents & call_agent ──────────────────

async function executeDiscoverAgents(args) {
  try {
    const params = new URLSearchParams();
    if (args.query) params.set("q", args.query);
    if (args.category) params.set("category", args.category);
    if (args.limit) params.set("limit", String(Math.min(args.limit, 50)));

    const res = await apiRequest("GET", `/api/agent-hub/discover?${params.toString()}`);
    if (res.status !== 200) {
      return { isError: true, text: `Agent discovery failed: ${JSON.stringify(res.data)}` };
    }

    const { agents, count } = res.data;
    if (count === 0) {
      return { isError: false, text: "No agents found matching your criteria. Try a broader search or browse all agents with no query." };
    }

    const lines = [`Found ${count} agent(s) available in the marketplace:\n`];
    for (const agent of agents) {
      lines.push(`  **${agent.displayName}** (ID: ${agent.id})`);
      lines.push(`    ${agent.description || "No description"}`);
      lines.push(`    Hosting: ${agent.hostingModel} | Cost: ${agent.creditsPerCall} credit/call | Installs: ${agent.totalInstalls || 0}`);
      if (agent.skills && agent.skills.length > 0) {
        lines.push(`    Skills:`);
        for (const skill of agent.skills) {
          lines.push(`      - ${skill.name}: ${skill.description || "No description"}`);
        }
      }
      lines.push("");
    }
    lines.push("Use `call_agent` with a serviceId and skillName to invoke an agent's skill.");
    return { isError: false, text: lines.join("\n") };
  } catch (err) {
    return { isError: true, text: `Failed to discover agents: ${err.message}` };
  }
}

async function executeCallAgent(args) {
  if (!args.serviceId) return { isError: true, text: "Missing required field: serviceId" };
  if (!args.skillName) return { isError: true, text: "Missing required field: skillName" };

  try {
    const deploymentId = process.env.DEPLOYMENT_ID || "";
    const res = await apiRequest("POST", "/api/agent-hub/call", {
      callerDeploymentId: deploymentId,
      serviceId: args.serviceId,
      skillName: args.skillName,
      args: args.args || {},
    });

    if (res.status === 402) {
      return { isError: true, text: "Insufficient credits. The user needs to purchase more credits from the dashboard to make agent calls." };
    }
    if (res.status === 404) {
      return { isError: true, text: `Agent or skill not found: ${args.serviceId} / ${args.skillName}. Use discover_agents to find available agents.` };
    }
    if (res.status !== 200) {
      return { isError: true, text: `Agent call failed (${res.status}): ${JSON.stringify(res.data).slice(0, 500)}` };
    }

    const { result, creditsCharged, callId } = res.data;
    const resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return {
      isError: false,
      text: `Agent call completed (${creditsCharged} credit charged, call ID: ${callId}).\n\nResult:\n${resultText}`,
    };
  } catch (err) {
    return { isError: true, text: `Agent call error: ${err.message}` };
  }
}

async function executeBrowseMarketplace(args) {
  try {
    const params = new URLSearchParams();
    if (args.type) params.set("type", args.type);
    if (args.query) params.set("q", args.query);
    if (args.category) params.set("category", args.category);

    const res = await apiRequest("GET", `/api/pod/marketplace/browse?${params.toString()}`);
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
    const res = await apiRequest("GET", `/api/pod/marketplace/item/${args.id}`);
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
    const res = await apiRequest("POST", "/api/pod/marketplace/install", {
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
    const res = await apiRequest("POST", "/api/pod/marketplace/uninstall", {
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
    const res = await apiRequest("GET", `/api/pod/marketplace/installed`);
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

async function executeCreateDraftService(args) {
  const name = (args.name || "").trim();
  const displayName = (args.displayName || "").trim();
  const description = (args.description || "").trim();
  const hostingModel = args.hostingModel || "self_hosted";

  if (!name || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    return { isError: true, text: "Invalid service name — must be lowercase alphanumeric with hyphens, starting with a letter." };
  }
  if (!displayName) return { isError: true, text: "displayName is required." };
  if (!description || description.length < 10) return { isError: true, text: "description must be at least 10 characters." };

  try {
    const res = await apiRequest("POST", "/api/pod/services/create-draft", {
      name,
      displayName,
      description,
      hostingModel,
      instructionSnippet: args.instructionSnippet || null,
      componentName: args.componentName || null,
      skills: args.skills || [],
    });

    if (res.status >= 400) {
      return { isError: true, text: `Failed to create draft (${res.status}): ${res.data?.error || JSON.stringify(res.data)}` };
    }

    const d = res.data;
    return {
      isError: false,
      text: [
        `Draft service "${displayName}" created successfully!`,
        ``,
        `Service ID: ${d.serviceId}`,
        `Status: draft`,
        `Hosting: ${hostingModel === "remote" ? "Remote (you host)" : "Self-hosted (buyer hosts)"}`,
        `Linked components: ${d.linkedComponents || 0}`,
        `Linked skills: ${d.linkedSkills || 0}`,
        ``,
        `Next steps:`,
        `- The creator can test this draft by installing it on a deployment from the My Services tab in the marketplace`,
        `- When ready, submit it for admin review`,
      ].join("\n"),
    };
  } catch (err) {
    return { isError: true, text: `Failed to create draft: ${err.message}` };
  }
}

async function executeSetTheme(args) {
  const body = {};
  if (args.preset) body.preset = args.preset;
  if (args.colors) body.colors = args.colors;
  if (args.radius) body.radius = args.radius;
  if (args.fontFamily) body.fontFamily = args.fontFamily;
  if (args.headingFontFamily) body.headingFontFamily = args.headingFontFamily;
  if (args.skin) body.skin = args.skin;

  // If nothing specified, treat as reset
  if (Object.keys(body).length === 0) {
    body.preset = "default";
  }

  // Write theme config to PVC marker file — the API's tamboAgent will
  // detect this file after each chat turn and persist to the DB.
  // This avoids needing JARBLE_API_URL connectivity from the pod.
  const fs = require("fs");
  const path = require("path");
  const themeDir = process.env.PVC_MOUNT || "/data";
  const themeFile = path.join(themeDir, "config", "pending-theme.json");
  try {
    fs.mkdirSync(path.dirname(themeFile), { recursive: true });
    fs.writeFileSync(themeFile, JSON.stringify(body, null, 2));
  } catch (err) {
    console.error("[MCP] Failed to write theme file:", err.message);
  }

  // Also try API call (works when JARBLE_API_URL is configured)
  try {
    await apiRequest("POST", "/api/pod/theme", body);
  } catch { /* non-fatal — marker file is the primary mechanism */ }

  const parts = [];
  if (body.preset) parts.push(`Preset: ${body.preset}`);
  if (body.colors) parts.push(`Custom colors: ${Object.keys(body.colors).join(", ")}`);
  if (body.radius) parts.push(`Border radius: ${body.radius}`);
  if (body.fontFamily) parts.push(`Font: ${body.fontFamily}`);
  if (body.headingFontFamily) parts.push(`Heading font: ${body.headingFontFamily}`);
  if (body.skin) parts.push(`Skin: ${body.skin}`);

  return {
    isError: false,
    text: `Theme updated! The chat page will reflect the new theme.\n${parts.join("\n")}`,
  };
}

// ── Design Context (session-level style tracking) ───────────────────────

const DESIGN_CONTEXT_PATH = (() => {
  const fs = require("fs");
  const path = require("path");
  const base = process.env.PVC_MOUNT || "/data";
  return path.join(base, "workspace", "design-context.json");
})();

function readDesignContext() {
  const fs = require("fs");
  try {
    const raw = fs.readFileSync(DESIGN_CONTEXT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeDesignContext(ctx) {
  const fs = require("fs");
  const path = require("path");
  try {
    fs.mkdirSync(path.dirname(DESIGN_CONTEXT_PATH), { recursive: true });
    fs.writeFileSync(DESIGN_CONTEXT_PATH, JSON.stringify(ctx, null, 2));
  } catch (err) {
    console.error("[MCP] Failed to write design context:", err.message);
  }
}

function mergeDesignContext(incoming) {
  const existing = readDesignContext();
  // Shallow merge top-level keys; arrays and objects replace, not deep-merge
  const merged = Object.assign({}, existing);
  if (incoming.colorPalette) merged.colorPalette = incoming.colorPalette;
  if (incoming.chartStyle) merged.chartStyle = incoming.chartStyle;
  if (incoming.layoutPreference) merged.layoutPreference = incoming.layoutPreference;
  if (incoming.typography) {
    merged.typography = Object.assign({}, merged.typography || {}, incoming.typography);
  }
  if (incoming.customStyles) {
    merged.customStyles = Object.assign({}, merged.customStyles || {}, incoming.customStyles);
  }
  merged.updatedAt = new Date().toISOString();
  writeDesignContext(merged);
  return merged;
}

function executeUpdateDesignContext(args) {
  if (!args || Object.keys(args).length === 0) {
    // Return current context
    const ctx = readDesignContext();
    if (Object.keys(ctx).length === 0) {
      return { isError: false, text: "No design context saved yet. Call with colorPalette, chartStyle, typography, layoutPreference, or customStyles to save your design choices." };
    }
    return { isError: false, text: "Current design context:\n" + JSON.stringify(ctx, null, 2) };
  }
  const merged = mergeDesignContext(args);
  const parts = [];
  if (merged.colorPalette) parts.push(`Color palette: ${merged.colorPalette.join(", ")}`);
  if (merged.chartStyle) parts.push(`Chart style: ${merged.chartStyle}`);
  if (merged.typography) parts.push(`Typography: heading=${merged.typography.heading || "default"}, body=${merged.typography.body || "default"}`);
  if (merged.layoutPreference) parts.push(`Layout: ${merged.layoutPreference}`);
  if (merged.customStyles) parts.push(`Custom styles: ${Object.keys(merged.customStyles).join(", ")}`);

  // Emit a fenced block so the gateway can relay the context to the frontend
  const contextBlock = "```jarble_design_context\n" + JSON.stringify(merged) + "\n```";

  return {
    isError: false,
    text: `Design context updated! These styles will be included in subsequent messages via [DESIGN_CONTEXT].\n${parts.join("\n")}\n${contextBlock}`,
  };
}

/**
 * Auto-infer design intent from rendered component props.
 * Called after each successful render_ui to passively build up the design context.
 */
function inferDesignContext(component, props) {
  if (!props || typeof props !== "object") return;

  const inferred = {};

  // Extract colors from chart components
  if (component === "chart" && props.colors && Array.isArray(props.colors)) {
    inferred.colorPalette = props.colors;
  }
  // Infer chart style preference
  if (component === "chart" && props.type) {
    inferred.chartStyle = props.type;
  }
  // Extract colors from stat_grid items with color fields
  if (component === "stat_grid" && Array.isArray(props.stats)) {
    const colors = props.stats
      .map(function(s) { return s.color; })
      .filter(function(c) { return c && typeof c === "string" && c.startsWith("#"); });
    if (colors.length >= 2) {
      inferred.colorPalette = colors;
    }
  }
  // Extract color palette from metric_card
  if (component === "metric_card" && props.color && typeof props.color === "string" && props.color.startsWith("#")) {
    // Single color — only update if we have no palette yet
    const existing = readDesignContext();
    if (!existing.colorPalette || existing.colorPalette.length === 0) {
      inferred.colorPalette = [props.color];
    }
  }

  // Only merge if we inferred something; return merged context for embedding
  if (Object.keys(inferred).length > 0) {
    return mergeDesignContext(inferred);
  }
  return null;
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
    const res = await apiRequest("POST", "/api/pod/marketplace/publish-component", {
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

// ── Shared helpers for web tools ───────────────────────────────────────

const WEB_USER_AGENT = "JarbleBot/1.0 (https://jarble.ai)";
const WEB_FETCH_TIMEOUT = 10000;

/**
 * Extract readable text from HTML by stripping tags, scripts, styles, nav, header, footer.
 * Collapses whitespace and returns clean text.
 */
function extractTextFromHtml(html) {
  let text = html;
  // Remove script, style, nav, header, footer, noscript, svg elements and their contents
  text = text.replace(/<(script|style|nav|header|footer|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * Extract <title> from HTML.
 */
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
}

/**
 * Fetch a URL with timeout and user-agent.
 */
async function webFetch(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || WEB_FETCH_TIMEOUT);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── Web & Search tool handlers ────────────────────────────────────────

async function executeWebFetch(args) {
  const { url, maxLength } = args;
  if (!url) return { isError: true, text: "Missing 'url' parameter." };

  const limit = Math.min(Math.max(maxLength || 10000, 100), 100000);

  try {
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `HTTP ${resp.status}: ${resp.statusText}` };

    const html = await resp.text();
    const title = extractTitle(html) || "";
    let content = extractTextFromHtml(html);
    const fullLength = content.length;
    if (content.length > limit) content = content.slice(0, limit) + "...";

    return {
      isError: false,
      text: JSON.stringify({ title, content, url, contentLength: fullLength }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out after 10 seconds" : err.message;
    return { isError: true, text: `Failed to fetch ${url}: ${msg}` };
  }
}

async function executeWebSearch(args) {
  const { query, maxResults } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 10);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT);
    let resp;
    try {
      resp = await fetch("https://lite.duckduckgo.com/lite", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": WEB_USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "q=" + encodeURIComponent(query),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) return { isError: true, text: `DuckDuckGo returned HTTP ${resp.status}` };

    const html = await resp.text();
    const results = [];

    // DuckDuckGo lite returns results in table rows with class "result-link" for links
    // and snippets in subsequent cells. Parse via regex.
    // Pattern: <a rel="nofollow" href="URL" class='result-link'>TITLE</a> ... <td class="result-snippet">SNIPPET</td>
    const linkRe = /<a[^>]+class='result-link'[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<td\s+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      links.push({ url: m[1], title: extractTextFromHtml(m[2]).trim() });
    }
    const snippets = [];
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(extractTextFromHtml(m[1]).trim());
    }

    for (let i = 0; i < Math.min(links.length, limit); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
      });
    }

    return {
      isError: false,
      text: JSON.stringify({ query, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Search timed out after 10 seconds" : err.message;
    return { isError: true, text: `Web search failed: ${msg}` };
  }
}

async function executeHackerNews(args) {
  const { query, maxResults, type } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 10);
  const searchType = type === "comment" ? "comment" : "story";

  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${searchType}&hitsPerPage=${limit}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `Hacker News API returned HTTP ${resp.status}` };

    const data = await resp.json();
    const results = (data.hits || []).map(hit => ({
      title: hit.title || hit.story_title || "",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points || 0,
      author: hit.author || "",
      createdAt: hit.created_at || "",
      numComments: hit.num_comments || 0,
      ...(searchType === "comment" ? { commentText: (hit.comment_text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) } : {}),
    }));

    return {
      isError: false,
      text: JSON.stringify({ query, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Hacker News search failed: ${msg}` };
  }
}

async function executeGithubSearch(args) {
  const { query, maxResults, sort } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 10);
  const sortBy = sort || "stars";

  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sortBy}&per_page=${limit}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);

    if (resp.status === 403) {
      return { isError: true, text: "GitHub API rate limit exceeded (10 requests/min for unauthenticated). Try again in a minute." };
    }
    if (!resp.ok) return { isError: true, text: `GitHub API returned HTTP ${resp.status}` };

    const data = await resp.json();
    const results = (data.items || []).map(repo => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || "",
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language || "Unknown",
      url: repo.html_url,
      updatedAt: repo.updated_at,
    }));

    return {
      isError: false,
      text: JSON.stringify({ query, totalCount: data.total_count, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `GitHub search failed: ${msg}` };
  }
}

async function executeNpmSearch(args) {
  const { query, maxResults } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 20);

  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `npm registry returned HTTP ${resp.status}` };

    const data = await resp.json();
    const results = (data.objects || []).map(obj => {
      const pkg = obj.package;
      return {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description || "",
        author: pkg.author ? pkg.author.name || pkg.author : "",
        weeklyDownloads: obj.score ? Math.round((obj.score.detail?.popularity || 0) * 1000000) : 0,
        url: `https://www.npmjs.com/package/${pkg.name}`,
      };
    });

    return {
      isError: false,
      text: JSON.stringify({ query, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `npm search failed: ${msg}` };
  }
}

async function executeAcademicSearch(args) {
  const { query, maxResults } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 20);

  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}&sortBy=relevance`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `arXiv API returned HTTP ${resp.status}` };

    const xml = await resp.text();
    const results = [];

    // Parse <entry> blocks from Atom XML using regex
    const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
    let entryMatch;
    while ((entryMatch = entryRe.exec(xml)) !== null && results.length < limit) {
      const entry = entryMatch[1];

      const titleM = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const summaryM = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      const idM = entry.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
      const publishedM = entry.match(/<published[^>]*>([\s\S]*?)<\/published>/i);

      // Extract all author names
      const authors = [];
      const authorRe = /<author>\s*<name>([\s\S]*?)<\/name>/gi;
      let authorMatch;
      while ((authorMatch = authorRe.exec(entry)) !== null) {
        authors.push(authorMatch[1].trim());
      }

      const title = titleM ? titleM[1].replace(/\s+/g, " ").trim() : "";
      const summary = summaryM ? summaryM[1].replace(/\s+/g, " ").trim().slice(0, 500) : "";
      const arxivUrl = idM ? idM[1].trim() : "";
      const published = publishedM ? publishedM[1].trim() : "";

      if (title) {
        results.push({ title, authors, summary, url: arxivUrl, published });
      }
    }

    return {
      isError: false,
      text: JSON.stringify({ query, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `arXiv search failed: ${msg}` };
  }
}

async function executeNewsSearch(args) {
  const { query, maxResults } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 10);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT);
    let resp;
    try {
      resp = await fetch("https://lite.duckduckgo.com/lite", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": WEB_USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "q=" + encodeURIComponent(query + " news") + "&df=w",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) return { isError: true, text: `DuckDuckGo returned HTTP ${resp.status}` };

    const html = await resp.text();
    const results = [];

    const linkRe = /<a[^>]+class='result-link'[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<td\s+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      links.push({ url: m[1], title: extractTextFromHtml(m[2]).trim() });
    }
    const snippets = [];
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(extractTextFromHtml(m[1]).trim());
    }

    for (let i = 0; i < Math.min(links.length, limit); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
      });
    }

    return {
      isError: false,
      text: JSON.stringify({ query, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Search timed out" : err.message;
    return { isError: true, text: `News search failed: ${msg}` };
  }
}

async function executeImageSearch(args) {
  const { query, count, orientation } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(count || 3, 1), 10);
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;

  // Primary: Unsplash API (if key is configured)
  if (unsplashKey) {
    try {
      const params = new URLSearchParams({
        query,
        per_page: String(limit),
        ...(orientation ? { orientation } : {}),
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT);
      let resp;
      try {
        resp = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
          signal: controller.signal,
          headers: { Authorization: `Client-ID ${unsplashKey}` },
        });
      } finally { clearTimeout(timer); }

      if (resp.ok) {
        const data = await resp.json();
        const results = (data.results || []).slice(0, limit).map((photo) => ({
          url: photo.urls?.regular || photo.urls?.small,
          thumbnail: photo.urls?.thumb,
          alt: photo.alt_description || photo.description || query,
          credit: photo.user?.name || "Unknown",
          creditUrl: photo.user?.links?.html || "",
          width: photo.width,
          height: photo.height,
        }));
        return {
          isError: false,
          text: JSON.stringify({
            query,
            source: "unsplash",
            results,
            attribution: "Photos provided by Unsplash. Always credit photographers.",
          }),
        };
      }
    } catch (err) {
      console.error("[MCP] Unsplash search failed, falling back to Wikimedia:", err.message);
    }
  }

  // Fallback: Wikimedia Commons (free, no API key needed)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT);
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiurlwidth: "800",
      format: "json",
      origin: "*",
    });
    let resp;
    try {
      resp = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
        signal: controller.signal,
        headers: { "User-Agent": WEB_USER_AGENT },
      });
    } finally { clearTimeout(timer); }

    if (!resp.ok) return { isError: true, text: `Wikimedia API returned HTTP ${resp.status}` };

    const data = await resp.json();
    const pages = data.query?.pages || {};
    const results = Object.values(pages)
      .filter((p) => p.imageinfo?.[0])
      .slice(0, limit)
      .map((p) => {
        const info = p.imageinfo[0];
        const meta = info.extmetadata || {};
        return {
          url: info.thumburl || info.url,
          fullUrl: info.url,
          alt: (meta.ObjectName?.value || p.title || query).replace(/^File:/, ""),
          credit: meta.Artist?.value?.replace(/<[^>]*>/g, "") || "Wikimedia Commons",
          license: meta.LicenseShortName?.value || "CC",
          width: info.thumbwidth || info.width,
          height: info.thumbheight || info.height,
        };
      });

    return {
      isError: false,
      text: JSON.stringify({
        query,
        source: "wikimedia",
        results,
        attribution: "Images from Wikimedia Commons. Check individual licenses.",
      }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Search timed out" : err.message;
    return { isError: true, text: `Image search failed: ${msg}` };
  }
}

async function executeDictionary(args) {
  const { word } = args;
  if (!word) return { isError: true, text: "Missing 'word' parameter." };

  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);

    if (resp.status === 404) return { isError: true, text: `Word "${word}" not found in dictionary.` };
    if (!resp.ok) return { isError: true, text: `Dictionary API returned HTTP ${resp.status}` };

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { isError: true, text: `No definitions found for "${word}".` };
    }

    const entry = data[0];
    const result = {
      word: entry.word,
      phonetic: entry.phonetic || (entry.phonetics && entry.phonetics[0] ? entry.phonetics[0].text : ""),
      meanings: (entry.meanings || []).map(m => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions || []).slice(0, 3).map(d => ({
          definition: d.definition,
          example: d.example || undefined,
        })),
      })),
    };

    return {
      isError: false,
      text: JSON.stringify(result),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Dictionary lookup failed: ${msg}` };
  }
}

async function executeCurrencyExchange(args) {
  const { from, to, amount } = args;
  if (!from) return { isError: true, text: "Missing 'from' currency code." };

  const fromCode = from.toUpperCase();

  try {
    let url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCode)}`;
    if (to) url += `&to=${encodeURIComponent(to.toUpperCase())}`;
    if (amount !== undefined && amount !== null) url += `&amount=${encodeURIComponent(String(amount))}`;

    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) {
      const body = await resp.text();
      return { isError: true, text: `Currency API error (${resp.status}): ${body.slice(0, 200)}` };
    }

    const data = await resp.json();
    return {
      isError: false,
      text: JSON.stringify({
        from: data.base || fromCode,
        date: data.date,
        rates: data.rates,
        ...(amount !== undefined ? { amount } : {}),
      }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Currency exchange failed: ${msg}` };
  }
}

async function executeTimezone(args) {
  const { timezone } = args;
  if (!timezone) return { isError: true, text: "Missing 'timezone' parameter." };

  try {
    if (timezone.toLowerCase() === "list") {
      const resp = await webFetch("https://worldtimeapi.org/api/timezone", WEB_FETCH_TIMEOUT);
      if (!resp.ok) return { isError: true, text: `WorldTimeAPI returned HTTP ${resp.status}` };
      const zones = await resp.json();
      return { isError: false, text: JSON.stringify({ timezones: zones }) };
    }

    const url = `https://worldtimeapi.org/api/timezone/${encodeURIComponent(timezone)}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);

    if (resp.status === 404) return { isError: true, text: `Timezone "${timezone}" not found. Use timezone "list" to see available timezones.` };
    if (!resp.ok) return { isError: true, text: `WorldTimeAPI returned HTTP ${resp.status}` };

    const data = await resp.json();
    return {
      isError: false,
      text: JSON.stringify({
        timezone: data.timezone,
        datetime: data.datetime,
        utcOffset: data.utc_offset,
        dayOfWeek: data.day_of_week,
        weekNumber: data.week_number,
      }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Timezone lookup failed: ${msg}` };
  }
}

async function executeCountryInfo(args) {
  const { name } = args;
  if (!name) return { isError: true, text: "Missing 'name' parameter." };

  try {
    const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,population,region,subregion,currencies,languages,flags,timezones,area`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);

    if (resp.status === 404) return { isError: true, text: `Country "${name}" not found.` };
    if (!resp.ok) return { isError: true, text: `REST Countries API returned HTTP ${resp.status}` };

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { isError: true, text: `No country found for "${name}".` };
    }

    const country = data[0];
    const currencies = country.currencies
      ? Object.entries(country.currencies).map(([code, c]) => ({ code, name: c.name, symbol: c.symbol }))
      : [];
    const languages = country.languages
      ? Object.values(country.languages)
      : [];

    return {
      isError: false,
      text: JSON.stringify({
        name: country.name?.common || name,
        officialName: country.name?.official || "",
        capital: Array.isArray(country.capital) ? country.capital : [],
        population: country.population,
        region: country.region,
        subregion: country.subregion || "",
        currencies,
        languages,
        flag: country.flags?.emoji || country.flags?.png || "",
        timezones: country.timezones || [],
        area: country.area,
      }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Country lookup failed: ${msg}` };
  }
}

async function executeOpenLibrary(args) {
  const { query, maxResults } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const limit = Math.min(Math.max(maxResults || 5, 1), 20);

  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `Open Library returned HTTP ${resp.status}` };

    const data = await resp.json();
    const results = (data.docs || []).slice(0, limit).map(doc => ({
      title: doc.title || "",
      author: Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "",
      firstPublished: doc.first_publish_year || null,
      isbn: Array.isArray(doc.isbn) ? doc.isbn[0] : null,
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 5) : [],
    }));

    return {
      isError: false,
      text: JSON.stringify({ query, results }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Open Library search failed: ${msg}` };
  }
}

function executeCodeRunner(args) {
  const { code, timeout } = args;
  if (!code) return { isError: true, text: "Missing 'code' parameter." };

  const vm = require("vm");
  const maxTimeout = Math.min(Math.max(timeout || 5000, 100), 10000);

  const logs = [];
  const mockConsole = {
    log: (...a) => logs.push(a.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(" ")),
    warn: (...a) => logs.push("[warn] " + a.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(" ")),
    error: (...a) => logs.push("[error] " + a.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(" ")),
    info: (...a) => logs.push(a.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(" ")),
  };

  const sandbox = {
    console: mockConsole,
    Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp,
    Map, Set, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    undefined, NaN, Infinity,
    setTimeout: undefined, // blocked
    setInterval: undefined, // blocked
    fetch: undefined, // blocked
    require: undefined, // blocked
    process: undefined, // blocked
  };

  const startMs = Date.now();
  try {
    const result = vm.runInNewContext(code, sandbox, { timeout: maxTimeout, filename: "code_runner.js" });
    const elapsed = Date.now() - startMs;

    let resultStr;
    try {
      resultStr = result === undefined ? "undefined" : JSON.stringify(result);
    } catch {
      resultStr = String(result);
    }

    return {
      isError: false,
      text: JSON.stringify({
        result: resultStr,
        logs,
        executionTimeMs: elapsed,
      }),
    };
  } catch (err) {
    const elapsed = Date.now() - startMs;
    return {
      isError: true,
      text: JSON.stringify({
        error: err.message,
        logs,
        executionTimeMs: elapsed,
      }),
    };
  }
}

async function executeUrlMetadata(args) {
  const { url } = args;
  if (!url) return { isError: true, text: "Missing 'url' parameter." };

  try {
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `HTTP ${resp.status}: ${resp.statusText}` };

    const html = await resp.text();

    // Extract various meta tags
    const title = extractTitle(html) || "";
    const getMetaContent = (nameOrProp) => {
      // Match both name= and property= attributes
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']*)["']`, "i");
      const m = html.match(re);
      if (m) return m[1];
      // Also try content before name/property
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${nameOrProp}["']`, "i");
      const m2 = html.match(re2);
      return m2 ? m2[1] : "";
    };

    const ogTitle = getMetaContent("og:title");
    const ogDesc = getMetaContent("og:description");
    const ogImage = getMetaContent("og:image");
    const ogSiteName = getMetaContent("og:site_name");
    const ogType = getMetaContent("og:type");
    const metaDesc = getMetaContent("description");

    // Favicon
    const faviconM = html.match(/<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']*)["']/i);
    let favicon = faviconM ? faviconM[1] : "";
    if (favicon && !favicon.startsWith("http")) {
      try {
        favicon = new URL(favicon, url).href;
      } catch { /* keep as-is */ }
    }

    return {
      isError: false,
      text: JSON.stringify({
        url,
        title: ogTitle || title,
        description: ogDesc || metaDesc,
        image: ogImage,
        siteName: ogSiteName,
        type: ogType,
        favicon,
      }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out after 10 seconds" : err.message;
    return { isError: true, text: `Failed to fetch metadata from ${url}: ${msg}` };
  }
}

async function executeRssReader(args) {
  const { url, maxItems } = args;
  if (!url) return { isError: true, text: "Missing 'url' parameter." };

  const limit = Math.min(Math.max(maxItems || 10, 1), 50);

  try {
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);
    if (!resp.ok) return { isError: true, text: `HTTP ${resp.status}: ${resp.statusText}` };

    const xml = await resp.text();

    // Detect if RSS or Atom
    const isAtom = /<feed\b/i.test(xml);
    const items = [];

    // Extract feed title
    let feedTitle = "";
    if (isAtom) {
      const ftM = xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
      feedTitle = ftM ? ftM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    } else {
      const ftM = xml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
      feedTitle = ftM ? ftM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    }

    if (isAtom) {
      // Atom: <entry> elements
      const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
      let match;
      while ((match = entryRe.exec(xml)) !== null && items.length < limit) {
        const e = match[1];
        const titleM = e.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const linkM = e.match(/<link[^>]+href=["']([^"']*)["']/i);
        const summaryM = e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || e.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
        const publishedM = e.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || e.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

        items.push({
          title: titleM ? titleM[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() : "",
          link: linkM ? linkM[1] : "",
          description: summaryM ? extractTextFromHtml((summaryM[1] || summaryM[2] || "").replace(/<!\[CDATA\[|\]\]>/g, "")).slice(0, 300) : "",
          publishedAt: publishedM ? (publishedM[1] || publishedM[2] || "").trim() : "",
        });
      }
    } else {
      // RSS: <item> elements
      const itemRe = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRe.exec(xml)) !== null && items.length < limit) {
        const e = match[1];
        const titleM = e.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const linkM = e.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
        const descM = e.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
        const pubDateM = e.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

        items.push({
          title: titleM ? titleM[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() : "",
          link: linkM ? linkM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "",
          description: descM ? extractTextFromHtml(descM[1].replace(/<!\[CDATA\[|\]\]>/g, "")).slice(0, 300) : "",
          publishedAt: pubDateM ? pubDateM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "",
        });
      }
    }

    return {
      isError: false,
      text: JSON.stringify({ feedTitle, items }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out after 10 seconds" : err.message;
    return { isError: true, text: `RSS reader failed: ${msg}` };
  }
}

async function executeWikipedia(args) {
  const { query, sentences } = args;
  if (!query) return { isError: true, text: "Missing 'query' parameter." };

  const numSentences = Math.min(Math.max(sentences || 5, 1), 20);

  try {
    // Try direct article lookup first
    const articleTitle = query.replace(/\s+/g, "_");
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;
    const resp = await webFetch(url, WEB_FETCH_TIMEOUT);

    if (resp.ok) {
      const data = await resp.json();
      // Truncate summary to requested number of sentences
      let summary = data.extract || "";
      const sentenceEnds = [...summary.matchAll(/[.!?]\s+/g)];
      if (sentenceEnds.length > numSentences && sentenceEnds[numSentences - 1]) {
        summary = summary.slice(0, sentenceEnds[numSentences - 1].index + 1);
      }

      return {
        isError: false,
        text: JSON.stringify({
          title: data.title || query,
          summary,
          url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${articleTitle}`,
          thumbnail: data.thumbnail?.source || null,
          description: data.description || "",
        }),
      };
    }

    // Not found — try search
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&format=json`;
    const searchResp = await webFetch(searchUrl, WEB_FETCH_TIMEOUT);
    if (!searchResp.ok) return { isError: true, text: `Wikipedia API returned HTTP ${searchResp.status}` };

    const searchData = await searchResp.json();
    // opensearch returns [query, [titles], [descriptions], [urls]]
    const titles = searchData[1] || [];
    const descriptions = searchData[2] || [];
    const urls = searchData[3] || [];

    if (titles.length === 0) {
      return { isError: true, text: `No Wikipedia article found for "${query}".` };
    }

    // Fetch the first result's summary
    const firstUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0].replace(/\s+/g, "_"))}`;
    const firstResp = await webFetch(firstUrl, WEB_FETCH_TIMEOUT);

    if (firstResp.ok) {
      const data = await firstResp.json();
      let summary = data.extract || "";
      const sentenceEnds = [...summary.matchAll(/[.!?]\s+/g)];
      if (sentenceEnds.length > numSentences && sentenceEnds[numSentences - 1]) {
        summary = summary.slice(0, sentenceEnds[numSentences - 1].index + 1);
      }

      const relatedTopics = titles.slice(1).map((t, i) => ({
        title: t,
        url: urls[i + 1] || "",
      }));

      return {
        isError: false,
        text: JSON.stringify({
          title: data.title || titles[0],
          summary,
          url: data.content_urls?.desktop?.page || urls[0],
          thumbnail: data.thumbnail?.source || null,
          relatedTopics,
        }),
      };
    }

    // Fallback: return search results without summary
    return {
      isError: false,
      text: JSON.stringify({
        title: titles[0],
        summary: descriptions[0] || "",
        url: urls[0] || "",
        thumbnail: null,
        relatedTopics: titles.slice(1).map((t, i) => ({ title: t, url: urls[i + 1] || "" })),
      }),
    };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Request timed out" : err.message;
    return { isError: true, text: `Wikipedia lookup failed: ${msg}` };
  }
}

// ── Service tool executor ─────────────────────────────────────────────

/**
 * Execute a dynamically registered service tool by POSTing to its proxy URL.
 * The proxy URL points to the Jarble API service proxy which handles auth,
 * rate limiting, circuit breaking, and HMAC signing.
 */
async function executeServiceTool(serviceTool, args) {
  try {
    const http = require("http");
    const https = require("https");

    const url = new URL(serviceTool._proxyUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const bodyJson = JSON.stringify(args);

    return new Promise(function(resolve) {
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyJson),
          // Use gateway token from environment for pod-to-API auth
          "X-Gateway-Token": process.env.OPENCLAW_GATEWAY_TOKEN || "",
          "X-Deployment-Id": process.env.DEPLOYMENT_ID || "",
        },
        timeout: 30000,
      }, function(res) {
        let data = "";
        res.on("data", function(chunk) { data += chunk; });
        res.on("end", function() {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ isError: false, text: data });
          } else {
            resolve({ isError: true, text: "Service call failed (" + res.statusCode + "): " + data.slice(0, 500) });
          }
        });
      });

      req.on("error", function(err) {
        resolve({ isError: true, text: "Service call error: " + err.message });
      });
      req.on("timeout", function() {
        req.destroy();
        resolve({ isError: true, text: "Service call timed out (30s)" });
      });

      req.write(bodyJson);
      req.end();
    });
  } catch (err) {
    return { isError: true, text: "Service tool error: " + err.message };
  }
}

// ── Confirmation tools ────────────────────────────────────────────────

const CONFIRMATIONS_PATH = path.join(WORKSPACE_DIR, "confirmations.json");

function loadConfirmations() {
  try {
    if (fs.existsSync(CONFIRMATIONS_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIRMATIONS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

function saveConfirmations(data) {
  try {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(CONFIRMATIONS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[MCP] Failed to save confirmations:", e.message);
  }
}

function executeConfirmAction(args) {
  var title = args.title;
  var description = args.description;
  var severity = args.severity;
  var actions = args.actions;
  var timeout = args.timeout;
  var metadata = args.metadata;

  if (!title || !description || !severity) {
    return { isError: true, text: "Missing required fields: title, description, severity." };
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    return { isError: true, text: "Must provide at least one action." };
  }
  if (!["info", "warning", "danger"].includes(severity)) {
    return { isError: true, text: "severity must be one of: info, warning, danger." };
  }

  var confirmationId = "conf-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var now = new Date().toISOString();

  // Store confirmation state
  var confirmations = loadConfirmations();
  confirmations[confirmationId] = {
    confirmationId: confirmationId,
    title: title,
    description: description,
    severity: severity,
    actions: actions,
    timeout: timeout || null,
    metadata: metadata || null,
    status: "pending",
    createdAt: now,
    respondedAt: null,
    actionId: null,
  };
  saveConfirmations(confirmations);

  // Emit a jarble_ui block for the confirmation card
  var block = JSON.stringify({
    component: "confirmation",
    props: {
      title: title,
      description: description,
      severity: severity,
      actions: actions,
      confirmationId: confirmationId,
      timeout: timeout || undefined,
      status: "pending",
      metadata: metadata || undefined,
    },
  });

  return {
    isError: false,
    text: "```jarble_ui\n" + block + "\n```\n\nConfirmation requested. Waiting for user response. confirmationId=" + confirmationId,
  };
}

function executeCheckConfirmation(args) {
  var confirmationId = args.confirmationId;
  if (!confirmationId) {
    return { isError: true, text: "Missing required field: confirmationId." };
  }

  var confirmations = loadConfirmations();
  var record = confirmations[confirmationId];
  if (!record) {
    return { isError: true, text: "Confirmation '" + confirmationId + "' not found." };
  }

  // Check timeout expiry
  if (record.status === "pending" && record.timeout) {
    var createdMs = new Date(record.createdAt).getTime();
    var expiresMs = createdMs + (record.timeout * 1000);
    if (Date.now() > expiresMs) {
      record.status = "expired";
      record.respondedAt = new Date().toISOString();
      confirmations[confirmationId] = record;
      saveConfirmations(confirmations);
    }
  }

  return {
    isError: false,
    text: JSON.stringify({
      confirmationId: record.confirmationId,
      status: record.status,
      actionId: record.actionId,
      respondedAt: record.respondedAt,
    }),
  };
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
    case "render_page": return executeRenderPage(args || {});
    case "create_component": return executeCreateComponent(args || {});
    // Service hosting tools
    case "start_http_service": return executeStartHttpService(args || {});
    case "stop_http_service": return executeStopHttpService(args || {});
    case "list_http_services": return executeListHttpServices();
    case "publish_to_marketplace": return executePublishToMarketplace(args || {});
    case "register_service": return executeRegisterService(args || {});
    // Marketplace browse/install tools
    case "browse_marketplace": return executeBrowseMarketplace(args || {});
    case "get_marketplace_item": return executeGetMarketplaceItem(args || {});
    case "install_marketplace_item": return executeInstallMarketplaceItem(args || {});
    case "uninstall_marketplace_item": return executeUninstallMarketplaceItem(args || {});
    case "list_installed_marketplace": return executeListInstalledMarketplace();
    case "publish_component": return executePublishComponent(args || {});
    case "create_draft_service": return executeCreateDraftService(args || {});
    // Agent marketplace tools
    case "discover_agents": return executeDiscoverAgents(args || {});
    case "call_agent": return executeCallAgent(args || {});
    case "set_theme": return executeSetTheme(args || {});
    case "update_design_context": return executeUpdateDesignContext(args || {});
    // Web & Search tools
    case "web_fetch": return executeWebFetch(args || {});
    case "web_search": return executeWebSearch(args || {});
    case "hacker_news": return executeHackerNews(args || {});
    case "github_search": return executeGithubSearch(args || {});
    case "npm_search": return executeNpmSearch(args || {});
    case "academic_search": return executeAcademicSearch(args || {});
    case "news_search": return executeNewsSearch(args || {});
    case "search_images": return executeImageSearch(args || {});
    // Reference & Data tools
    case "dictionary": return executeDictionary(args || {});
    case "currency_exchange": return executeCurrencyExchange(args || {});
    case "timezone": return executeTimezone(args || {});
    case "country_info": return executeCountryInfo(args || {});
    case "open_library": return executeOpenLibrary(args || {});
    // Utility tools
    case "code_runner": return executeCodeRunner(args || {});
    case "url_metadata": return executeUrlMetadata(args || {});
    case "rss_reader": return executeRssReader(args || {});
    case "wikipedia": return executeWikipedia(args || {});
    // Human-in-the-loop confirmation tools
    case "confirm_action": return executeConfirmAction(args || {});
    case "check_confirmation": return executeCheckConfirmation(args || {});
    // Knowledge base tools
    case "knowledge_search": return executeKnowledgeSearch(args || {});
    case "list_knowledge": return executeListKnowledge();
    case "delete_knowledge": return executeDeleteKnowledge(args || {});
    default:
      // Per-component tools: show_chart, show_data_table, etc.
      // The tool's arguments ARE the props directly (not wrapped in {component, props}).
      if (name.startsWith("show_")) {
        const component = name.slice(5); // "show_chart" -> "chart"
        return executeRenderUi({ component, props: args || {} });
      }

      // Dynamic service tools: svc_weather_forecast, svc_stock_price, etc.
      // These are registered from /data/config/service-tools.json and dispatch
      // to the installed service's proxy URL.
      if (name.startsWith("svc_")) {
        const serviceTool = SERVICE_TOOLS.find(function(t) { return t.name === name; });
        if (serviceTool) {
          return executeServiceTool(serviceTool, args || {});
        }
      }

      // Agent delegation tools: delegate_to_data_agent, delegate_to_workflow_agent, etc.
      if (name.startsWith("delegate_to_")) {
        const agentTool = AGENT_TOOLS.find(function(t) { return t.name === name; });
        if (agentTool) {
          return executeAgentTool(agentTool, args || {});
        }
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

  // List tools — includes core TOOLS + per-component show_* + service tools + agent tools
  if (method === "tools/list") {
    // Build MCP tool definitions from loaded service tools
    const serviceToolDefs = SERVICE_TOOLS.map(function(t) {
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      };
    });
    // Build agent tool definitions (static)
    const agentToolDefs = AGENT_TOOLS.map(function(t) {
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      };
    });
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: [...TOOLS, ...PER_COMPONENT_TOOLS, ...serviceToolDefs, ...agentToolDefs] },
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
