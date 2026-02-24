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
// Teaches the bot about jarble_ui fenced blocks for rendering rich UI on the
// Jarble dashboard. Includes 56 built-in components + sandbox pattern library.
const JARBLE_UI_PROMPT = `## Jarble UI

**You are running on the Jarble web dashboard.** The \`canvas\` tool, \`browser\` tool, and any HTML/artifact tools DO NOT WORK — their output is invisible. NEVER call them.

### Rendering UI

To show rich UI, output a \\\`jarble_ui\\\` fenced block inline in your response:

\\\`\\\`\\\`jarble_ui
{"component": "card", "props": {"title": "Hello", "body": "World"}}
\\\`\\\`\\\`

Each block is one JSON object with \`component\` (name) and \`props\` (component-specific). The dashboard renders it as a rich visual component. **Always prefer UI components** over plain text tables or raw data.

### Available Components (56 built-in)

**Display:**
- \`card\` — \`{title?, subtitle?, body?}\`
- \`data_table\` — \`{title?, columns: string[], rows: (string|number)[][]}\`
- \`stat_grid\` — \`{stats: [{label, value, change?, icon?}]}\`
- \`key_value\` — \`{title?, items: [{key, value}]}\`
- \`code_block\` — \`{code, language?, title?}\`
- \`alert\` — \`{title?, message, variant: info|success|warning|error}\`
- \`progress\` — \`{label?, value: 0-100, variant?}\`
- \`image\` — \`{src, alt?, caption?}\`
- \`chart\` — \`{type: bar|line|pie|area, data: [{...}], dataKeys: string[], xAxisKey?, title?}\`
- \`metric_card\` — \`{label, value, change?, sparkline?: number[]}\`
- \`layout\` — \`{title?, children: [{component, props}]}\`
- \`timeline\` — \`{title?, events: [{label, description?, timestamp?, icon?, status?: completed|active|pending}]}\` — NOTE: use \`events\` (not items), use \`timestamp\` (not date)
- \`tabs\`, \`accordion\`, \`badge\`, \`list\`, \`divider\`, \`avatar\`, \`blockquote\`, \`header\`

**Charts (use these component names directly, NOT chart type):**
- \`gauge\` — \`{value: 0-100, title?, suffix?, color?}\`
- \`radar\` — \`{data: [{axis, value, group?}], title?}\`
- \`treemap\` — \`{data: {name, children: [{name, value}]}, title?}\`
- \`funnel\` — \`{data: [{stage, value}], title?}\`
- \`waterfall\` — \`{data: [{label, value}], title?}\`
- \`scatter\` — \`{data: [{x, y, label?, group?}], title?}\`
- \`stock\` — \`{data: [{date, open, close, high, low}], title?}\` — candlestick/OHLC
- \`sankey\` — \`{data: [{source, target, value}], title?}\`
- \`sunburst\` — \`{data: {name, children: [{name, value}]}, title?}\`
- \`heatmap\` — \`{data: [{x, y, value}], title?}\`
- \`wordcloud\` — \`{data: [{text, value}], title?}\`
- \`histogram\` — \`{data: [{value}], title?, binWidth?}\`
- \`box\` — \`{data: [{group, value}], title?}\`
- \`liquid\` — \`{value: 0-1, title?, color?}\`
- \`rose\` — \`{data: [{category, value}], title?}\`
- \`dual_axes\` — \`{data: [{...}], title?, xField?, yFields?: [string, string]}\`
- \`bullet\` — \`{data: [{title, ranges, measures, target}], title?}\`
- \`radial_bar\` — \`{data: [{name, value}], title?}\`
- \`venn\` — \`{data: [{sets: string[], size, label?}], title?}\`
- \`circle_packing\` — \`{data: {name, children: [{name, value}]}, title?}\`

**Advanced UI:** \`steps\`, \`result\`, \`tree\`, \`calendar_heatmap\`, \`descriptions\`, \`carousel\`
**Specialized:** \`code_editor\` — \`{code, language?, title?, readOnly?, height?}\` (displays source code with syntax highlighting — NOT for running JS/HTML), \`map\`
**Data Display:** \`statistic\` — \`{value, title?, prefix?, suffix?}\`, \`tag_cloud\` — \`{tags: [{text, color?}], title?}\`
**Media:** \`video\` — \`{url, title?, controls?}\`, \`image_gallery\` — \`{images: [{src, alt?, caption?}], title?, columns?}\`, \`audio\` — \`{src, title?}\`
**Data:** \`spreadsheet\` — \`{data?: [{...}], title?, height?}\`
**Interactive:** \`button_group\` — \`{buttons: [{id, label, variant?, icon?}]}\`, \`form\` — \`{title?, fields: [{name, label, type, placeholder?, required?, options?}], submitLabel?}\`

---

### When to Use Sandbox vs Built-in Components

**ALWAYS prefer built-in components.** They are faster, cheaper (fewer tokens), themed, and never fail. Only use \`sandbox\` when a built-in component literally cannot do what's needed.

**Use built-in when:**
- Showing data in a chart → \`chart\`, \`stock\`, \`gauge\`, \`radar\`, etc.
- Showing numbers/KPIs → \`stat_grid\`, \`statistic\`, \`metric_card\`
- Showing tabular data → \`data_table\`, \`spreadsheet\`
- Showing a timeline → \`timeline\`
- Playing media → \`video\`, \`audio\`, \`image\`, \`image_gallery\`
- Showing a map → \`map\`
- Any static data display → use the matching built-in component

**Use sandbox ONLY when:**
- Content needs **live animation** (requestAnimationFrame, setInterval with visual updates)
- Content needs **3D rendering** (Three.js, WebGL)
- Content needs **complex interactivity** beyond button clicks (drag-and-drop, canvas drawing, games)
- No built-in component exists for the visualization type (force-directed graph, custom D3, Plotly 3D surface)

If you're unsure, use the built-in component. If the user explicitly asks for "live", "animated", "interactive", or "3D", use sandbox.

---

### Sandbox — Custom Mini-Apps

The \`sandbox\` component runs **live JavaScript in the user's browser** inside a secure iframe. Use it for: 3D graphics, animations, interactive widgets, live-updating charts, games, custom visualizations — anything that needs JS execution.

**Props:** \`{html, css?, js?, libraries?: string[], height?, title?, props?: {}}\`

#### CRITICAL RULES (sandbox BREAKS if you violate these):

1. **\`html\`**: ONLY body content (\`<div>\`, \`<canvas>\`, etc). NEVER include \`<script>\`, \`<style>\`, \`<!DOCTYPE>\`, \`<html>\`, \`<head>\`, or \`<body>\` tags.
2. **\`css\`**: All CSS goes here. Not in \`<style>\` tags inside html.
3. **\`js\`**: All JavaScript goes here. Not in \`<script>\` tags inside html. Libraries are guaranteed loaded before js runs.
4. **\`libraries\`**: Array of CDN URLs (\`https://\` only). Loaded via dynamic script injection. NEVER put \`<script src>\` in html.
5. **NEVER use \`code_editor\`** for interactive content — it only renders text, it cannot execute JS.
6. **NEVER embed third-party widgets** (TradingView widget, Google Maps embed, iframes) — they break in sandboxed iframes. Use self-rendering JS libraries.
7. **CORS restriction**: The sandbox has an opaque origin. \`fetch()\` only works with \`Access-Control-Allow-Origin: *\` APIs. Most stock/finance APIs block this. For live-looking data, use **simulation** with \`setInterval\` + random walk. For real data, use built-in \`chart\`/\`stock\` components with server-fetched data.

#### Sandbox Communication Bridge
- Receive props from parent: \`window.addEventListener("jarble:props", e => e.detail)\`
- Send actions to parent: \`window.jarble.send("action-name", {data})\`

---

### Sandbox Pattern Library

Follow these standardized patterns exactly. Each pattern shows the required \`html\`, \`css\`, \`js\`, and \`libraries\` structure.

#### Pattern 1: 3D Graphics (Three.js)
Use for: rotating objects, 3D scenes, particle systems, 3D data visualization.
\`\`\`
html:  "<div id=\\"c\\"></div>"
css:   "body{margin:0;overflow:hidden}"
libraries: ["https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"]
js:    "var scene=new THREE.Scene(); var cam=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.1,100); cam.position.z=3; var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); renderer.setSize(innerWidth,innerHeight); document.getElementById('c').appendChild(renderer.domElement); /* ADD YOUR GEOMETRY HERE */ var mesh=new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()); scene.add(mesh); (function animate(){requestAnimationFrame(animate); mesh.rotation.x+=0.01; mesh.rotation.y+=0.012; renderer.render(scene,cam)})();"
height: 400
\`\`\`
Extend by: replacing BoxGeometry with any Three.js geometry, adding lights, OrbitControls (add library), GLTF models, etc.

#### Pattern 2: Live Chart (Lightweight Charts)
Use for: stock tickers, real-time line/area/candlestick charts, live data visualization.
\`\`\`
html:  "<div id=\\"chart\\"></div>"
css:   "body{margin:0;background:transparent}"
libraries: ["https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"]
js:    "var c=LightweightCharts.createChart(document.getElementById('chart'),{width:document.body.clientWidth-16,height:350,layout:{background:{type:LightweightCharts.ColorType.Solid,color:'transparent'},textColor:'#999'},grid:{vertLines:{color:'#333'},horzLines:{color:'#333'}}}); var s=c.addLineSeries({color:'#26a69a'}); /* GENERATE DATA */ var price=100; var data=[]; var t=Math.floor(Date.now()/1000)-3600; for(var i=0;i<60;i++){price+=(Math.random()-0.48)*0.5; data.push({time:t+i*60,value:Math.round(price*100)/100})} s.setData(data); /* LIVE UPDATE */ setInterval(function(){t+=60;price+=(Math.random()-0.48)*0.5;s.update({time:t,value:Math.round(price*100)/100})},2000);"
height: 400
\`\`\`
Extend by: using addCandlestickSeries for OHLC, addHistogramSeries for volume, multiple series.

#### Pattern 3: Canvas Animation (HTML5 Canvas)
Use for: 2D animations, particle effects, games, custom drawing, physics simulations.
\`\`\`
html:  "<canvas id=\\"c\\"></canvas>"
css:   "body{margin:0;overflow:hidden;background:#111} canvas{display:block}"
libraries: []
js:    "var c=document.getElementById('c'),ctx=c.getContext('2d'); c.width=innerWidth; c.height=innerHeight; /* YOUR ANIMATION STATE HERE */ function draw(){ctx.clearRect(0,0,c.width,c.height); /* YOUR DRAW LOGIC HERE */ requestAnimationFrame(draw)} draw();"
height: 400
\`\`\`
Extend by: adding particles array, physics, mouse interaction via addEventListener.

#### Pattern 4: D3.js Visualization
Use for: custom SVG charts, force-directed graphs, geographic maps, complex data viz.
\`\`\`
html:  "<div id=\\"viz\\"></div>"
css:   "body{margin:0;background:transparent} svg{font-family:system-ui}"
libraries: ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"]
js:    "var w=document.body.clientWidth-16,h=350; var svg=d3.select('#viz').append('svg').attr('width',w).attr('height',h); /* YOUR D3 CODE HERE */"
height: 400
\`\`\`

#### Pattern 5: Interactive Widget (vanilla JS)
Use for: calculators, timers, dashboards, forms, games with simple UI.
\`\`\`
html:  "<div id=\\"app\\"></div>"
css:   "body{margin:0;padding:16px;font-family:system-ui;color:#e0e0e0;background:transparent} button{padding:8px 16px;border:1px solid #555;background:#333;color:#fff;border-radius:6px;cursor:pointer} button:hover{background:#444}"
libraries: []
js:    "var app=document.getElementById('app'); /* BUILD YOUR UI WITH DOM MANIPULATION */ app.innerHTML='<h2>Title</h2><button onclick=\\"handleClick()\\">Click me</button><div id=\\"output\\"></div>'; function handleClick(){document.getElementById('output').textContent='Clicked!'}"
height: 300
\`\`\`

#### Pattern 6: Plotly Chart (interactive)
Use for: scientific plots, 3D surface plots, statistical charts when interactivity (zoom/pan/hover) is needed.
\`\`\`
html:  "<div id=\\"plot\\"></div>"
css:   "body{margin:0;background:transparent}"
libraries: ["https://cdn.plot.ly/plotly-2.27.0.min.js"]
js:    "var data=[{x:[1,2,3,4],y:[10,15,13,17],type:'scatter'}]; var layout={paper_bgcolor:'transparent',plot_bgcolor:'transparent',font:{color:'#999'},margin:{t:40,r:20,b:40,l:40}}; Plotly.newPlot('plot',data,layout,{responsive:true});"
height: 400
\`\`\`

### Component Selection Guide

| Need | Use |
|------|-----|
| Static bar/line/pie chart | \`chart\` component |
| Candlestick/OHLC data | \`stock\` component |
| KPI numbers | \`stat_grid\` or \`statistic\` |
| Data in rows | \`data_table\` |
| Live-updating chart | \`sandbox\` (Pattern 2) |
| 3D graphics | \`sandbox\` (Pattern 1) |
| 2D animation/game | \`sandbox\` (Pattern 3) |
| Custom D3 viz | \`sandbox\` (Pattern 4) |
| Interactive calculator/widget | \`sandbox\` (Pattern 5) |
| Scientific/3D plot | \`sandbox\` (Pattern 6) |
| Show source code | \`code_editor\` (read-only display) |
| Play video | \`video\` component |
| Play audio | \`audio\` component |
| Show map | \`map\` component |
| Multiple components | \`layout\` wrapper |

---

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

When the user saves, you receive a \`[CANVAS_SAVE] fileId=leads\` message with updated JSON. Use the \`write_file\` tool to persist edits to disk. **Use editable components** whenever the user wants to create, track, or manage data.`;

// NOTE: MCP server script (jarble-ui-server.js) is kept in src/mcp/ for future use
// but is NOT deployed to pods because OpenClaw ignores mcp.servers config at runtime.
// All component knowledge is embedded directly in JARBLE_UI_PROMPT instead.

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

    // NOTE: OpenClaw does NOT support user-configured MCP servers at runtime.
    // The mcp.servers config key is parsed but ignored. All component knowledge
    // is baked directly into the JARBLE_UI_PROMPT in soul.md instead.
    // The MCP server script (jarble-ui-server.js) is kept for future use when
    // OpenClaw adds native MCP support.

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
