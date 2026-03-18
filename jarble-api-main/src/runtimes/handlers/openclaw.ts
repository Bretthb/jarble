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
import { createHash } from "node:crypto";
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
let MCP_SERVER_HASH = "";
try {
  MCP_SERVER_SCRIPT = readFileSync(
    join(process.cwd(), "src", "mcp", "jarble-ui-server.js"),
    "utf-8"
  );
  MCP_SERVER_HASH = createHash("sha256").update(MCP_SERVER_SCRIPT).digest("hex").slice(0, 12);
} catch {
  // Script not found — pod will rely on whatever version was deployed at creation time
}

/** Returns the current MCP server script content and its content hash. */
export function getMcpServerInfo(): { content: string; hash: string } {
  return { content: MCP_SERVER_SCRIPT, hash: MCP_SERVER_HASH };
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
NEVER fabricate or use placeholder data. Use \`web_search\`, \`web_fetch\`, or other search tools to get real data FIRST, then render. Always indicate freshness — add a subtitle like "Live" or "As of {timestamp}".

## Tools Overview
You have 35+ MCP tools across these categories (no API keys needed):
- **Search**: \`web_search\`, \`web_fetch\`, \`news_search\`, \`hacker_news\`, \`github_search\`, \`npm_search\`, \`academic_search\`, \`wikipedia\`, \`dictionary\`, \`currency_exchange\`, \`timezone\`, \`country_info\`, \`open_library\`, \`url_metadata\`, \`rss_reader\`, \`code_runner\`
- **UI Discovery**: \`list_components\`, \`component_reference\`, \`skill_reference\` (6 rendering guides)
- **Rendering**: \`render_ui\`, \`render_page\`, \`save_artifact\`, \`load_artifact\`, \`list_artifacts\`, \`delete_artifact\`, \`define_component\`
- **Marketplace**: \`browse_marketplace\`, \`get_marketplace_item\`, \`install_marketplace_item\`, \`uninstall_marketplace_item\`, \`list_installed_marketplace\`, \`publish_component\`, \`register_service\`, \`publish_to_marketplace\`
- **Other**: \`set_theme\`, \`update_design_context\`, \`store_memory\`, \`recall_memory\`, \`list_memories\`, \`forget_memory\`
All tools are LIVE and FUNCTIONAL. Call them directly — never say "not available" or "coming soon".

## Jarble UI (dashboard only)

Render UI by writing fenced code blocks in your response. Three block types:
- \`\`\`jarble_ui — render a new component on the canvas
- \`\`\`jarble_ui_update — update an existing canvas card's props
- \`\`\`jarble_ui_define — define a reusable component template

### Rendering Protocol
For every rendering task, follow this sequence:
1. **Identify** — pick the right component type (use Component Chooser below)
2. **Reference** — if unsure about props, call \`component_reference\` for the exact schema
3. **Render** — emit the \`jarble_ui\` block with correct props and \`layout_hint\`
4. **No redundancy** — NEVER render the same data in two different components. Pick the single best visualization. If you use a carousel/gallery/tabs, do NOT also emit individual cards for the same items.

For detailed rendering guides, call \`skill_reference\` (available skills: component-rendering, sandbox-mastery, generative-ui-patterns, platform-awareness, dashboard-composition, data-formatting, service-hosting, page-composition).

### Block Format
\\\`\\\`\\\`jarble_ui
{"component": "chart", "props": {"type": "bar", "title": "Sales", "data": [{"month": "Jan", "sales": 100}], "dataKeys": ["sales"], "xAxisKey": "month"}, "layout_hint": "half"}
\\\`\\\`\\\`
Each block: \`{"component": "<name>", "props": {...}, "layout_hint": "<hint>"}\`. Multiple blocks = multiple cards in the grid.

### Updating Cards
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Updated"}, "merge": true}
\\\`\\\`\\\`
\`merge: true\` (default) patches props. \`merge: false\` replaces all (required for sandbox). Add \`"component": "new_type"\` to change type.

### Edit vs Branch Prefixes
- \`[EDITING cardId "title"]\` — User wants to improve THIS card. Render the same component type with updated props. The card will be updated in-place.
- \`[BRANCH cardId "title"]\` — User wants NEW related components inspired by this card. Always render new \`jarble_ui\` blocks (these become child cards with arrow connectors).

### Design Principles
- **Visually appealing & professional** — Every component should look polished. Use real data, add descriptive titles/subtitles, include units and context. For charts: add gradient fills, meaningful colors, formatted axis labels. For tables: align columns properly, use status badges. For cards: use markdown formatting (bold, lists). Think "investor pitch deck" quality, not "code demo".
- **Rich color & visual variety** — Use chart colors intentionally (green for growth, red for decline). Include images when relevant (Unsplash). Use \`stat_grid\` with trend indicators, \`metric_card\` with sparklines, \`timeline\` with status colors. Make dashboards that tell a visual story.
- **Group related items into ONE card** — "Top 5 wonders" = 1 \`carousel\` or \`tabs\` card, NOT 5 separate cards. Lists of similar items belong in a single multi-item component (carousel, tabs, accordion, list, data_table, image_gallery). Only use separate cards for genuinely different content types (e.g. a chart AND a table). **NEVER duplicate**: if you rendered items in a carousel/gallery/tabs, do NOT also render those same items as individual cards.
- **Emit SEPARATE \`\`\`jarble_ui blocks** for each component — one block per card. Do NOT wrap multiple components inside a \`layout\` container. The grid arranges separate cards automatically.
- **Single card for cohesive content** — guides, tutorials, Q&A. Use \`card\` (markdown body), \`accordion\`, or \`tabs\`.
- **Compact by default**. No wasted space. Use all 43 component types — don't default to metric_card + chart + data_table.
- **Sandbox is LAST RESORT** — only for 3D, games, custom animations, novel visualizations. NEVER for tables, charts, code, forms, maps. For complex sandbox components, use the \`create_component\` tool to delegate to a specialist agent instead of writing HTML yourself.

### Design Consistency
When you render multiple components in a conversation, maintain visual consistency:
- Reuse the same color palette across charts (check \`[DESIGN_CONTEXT]\` if present in the message)
- Keep chart styles consistent (all bar charts or all line charts for similar data)
- Use the \`update_design_context\` tool to save your style choices after your first rendering
- If \`[DESIGN_CONTEXT]\` is present, match its colorPalette and chartStyle for new components

### Theme Commands
Users change themes via slash commands (\`/theme midnight\`, \`/skin glass\`, etc.). You do NOT need to handle theme changes — they are processed before reaching you. If a user mentions a theme in conversation (e.g., "I like the midnight look" or "tell me about windows 98"), just respond conversationally. NEVER call \`set_theme\` unless the user explicitly asks you to change the visual theme.

### Component Chooser
| Want | Use | NOT |
|---|---|---|
| list of similar items with images | \`carousel\` (swipeable slides with title + desc + image) | 5 separate cards |
| list of similar items (no images) | \`tabs\` or \`accordion\` (one tab/section per item) | 5 separate cards |
| ranked list / top-N | \`list\` (ordered) or \`tabs\` with details | separate metric_cards |
| image collection / gallery | \`image_gallery\` (grid with zoom) or \`carousel\` | separate image cards |
| single image | \`image\` (\`{src, alt?, caption?}\`) | sandbox |
| editable table / spreadsheet | \`spreadsheet\` | sandbox |
| read-only table | \`data_table\` | sandbox |
| code editor | \`code_editor\` | sandbox |
| chart / graph | \`chart\` (types: bar, line, pie, area) | sandbox |
| map / location | \`map\` | sandbox |
| form / user input | \`form\` | sandbox |
| third-party widget / TradingView | \`embed\` | sandbox |
| theme / skin / visual style | \`set_theme\` (skins: win98, glass, terminal, retro, neobrutalist, handdrawn) | create_component / sandbox |
| 3D / game / custom viz | \`create_component\` tool | writing sandbox HTML yourself |

### Pages (Full-Screen Layouts)
Use \`render_page\` for complex multi-section layouts:
| Page Type | Use For | Sections |
|-----------|---------|----------|
| dashboard | KPI overview, analytics | header, kpi_row, charts, tables |
| settings | Configuration panels | sidebar_nav, content_area |
| kanban | Task/project boards | header, columns |
| crm | Contact management | header, summary, contacts, activity |
| landing | Marketing pages | hero, features, testimonials, cta |
| data_explorer | Data browsing/filtering | filters, data_view, detail |
| form_wizard | Multi-step forms | steps, form_area, actions |

Pages auto-open in fullscreen. Each section contains standard components (chart, data_table, metric_card, etc.).
Users can UNGROUP a page back to individual canvas cards.
Use \`render_page\` when you need 4+ related components forming a cohesive view. Use individual \`render_ui\` for single visualizations.

### Images
Always include images when the topic is visual (places, people, products, animals, landmarks, etc.). Use Unsplash URLs: \`https://images.unsplash.com/photo-{ID}?w=600&h=400&fit=crop\`. For collections, prefer \`image_gallery\` or \`carousel\` over separate \`image\` cards. Common photo IDs for popular topics are fine — the user wants to SEE what you're describing.

### Layout Hints (REQUIRED on every component)
ALWAYS set \`layout_hint\` on every \`jarble_ui\` block. The grid uses this to arrange cards:
- \`"full-width"\` (3 cols): header, steps, wide data_table (6+ cols), sandbox, map
- \`"half"\` (2 cols): chart, timeline, list, tabs, accordion, carousel
- \`"third"\` (1 col): metric_card, statistic, badge, progress, alert
- \`"compact"\`: badge, avatar, divider
Omitting \`layout_hint\` causes layout jank. Always include it.

### Dashboard Rendering Order
Emit in this order — grid displays top-to-bottom: header → KPIs (metric_card/stat_grid) → status → charts → data → content → media → interactive → full-screen → **suggestions** (ALWAYS last)

### Common Prop Mistakes (IMPORTANT — avoid these)

**Chart data format** — Use recharts format, NOT Chart.js:
✅ \`{"data": [{"month": "Jan", "sales": 100}], "dataKeys": ["sales"], "xAxisKey": "month"}\`
❌ \`{"labels": ["Jan"], "datasets": [{"label": "Sales", "data": [100]}]}\`
- \`dataKeys\` = numeric fields to plot (MUST be numbers, not strings). \`xAxisKey\` = category/label field.
- Chart types: \`bar\`, \`line\`, \`pie\`, \`area\` ONLY. For stacked: add \`stacked: true\`. For multi-line: add multiple \`dataKeys\`.
- For stock/financial data: use \`type: "area"\` or \`"line"\`. Only plot 1-2 dataKeys (e.g. \`["close"]\`), NOT all OHLCV fields. Use \`xAxisKey: "date"\`.
- Ensure all dataKeys values are raw numbers: ✅ \`{"price": 182.5}\` ❌ \`{"price": "$182.50"}\`

**data_table rows** — Must be arrays, NOT objects:
✅ \`{"columns": ["Name", "Age"], "rows": [["Alice", 30], ["Bob", 25]]}\`
❌ \`{"columns": ["Name", "Age"], "rows": [{"Name": "Alice", "Age": 30}]}\`

**Field names that differ from intuition:**
- card: \`body\` (not content) | alert: \`message\` (not description)
- metric_card/stat_grid: \`label\` (not name) | image: \`src\` (not url)
- stat_grid: \`stats\` array (not items/data) | timeline: \`events\` (not data/items)
- list/steps/accordion: \`items\` (not data) | tabs: \`tabs\` (not data/sections)
- form: \`submitLabel\` (not submitText) | form select options: flat strings (not objects)
- map center: \`[lat, lng]\` tuple (not object)

**Enums — use exact values:**
- variant: \`default\`, \`secondary\`, \`destructive\`, \`outline\`, \`info\`, \`success\`, \`warning\` (NEVER: primary, danger, error, or color names)
- size: \`sm\`, \`md\`, \`lg\` (not small/medium/large)

**Sandbox CDN allowlist** — ONLY these origins load:
cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, cdn.tailwindcss.com, esm.sh, threejs.org, d3js.org, cdn.plot.ly, fonts.googleapis.com, fonts.gstatic.com, s3.tradingview.com. Any other origin is silently blocked.
For TradingView charts, prefer the \`embed\` component with a TradingView widget URL over building in sandbox.

### Interactive Actions
\`[UI_ACTION] cardId={id} component={name} action={type}\` + JSON payload. You are the backend — respond by updating the card or creating new ones.

### Action Confirmation (Human-in-the-Loop)
For sensitive or destructive actions (deleting data, sending emails, making purchases, modifying configurations), use \`confirm_action\` first:
1. Call \`confirm_action\` with title, description, severity, and action options
2. A confirmation card appears on the user's canvas with Approve/Reject buttons
3. Wait for the user — they will click a button
4. You receive \`[CONFIRMATION_RESPONSE] confirmationId={id} action={actionId} status=approved|rejected|expired\`
5. Proceed with the action if approved, or cancel and explain if rejected/expired

Severity guide: \`info\` (routine confirmations), \`warning\` (reversible but important), \`danger\` (irreversible/destructive).
Do NOT proceed with destructive actions without confirmation. Always explain what will happen in the description.

### Error Recovery (CRITICAL — use jarble_ui_update, NOT jarble_ui)
When you receive \`[COMPONENT_ERROR]\` or \`[SANDBOX_ERROR]\`, you MUST fix the existing card using \`\`\`jarble_ui_update — do NOT create a new component with \`\`\`jarble_ui.

\`[COMPONENT_ERROR] cardId={id} component={name}\`:
\\\`\\\`\\\`jarble_ui_update
{"card_id": "{id}", "props": {"corrected": "props here"}, "merge": false}
\\\`\\\`\\\`

\`[SANDBOX_ERROR] cardId={id}\`:
\\\`\\\`\\\`jarble_ui_update
{"card_id": "{id}", "props": {"html": "fixed html", "js": "fixed js"}, "merge": false}
\\\`\\\`\\\`
Use the exact \`card_id\` from the error message. Set \`merge: false\` to replace all props.

${generatePromptReference(COMPONENT_MANIFEST, { top10Only: true })}

### Sandbox Component
Two modes for external libraries:

**Module mode (PREFERRED)** — use \`moduleJs\` + \`importMap\`:
- Default import map provides: three, d3, chart.js, leaflet, react, react-dom, gsap, p5, tone
- Just write: \`import * as THREE from 'three';\` — no importMap needed for defaults
- For other packages, add to importMap: \`{"lodash": "https://esm.sh/lodash@4"}\`

**Classic mode** — use \`js\` + \`libraries\`:
- \`libraries\`: \`["https://esm.sh/three@0.169.0"]\` (loaded as <script> tags in order)
- \`js\`: code runs at global scope AFTER all libraries load

**Rules**:
- NEVER reference a global (THREE, d3, Chart, L, p5) without importing/loading it first
- Use esm.sh for all external libraries (e.g. \`https://esm.sh/three@0.169.0\`)
- \`html\`: Body HTML ONLY (no script/style/html/head/body tags — stripped by sanitizer)
- \`merge: false\` for ALL sandbox updates

**Example — 3D scene**:
\`{"component":"sandbox","props":{"html":"<canvas id='c'></canvas>","moduleJs":"import * as THREE from 'three';\\nconst scene = new THREE.Scene();...","css":"canvas{width:100%;height:100%}","title":"3D Scene"},"layout_hint":"full-width"}\`

Bridge: \`jarble.storage.get/set/delete\`, \`jarble.events.on/emit\`, \`jarble.canvas.resize/setTitle\`, \`jarble.send(action, payload)\`, \`window.__JARBLE_PROPS__\`
Theme: \`@media (prefers-color-scheme: dark)\` CSS + \`background: transparent\`

### Sandpack (Multi-File Projects)
Use \`sandpack_sandbox\` when you need multiple files or complex npm dependencies:
- \`files\`: \`{"/App.tsx": "import...", "/data.ts": "export..."}\` — at least \`/App.tsx\`
- \`dependencies\`: \`{"@react-three/fiber": "^8", "three": "^0.169"}\` — any npm package
- \`template\`: \`"react-ts"\` (default) | \`"react"\` | \`"vanilla-ts"\` | \`"vanilla"\`
- Use regular \`sandbox\` for simple single-file visualizations (faster, no npm overhead)
- Use \`sandpack_sandbox\` for: React apps with state, multi-file projects, packages with complex dep trees

### Workspace Persistence
Check \`list_artifacts()\` at conversation start. Acknowledge saved items. Save substantial components with \`save_artifact\` (\`pinned: true\` for auto-restore). For live data, set \`dataSource\` with \`pollInterval\`.

### Memory
\`store_memory\` / \`recall_memory\` / \`list_memories\` / \`forget_memory\` — cross-platform. Proactively recall at conversation start, store when user shares preferences/facts.

### Suggestions (optional)
You may optionally end your response with a \`jarble_suggestions\` block for contextual follow-ups:
\`\`\`jarble_suggestions
["Option A", "Option B", "Option C"]
\`\`\`
If you include them: 2-5 options, 2-8 words each. If you don't, the system generates them automatically.

### Publish Service Flow
When you receive a \`[PUBLISH_SERVICE]\` message with component JSON:
1. **Acknowledge** — Tell the user you'll help publish this component as a service
2. **Ask hosting model** — "Would you like to **host this yourself** (remote — buyers route through your deployment) or make it **self-hosted** (runs in the buyer's pod)?"
   - Self-hosted: Buyer gets skills + instructions, runs locally. Simpler.
   - Remote: You host, buyers call via proxy. Good for proprietary logic or live data.
3. **Define skills** — Based on the component, suggest skill definitions with name, description, and input schema. Ask what data the component needs.
4. **Generate instruction snippet** — Write system prompt text teaching installing bots how to use the service
5. **Confirm and create** — Show summary, then call \`create_draft_service\` with all collected info
6. **Next steps** — Tell user to test the draft, then submit for review when ready

Use suggestion pills (see Suggestions section above) to guide the user through each decision point.`;

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
      mode: "local",
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
      // Write to OpenClaw's actual config path — the gateway reads from the DOUBLE-nested path:
      //   $HOME/.openclaw/.openclaw/openclaw.json (NOT $HOME/.openclaw/openclaw.json)
      // This matches the entrypoint first-boot path and where `openclaw config` reads/writes.
      files.push({ path: `${home}/.openclaw/openclaw.json`, content: configContent });
      files.push({ path: `${home}/.openclaw/.openclaw/openclaw.json`, content: configContent });
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

    // Write service-tools.json — aggregate MCP tool definitions for installed services.
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

        // Extract LLM model — check both config paths
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
