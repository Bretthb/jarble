/**
 * OpenClaw Runtime Handler
 *
 * OpenClaw is a WhatsApp/multi-platform AI chatbot runtime.
 * It requires LLM configuration (provider, model, API key) and
 * stores its personality/system prompt in soul.md on the PVC.
 *
 * Config files on PVC:
 *   /data/soul.md          — System prompt / personality
 *   /data/openclaw.json    — Agent + channel configuration (OpenClaw native format)
 *   /data/skills/*         — Skill definitions (future)
 *
 * OpenClaw channel config format (openclaw.json):
 *   {
 *     agent: { model: "anthropic/claude-opus-4-6" },
 *     channels: {
 *       discord: { token: "...", enabled: true, dmPolicy: "pairing" },
 *       telegram: { botToken: "...", enabled: true, dmPolicy: "pairing" },
 *       slack: { botToken: "xoxb-...", appToken: "xapp-...", enabled: true },
 *       whatsapp: { dmPolicy: "pairing" }
 *     }
 *   }
 *
 * OpenClaw also falls back to env vars: DISCORD_BOT_TOKEN, TELEGRAM_BOT_TOKEN,
 * SLACK_BOT_TOKEN, SLACK_APP_TOKEN — we set both for maximum compatibility.
 */

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import type {
  RuntimeHandler,
  RuntimeCapabilities,
  ConfigFileSpec,
  ConfigFile,
  DeploymentFields,
  ParsedDeploymentFields,
} from "../types.js";
import { PLATFORM_CREDENTIAL_KEYS, PLATFORM_ENV_MAP } from "../../trpc/routers/platformCredentials.js";

