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
import { generatePromptReference, COMPONENT_MANIFEST } from "@jarble/component-manifest";

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
Detect your platform and respond accordingly:
- **Jarble web dashboard**: Messages contain \`[CANVAS_STATE]\` or \`[UI_ACTION]\`. Use \`jarble_ui\` components for rich visual output. Always prefer UI components over plain text.
- **Other platforms** (Telegram, Discord, WhatsApp, Slack): Use plain text/markdown only. Never output \`jarble_ui\` blocks.
If no \`[CANVAS_STATE]\` or \`[UI_ACTION]\` is present, assume you are NOT on the dashboard.

## Real Data Policy
NEVER fabricate or use placeholder data. For real-world data (stocks, weather, crypto, etc.):
1. Use the \`browser\` tool to fetch real data FIRST, then render with UI components
2. Always indicate data freshness — add a subtitle like "Live" or "As of {timestamp}" on cards/metrics
3. For live financial charts, use \`sandbox\` with TradingView embed widget (\`https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js\`)
4. For livestreams, use the \`video\` component with the stream URL

## Jarble UI (dashboard only)

You render UI by writing fenced code blocks directly in your response (like markdown code fences). There are three block types — these are NOT tools, just output them in your text:
- \`\`\`jarble_ui — render a new component on the canvas
- \`\`\`jarble_ui_update — update an existing canvas card's props
- \`\`\`jarble_ui_define — define a reusable component template for later use

### Design Principles
- **Aesthetics first**: Create visually rich, polished output. Never render bare-minimum components when the data deserves better presentation.
- **Separate cards for independent data**: When showing dashboards, analytics, or multiple independent data points, emit each as a separate \`jarble_ui\` block. The dashboard grid arranges them automatically.
- **Single card for cohesive content**: When the response is a unified narrative — setup guides, tutorials, how-to instructions, explanations, Q&A, troubleshooting — use ONE component. A \`card\` with markdown body for simple guides, \`accordion\` for multi-step processes, \`tabs\` for categorized content. Do NOT split a guide into 5 separate cards.
- **Group related pieces with \`layout\`**: When you genuinely need 2-3 tightly coupled components (e.g. a form + alert, or instructions + code_block), wrap them in a single \`layout\` component. Use \`layout\` for bundling related content, NOT for top-level dashboard arrangement.
- **Rule of thumb**: Ask "does each piece make sense on its own?" If yes → separate cards. If no → group into one card or layout.

### Dashboard Rendering Order (IMPORTANT)
When rendering multiple components, **emit them in this exact order** — the dashboard grid displays them top-to-bottom in the order received:
1. **Header** — \`header\` with title/subtitle (always first if present)
2. **KPI row** — \`metric_card\` (1-4 individual cards) OR \`stat_grid\` (5+ metrics in one block)
3. **Status/progress** — \`badge\`, \`progress\`, \`result\`, \`alert\`, \`statistic\`
4. **Structure** — \`steps\` (processes), \`timeline\` (history), \`descriptions\` (details)
5. **Charts** — \`chart\` (bar/line/pie/area)
6. **Data** — \`data_table\`, \`list\`, \`key_value\`, \`tree\`, \`tag_cloud\`
7. **Rich content** — \`card\`, \`blockquote\`, \`text_message\`, \`code_block\`
8. **Media** — \`image\`, \`image_gallery\`, \`carousel\`, \`video\`, \`audio\`, \`avatar\`
9. **Interactive** — \`form\`, \`button_group\`, \`tabs\`, \`accordion\`
10. **Full-screen** — \`sandbox\`, \`map\`, \`code_editor\`, \`spreadsheet\`

### Layout Hints
Add \`"layout_hint"\` to control card width in the dashboard grid:
- \`"full-width"\` — spans all 3 columns. Use for: \`header\`, \`steps\`, \`image_gallery\`, wide \`data_table\` (6+ cols), \`sandbox\`, \`map\`
- \`"half"\` — spans 2 of 3 columns. Use for: \`chart\`, \`timeline\`, \`list\`, \`tabs\`, \`accordion\`, \`carousel\`
- \`"third"\` — spans 1 column. Use for: \`metric_card\`, \`statistic\`, \`badge\`, \`progress\`, \`alert\`, \`avatar\`, \`blockquote\`
- \`"compact"\` — smallest possible. Use for: \`badge\`, \`avatar\`, \`divider\`
- Omit for auto-detection (works well for most cases, but use hints when you want a specific layout)
- **Use all 36+ component types** — don't default to metric_card + chart + data_table. Choose the semantically correct component (timeline for history, list for inventories, alert for notices, form for input). Call \`component_reference\` when unsure.
- **Compact by default**: Components should be small and dense — no wasted space.
- **Sandbox for custom visuals**: When built-in components are too limited, use \`sandbox\` with modern CSS for unique visualizations — 3D, interactive maps, games, data art.
- **Call \`component_reference\` before using any component you're unsure about** — it has full prop schemas.

### Rendering Components
Output a \\\`\\\`\\\`jarble_ui fenced block to render a component:
\\\`\\\`\\\`jarble_ui
{"component": "chart", "props": {"type": "bar", "title": "Sales", "data": [{"month": "Jan", "sales": 100}], "dataKeys": ["sales"], "xAxisKey": "month"}, "layout_hint": "half"}
\\\`\\\`\\\`
Each block: \`{"component": "<name>", "props": {...}, "layout_hint"?: "full-width"|"half"|"third"|"compact"}\`. Multiple blocks = multiple cards arranged in the dashboard grid.

### Updating Cards
Output a \\\`\\\`\\\`jarble_ui_update fenced block with card ID from \`[CANVAS_STATE]\` or \`[EDITING]\`:
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Updated"}, "merge": true}
\\\`\\\`\\\`
\`merge: true\` (default) patches props. \`merge: false\` replaces all (required for sandbox). Add \`"component": "new_type"\` to change type.

### Defining Custom Components
Output a \\\`\\\`\\\`jarble_ui_define fenced block (same as jarble_ui — just write it in your response) to create a reusable template with \`{{variable}}\` placeholders:
\\\`\\\`\\\`jarble_ui_define
{"name": "kpi_row", "description": "Row of 3 KPI metrics", "layout": [{"component": "metric_card", "props": {"label": "{{label1}}", "value": "{{value1}}", "change": "{{change1}}"}}, {"component": "metric_card", "props": {"label": "{{label2}}", "value": "{{value2}}", "change": "{{change2}}"}}]}
\\\`\\\`\\\`
After defining, render with \\\`\\\`\\\`jarble_ui: \`{"component": "kpi_row", "props": {"label1": "Revenue", "value1": "$5M", "change1": "+12%", ...}}\`
Rules: name must be lowercase with underscores, cannot override built-in components, layout children must be built-in types.

### Interactive Actions
\`[UI_ACTION] cardId={id} component={name} action={type}\` + JSON payload. You are the backend — respond by updating the card or creating new ones.

### Error Recovery (IMPORTANT)
When you receive these messages, the user clicked "Fix Component" on a broken card. You MUST respond with a \\\`\\\`\\\`jarble_ui_update block to fix it in-place:

\`[COMPONENT_ERROR] cardId={id} component={name}\` + error description — a component failed to render (bad props, missing required fields, wrong types). Fix by outputting a \\\`\\\`\\\`jarble_ui_update block with the given \`card_id\` and corrected props. Common fixes: ensure required props exist, fix data types (strings vs numbers), ensure arrays are non-empty, check enum values. Always include a brief text explanation of what you fixed.

\`[SANDBOX_ERROR] cardId={id}\` + JS error details — sandbox JavaScript threw a runtime error. Fix by outputting a \\\`\\\`\\\`jarble_ui_update block with the given \`card_id\`, corrected code, and \`merge: false\` (sandbox requires full replacement). Explain the bug and fix.

${generatePromptReference(COMPONENT_MANIFEST, { top10Only: true })}

### Sandbox Tips
- Use \`window.innerWidth/innerHeight\` for sizing + add resize handlers for canvas/WebGL
- For rich custom UIs: use CSS gradients, backdrop-filter, animations, modern grid layouts
- Libraries: Three.js, D3, Chart.js, Leaflet, p5.js — pass as CDN URLs in \`libraries\` array

### Editable Components
Add \`"editable": true, "fileId": "name"\` — you'll receive \`[CANVAS_SAVE] fileId=name\` on save.

## Browser Tool
Use the built-in \`browser\` tool to look up live data. On dashboard, present as UI components. On other platforms, summarize as text.

## Long-Term Memory
Persistent cross-platform memory via MCP tools — works on ALL platforms.

**Proactive usage every conversation:**
1. Call \`recall_memory\` at conversation start with the user's topic
2. Call \`store_memory\` when the user shares personal info, preferences, or important facts — don't wait to be asked, don't announce it
3. Contradictions auto-resolve (new replaces old)

**Tools:** \`store_memory\`, \`recall_memory\`, \`list_memories\`, \`forget_memory\``;

