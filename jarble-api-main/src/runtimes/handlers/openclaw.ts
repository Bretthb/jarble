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
// Teaches the bot about jarble_ui fenced blocks AND the mcporter MCP bridge
// so it can render rich UI components on the Jarble web dashboard.
const JARBLE_UI_PROMPT = `## Jarble UI — You MUST Use This

**CRITICAL: You are running on the Jarble web dashboard, NOT in a terminal.** The \`canvas\` tool and \`browser\` tool DO NOT WORK HERE — they will always fail. NEVER call them. Instead, you MUST use \`\`\`jarble_ui\`\`\` fenced code blocks to render UI. This is the ONLY way to show visual content to the user.

Use jarble_ui proactively in every response where visual presentation would help. Do NOT output plain text tables, lists of numbers, or status information as raw text — always render them as rich UI components.

### How to Render UI

Include a \\\`jarble_ui\\\` fenced code block in your response. The dashboard renders it as a rich interactive component:

\\\`\\\`\\\`jarble_ui
{"component": "card", "props": {"title": "Hello", "body": "World"}}
\\\`\\\`\\\`

You can mix multiple UI blocks with regular text in a single response. **Default to using UI components** — they make your responses dramatically more useful.

### When to Use Each Component

| Situation | Component |
|-----------|-----------|
| Greeting or intro | \`card\` with title + body |
| Numbers, KPIs, metrics | \`stat_grid\` |
| Tabular data, lists, comparisons | \`data_table\` |
| Config, settings, key-value pairs | \`key_value\` |
| Code snippets | \`code_block\` |
| Warnings, errors, success messages | \`alert\` |
| Progress or completion | \`progress\` |
| Multi-section dashboards | \`layout\` with children |

### Component Reference

- **card**: \`{"component":"card","props":{"title":"...","subtitle":"...","body":"..."}}\`
- **data_table**: \`{"component":"data_table","props":{"title":"...","columns":["A","B"],"rows":[["1","2"]]}}\`
- **stat_grid**: \`{"component":"stat_grid","props":{"stats":[{"label":"Users","value":42,"change":"+5%"}]}}\`
- **key_value**: \`{"component":"key_value","props":{"title":"Info","items":[{"key":"Status","value":"OK"}]}}\`
- **code_block**: \`{"component":"code_block","props":{"title":"Example","language":"js","code":"console.log('hi')"}}\`
- **alert**: \`{"component":"alert","props":{"variant":"success","title":"Done","message":"All good"}}\` (variants: info, success, warning, error)
- **progress**: \`{"component":"progress","props":{"label":"Upload","value":75}}\`
- **image**: \`{"component":"image","props":{"src":"https://...","alt":"...","caption":"..."}}\`
- **layout**: \`{"component":"layout","props":{"title":"Dashboard","children":[{"component":"stat_grid","props":{...}},{"component":"data_table","props":{...}}]}}\`

### Editable Components

Add \`"editable": true\` and \`"fileId": "some-name"\` to make any component editable by the user.
When the user saves, their edits are sent back to you as a chat message prefixed with \`[CANVAS_SAVE]\`.
You can acknowledge the edit, store the data, or push it to an integration.

Example — editable table:
\`\`\`
{"component":"data_table","props":{"title":"My Leads","columns":["Name","Email","Status"],"rows":[["Jane","jane@co.com","New"]]},"editable":true,"fileId":"leads"}
\`\`\`

Example — editable card:
\`\`\`
{"component":"card","props":{"title":"Meeting Notes","body":"..."},"editable":true,"fileId":"notes"}
\`\`\`

When a user saves an editable component, you'll receive a message like:
\`[CANVAS_SAVE] fileId=leads\`
\`{"component":"data_table","props":{"title":"My Leads","columns":["Name","Email","Status"],"rows":[["Jane","jane@co.com","Contacted"]]}}\`

Acknowledge the save and update your data accordingly. **Always use editable components** when the user asks to create, track, or manage data — spreadsheets, notes, dashboards, etc.

### Component Library

You have a pre-built library of composite components on disk. **Always call \`list_components\` first** to see what's available before building UI from scratch. Library components combine primitives into reusable templates (dashboard, invoice, sprint_board, etc.).

- Render any library component with \`render_ui\` — pass the template variables as props
- Modify or create new composites with \`define_component\`
- All library components use {{variable}} placeholders — list_components shows the full definition`;

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
    files.push({ path: "/data/.openclaw/workspace/SOUL.md", content: soulContent });

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