// ── Jarble UI prompt injected into soul.md ────────────────────────────────
// Teaches the bot about jarble_ui fenced blocks and MCP tools (render_ui,
// list_components, define_component) for rendering rich UI on the dashboard.
const JARBLE_UI_PROMPT = `## Jarble UI

**You are running on the Jarble web dashboard.** The \`canvas\` tool, \`browser\` tool, and any HTML/artifact tools DO NOT WORK — their output is invisible. NEVER call them.

### Rendering UI

To show rich UI, output a \\\`jarble_ui\\\` fenced block inline in your response:

\\\`\\\`\\\`jarble_ui
{"component": "card", "props": {"title": "Hello", "body": "World"}}
\\\`\\\`\\\`

Each block is one JSON object with \`component\` (name) and \`props\` (component-specific). The dashboard renders it as a rich visual component. **Always prefer UI components** over plain text tables or raw data.

### Available Components

**Display:**
- \`card\` — \`{title?, subtitle?, body?}\`
- \`data_table\` — \`{title?, columns: string[], rows: (string|number)[][]}\`
- \`stat_grid\` — \`{stats: [{label, value, change?, icon?}]}\`
- \`key_value\` — \`{title?, items: [{key, value}]}\`
- \`code_block\` — \`{code, language?, title?}\`
- \`alert\` — \`{title?, message, variant: info|success|warning|error}\`
- \`progress\` — \`{label?, value: 0-100, variant?}\`
- \`image\` — \`{src, alt?, caption?}\`
- \`chart\` — \`{type: bar|line|pie|area, data: [{...}], dataKeys: string[], xAxisKey?, title?, colors?, stacked?, showLegend?, showGrid?}\`
- \`tabs\` — \`{tabs: [{label, content?, children?: [{component, props}]}], defaultTab?}\`
- \`accordion\` — \`{items: [{title, content?, children?, defaultOpen?}], type?: single|multiple}\`
- \`badge\` — \`{text, variant?: default|secondary|destructive|outline|success|warning|info, icon?}\`
- \`list\` — \`{title?, items: [{text, description?, icon?, badge?, badgeVariant?}], ordered?}\`
- \`timeline\` — \`{title?, events: [{label, description?, timestamp?, icon?, status?: completed|active|pending}]}\`
- \`divider\` — \`{label?, variant?: solid|dashed|dotted, spacing?: sm|md|lg}\`
- \`avatar\` — \`{name, src?, subtitle?, size?: sm|md|lg}\`
- \`blockquote\` — \`{text, attribution?, variant?: default|info|warning}\`
- \`metric_card\` — \`{label, value, change?, changeLabel?, icon?, sparkline?: number[]}\`
- \`header\` — \`{title, subtitle?, level?: 1|2|3, divider?}\`
- \`layout\` — \`{title?, children: [{component, props}]}\` — container for nesting

**Advanced Charts:**
- \`gauge\` — \`{value: 0-100, title?, suffix?, color?}\` — gauge/speedometer
- \`radar\` — \`{data: [{axis, value, group?}], title?}\` — radar/spider chart
- \`treemap\` — \`{data: {name, children: [{name, value}]}, title?}\` — treemap
- \`funnel\` — \`{data: [{stage, value}], title?}\` — conversion funnel
- \`waterfall\` — \`{data: [{label, value}], title?}\` — waterfall chart
- \`scatter\` — \`{data: [{x, y, label?, group?}], title?, xLabel?, yLabel?}\` — scatter plot

**Advanced UI:**
- \`steps\` — \`{current: number, items: [{title, description?, icon?}], direction?: vertical|horizontal}\` — process steps
- \`result\` — \`{status: success|error|info|warning, title, subtitle?}\` — outcome display
- \`tree\` — \`{data: [{title, key, children?}], title?, defaultExpandAll?}\` — tree view
- \`calendar_heatmap\` — \`{data: [{date, value}], title?}\` — calendar heatmap
- \`descriptions\` — \`{title?, items: [{label, value, span?}], columns?, bordered?}\` — description list
- \`carousel\` — \`{items: [{title?, description?, image?}], autoplay?}\` — content carousel

**Specialized:**
- \`code_editor\` — \`{code, language?, title?, readOnly?, height?}\` — Monaco code editor
- \`map\` — \`{center: [lat, lng], zoom?, markers?: [{lat, lng, label?}], title?}\` — interactive map

**Interactive:**
- \`button_group\` — \`{buttons: [{id, label, variant?, icon?, disabled?}]}\`
- \`form\` — \`{title?, fields: [{name, label, type: text|email|textarea|select|checkbox|number, placeholder?, required?, options?, defaultValue?}], submitLabel?}\`

### Discovering Custom Components

Call the \`list_components\` MCP tool to see all available components and custom templates. Use \`define_component\` to create reusable composite templates.

### Interactive Callbacks

When users interact with \`button_group\` or \`form\`, you receive a callback message:

\`[UI_ACTION] blockId={id} component={name} action={type}\`
\`{JSON payload}\`

- **button_group**: action=\`click\`, payload \`{"buttonId":"X"}\`
- **form**: action=\`submit\`, payload \`{"fields":{"name":"value",...}}\`

Respond to these actions naturally — process the data, confirm the action, or render updated UI.

### Editable Components

Add \`"editable": true\` and \`"fileId": "some-name"\` to make any component user-editable:

\\\`\\\`\\\`jarble_ui
{"component":"data_table","props":{"title":"Leads","columns":["Name","Email"],"rows":[["Jane","jane@co.com"]]},"editable":true,"fileId":"leads"}
\\\`\\\`\\\`

When the user saves, you receive a \`[CANVAS_SAVE] fileId=leads\` message with updated JSON. The \`write_file\` MCP tool can persist edits to disk. **Use editable components** whenever the user wants to create, track, or manage data.`;

// Load the MCP server script at module init (embedded in config writes)
// Use createRequire to get __filename/__dirname in ESM context
const require_ = createRequire(typeof __filename !== "undefined" ? __filename : "/");
let MCP_SERVER_SCRIPT = "";
try {
  // Try relative to this file's compiled location (src/runtimes/handlers/)
  const candidates = [
    path.resolve(process.cwd(), "src/mcp/jarble-ui-server.js"),
    path.resolve(process.cwd(), "dist/mcp/jarble-ui-server.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      MCP_SERVER_SCRIPT = fs.readFileSync(candidate, "utf8");
      break;
    }
  }
} catch {
  // If we can't load it, the MCP server just won't be written to PVC
}