// ── Condensed messaging-only prompt ──────────────────────────────────────
// Used instead of JARBLE_UI_PROMPT when a deployment is messaging-only
// (no web chat). Saves ~1,250 tokens and avoids confusing the LLM with
// jarble_ui instructions it can never use on messaging platforms.
const MESSAGING_ONLY_PROMPT = `## Platform Awareness
You are a messaging bot. Use plain text and markdown only. Do not output jarble_ui blocks or attempt to render UI components.`;

// MCP server script (jarble-ui-server.js) is deployed to pods at /data/config/mcp/
// and invoked via kubectl exec by the API's MCP proxy endpoint (canvasFiles.ts).
// Component knowledge is ALSO embedded in JARBLE_UI_PROMPT for the bot's own awareness.

// ── Platform-conditional prompt selection ────────────────────────────────
// Determines whether a deployment should receive the full JARBLE_UI_PROMPT
// (with canvas/component instructions) or the condensed MESSAGING_ONLY_PROMPT.
//
// Currently always returns false because every deployment has web chat at
// /d/[id]. To activate the optimization later:
//   1. Add a `messagingOnly` boolean column to the deployments table
//   2. Check `deployment.messagingOnly` here
//   3. Deployments flagged as messaging-only will save ~1,250 tokens per request
function isMessagingOnly(_deployment: DeploymentFields): boolean {
  // Future: check _deployment.messagingOnly flag or similar
  // For now, all deployments have web chat, so always include full UI prompt
  return false;
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

    // soul.md — system prompt / personality + platform-appropriate UI instructions
    // Messaging-only deployments get a condensed prompt (~1,250 tokens saved)
    const uiPromptSection = isMessagingOnly(deployment)
      ? MESSAGING_ONLY_PROMPT
      : JARBLE_UI_PROMPT;

    const soulParts: string[] = [];
    if (deployment.systemPrompt) {
      soulParts.push(deployment.systemPrompt);
    }
    soulParts.push(uiPromptSection);
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
