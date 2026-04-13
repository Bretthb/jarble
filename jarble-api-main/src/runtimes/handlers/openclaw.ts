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
35+ MCP tools, all LIVE. Key categories: Search (\`web_search\`, \`web_fetch\`, \`news_search\`, \`wikipedia\`, etc.), UI (\`list_components\`, \`component_reference\`, \`skill_reference\`), Rendering (\`render_ui\`, \`render_page\`, \`compose_dashboard\`, \`save_artifact\`), Agents (\`discover_agents\`, \`call_agent\` - 1 credit/call), Knowledge (\`knowledge_search\`), Memory (\`core_memory_read\`/\`write\`, \`archival_insert\`/\`search\`).

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
**Three-tier memory:**
- **Core** (identity): Call \`core_memory_read\` at conversation start to load your persona, user preferences, goals, style. Use \`core_memory_write\` to update when the user shares identity or preference info.
- **Archival** (long-term facts): \`archival_insert\`/\`archival_search\` for cross-platform memory. Legacy \`store_memory\`/\`recall_memory\` still work.
- **Credentials**: When a user provides an API key, token, or credential, use \`store_secret\` (NOT store_memory) to save it as an encrypted env var. It becomes available as \`process.env.KEY_NAME\` after a brief restart. Call \`list_secrets\` to check existing keys first.
\`knowledge_search\` for uploaded docs (cite sources). \`list_artifacts()\` at conversation start; \`save_artifact\` for substantial components.

### Platform Bridge
You can register subagents and credentials on the Jarble platform so they appear in the user's dashboard:
- \`platform_register_agent\` — create a subagent (appears in Subagents panel, increments the count)
- \`platform_store_secret\` — store a credential visible in Config credentials
- \`platform_list_team\` — list your team members and roles
- \`platform_log_action\` — log significant actions (visible in Debug Traces)

**CRITICAL**: These tools return a result. If the result contains \`isError: true\` or indicates failure, tell the user the registration failed and suggest they try again later. NEVER claim an agent was created if the tool call failed or was not executed.

### Team File Sharing
Share files with teammates or store files for later use:
- \`upload_team_file\` — upload a file (base64 content + filename) to shared team storage. Returns a \`team://\` URI.
- \`download_team_file\` — download a file by fileId from a \`team://\` URI.
- \`list_team_files\` — list all files in the current session's team storage.

Use these to share CSVs, images, PDFs, or any data between team members. Include the \`team://\` URI in delegation context so teammates can access the file.

### Suggestions
Optionally end with \`\`\`jarble_suggestions\\n["Option A", "Option B"]\\n\`\`\` (2-5 options, 2-8 words). Auto-generated if omitted.`;

// ── Condensed messaging-only prompt ──────────────────────────────────────
// Used instead of JARBLE_UI_PROMPT when a deployment is messaging-only
// (no web chat). Saves ~1,250 tokens and avoids confusing the LLM with
// jarble_ui instructions it can never use on messaging platforms.
const MESSAGING_ONLY_PROMPT = `## Platform Awareness
You are a messaging bot. Use plain text and markdown only. Do not output jarble_ui blocks or attempt to render UI components.`;

// ── Condensed UI prompt for subagent SOUL.md ────────────────────────────
// Subagents spawned via sessions_spawn get their own SOUL.md with their
// custom system prompt + this trimmed UI prompt so they can use render_ui.
const SUBAGENT_UI_PROMPT = `## Jarble UI (dashboard only)
You are a specialist subagent with full MCP tool access.
Block types: \`\`\`jarble_ui (new card), \`\`\`jarble_ui_update (update existing).
**Protocol**: 1) Pick component 2) If unsure call \`component_reference\` 3) Emit block with props + \`layout_hint\`.
For detailed guides call \`skill_reference\`. For prop schemas call \`component_reference\`.

### Block Format
\\\`\\\`\\\`jarble_ui
{"component": "chart", "props": {...}, "layout_hint": "half"}
\\\`\\\`\\\`

### Component Chooser
**Default \`sandbox\`** for anything visual. Typed components only for simple standalone use:
- \`sandbox\`: dashboards, charts, data viz, interactive widgets, 3D, games
- \`metric_card\`/\`stat_grid\`: single KPI. \`alert\`: single notification. \`list\`: simple list.
- \`carousel\`/\`image_gallery\`: items with images. \`form\`: user input. \`embed\`: third-party widgets.

### Layout Hints (REQUIRED)
\`"full-width"\`: sandbox, wide tables. \`"half"\`: charts, lists. \`"third"\`: metrics, alerts. \`"compact"\`: badges.

### Core Rules
- Never output raw HTML outside jarble_ui blocks. Never use base64 images.
- SANDBOX-FIRST: Prefer \`sandbox\` for dashboards and multi-component requests.
- Design: polished, professional, real data, descriptive titles, meaningful colors.`;

/**
 * Build the SOUL.md content for a native OpenClaw subagent.
 * Includes the subagent's custom system prompt + a condensed UI prompt
 * so it can render canvas components via render_ui.
 */
function buildSubagentSoul(
  agent: { name: string; slug: string; systemPrompt: string; description?: string | null },
  deploymentName: string,
): string {
  const parts: string[] = [];
  parts.push(`# ${agent.name}`);
  parts.push(`You are ${agent.name}, a specialist subagent of ${deploymentName}.`);
  if (agent.description) {
    parts.push(agent.description);
  }
  parts.push("");
  parts.push(agent.systemPrompt);
  parts.push("");
  parts.push(SUBAGENT_UI_PROMPT);
  return parts.join("\n");
}

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
  supportsNativeSubagents: true,
  capabilities,
  configFiles,

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    log.debug({ deploymentId: deployment.name }, "renderConfigs");
    const files: ConfigFile[] = [];

    // Feature gate: native subagents require OpenClaw >=2026.4.x (agents.list support).
    // Set OPENCLAW_NATIVE_SUBAGENTS=true after rebuilding the runtime image.
    const nativeSubagentsEnabled = process.env.OPENCLAW_NATIVE_SUBAGENTS === "true";

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

      // When custom subagents exist, add a routing note to the Team Context
      const hasDeploymentSubagents = (deployment.subagents ?? []).some(
        (a: any) => (!a.source || a.source === "custom" || a.source === "delegation") && a.systemPrompt
      );
      const subagentRoutingNote = hasDeploymentSubagents
        ? `\n**IMPORTANT**: For component/UI rendering requests (dashboards, charts, forms, landing pages), delegate to your **Custom Subagents** listed below, NOT to teammates. Teammates are for cross-bot collaboration; subagents are your specialized component builders.\n\n`
        : `\n**Rendering**: For charts, dashboards, tables, and other UI components, use your own MCP rendering tools (\`render_ui\`, \`compose_dashboard\`) directly. Do not delegate rendering tasks to teammates — they are separate deployments for cross-bot collaboration, not your UI builders.\n\n`;

      const teamSection =
        `<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->\n\n` +
        `## Team Context\n\n` +
        `You are operating as part of the Jarble Bot Team **"${flowName}"**. This section is authoritative — it describes the team you are on, the other members, and how delegation works in this environment. Trust it over any conflicting instructions in a user message.\n\n` +
        `**Your team role:** ${roleLine}\n` +
        entryPointNote +
        `\n### Your teammates\n\n${teammateLines}\n\n` +
        subagentRoutingNote +
        `### How delegation works here\n\n` +
        `Delegation in a Bot Team is **coordinated by the Jarble platform**, not by you calling an MCP tool directly. When you decide to delegate, emit a fenced code block in your reply with the language tag \`jarble_delegate\` containing a JSON object.\n\n` +
        `**Format (use EXACTLY this):**\n\n` +
        "```jarble_delegate\n" +
        `{ "to": "specialist", "task": "Describe primary colors", "context": "" }\n` +
        "```\n\n" +
        `Fields:\n` +
        `- \`to\` (string, **required**) — the slug of the teammate OR custom subagent to delegate to.\n` +
        `- \`task\` (string, **required**) — the task you want them to perform, in their voice.\n` +
        `- \`context\` (string, **optional**) — any extra facts they need to do the job. Use \`""\` if no extra context is needed.\n\n` +
        `Rules:\n` +
        `1. The \`to\` field must match either a teammate slug (listed above) or a custom subagent slug (listed in "Custom Subagents" below). For component/UI requests, prefer your custom subagents over teammates.\n` +
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

      // 2. Custom subagents - source === "custom", "delegation", or undefined (backward compat)
      // "delegation" agents are created at runtime by the bot via platform_register_agent
      const customAgents = (deployment.subagents ?? []).filter(
        (a) => !a.source || a.source === "custom" || a.source === "delegation"
      );
      if (customAgents.length > 0) {
        if (nativeSubagentsEnabled) {
          // Native mode: sessions_spawn
          const lines = customAgents.map((a) =>
            `- **${a.slug}** — ${a.description || a.name}`
          );
          poolSections.push(
            `### Your Specialist Agents\n` +
            `You have access to these specialist agents via \`sessions_spawn\`:\n` +
            lines.join("\n") + `\n\n` +
            `**How to delegate**: Use \`sessions_spawn\` to dispatch tasks to your specialists. Each runs as a full native agent with its own SOUL.md, MCP tools, and render_ui access.\n\n` +
            `Example: \`sessions_spawn({ task: "Build a KPI dashboard showing monthly revenue", agentId: "${customAgents[0].slug}" })\`\n\n` +
            `Then call \`sessions_yield\` to wait for the result. The specialist will announce its output (including any rendered UI components) back to you when complete.\n\n` +
            `Rules:\n` +
            `1. Use \`sessions_spawn\` for ALL subagent calls. Do NOT emit \`jarble_delegate\` blocks for subagents.\n` +
            `2. Your specialists have full MCP tool access — they can use \`render_ui\`, \`web_search\`, \`component_reference\`, and all other tools.\n` +
            `3. Team delegations (cross-bot, different pods) still use \`jarble_delegate\` blocks.\n` +
            `4. If no specialist fits, build it yourself using \`render_ui\` with the \`sandbox\` component.`
          );
        } else {
          // Legacy mode: MCP tool calls
          const lines = customAgents.map((a) =>
            `- **agent_${a.slug}** — ${a.description || a.name}`
          );
          poolSections.push(
            `### Custom Subagents\n` +
            lines.join("\n") + `\n\n` +
            `**How to call subagents**: Call them as MCP tools. Pass a \`task\` string argument describing what to build.\n\n` +
            `Example: \`agent_${customAgents[0].slug}({ "task": "describe the task here", "context": "any extra data" })\`\n\n` +
            `Rules:\n` +
            `1. ALWAYS call the \`agent_*\` tool directly.\n` +
            `2. Your subagents can render UI components on the canvas using \`render_ui\` and \`sandbox\`.\n` +
            `3. If no subagent fits, build it yourself using \`render_ui\` with the \`sandbox\` component.`
          );
        }
      }

      // 3. Team members - other deployments linked via Bot Teams flows
      // Only render this section when there is NO Team Context block above.
      // When Team Context exists, it is the authoritative delegation source
      // and includes the teammate roster + jarble_delegate instructions.
      // Rendering both creates conflicting delegation paths that confuse the bot.
      const hasTeamContext = !!deployment.teamContext?.teammates?.length;
      if (!hasTeamContext && deployment.teamMembers && deployment.teamMembers.length > 0) {
        const lines = deployment.teamMembers.map((m) =>
          `- **${m.slug}** - ${m.name}${m.role ? `: ${m.role}` : ""}`
        );
        poolSections.push(
          `### Team Members\n` +
          `**Preferred**: Use the \`a2a_delegate\` tool to delegate tasks to teammates. It accepts a \`to\` (teammate slug), \`task\` (what to do), and optional \`context\` (extra data).\n` +
          `Example: \`a2a_delegate({ to: "${deployment.teamMembers[0].slug}", task: "Analyze the Q1 revenue data", context: "Focus on month-over-month growth" })\`\n\n` +
          `Legacy \`delegate_to_{slug}\` tools and \`jarble_delegate\` fenced blocks also work but prefer \`a2a_delegate\` for new delegations.\n\n` +
          `Available teammates:\n` +
          lines.join("\n")
        );
      }

      if (poolSections.length > 0) {
        const hasCustomSubagents = customAgents.length > 0;

        const delegationGuidance = hasCustomSubagents
          ? (nativeSubagentsEnabled
            ? // Native mode: sessions_spawn
              `### When to Delegate\n` +
              `- **Simple request** (single chart, quick answer): Handle it yourself with \`render_ui\` or \`sandbox\`.\n` +
              `- **Any UI component or specialized request**: Use \`sessions_spawn\` to dispatch to the matching specialist. They have full MCP access and can render UI directly.\n` +
              `- Do NOT use \`compose_dashboard\` or \`create_component\` — use your specialist agents instead.\n\n` +
              `### How to Call Specialists\n` +
              `Use \`sessions_spawn\` + \`sessions_yield\`:\n` +
              `1. \`sessions_spawn({ task: "Build a KPI grid with...", agentId: "dashboard_builder" })\`\n` +
              `2. \`sessions_yield\` — wait for the specialist to finish\n` +
              `3. Read the announced result and synthesize for the user\n\n` +
              `Each specialist runs as a full native agent with its own SOUL.md, render_ui, and all MCP tools.\n\n`
            : // Legacy mode: MCP tool calls
              `### When to Delegate\n` +
              `- **Simple request** (single chart, quick answer): Handle it yourself with \`render_ui\` or \`sandbox\`.\n` +
              `- **Any UI component request**: Call the matching \`agent_*\` tool directly. These are your specialist subagents.\n\n` +
              `### How to Call Subagents\n` +
              `Your subagents are MCP tools. Call them exactly like \`render_ui\` or \`web_search\`:\n` +
              `\`agent_dashboard_builder({ "task": "Build a KPI grid with...", "context": "" })\`\n\n`
          )
          : // No custom subagents — use platform orchestration (default for new users)
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
            `3. Combine results in your response\n\n`;

        soulParts.push(
          `## Your Agent Pool\n` +
          `You are an orchestrator. For complex, multi-part tasks, delegate to your specialist agents instead of doing everything yourself.\n\n` +
          delegationGuidance +
          poolSections.join("\n\n")
        );
      }
    }

    // Memory scope guidance.
    //
    // Context: openclaw ships with NATIVE memory tools (memory_search,
    // memory_get) that bypass Jarble's memory scope enforcement (the
    // Jarble MCP server at jarble-ui.store_memory / recall_memory does
    // respect it). If the bot defaults to the native tools, everything
    // tonight's memory scope trilogy (#67/#69/#75/#81) shipped is
    // functionally dormant. This section explicitly tells the bot to
    // prefer the jarble-ui MCP tools over the native ones whenever the
    // user's data privacy matters — which is always.
    //
    // The `mcporter` skill is already enabled by default on every
    // deployment, and PR #72 registers jarble-ui with mcporter. So
    // the bot has everything it needs to obey this prompt directly.
    const memoryScope = deployment.memoryScope ?? "global";
    if (memoryScope !== "off") {
      soulParts.push(
        `## Long-Term Memory — Use Jarble's Scope-Aware Tools\n` +
        `You have two memory tool sets available:\n` +
        `  1. **openclaw's native** \`memory_search\` / \`memory_get\` — fast, built-in, but BYPASSES this deployment's memory scope setting. Do NOT use these for anything the user might consider private or conversational.\n` +
        `  2. **Jarble's scope-aware** \`store_memory\` / \`recall_memory\` / \`list_memories\` / \`forget_memory\` via mcporter — respects the deployment-level memory scope (global / per-session / off) the user configured.\n\n` +
        `**ALWAYS use the Jarble tools for user-facing long-term memory.** Call them via mcporter:\n` +
        `  \`\`\`\n` +
        `  mcporter call jarble-ui.store_memory text="user's favorite color is blue"\n` +
        `  mcporter call jarble-ui.recall_memory query="favorite color"\n` +
        `  \`\`\`\n` +
        `You may still use openclaw's native memory tools for code-level state (workspace facts, project metadata, etc) where scope doesn't matter.\n`
      );
    }

    if (memoryScope === "session") {
      soulParts.push(
        `### Memory Scope — Per-Session\n` +
        `Jarble's memory for this deployment is scoped to individual conversations. Anything you store via \`mcporter call jarble-ui.store_memory\` is only visible in the current chat — you will not recall it in other conversations with this user. ` +
        `The Jarble MCP server auto-resolves the current session from the runtime environment in most cases, so you can call memory tools without a \`session_id\` argument and it will work correctly. ` +
        `If a memory call returns a "session mode — you MUST pass session_id" error, re-run it with \`session_id\` set to your current openclaw session id.`
      );
    } else if (memoryScope === "off") {
      soulParts.push(
        `## Long-Term Memory — DISABLED\n` +
        `Long-term memory tools (\`store_memory\`, \`recall_memory\`, \`list_memories\`, \`forget_memory\`) are disabled for this deployment. ` +
        `Do not call them via mcporter — the calls will return an error. ` +
        `Do NOT fall back to openclaw's native \`memory_search\` / \`memory_get\` as a workaround — the user explicitly turned off long-term memory. ` +
        `Do not promise the user that you will remember anything after this chat ends.`
      );
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

    // ── Native subagents: populate agents.list from deployment.subagents ──
    // Each custom subagent becomes a named agent in OpenClaw with its own
    // workspace + SOUL.md. The parent bot uses sessions_spawn to delegate.
    //
    // GATED: Only activate when OPENCLAW_NATIVE_SUBAGENTS=true (see top of renderConfigs).
    const customSubagents = (deployment.subagents ?? []).filter(
      (a) => a.systemPrompt && (!a.source || a.source === "custom" || a.source === "delegation")
    );

    if (nativeSubagentsEnabled && customSubagents.length > 0) {
      const agentsList: Array<Record<string, any>> = [];

      for (const agent of customSubagents) {
        const agentWorkspace = `.openclaw/agents/${agent.slug}`;

        // Write per-agent SOUL.md to its workspace directory
        const agentSoul = buildSubagentSoul(
          agent,
          deployment.name,
        );
        files.push({
          path: `${home}/.openclaw/agents/${agent.slug}/SOUL.md`,
          content: agentSoul,
        });

        // Build agents.list entry
        const agentEntry: Record<string, any> = {
          id: agent.slug,
          workspace: agentWorkspace,
        };

        // Per-agent model override
        if (agent.model) {
          const provider = deployment.llmProvider || "anthropic";
          agentEntry.model = agent.model.includes("/")
            ? agent.model
            : `${provider}/${agent.model}`;
        }

        // Per-agent tool restrictions from the tools JSON field
        if (agent.tools) {
          try {
            const toolList = JSON.parse(agent.tools);
            if (Array.isArray(toolList) && toolList.length > 0) {
              agentEntry.tools = { allow: toolList };
            }
          } catch { /* allow all by default */ }
        }

        // Leaf agents cannot spawn their own children
        agentEntry.subagents = { allowAgents: [] };

        agentsList.push(agentEntry);
      }

      // Ensure agents config exists
      if (!openclawConfig.agents) {
        openclawConfig.agents = { defaults: {} };
      }

      openclawConfig.agents.list = agentsList;

      // Configure subagent spawning defaults
      openclawConfig.agents.defaults.subagents = {
        maxSpawnDepth: 2,
        maxChildrenPerAgent: 5,
        maxConcurrent: 8,
        runTimeoutSeconds: 900,
        allowAgents: customSubagents.map((a) => a.slug),
      };

      log.info(
        { agentCount: agentsList.length, slugs: customSubagents.map((a) => a.slug) },
        "renderConfigs: wrote native agents.list for sessions_spawn",
      );
    }

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
    openclawConfig.tools = {
      deny: ["canvas"],
    };

    // Plugin enablement — OpenClaw's plugin loader reads from plugins.entries,
    // NOT from channels.<id>.enabled. Without matching entries here, configured
    // channels won't load properly after configSync overwrites the first-boot config.
    // Also explicitly disable unsupported channels (Signal, iMessage, Nostr, Google Chat).
    const pluginEntries: Record<string, { enabled: boolean }> = {
      // Always enable the 4 supported platforms — their channel config is gated
      // by credentials above (no creds = channel section is empty, harmless)
      whatsapp: { enabled: true },
      telegram: { enabled: true },
      discord: { enabled: true },
      slack: { enabled: true },
      // Disable unsupported platforms
      signal: { enabled: false },
      imessage: { enabled: false },
      nostr: { enabled: false },
      googlechat: { enabled: false },
    };

    openclawConfig.plugins = {
      ...(openclawConfig.plugins || {}),
      entries: {
        ...(openclawConfig.plugins?.entries || {}),
        ...pluginEntries,
      },
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

      // Register the Jarble MCP server with mcporter so the `mcporter` skill
      // (already enabled by default) can spawn it and the agent can call its
      // tools via `mcporter call jarble-ui.<tool>`. Without this file, the
      // jarble-ui-server.js just sits on disk and nothing invokes it —
      // render_ui / define_component / store_memory / skill_reference / etc.
      // have never been reachable from a real bot.
      //
      // mcporter's "system" config path is ${HOME}/.mcporter/mcporter.json.
      // HOME=/data in legacy mode and /home/openclaw in operator mode.
      //
      // The server script path differs by mode because configSync writes
      // the MCP server to {pvcMount}/mcp/jarble-ui-server.js, and the PVC
      // is mounted at different places in legacy vs operator pods.
      const mcpScriptPath =
        managedBy === "operator"
          ? "/home/openclaw/.openclaw/mcp/jarble-ui-server.js"
          : "/data/config/mcp/jarble-ui-server.js";

      const mcporterConfig = {
        mcpServers: {
          "jarble-ui": {
            command: "node",
            args: [mcpScriptPath],
          },
        },
      };
      const mcporterJson = JSON.stringify(mcporterConfig, null, 2) + "\n";
      files.push({
        path: `${home}/.mcporter/mcporter.json`,
        content: mcporterJson,
      });
    }

    // Render installed skills as individual JSON files under /data/skills/
    // For remote/hybrid package skills, inject a `proxyUrl` field so OpenClaw
    // routes tool calls through the Jarble API proxy rather than calling the
    // creator's endpoint directly (the proxy handles HMAC signing + rate limits).
    if (deployment.skills && deployment.skills.length > 0) {
      for (const skill of deployment.skills) {
        // Sanitize skill name for use as filename (lowercase, alphanumeric + hyphens)
        const safeName = skill.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

        files.push({
          path: `skills/${safeName}.json`,
          content: skill.config,
        });
      }
    }

    // Legacy subagent-tools.json — used when native subagents are disabled
    // (OPENCLAW_NATIVE_SUBAGENTS !== "true") or on older OpenClaw versions.
    if (!nativeSubagentsEnabled && deployment.subagents && deployment.subagents.length > 0) {
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
      log.info({ toolCount: subagentTools.length }, "renderConfigs: wrote subagent-tools.json (legacy mode)");
    }

    // Write delegation-tools.json - MCP tool definitions for Bot Teams delegation.
    // Phase 1 (A2A): single `a2a_delegate` tool with a `to` enum of teammate slugs,
    // plus legacy per-member `delegate_to_{slug}` tools for backward compatibility.
    if (deployment.teamMembers && deployment.teamMembers.length > 0) {
      const slugs = deployment.teamMembers.map((m) => m.slug);
      const memberDescriptions = deployment.teamMembers
        .map((m) => `  - "${m.slug}": ${m.name}${m.role ? ` (${m.role})` : ""}`)
        .join("\n");

      // New structured A2A delegate tool
      const a2aDelegateTool = {
        name: "a2a_delegate",
        description:
          "Delegate a task to a teammate. Use this tool to send structured task requests to other agents in your team.\n\nAvailable teammates:\n" +
          memberDescriptions,
        inputSchema: {
          type: "object" as const,
          properties: {
            to: {
              type: "string" as const,
              enum: slugs,
              description: "The slug of the teammate to delegate to",
            },
            task: {
              type: "string" as const,
              description: "Clear description of the task to delegate",
            },
            context: {
              type: "string" as const,
              description: "Additional context, data, or constraints for the delegate",
            },
          },
          required: ["to", "task"] as const,
        },
      };

      // Legacy per-member tools for backward compatibility
      const legacyTools = deployment.teamMembers.map((m) => ({
        name: `delegate_to_${m.slug}`,
        slug: m.slug,
        description: `Delegate to ${m.name}${m.role ? ` (${m.role})` : ""}`,
        inputSchema: {
          type: "object" as const,
          properties: {
            task: { type: "string" as const, description: "The task to delegate" },
            context: { type: "string" as const, description: "Relevant context for the delegate" },
          },
          required: ["task"],
        },
      }));

      const delegationTools = [a2aDelegateTool, ...legacyTools];

      files.push({
        path: "delegation-tools.json",
        content: JSON.stringify(delegationTools, null, 2),
      });
      log.info({ toolCount: delegationTools.length }, "renderConfigs: wrote delegation-tools.json");
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

    // Jarble API URL for the platform bridge tools (platform_register_agent, etc.)
    // Without this, the MCP server falls back to host.docker.internal:3001 which
    // doesn't resolve in Kubernetes. Use the API's public URL.
    const apiUrl = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.replace("dev.jarble.ai", "api.jarble.ai").replace("jarble.ai", "api.jarble.ai")
      : "https://api.jarble.ai";
    entries["JARBLE_API_URL"] = apiUrl;

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

    // Memory scope enforcement (JAR memory-scoping enforcement PR B).
    // Surfaced to the pod so jarble-ui-server.js can hide/disable the
    // memory tools when the user picks "off". Session mode is advisory
    // for now — session-keyed partition lives in a follow-up.
    entries["JARBLE_MEMORY_SCOPE"] = deployment.memoryScope ?? "global";

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