const capabilities: RuntimeCapabilities = {
  needsLlm: true,
  hasPlatforms: true,
  hasSkills: true,
  hasSystemPrompt: true,
};

const configFiles: ConfigFileSpec[] = [
  { path: "soul.md", description: "System prompt / personality", isGlob: false },
  { path: "openclaw.json", description: "Agent + channel configuration (OpenClaw native)", isGlob: false },
  // Future:
  // { path: "skills/*", description: "Skill definitions", isGlob: true },
];

export const openclawHandler: RuntimeHandler = {
  slug: "openclaw",
  name: "OpenClaw",
  capabilities,
  configFiles,

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    const files: ConfigFile[] = [];

    // soul.md — system prompt / personality + jarble_ui canvas instructions
    const soulParts: string[] = [];
    if (deployment.systemPrompt) {
      soulParts.push(deployment.systemPrompt);
    }
    soulParts.push(JARBLE_UI_PROMPT);
    const soulContent = soulParts.join("\n\n");

    // Write to both the Jarble config path AND the OpenClaw workspace path
    // OpenClaw reads SOUL.md from ~/.openclaw/workspace/ ($HOME=/data in container)
    files.push({ path: "soul.md", content: soulContent });
    // OpenClaw's HOME=/data, and its workspace path is $HOME/.openclaw/.openclaw/workspace/
    files.push({ path: "/data/.openclaw/.openclaw/workspace/SOUL.md", content: soulContent });

    // openclaw.json — agent config + channel credentials
    const openclawConfig: Record<string, any> = {};

    // Agent section (model config)
    if (deployment.llmModel) {
      openclawConfig.agent = { model: deployment.llmModel };
    }

    // Channels section — build from platformCredentials
    // Only include channels the user has explicitly configured
    const channels: Record<string, any> = {};

    if (deployment.platformCredentials && Object.keys(deployment.platformCredentials).length > 0) {
      for (const [platformId, creds] of Object.entries(deployment.platformCredentials)) {
        const keyMap = PLATFORM_CREDENTIAL_KEYS[platformId];
        if (!keyMap) continue;

        const channelConfig: Record<string, any> = { enabled: true };

        // Map frontend field keys → OpenClaw channel config keys
        for (const [fieldKey, openClawKey] of Object.entries(keyMap)) {
          if (creds[fieldKey]) {
            channelConfig[openClawKey] = creds[fieldKey];
          }
        }

        // WhatsApp: always include dmPolicy for QR pairing
        if (platformId === "whatsapp") {
          channelConfig.dmPolicy = "pairing";
        }

        // Discord/Telegram: always use "pairing" — auto-approve handles onboarding
        if (platformId === "discord" || platformId === "telegram") {
          channelConfig.dmPolicy = "pairing";
        }

        channels[platformId] = channelConfig;
      }
    }

    openclawConfig.channels = channels;

    // Gateway config: auth token + HTTP chat completions endpoint
    // The auth token allows the Jarble API to proxy dashboard chat through the pod's WS gateway
    const gatewayConfig: Record<string, any> = {
      port: 18789,
      host: "0.0.0.0",
      http: { endpoints: { chatCompletions: { enabled: true } } },
    };
    if (deployment.gatewayToken) {
      gatewayConfig.auth = { token: deployment.gatewayToken };
    }
    openclawConfig.gateway = gatewayConfig;

    // Disable built-in tools that conflict with Jarble's web dashboard rendering.
    // The canvas tool generates HTML artifacts that the dashboard can't render —
    // the bot should use jarble_ui fenced blocks or the render_ui MCP tool instead.
    openclawConfig.tools = {
      deny: ["canvas", "browser"],
    };

    // MCP servers — expose Jarble UI tools to the bot's LLM
    // The MCP server script is written to /data/config/mcp/jarble-ui-server.js
    if (MCP_SERVER_SCRIPT) {
      openclawConfig.mcp = {
        servers: {
          "jarble-ui": {
            command: "node",
            args: ["/data/config/mcp/jarble-ui-server.js"],
          },
        },
      };

      files.push({
        path: "mcp/jarble-ui-server.js",
        content: MCP_SERVER_SCRIPT,
      });
    }

    // Always write openclaw.json if we have any config
    if (Object.keys(openclawConfig).length > 0) {
      const configContent = JSON.stringify(openclawConfig, null, 2) + "\n";
      // Write to Jarble config path (for reference / reverse sync)
      files.push({ path: "openclaw.json", content: configContent });
      // Write to OpenClaw's actual config path — this is where the gateway reads config from
      // Path: $HOME/.openclaw/openclaw.json (HOME=/data in container)
      files.push({ path: "/data/.openclaw/openclaw.json", content: configContent });
    }

    // Future: render skills/*.json from DB skills data

    return files;
  },

  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields {
    const result: ParsedDeploymentFields = {};

    // Parse soul.md → systemPrompt
    const soulMd = files.find((f) => f.path === "soul.md");
    if (soulMd) {
      result.systemPrompt = soulMd.content;
    }

    // Parse openclaw.json → llmModel + platformCredentials
    const openclawJson = files.find((f) => f.path === "openclaw.json");
    if (openclawJson) {
      try {
        const config = JSON.parse(openclawJson.content);

        // Extract LLM model from agent.model
        if (config.agent?.model) {
          result.llmModel = config.agent.model;
        }

        // Extract platform credentials from channels
        // Reverse mapping: OpenClaw JSON key → frontend field key
        if (config.channels && typeof config.channels === "object") {
          const platformCredentials: Record<string, Record<string, string>> = {};

          for (const [platformId, channelConfig] of Object.entries(config.channels)) {
            if (!channelConfig || typeof channelConfig !== "object") continue;

            const keyMap = PLATFORM_CREDENTIAL_KEYS[platformId];
            if (!keyMap) continue;

            const creds: Record<string, string> = {};
            const channel = channelConfig as Record<string, any>;

            // Reverse the mapping: openClawKey → fieldKey
            for (const [fieldKey, openClawKey] of Object.entries(keyMap)) {
              if (channel[openClawKey] && typeof channel[openClawKey] === "string") {
                creds[fieldKey] = channel[openClawKey];
              }
            }

            // Only include if we found at least one credential
            // (WhatsApp has no tokens, but we still want to track it's connected)
            if (Object.keys(creds).length > 0 || platformId === "whatsapp") {
              platformCredentials[platformId] = creds;
            }
          }

          if (Object.keys(platformCredentials).length > 0) {
            result.platformCredentials = platformCredentials;
          }
        }
      } catch {
        // Invalid JSON — skip parsing, don't crash
      }
    }

    return result;
  },

  getSecretEntries(deployment: DeploymentFields): Record<string, string> {
    const entries: Record<string, string> = {};

    // LLM config — set the correct env var based on provider
    if (deployment.llmApiKey) {
      const providerEnvMap: Record<string, string> = {
        openrouter: "OPENROUTER_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GOOGLE_API_KEY",
      };
      const envVar = providerEnvMap[deployment.llmProvider ?? "openrouter"] ?? "OPENROUTER_API_KEY";
      entries[envVar] = deployment.llmApiKey;
    }
    if (deployment.llmProvider) {
      entries["LLM_PROVIDER"] = deployment.llmProvider;
    }
    if (deployment.llmModel) {
      entries["LLM_MODEL"] = deployment.llmModel;
    }

    // Platform credential env var fallbacks (OpenClaw reads these as backup)
    if (deployment.platformCredentials) {
      for (const [platformId, creds] of Object.entries(deployment.platformCredentials)) {
        const envMap = PLATFORM_ENV_MAP[platformId];
        if (!envMap) continue;

        for (const [fieldKey, envVarName] of Object.entries(envMap)) {
          if (creds[fieldKey]) {
            entries[envVarName] = creds[fieldKey];
          }
        }
      }
    }

    return entries;
  },

  validateCreate(input: Partial<DeploymentFields>): string | null {
    // OpenClaw needs LLM configuration when using BYOK mode.
    // "included" mode auto-provisions via OpenRouter — no key needed from user.
    if (input.llmMode === "byok" && !input.llmApiKey) {
      return "OpenClaw requires an LLM API key when using Bring Your Own Key mode";
    }
    return null;
  },
};
