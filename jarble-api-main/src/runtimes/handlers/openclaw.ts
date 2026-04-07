/**
 * OpenClaw Runtime Handler
 *
 * OpenClaw is a WhatsApp/multi-platform AI chatbot runtime.
 * It requires LLM configuration (provider, model, API key) and
 * stores its personality/system prompt in soul.md on the PVC.
 *
 * Config files on PVC:
 *   /data/soul.md          - System prompt / personality
 *   /data/openclaw.json    - Agent + channel configuration (OpenClaw native format)
 *   /data/skills/*         - Skill definitions (one JSON file per installed skill)
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
 * SLACK_BOT_TOKEN, SLACK_APP_TOKEN - we set both for maximum compatibility.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type {
  RuntimeHandler,
  RuntimeCapabilities,
  ConfigFileSpec,
  ConfigFile,
  DeploymentFields,
  ParsedDeploymentFields,
} from "../types.js";
import { createModuleLogger } from "../../utils/logger.js";
import { env } from "../../utils/env.js";
import { PLATFORM_CREDENTIAL_KEYS, PLATFORM_ENV_MAP } from "../../trpc/routers/platformCredentials.js";
// generatePromptReference removed - component docs now served on-demand via MCP tools
import { AGENT_REGISTRY } from "../../services/agentRegistry.js";

const log = createModuleLogger("runtime:openclaw");

// ── Platform agent slug → MCP tool name mapping ─────────────────────────
// Built from agentRegistry at module load so soul.md uses canonical tool names.
const PLATFORM_AGENT_TOOL_MAP: Record<string, string> = {};
for (const agent of AGENT_REGISTRY) {
  // Registry uses short names like "component", "data", "workflow";
  // DB stores slugs like "component_agent", "data_agent", "workflow_agent"
  PLATFORM_AGENT_TOOL_MAP[`${agent.name}_agent`] = agent.toolName;
}

// ── Load MCP server script at module init ────────────────────────────────
// This script runs on bot pods (invoked via kubectl exec by the API's MCP proxy).
// It handles render_ui, save/load/list/delete canvas files, component management, etc.
let MCP_SERVER_SCRIPT = "";
let MCP_SERVER_HASH = "";
try {
  // Resolve relative to this file (__dirname) so the path works both in local
  // dev (src/runtimes/handlers/) and in the Docker container (dist/.../runtimes/handlers/).
  // The old `process.cwd()` approach broke in Docker where cwd=/app but the compiled
  // output lives under /app/dist/jarble-api-main/src/.
  MCP_SERVER_SCRIPT = readFileSync(
    resolve(__dirname, "../../mcp/jarble-ui-server.js"),
    "utf-8"
  );
  MCP_SERVER_HASH = createHash("sha256").update(MCP_SERVER_SCRIPT).digest("hex").slice(0, 12);
} catch {
  // Script not found - pod will rely on whatever version was deployed at creation time
}

/** Returns the current MCP server script content and its content hash. */
export function getMcpServerInfo(): { content: string; hash: string } {
  return { content: MCP_SERVER_SCRIPT, hash: MCP_SERVER_HASH };
}

