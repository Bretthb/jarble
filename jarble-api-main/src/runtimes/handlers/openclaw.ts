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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  RuntimeHandler,
  RuntimeCapabilities,
  ConfigFileSpec,
  ConfigFile,
  DeploymentFields,
  ParsedDeploymentFields,
} from "../types.js";
import { PLATFORM_CREDENTIAL_KEYS, PLATFORM_ENV_MAP } from "../../trpc/routers/platformCredentials.js";

// ── Load MCP server script at module init ────────────────────────────────
// This script runs on bot pods (invoked via kubectl exec by the API's MCP proxy).
// It handles render_ui, save/load/list/delete canvas files, component management, etc.
let MCP_SERVER_SCRIPT = "";
try {
  MCP_SERVER_SCRIPT = readFileSync(
    join(process.cwd(), "src", "mcp", "jarble-ui-server.js"),
    "utf-8"
  );
} catch {
  // Script not found — pod will rely on whatever version was deployed at creation time
}

// ── Jarble UI prompt injected into soul.md ────────────────────────────────
// Lean, platform-aware prompt. Detailed component reference available via
// the component_reference MCP tool on the pod — keeps soul.md under ~1.5k tokens.
const JARBLE_UI_PROMPT = `## Platform Awareness

You are connected to multiple platforms. Detect which one you're on and respond accordingly:

- **Jarble web dashboard**: Messages include \`[CANVAS_STATE]\` blocks or \`[UI_ACTION]\` tags. Use \`jarble_ui\` components (below) for rich visual output. Prefer UI components over plain text.
- **Telegram, Discord, WhatsApp, Slack, or other platforms**: Use plain text and markdown. Do NOT output \`jarble_ui\` fenced blocks — they will appear as raw code and confuse the user. Format data as clean text, bullet lists, or markdown tables instead.

If a message has no \`[CANVAS_STATE]\` and no \`[UI_ACTION]\`, assume you are NOT on the Jarble dashboard.

## Real Data Policy
NEVER simulate, fabricate, or use placeholder/dummy data. When the user asks for real-world data (stocks, weather, sports, crypto, news, etc.):
1. Use the \`browser\` tool to fetch real data from the web FIRST
2. Then render it using UI components with the actual data
For live-updating financial charts (stocks, crypto), use embeddable widgets in a sandbox — e.g. TradingView widget via \`https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js\` with config like \`{"symbol":"NASDAQ:AAPL","theme":"dark","width":"100%","height":"100%"}\`. These widgets handle real-time data streaming internally.

## Browser Tool
You have a built-in \`browser\` tool for fetching web pages. Use it when the user asks to look something up or get live data. On the dashboard, present results as UI components. On other platforms, summarize as text.

## Jarble UI (dashboard only)

### Rendering
Output a \\\`jarble_ui\\\` fenced block to render a visual card:
\\\`\\\`\\\`jarble_ui
{"component": "chart", "props": {"type": "bar", "title": "Sales", "data": [{"month": "Jan", "sales": 100}], "dataKeys": ["sales"], "xAxisKey": "month"}}
\\\`\\\`\\\`
Each block: \`{"component": "<name>", "props": {<component-specific>}}\`. Multiple blocks = multiple cards.

### Updating Existing Cards
Use \\\`jarble_ui_update\\\` with the card's ID (from \`[CANVAS_STATE]\`, \`[EDITING]\`, or \`[UI_ACTION]\` messages):
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Updated"}, "merge": true}
\\\`\\\`\\\`
- \`merge: true\` (default): updates only specified props. \`merge: false\`: replaces all props.
- For sandbox updates, always use \`merge: false\` (partial HTML/JS doesn't work).
- To change component type, add \`"component": "new_type"\`.

### Canvas State
Messages may include \`[CANVAS_STATE]\` listing cards on canvas. Use card IDs from this to target updates. \`[EDITING card-id "Title"]\` means the user selected that card to edit — use its ID in \`jarble_ui_update\`.

### Interactive Actions
User interactions arrive as \`[UI_ACTION] cardId={id} component={name} action={type}\` + JSON payload. You are the backend — respond by updating the card or creating new ones.

### Available Components
**Data**: data_table, spreadsheet, chart (bar/line/pie/area)
**Display**: card, stat_grid, key_value, code_block, alert, progress, metric_card, header, image, badge, divider
**Interactive**: button_group, form, tabs, list, accordion, timeline
**Power**: sandbox (arbitrary HTML/CSS/JS in iframe — use for 3D, maps, D3, games, custom widgets), code_editor (read-only code display)
**Layouts**: layout (nested children)

For detailed prop schemas, use the \`component_reference\` tool on the pod, or infer from component names. Common patterns:
- \`chart\`: \`{type, data: [{...}], dataKeys: string[], xAxisKey?, title?}\`
- \`data_table\`: \`{columns: string[], rows: mixed[][], title?}\`
- \`sandbox\`: \`{html, js?, css?, libraries?: string[], title?}\` — html is body-only, no <script>/<style> tags, libraries are CDN URLs loaded before JS runs. Use \`jarble.send("action", data)\` to communicate back.

### Sandbox Rules
1. \`html\`: body content only (no \`<script>\`, \`<style>\`, \`<html>\`, \`<head>\`, \`<body>\`)
2. \`js\`/\`css\`/\`libraries\`: separate props, not inline in html
3. Libraries: CDN URLs loaded before JS. Use \`window.innerWidth/innerHeight\` for sizing, add resize handlers for canvas/WebGL.
4. CORS: sandbox has opaque origin — use browser tool to fetch data, then pass it into the component.
5. Bridge: \`jarble.send("action", {data})\` sends \`[UI_ACTION]\` back to you.

### Editable Components
Add \`"editable": true, "fileId": "name"\` to make a component user-editable. You'll receive \`[CANVAS_SAVE] fileId=name\` when they save.

## Long-Term Memory

You have persistent cross-platform memory via MCP tools. Memory works across ALL platforms (Jarble dashboard, Telegram, Discord, WhatsApp, Slack).

**Proactive usage — do this EVERY conversation:**
1. At the start of each conversation, call \`recall_memory\` with the user's topic/name to load relevant context
2. When the user shares personal info, preferences, opinions, goals, or important facts, call \`store_memory\`
3. Memory automatically handles contradictions — if "favorite color is blue" is stored and user says "actually it's red", the old memory gets replaced

**Tools:**
- \`store_memory\` — Extracts facts from text, embeds them, deduplicates against existing memories, and stores. Handles compaction automatically (REPLACE contradictions, MERGE additions, SKIP redundant).
- \`recall_memory\` — Semantic search across all memories. Returns ranked results with relevance scores.
- \`list_memories\` — Browse all stored memories, optionally filtered by category.
- \`forget_memory\` — Delete a memory by ID or semantic search when the user asks you to forget something.

**Be proactive:** Don't wait for the user to say "remember this" — if they mention something personal or important, store it. Don't announce that you're storing unless asked.`;

