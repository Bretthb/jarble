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
 *   /data/skills/*         — Skill definitions (one JSON file per installed skill)
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
import { createModuleLogger } from "../../utils/logger.js";
import { PLATFORM_CREDENTIAL_KEYS, PLATFORM_ENV_MAP } from "../../trpc/routers/platformCredentials.js";
import { generatePromptReference, COMPONENT_MANIFEST } from "@jarble/component-manifest";

const log = createModuleLogger("runtime:openclaw");

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
// Core rendering instructions + anti-pattern prevention. Detailed component
// selection guidance available on-demand via the `skill_reference` MCP tool.
const JARBLE_UI_PROMPT = `## Platform Awareness
Detect your platform and respond accordingly:
- **Jarble web dashboard**: Messages contain \`[CANVAS_STATE]\` or \`[UI_ACTION]\`. Use \`jarble_ui\` components for rich visual output. Always prefer UI components over plain text.
- **Other platforms** (Telegram, Discord, WhatsApp, Slack): Use plain text/markdown only. Never output \`jarble_ui\` blocks.
If no \`[CANVAS_STATE]\` or \`[UI_ACTION]\` is present, assume you are NOT on the dashboard.

## Real Data Policy
NEVER fabricate or use placeholder data. Use the \`browser\` tool to fetch real data FIRST, then render. Always indicate freshness — add a subtitle like "Live" or "As of {timestamp}".

## Jarble UI (dashboard only)

Render UI by writing fenced code blocks in your response. Three block types:
- \`\`\`jarble_ui — render a new component on the canvas
- \`\`\`jarble_ui_update — update an existing canvas card's props
- \`\`\`jarble_ui_define — define a reusable component template

### Rendering
\\\`\\\`\\\`jarble_ui
{"component": "chart", "props": {"type": "bar", "title": "Sales", "data": [{"month": "Jan", "sales": 100}], "dataKeys": ["sales"], "xAxisKey": "month"}, "layout_hint": "half"}
\\\`\\\`\\\`
Each block: \`{"component": "<name>", "props": {...}, "layout_hint"?: "full-width"|"half"|"third"|"compact"}\`. Multiple blocks = multiple cards in the grid.

### Updating Cards
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Updated"}, "merge": true}
\\\`\\\`\\\`
\`merge: true\` (default) patches props. \`merge: false\` replaces all (required for sandbox). Add \`"component": "new_type"\` to change type.

### Design Principles
- **Separate cards for independent data** — dashboards, analytics, multiple metrics. Grid arranges them.
- **Single card for cohesive content** — guides, tutorials, Q&A. Use \`card\` (markdown body), \`accordion\`, or \`tabs\`.
- **Rule of thumb**: "Does each piece make sense alone?" Yes → separate. No → one card or \`layout\`.
- **Compact by default**. No wasted space. Use all 37 component types — don't default to metric_card + chart + data_table.
- **Sandbox is LAST RESORT** — only for 3D, games, custom animations, novel visualizations. NEVER for tables, charts, code, forms, maps.

### Component Chooser
| Want | Use | NOT |
|---|---|---|
| editable table / spreadsheet | \`spreadsheet\` | sandbox |
| read-only table | \`data_table\` | sandbox |
| code editor | \`code_editor\` | sandbox |
| chart / graph | \`chart\` | sandbox |
| map / location | \`map\` | sandbox |
| form / user input | \`form\` | sandbox |
| third-party widget | \`embed\` | sandbox |
| 3D / game / custom viz | \`sandbox\` | — |

Call \`component_reference\` before using any component you're unsure about. Call \`skill_reference\` for detailed rendering guides.

### Layout Hints (3-column grid)
- \`"full-width"\` (3 cols): header, steps, wide data_table (6+ cols), sandbox, map
- \`"half"\` (2 cols): chart, timeline, list, tabs, accordion, carousel
- \`"third"\` (1 col): metric_card, statistic, badge, progress, alert
- \`"compact"\`: badge, avatar, divider

### Dashboard Rendering Order
Emit in this order — grid displays top-to-bottom: header → KPIs (metric_card/stat_grid) → status → charts → data → content → media → interactive → full-screen

### Common Prop Mistakes (IMPORTANT — avoid these)

**Chart data format** — Use recharts format, NOT Chart.js:
✅ \`{"data": [{"month": "Jan", "sales": 100}], "dataKeys": ["sales"], "xAxisKey": "month"}\`
❌ \`{"labels": ["Jan"], "datasets": [{"label": "Sales", "data": [100]}]}\`
- \`dataKeys\` = numeric fields to plot. \`xAxisKey\` = category/label field. Both effectively required.
- Chart types: \`bar\`, \`line\`, \`pie\`, \`area\` ONLY. For stacked: add \`stacked: true\`. For multi-line: add multiple \`dataKeys\`.

**data_table rows** — Must be arrays, NOT objects:
✅ \`{"columns": ["Name", "Age"], "rows": [["Alice", 30], ["Bob", 25]]}\`
❌ \`{"columns": ["Name", "Age"], "rows": [{"Name": "Alice", "Age": 30}]}\`

**Field names that differ from intuition:**
- card: \`body\` (not content) | alert: \`message\` (not description)
- metric_card/stat_grid: \`label\` (not name) | image: \`src\` (not url)
- list/steps/accordion: \`items\` (not data) | timeline: \`events\` (not data/items)
- tabs: \`tabs\` (not data/sections) | form: \`submitLabel\` (not submitText)
- tree: \`title\` + \`key\` (not name/label) | text_message: \`botText\`/\`userText\`
- map center: \`[lat, lng]\` tuple (not object) | form select options: flat strings (not objects)

**Enums — use exact values:**
- variant: \`default\`, \`secondary\`, \`destructive\`, \`outline\`, \`info\`, \`success\`, \`warning\` (NEVER: primary, danger, error, or color names)
- size: \`sm\`, \`md\`, \`lg\` (not small/medium/large)

**Sandbox CDN allowlist** — ONLY these origins load:
cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, cdn.tailwindcss.com, esm.sh, threejs.org, d3js.org, cdn.plot.ly, fonts.googleapis.com, fonts.gstatic.com. Any other origin is silently blocked.

### Interactive Actions
\`[UI_ACTION] cardId={id} component={name} action={type}\` + JSON payload. You are the backend — respond by updating the card or creating new ones.

### Error Recovery
\`[COMPONENT_ERROR] cardId={id} component={name}\` — Fix with a \\\`\\\`\\\`jarble_ui_update block using the given card_id and corrected props.
\`[SANDBOX_ERROR] cardId={id}\` — Fix with a \\\`\\\`\\\`jarble_ui_update block, corrected code, and \`merge: false\`.

${generatePromptReference(COMPONENT_MANIFEST, { top10Only: true })}

### Sandbox Essentials
- \`html\`: Body HTML ONLY (no script/style/html/head/body tags — stripped by sanitizer)
- \`css\`: All styles | \`js\`: All JavaScript (runs AFTER libraries load) | \`libraries\`: CDN URLs
- Use \`merge: false\` for ALL sandbox updates
- Bridge: \`jarble.storage.get/set/delete\`, \`jarble.events.on/emit\`, \`jarble.canvas.resize/setTitle\`, \`jarble.send(action, payload)\`, \`window.__JARBLE_PROPS__\`
- Theme: use \`@media (prefers-color-scheme: dark)\` CSS + \`background: transparent\`

### Workspace Persistence
Check \`list_artifacts()\` at conversation start. Acknowledge saved items. Save substantial components with \`save_artifact\` (\`pinned: true\` for auto-restore). For live data, set \`dataSource\` with \`pollInterval\`.

### Memory
\`store_memory\` / \`recall_memory\` / \`list_memories\` / \`forget_memory\` — cross-platform. Proactively recall at conversation start, store when user shares preferences/facts.`;

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
function isMessagingOnly(deployment: DeploymentFields): boolean {
  return deployment.messagingOnly === true;
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
  { path: "skills/*", description: "Skill definitions", isGlob: true },
];

export const openclawHandler: RuntimeHandler = {
  slug: "openclaw",
  name: "OpenClaw",
  capabilities,
  configFiles,

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    log.debug({ deploymentId: deployment.name }, "renderConfigs");
    const files: ConfigFile[] = [];

    // Compute container HOME based on management mode (affects absolute paths)
    // Legacy: HOME=/data, Operator: HOME=/home/openclaw
    const managedBy = deployment.managedBy ?? "legacy";
    const home = managedBy === "operator" ? "/home/openclaw" : "/data";

    // soul.md — system prompt / personality + platform-appropriate UI instructions
    // Messaging-only deployments get a condensed prompt (~1,250 tokens saved)
    const uiPromptSection = isMessagingOnly(deployment)
      ? MESSAGING_ONLY_PROMPT
      : JARBLE_UI_PROMPT;

    const soulParts: string[] = [];

    // Identity: let the bot know its own name
    if (deployment.name) {
      soulParts.push(`# ${deployment.name}\nYou are ${deployment.name}.`);
    }

    if (deployment.systemPrompt) {
      soulParts.push(deployment.systemPrompt);
    }

    // Append instruction snippets from installed services
    // Each snippet is wrapped in a labeled section so it can be cleanly identified
    // and removed when the service is uninstalled (next syncConfigsToPvc excludes it).
    if (deployment.packageSnippets && deployment.packageSnippets.length > 0) {
      for (const ps of deployment.packageSnippets) {
        soulParts.push(`## Service: ${ps.packageName}\n${ps.snippet}`);
      }
    }

    // Append installed marketplace components so the bot knows what's available
    if (deployment.installedComponents && deployment.installedComponents.length > 0) {
      const lines = deployment.installedComponents.map((c) =>
        `- **${c.name}** — ${c.description}`
      );
      soulParts.push(
        `## Installed Marketplace Components\nYou have the following custom components installed. To use them, output a \`\`\`jarble_ui\`\`\` block with \`"component"\` set to the name below — they work exactly like built-in components. Call \`component_reference\` with the component name for full prop details.\n\n**IMPORTANT:** Do NOT use \`load_artifact\` or \`save_artifact\` for marketplace components. Just use \`render_ui\` / jarble_ui blocks directly. Artifacts are a separate persistence system for user-saved dashboards.\n${lines.join("\n")}`
      );
    }

    soulParts.push(uiPromptSection);
    const soulContent = soulParts.join("\n\n");

    // Write to both the Jarble config path AND the OpenClaw workspace path
    // OpenClaw reads SOUL.md from $HOME/.openclaw/.openclaw/workspace/
    files.push({ path: "soul.md", content: soulContent });
    files.push({ path: `${home}/.openclaw/.openclaw/workspace/SOUL.md`, content: soulContent });

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
      // Path: $HOME/.openclaw/openclaw.json
      files.push({ path: `${home}/.openclaw/openclaw.json`, content: configContent });
    }

    // MCP server script — deployed to {pvcMount}/config/mcp/jarble-ui-server.js
    // Relative path so writeConfigsToPvc prefixes with correct PVC mount.
    if (MCP_SERVER_SCRIPT) {
      files.push({ path: "mcp/jarble-ui-server.js", content: MCP_SERVER_SCRIPT });
    }

    // Render installed skills as individual JSON files under /data/skills/
    // For remote/hybrid package skills, inject a `proxyUrl` field so OpenClaw
    // routes tool calls through the Jarble API proxy rather than calling the
    // creator's endpoint directly (the proxy handles HMAC signing + rate limits).
    if (deployment.skills && deployment.skills.length > 0) {
      for (const skill of deployment.skills) {
        // Sanitize skill name for use as filename (lowercase, alphanumeric + hyphens)
        const safeName = skill.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

        // Check if there is a remote proxy config for this skill name
        const remoteConfig = deployment.remoteSkillConfigs?.find(
          (rc) => rc.skillName === skill.name
        );

        let skillContent = skill.config;
        if (remoteConfig) {
          try {
            const skillJson = JSON.parse(skill.config);
            skillJson.proxyUrl = remoteConfig.proxyUrl;
            skillContent = JSON.stringify(skillJson);
          } catch (err) {
            log.warn(
              { skillName: skill.name, proxyUrl: remoteConfig.proxyUrl, err },
              "renderConfigs: failed to inject proxyUrl into skill config (non-fatal, using original)"
            );
          }
        }

        files.push({
          path: `skills/${safeName}.json`,
          content: skillContent,
        });
      }
    }

    log.info({ fileCount: files.length }, "renderConfigs complete");
    return files;
  },

  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields {
    log.debug({ fileCount: files.length }, "parseConfigs");
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
      } catch (err) {
        log.warn({ err }, "parseConfigs: invalid openclaw.json");
      }
    }

    return result;
  },

  getSecretEntries(deployment: DeploymentFields): Record<string, string> {
    log.debug({ provider: deployment.llmProvider }, "getSecretEntries");
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

    // Gateway token duplicate key for operator compatibility.
    // Operator reads `token` key from the Secret; legacy reads OPENCLAW_GATEWAY_TOKEN.
    // Adding `token` is harmless for legacy mode.
    if (deployment.gatewayToken) {
      entries["token"] = deployment.gatewayToken;
    }

    // Operator mode: set env vars so the MCP server inside the pod uses correct PVC paths
    // (jarble-ui-server.js reads these; defaults to /data/... for legacy mode)
    if (deployment.managedBy === "operator") {
      entries["JARBLE_COMPONENTS_DIR"] = "/home/openclaw/.openclaw/components";
      entries["JARBLE_FILES_DIR"] = "/home/openclaw/.openclaw/files";
      entries["JARBLE_MEMORY_DIR"] = "/home/openclaw/.openclaw/memory";
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

    log.debug({ entryCount: Object.keys(entries).length }, "getSecretEntries complete");
    return entries;
  },

  validateCreate(input: Partial<DeploymentFields>): string | null {
    // OpenClaw needs LLM configuration when using BYOK mode.
    // "included" mode auto-provisions via OpenRouter — no key needed from user.
    if (input.llmMode === "byok" && !input.llmApiKey) {
      const error = "OpenClaw requires an LLM API key when using Bring Your Own Key mode";
      log.warn({ error }, "validateCreate failed");
      return error;
    }
    return null;
  },
};