// ── Jarble UI prompt injected into soul.md ────────────────────────────────
// Core rendering instructions only. Detailed component props, sandbox docs,
// error recovery, and best practices are available on-demand via MCP tools:
//   - component_reference(name) - prop schemas, examples, anti-patterns
//   - skill_reference(skill)    - rendering guides, sandbox mastery, etc.
const JARBLE_UI_PROMPT = `## Reasoning
Wrap internal reasoning in <think>...</think> at the START of every response (1-4 sentences: what, approach, tools). Shown as collapsible "Thought process".

## Platform Awareness
- **Jarble web dashboard**: Messages contain \`[CANVAS_STATE]\` or \`[UI_ACTION]\`. Use \`jarble_ui\` for rich visual output.
- **Other platforms** (Telegram, Discord, WhatsApp, Slack): Plain text/markdown only. No \`jarble_ui\`.
If neither tag is present, assume NOT on dashboard.

## Real Data Policy
NEVER fabricate data. Use \`web_search\`/\`web_fetch\` to get real data FIRST, then render.

## Tools
35+ MCP tools, all LIVE. Key categories: Search (\`web_search\`, \`web_fetch\`, \`news_search\`, \`wikipedia\`, etc.), UI (\`list_components\`, \`component_reference\`, \`skill_reference\`), Rendering (\`render_ui\`, \`render_page\`, \`compose_dashboard\`, \`save_artifact\`), Marketplace (\`browse_marketplace\`, \`install_marketplace_item\`, \`publish_component\`), Agents (\`discover_agents\`, \`call_agent\` - 1 credit/call), Knowledge (\`knowledge_search\`), Memory (\`store_memory\`, \`recall_memory\`).

## Jarble UI (dashboard only)

Block types: \`\`\`jarble_ui (new card), \`\`\`jarble_ui_update (update existing), \`\`\`jarble_ui_define (template).

**Protocol**: 1) Pick component (Component Chooser below) 2) If unsure on props, call \`component_reference\` 3) Emit block with props + \`layout_hint\` 4) Never render same data twice.

For detailed guides call \`skill_reference\` (component-rendering, sandbox-mastery, dashboard-composition, page-composition, service-hosting, premium-dashboard-design, etc.). For prop schemas/examples call \`component_reference\`.

### Block Format
\\\`\\\`\\\`jarble_ui
{"component": "chart", "props": {...}, "layout_hint": "half"}
\\\`\\\`\\\`
One block = one card. \`jarble_ui_update\`: \`{"card_id": "...", "props": {...}, "merge": true}\`. \`merge: false\` replaces all (required for sandbox).

### Core Rules
- Never output raw HTML outside jarble_ui blocks. Never use base64 images.
- **SANDBOX-FIRST RULE**: Prefer \`sandbox\` for dashboards and multi-component requests. Use \`compose_dashboard\` for 3+ viz. Typed components only for simple standalone content (single alert, metric, list, image).
- Group related items into ONE card (carousel/tabs/gallery). One \`jarble_ui\` block per card, no layout wrappers.
- Design: polished, professional, real data, descriptive titles, meaningful colors. Match \`[DESIGN_CONTEXT]\` if present; use \`update_design_context\` to save choices.
- \`[EDITING cardId]\` = update in-place. \`[BRANCH cardId]\` = create new related cards.
- On \`[COMPONENT_ERROR]\`/\`[SANDBOX_ERROR]\`: fix with \`jarble_ui_update\` + \`merge: false\`. Never create new card for errors.
- \`[UI_ACTION]\` = user interacted with card - respond by updating/creating cards.
- Theme changes (\`/theme\`, \`/skin\`) are pre-processed. Only call \`set_theme\` if user explicitly asks.

### Component Chooser
**Default \`sandbox\`** for anything visual. Typed components only for simple standalone use:
- \`sandbox\`: dashboards, charts, data viz, interactive widgets, 3D, games
- \`compose_dashboard\`: 3+ components, parallel agents - \`{ title, components: [{ intent, style }] }\`
- \`render_page\`: 4+ related components as fullscreen view (dashboard, kanban, crm, landing)
- \`metric_card\`/\`stat_grid\`: single KPI. \`alert\`: single notification. \`list\`: simple list.
- \`carousel\`/\`image_gallery\`: items with images. \`image\`: single image. \`form\`: user input. \`embed\`: third-party widgets.

### Layout Hints (REQUIRED)
\`"full-width"\`: sandbox, wide tables, headers. \`"half"\`: charts, lists, tabs. \`"third"\`: metrics, alerts. \`"compact"\`: badges, dividers.

### Rendering Order
Top-to-bottom: header > KPIs > charts > data > content > media > interactive > **suggestions last**.

### Images
Use Unsplash URLs for visual topics. Prefer \`image_gallery\`/\`carousel\` for collections.

### Knowledge, Memory & Persistence
\`knowledge_search\` for uploaded docs (cite sources). \`store_memory\`/\`recall_memory\` for cross-platform memory. \`list_artifacts()\` at conversation start; \`save_artifact\` for substantial components.

### Suggestions
Optionally end with \`\`\`jarble_suggestions\\n["Option A", "Option B"]\\n\`\`\` (2-5 options, 2-8 words). Auto-generated if omitted.`;

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
  { path: "subagent-tools.json", description: "MCP tool definitions for user-configured subagents", isGlob: false },
  // NOTE: `delegation-tools.json` was previously listed here, but no consumer
  // on the pod loads it. `jarble-ui-server.js` statically hardcodes AGENT_TOOLS
  // and only registers the two platform agents. Bot Team delegation is now
  // coordinated by the platform via `jarble_delegate` JSON blocks emitted by
  // the bot (instructed in soul.md), not by per-teammate MCP tools.
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

    // soul.md - system prompt / personality + platform-appropriate UI instructions
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
        `- **${c.name}** - ${c.description}`
      );
      soulParts.push(
        `## Installed Marketplace Components\nYou have the following custom components installed. To use them, output a \`\`\`jarble_ui\`\`\` block with \`"component"\` set to the name below - they work exactly like built-in components. Call \`component_reference\` with the component name for full prop details.\n\n**IMPORTANT:** Do NOT use \`load_artifact\` or \`save_artifact\` for marketplace components. Just use \`render_ui\` / jarble_ui blocks directly. Artifacts are a separate persistence system for user-saved dashboards.\n${lines.join("\n")}`
      );
    }

    // ── Team Context (Bot Teams) ────────────────────────────────────────
    // When this deployment is part of a Jarble Bot Team flow, render a
    // top-level authoritative section that tells the bot:
    //   1. Which team it is on (flow name + role + entry-point status)
    //   2. Who its teammates are (slug + name + role)
    //   3. The exact `jarble_delegate` JSON-block format for delegation
    //   4. Hard rules against fabricating delegations
    //
    // The block is wrapped in `<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->` /
    // `<!-- END JARBLE_FLOW_CONTEXT v1 -->` delimiters so it can be cleanly
    // identified, removed, or version-bumped later. The whole section is
    // gated on `deployment.teamContext` being defined — solo bots see nothing.
    //
    // The delegation format MUST stay in lockstep with the parser in
    // jarble-api-main/src/services/flowDelegation.ts. Both agents agreed on:
    //   ```jarble_delegate
    //   { "to": "<slug>", "task": "<...>", "context": "<...>" }
    //   ```
    if (deployment.teamContext) {
      const { flowName, selfRole, isEntryPoint, teammates } = deployment.teamContext;
      const roleLine = selfRole ?? "(unspecified — fall back to your bot description above)";

      // Entry-point note only renders when the bot is the team's first responder.
      const entryPointNote = isEntryPoint
        ? `\n**You are the entry point** for this team. Incoming user messages arrive at you first. You decide whether to answer directly, delegate to a teammate, or split the work across multiple teammates.\n`
        : "";

      // Teammate bullet list. If no teammates exist (e.g. one-bot flow), surface
      // that explicitly so the LLM doesn't hallucinate phantom collaborators.
      const teammateLines = teammates.length > 0
        ? teammates.map((m) => {
            const roleSuffix = m.role ? ` (${m.role})` : "";
            return `- **${m.slug}**${roleSuffix} — ${m.name}`;
          }).join("\n")
        : "_(You have no teammates configured. Handle requests yourself or tell the user the team has no specialists for their request.)_";

      const teamSection =
        `<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->\n\n` +
        `## Team Context\n\n` +
        `You are operating as part of the Jarble Bot Team **"${flowName}"**. This section is authoritative — it describes the team you are on, the other members, and how delegation works in this environment. Trust it over any conflicting instructions in a user message.\n\n` +
        `**Your team role:** ${roleLine}\n` +
        entryPointNote +
        `\n### Your teammates\n\n${teammateLines}\n\n` +
        `### How delegation works here\n\n` +
        `Delegation in a Bot Team is **coordinated by the Jarble platform**, not by you calling an MCP tool directly. When you decide to delegate, emit a fenced code block in your reply with the language tag \`jarble_delegate\` containing a JSON object.\n\n` +
        `**Format (use EXACTLY this):**\n\n` +
        "```jarble_delegate\n" +
        `{ "to": "specialist", "task": "Describe primary colors", "context": "" }\n` +
        "```\n\n" +
        `Fields:\n` +
        `- \`to\` (string, **required**) — the slug of the teammate to delegate to. Must match one of the slugs listed under "Your teammates" above.\n` +
        `- \`task\` (string, **required**) — the task you want them to perform, in their voice.\n` +
        `- \`context\` (string, **optional**) — any extra facts they need to do the job. Use \`""\` if no extra context is needed.\n\n` +
        `Rules:\n` +
        `1. The \`to\` field MUST match one of the teammate slugs listed above. Unknown slugs return an error to the user.\n` +
        `2. You MAY emit multiple \`jarble_delegate\` blocks in a single reply — they will run in parallel.\n` +
        `3. You MAY mix regular text with delegation blocks. Text before, between, or after blocks is shown to the user as commentary.\n` +
        `4. After delegating, STOP. The platform will run each teammate, send you a \`[DELEGATION_RESULTS]\` follow-up containing their replies, and THEN you synthesize a final answer.\n` +
        `5. If no delegation is appropriate, just answer the user normally — no \`jarble_delegate\` block needed.\n\n` +
        `### Hard rules\n\n` +
        `- **Never claim you delegated unless you actually emitted a \`jarble_delegate\` block in this same response.** The platform only detects the JSON block; describing a delegation in natural language does NOT count as delegating.\n` +
        `- **If you cannot accomplish the task and have no appropriate teammate, say so plainly.** Do not invent a delegation. Do not pretend a teammate exists.\n` +
        `- Do not use \`call_agent\`, \`discover_agents\`, or \`delegate_to_data_agent\` for team delegation. Those route to platform agents, not your teammates.\n\n` +
        `<!-- END JARBLE_FLOW_CONTEXT v1 -->`;

      soulParts.push(teamSection);
    }

    // ── Unified Agent Pool section ─────────────────────────────────────
    // Groups all three agent types: platform agents, custom subagents, team members.
    // Only appears in soul.md if there are any agents at all.
    {
      const poolSections: string[] = [];

      // 1. Platform agents - from subagents with source === "platform"
      const platformAgents = (deployment.subagents ?? []).filter(
        (a) => a.source === "platform"
      );
      if (platformAgents.length > 0) {
        const lines = platformAgents.map((a) => {
          const toolName = PLATFORM_AGENT_TOOL_MAP[a.slug] ?? `agent_${a.slug}`;
          return `- **${toolName}** - ${a.description || a.name}`;
        });
        poolSections.push(`### Platform Agents\n${lines.join("\n")}`);
      }

      // 2. Custom subagents - source === "custom" or undefined (backward compat)
      const customAgents = (deployment.subagents ?? []).filter(
        (a) => !a.source || a.source === "custom"
      );
      if (customAgents.length > 0) {
        const lines = customAgents.map((a) =>
          `- **agent_${a.slug}** - ${a.description || a.name}`
        );
        poolSections.push(`### Custom Subagents\n${lines.join("\n")}`);
      }

      // NOTE: Team members were previously rendered here as a subsection of
      // the Agent Pool, referencing nonexistent `delegate_to_{slug}` MCP tools.
      // That code lied to the LLM (the tools never existed at runtime) and is
      // now replaced by the top-level "Team Context" section above, which
      // teaches the bot the `jarble_delegate` JSON-block protocol that the
      // platform actually parses (see flowDelegation.ts).

      if (poolSections.length > 0) {
        soulParts.push(
          `## Your Agent Pool\n` +
          `You are an orchestrator. For complex, multi-part tasks, delegate to your specialist agents instead of doing everything yourself.\n\n` +
          `### When to Delegate\n` +
          `- **Simple request** (single chart, quick answer, one component): Handle it yourself with render_ui or sandbox. Fast and direct.\n` +
          `- **Dashboard or multi-component request** (3+ visual elements): Use \`compose_dashboard\` - it runs agents in parallel for faster results.\n` +
          `- **Data + visualization** (user provides data or asks for analytics): Call \`delegate_to_data_agent\` first to process/structure the data, then use the result in your visualization.\n` +
          `- **Multi-step pipeline** (analyze → transform → visualize): Call agents sequentially - each one's output feeds the next.\n\n` +
          `### How to Call Agents\n` +
          `All agents are MCP tools. Call them the same way you call render_ui or web_search. Pass a "task" string argument.\n` +
          `IMPORTANT: Do NOT use call_agent or discover_agents for these. Call the tool name directly.\n\n` +
          `### Orchestration Patterns\n` +
          `**Pattern 1 - Data-First Pipeline:**\n` +
          `1. Call \`delegate_to_data_agent\` with task: "Analyze this data and return chart_data format"\n` +
          `2. Use the structured result in your \`render_ui\` or sandbox call\n\n` +
          `**Pattern 2 - Parallel Dashboard:**\n` +
          `Call \`compose_dashboard\` with multiple component intents - agents generate each component in parallel\n\n` +
          `**Pattern 3 - Sequential Multi-Agent:**\n` +
          `1. Call \`delegate_to_data_agent\` for data processing\n` +
          `2. Call \`create_component\` for custom component generation\n` +
          `3. Combine results in your response\n\n` +
          poolSections.join("\n\n")
        );
      }
    }

    soulParts.push(uiPromptSection);
    const soulContent = soulParts.join("\n\n");

    // Write to both the Jarble config path AND the OpenClaw workspace path
    // OpenClaw reads SOUL.md from $HOME/.openclaw/.openclaw/workspace/
    files.push({ path: "soul.md", content: soulContent });
    files.push({ path: `${home}/.openclaw/.openclaw/workspace/SOUL.md`, content: soulContent });

    // openclaw.json - agent config + channel credentials
    const openclawConfig: Record<string, any> = {};

    // Agent section (model config)
    // OpenClaw reads model from agents.defaults.model.primary (NOT agent.model)
    // The entrypoint first-boot uses this same path: agents.defaults.model.primary
    // Model must be provider-prefixed (e.g. "anthropic/claude-opus-4-6-20250610")
    if (deployment.llmModel) {
      const provider = deployment.llmProvider || "anthropic";
      const model = deployment.llmModel;
      // Only prefix if not already prefixed (e.g. "openrouter/auto" already has it)
      const prefixedModel = model.includes("/") ? model : `${provider}/${model}`;

      openclawConfig.agents = {
        defaults: { model: { primary: prefixedModel } },
      };
    }

    // NOTE: OpenClaw validates agents config strictly - only "defaults" is allowed.
    // Custom subagents are routed via MCP tools (agent_{slug}) → API → LLM instead.

    // Channels section - build from platformCredentials
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

        // Discord/Telegram: always use "pairing" - auto-approve handles onboarding
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
      mode: "local",
      port: 18789,
      http: { endpoints: { chatCompletions: { enabled: true } } },
      controlUi: {
        dangerouslyAllowHostHeaderOriginFallback: true,
        dangerouslyDisableDeviceAuth: true,
      },
    };
    if (deployment.gatewayToken) {
      gatewayConfig.auth = { token: deployment.gatewayToken };
    }
    openclawConfig.gateway = gatewayConfig;

    // Disable built-in tools that conflict with Jarble's web dashboard rendering.
    // The canvas tool generates HTML artifacts that the dashboard can't render -
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
      // Write to OpenClaw's actual config path - the gateway reads from the DOUBLE-nested path:
      //   $HOME/.openclaw/.openclaw/openclaw.json (NOT $HOME/.openclaw/openclaw.json)
      // This matches the entrypoint first-boot path and where `openclaw config` reads/writes.
      files.push({ path: `${home}/.openclaw/openclaw.json`, content: configContent });
      files.push({ path: `${home}/.openclaw/.openclaw/openclaw.json`, content: configContent });
    }

    // MCP server script - deployed to {pvcMount}/config/mcp/jarble-ui-server.js
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

    // Write service-tools.json - aggregate MCP tool definitions for installed services.
    // The MCP server reads this file to dynamically register service skills as first-class
    // bot tools (e.g. "weather_forecast" instead of generic service_call).
    if (deployment.remoteSkillConfigs && deployment.remoteSkillConfigs.length > 0) {
      const serviceTools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        proxyUrl: string;
        serviceId: string;
      }> = [];

      // Parse each installed skill to extract tool definitions
      if (deployment.skills) {
        for (const skill of deployment.skills) {
          try {
            const skillJson = JSON.parse(skill.config);
            const remoteConfig = deployment.remoteSkillConfigs.find(
              (rc) => rc.skillName === skill.name
            );
            if (remoteConfig && skillJson.inputSchema) {
              serviceTools.push({
                name: skill.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                description: skillJson.description || `Service skill: ${skill.name}`,
                inputSchema: skillJson.inputSchema,
                proxyUrl: remoteConfig.proxyUrl,
                serviceId: remoteConfig.packageId,
              });
            }
          } catch {
            // Skip malformed skill JSON
          }
        }
      }

      if (serviceTools.length > 0) {
        files.push({
          path: "service-tools.json",
          content: JSON.stringify(serviceTools, null, 2),
        });
        log.info({ toolCount: serviceTools.length }, "renderConfigs: wrote service-tools.json");
      }
    }

    // Write subagent-tools.json - MCP tool definitions for user-configured subagents.
    // The MCP server reads this file to dynamically register subagent tools (agent_{slug}).
    if (deployment.subagents && deployment.subagents.length > 0) {
      const subagentTools = deployment.subagents.map((a) => ({
        name: `agent_${a.slug}`,
        slug: a.slug,
        description: a.description || `Custom agent: ${a.name}`,
        inputSchema: {
          type: "object" as const,
          properties: {
            task: { type: "string", description: `Task or question to delegate to ${a.name}` },
            context: { type: "string", description: "Additional context or data for the agent" },
          },
          required: ["task"],
        },
      }));

      files.push({
        path: "subagent-tools.json",
        content: JSON.stringify(subagentTools, null, 2),
      });
      log.info({ toolCount: subagentTools.length }, "renderConfigs: wrote subagent-tools.json");
    }

    // NOTE: `delegation-tools.json` was previously written here, but no
    // consumer on the pod loads it. `jarble-ui-server.js` statically hardcodes
    // AGENT_TOOLS at module init and only registers the two platform agents
    // (`delegate_to_data_agent`, `delegate_to_workflow_agent`). Bot Team
    // delegation is now handled by the platform: the bot emits
    // `jarble_delegate` JSON blocks (taught in the soul.md "Team Context"
    // section above), `flowChat.ts` parses them via `flowDelegation.ts`, and
    // the platform invokes the teammates and feeds results back as
    // `[DELEGATION_RESULTS]`. If we ever wire dynamic MCP tool registration in
    // the MCP server, reintroduce this writer here sourced from
    // `deployment.teamContext.teammates`.

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

        // Extract LLM model - check both config paths
        // New format: agents.defaults.model.primary (what OpenClaw actually reads)
        // Legacy format: agent.model (old Jarble configs)
        const model = config.agents?.defaults?.model?.primary || config.agent?.model;
        if (model) {
          // Strip provider prefix for DB storage (DB stores model ID only, provider separately)
          const slashIdx = model.indexOf("/");
          result.llmModel = slashIdx > 0 ? model.slice(slashIdx + 1) : model;
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

    // LLM config - set the correct env var based on provider
    const providerEnvMap: Record<string, string> = {
      openrouter: "OPENROUTER_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };

    if ((deployment as any).llmMode === "platform") {
      // Platform agents use the platform's own LLM key
      const platformKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
      if (platformKey) {
        const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
        const envVar = providerEnvMap[provider] ?? "OPENROUTER_API_KEY";
        entries[envVar] = platformKey;
      } else {
        log.error(
          { deploymentId: deployment.id },
          "Platform mode deployment has no platform LLM key configured (AGENT_LLM_API_KEY / OPENROUTER_API_KEY) - pod LLM calls will fail",
        );
      }
    } else if (deployment.llmApiKey) {
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
      entries["JARBLE_KNOWLEDGE_DIR"] = "/home/openclaw/.openclaw/knowledge";
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

    // User/agent-defined deployment secrets — lowest priority (cannot overwrite system entries)
    if (deployment.deploymentSecrets) {
      for (const [key, value] of Object.entries(deployment.deploymentSecrets)) {
        if (!entries[key]) {
          entries[key] = value;
        }
      }
    }

    log.debug({ entryCount: Object.keys(entries).length }, "getSecretEntries complete");
    return entries;
  },

  validateCreate(input: Partial<DeploymentFields>): string | null {
    // OpenClaw needs LLM configuration when using BYOK mode.
    // "included" mode auto-provisions via OpenRouter - no key needed from user.
    // "platform" mode uses platform-managed keys - no key needed from user.
    if (input.llmMode === "byok" && !input.llmApiKey) {
      const error = "OpenClaw requires an LLM API key when using Bring Your Own Key mode";
      log.warn({ error }, "validateCreate failed");
      return error;
    }
    return null;
  },
};