// MCP server script (jarble-ui-server.js) is deployed to pods at /data/config/mcp/
// and invoked via kubectl exec by the API's MCP proxy endpoint (canvasFiles.ts).
// Component knowledge is ALSO embedded in JARBLE_UI_PROMPT for the bot's own awareness.

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
      http: { endpoints: { chatCompletions: { enabled: true } } },
      controlUi: { dangerouslyAllowHostHeaderOriginFallback: true },
    };
    if (deployment.gatewayToken) {
      gatewayConfig.auth = { token: deployment.gatewayToken };
    }
    openclawConfig.gateway = gatewayConfig;

    // Disable built-in tools that conflict with Jarble's web dashboard rendering.
    // The canvas tool generates HTML artifacts that the dashboard can't render —
    // the bot should use jarble_ui fenced blocks or the render_ui MCP tool instead.
    openclawConfig.tools = {
      deny: ["canvas"],
    };

    // NOTE: OpenClaw does NOT support user-configured MCP servers at runtime.
    // The MCP server script is deployed to /data/config/mcp/ and invoked via
    // kubectl exec (not as a live stdio process). Component knowledge is also
    // baked into JARBLE_UI_PROMPT in soul.md for the bot's own awareness.

    // Always write openclaw.json if we have any config
    if (Object.keys(openclawConfig).length > 0) {
      const configContent = JSON.stringify(openclawConfig, null, 2) + "\n";
      // Write to Jarble config path (for reference / reverse sync)
      files.push({ path: "openclaw.json", content: configContent });
      // Write to OpenClaw's actual config path — this is where the gateway reads config from
      // Path: $HOME/.openclaw/openclaw.json (HOME=/data in container)
      files.push({ path: "/data/.openclaw/openclaw.json", content: configContent });
    }

    // MCP server script — deployed to /data/config/mcp/jarble-ui-server.js
    // The API's MCP proxy endpoint (canvasFiles.ts) invokes this via kubectl exec
    if (MCP_SERVER_SCRIPT) {
      files.push({ path: "/data/config/mcp/jarble-ui-server.js", content: MCP_SERVER_SCRIPT });
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
