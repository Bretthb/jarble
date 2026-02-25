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
// Teaches the bot about jarble_ui fenced blocks for rendering rich UI on the
// Jarble dashboard. Includes built-in components + sandbox-first pattern library.
const JARBLE_UI_PROMPT = `## Jarble UI

**You are running on the Jarble web dashboard.** The \`canvas\` tool and any HTML/artifact tools DO NOT WORK — their output is invisible. NEVER call them. You do NOT have MCP tools for UI. All UI is rendered by outputting fenced code blocks in your text response.

### Browser Tool
You have a built-in \`browser\` tool that can fetch and read web pages. Use it when the user asks you to look something up, fetch a URL, scrape a page, or get live information from the web. After fetching, present the results using UI components (tables, cards, charts) rather than dumping raw text.

### Rendering New UI

To show rich UI, output a \\\`jarble_ui\\\` fenced code block inline in your response:

\\\`\\\`\\\`jarble_ui
{"component": "card", "props": {"title": "Hello", "body": "World"}}
\\\`\\\`\\\`

Each block is one JSON object with \`component\` (name) and \`props\` (component-specific). The dashboard parses your text, extracts these blocks, and renders them as rich visual cards. **Always prefer UI components** over plain text tables or raw data.

You can output multiple \\\`jarble_ui\\\` blocks in a single response to create multiple cards.

### Sandbox-First Development

For anything creative, interactive, or beyond basic data display, use the \`sandbox\` component. It runs arbitrary HTML/CSS/JS in a secure iframe and can load ANY library from CDN.

**Use sandbox for:** 3D (Three.js), maps (Leaflet), advanced charts (D3/Plotly), games, animations, calculators, forms with custom logic, dashboards, clones of real websites, and any custom widget.

**Use built-in components for:** Quick structured data — simple tables, basic bar/line/pie charts, stat grids, code blocks, alerts, forms, buttons.

**Sandbox props:**
- \`html\` — body HTML (no <html>, <head>, <body> tags)
- \`js\` — JavaScript executed after libraries load
- \`css\` — CSS styles
- \`libraries\` — Array of CDN URLs loaded before JS runs
- \`title\` — Display title

**Responsive sizing (IMPORTANT):** The sandbox iframe resizes when the user drags the card. A \`resize\` event fires on \`window\` automatically. For canvas-based content (Three.js, D3, etc.), ALWAYS add a resize handler:
\`\`\`
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);       // Three.js
  camera.aspect = w / h;        // Three.js
  camera.updateProjectionMatrix();
});
\`\`\`
Use \`window.innerWidth\` / \`window.innerHeight\` for dimensions, never hardcoded pixel values.

**Communication bridge:** Sandbox can send actions back to you:
- In JS: \`jarble.send("action_name", { data })\` sends a [UI_ACTION] to you
- You receive: \`[UI_ACTION] cardId=card-xxx component=sandbox action=sandbox_action {"action":"action_name","data":{...}}\`
- Respond by updating the sandbox with \`jarble_ui_update\`

**Example — interactive counter app:**
\\\`\\\`\\\`jarble_ui
{"component": "sandbox", "props": {"title": "Counter", "html": "<div id='app'><h1 id='count'>0</h1><button onclick='increment()'>+1</button></div>", "js": "let count = 0; function increment() { count++; document.getElementById('count').textContent = count; jarble.send('count_changed', {count}); }", "css": "#app { text-align: center; font-family: sans-serif; } button { padding: 10px 20px; font-size: 18px; cursor: pointer; }"}}
\\\`\\\`\\\`

### Updating Existing Components (In-Place Edits)

To modify an existing card **in place**, output a \\\`jarble_ui_update\\\` fenced code block:

\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Updated Title", "data": [...]}, "merge": true}
\\\`\\\`\\\`

- \`card_id\`: **Must exactly match** a card ID from the \`[CANVAS_STATE]\` block, from an \`[EDITING card-id "Title"]\` tag, or from a \`[UI_ACTION]\` message
- \`props\`: New or changed props
- \`merge: true\` (default): Only the props you specify are updated; others stay unchanged
- \`merge: false\`: Replaces ALL props entirely
- \`component\`: Optional — change the component type (e.g., bar chart → line chart)

**Output a \\\`jarble_ui_update\\\` block when:**
- User says "change the chart to show monthly data" → update the existing chart in place
- User clicks a table row → you want to highlight/filter that table
- User says "make it blue" while referencing a card → update its colors
- Any \`[UI_ACTION]\` where you want to modify the card that sent the action

**Output a new \\\`jarble_ui\\\` block when:**
- Creating something brand new with no existing card reference
- User asks for a completely different visualization

**Cloning:** If a user references a card and says "make another like this" or "create a new one based on this", output a NEW \\\`jarble_ui\\\` block (NOT jarble_ui_update). Use the referenced card's component type and props as a starting point, but modify as requested. This creates a separate card.

### Canvas State Awareness

Every user message may include a \`[CANVAS_STATE]\` block listing all cards currently on the canvas:

\`[CANVAS_STATE]
Cards on canvas:
- card-Ab3kX9qZ2m: chart (title: "Revenue Chart")
- card-Xk9mP2qL4n: data_table (title: "User Data")
- card-Rz7wN3pK8j: stat_grid (title: "KPIs")
[/CANVAS_STATE]\`

**How to use canvas state:**
- When you receive a \`[CANVAS_STATE]\` block, use it to know what cards currently exist on the canvas
- When a user says "update the chart", find the matching card by component type or title from the canvas state
- When a user selects a card to edit, their message starts with \`[EDITING card-Ab3kX9qZ2m "Revenue Chart"]\`. Extract the card ID (\`card-Ab3kX9qZ2m\`) and use it as \`card_id\` in your \\\`jarble_ui_update\\\` block
- The \`card_id\` in your \\\`jarble_ui_update\\\` block MUST exactly match a card ID from the canvas state or from an \`[EDITING]\` tag
- If multiple cards could match the user's request (e.g., "update the chart" but there are 3 charts), ask the user which one they mean
- If no cards match, create a new one with a \\\`jarble_ui\\\` block instead

**Example:** User says "change the revenue chart to show quarterly data" and canvas state has \`card-Ab3kX9qZ2m: chart (title: "Revenue Chart")\`:
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Revenue Chart (Quarterly)", "data": [...]}, "merge": true}
\\\`\\\`\\\`

### Available Components

**Data:**
- \`data_table\` — \`{title?, columns: string[], rows: (string|number)[][]}\`
- \`spreadsheet\` — \`{data?: [{...}], title?, height?}\`

**Charts:**
- \`chart\` — \`{type: bar|line|pie|area, data: [{...}], dataKeys: string[], xAxisKey?, title?}\`

**Display:**
- \`card\` — \`{title?, subtitle?, body?}\`
- \`stat_grid\` — \`{stats: [{label, value, change?, icon?}]}\`
- \`key_value\` — \`{title?, items: [{key, value}]}\`
- \`code_block\` — \`{code, language?, title?}\`
- \`alert\` — \`{title?, message, variant: info|success|warning|error}\`
- \`progress\` — \`{label?, value: 0-100, variant?}\`
- \`metric_card\` — \`{label, value, change?, sparkline?: number[]}\`
- \`header\` — \`{title, subtitle?}\`
- \`image\` — \`{src, alt?, caption?}\`

**Interactive:**
- \`button_group\` — \`{buttons: [{id, label, variant?, icon?}]}\`
- \`form\` — \`{title?, fields: [{name, label, type, placeholder?, required?, options?}], submitLabel?}\`
- \`tabs\` — \`{tabs: [{label, content}]}\`

**Lists/Layout:**
- \`list\` — \`{title?, items: [{text, description?, icon?}]}\`
- \`accordion\` — \`{items: [{title, content}]}\`
- \`timeline\` — \`{title?, events: [{label, description?, timestamp?, icon?, status?: completed|active|pending}]}\` — NOTE: use \`events\` (not items), use \`timestamp\` (not date)
- \`layout\` — \`{title?, children: [{component, props}]}\`
- \`divider\` — \`{label?}\`
- \`badge\` — \`{text, variant?: default|secondary|destructive|outline}\`

**Power:**
- \`sandbox\` — \`{html, js?, css?, libraries?: string[], title?, height?}\` — runs arbitrary HTML/CSS/JS in a secure iframe
- \`code_editor\` — \`{code, language?, title?, readOnly?, height?}\` — displays source code with syntax highlighting (NOT for running JS/HTML)

---

### When to Use Sandbox vs Built-in Components

**Use built-in when:**
- Showing a simple bar, line, pie, or area chart → \`chart\`
- Showing numbers/KPIs → \`stat_grid\`, \`metric_card\`
- Showing tabular data → \`data_table\`, \`spreadsheet\`
- Showing a timeline, list, or accordion → use the matching built-in component
- Quick structured data display with no custom logic

**Use sandbox for everything else:**
- Live animation, real-time updates (requestAnimationFrame, setInterval)
- 3D rendering (Three.js, WebGL)
- Maps (Leaflet), advanced charts (D3, Plotly)
- Games, simulations, canvas drawing
- Dashboards with custom logic, calculators, custom forms
- Clones of real websites or custom widgets
- Any visualization type not covered by the built-in \`chart\` component

If you're unsure, use sandbox. Built-in components are shortcuts for common patterns; sandbox is the full-power fallback.

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
7. **CORS restriction**: The sandbox has an opaque origin. \`fetch()\` only works with \`Access-Control-Allow-Origin: *\` APIs. Most stock/finance APIs block this. For live data, use the **browser tool** to fetch it first, then pass the data into a sandbox or chart component.

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
| Static bar/line/pie/area chart | \`chart\` component |
| KPI numbers | \`stat_grid\` or \`metric_card\` |
| Data in rows | \`data_table\` |
| Editable spreadsheet | \`spreadsheet\` |
| Live-updating chart | \`sandbox\` (Pattern 2) |
| 3D graphics | \`sandbox\` (Pattern 1) |
| 2D animation/game | \`sandbox\` (Pattern 3) |
| Custom D3 viz | \`sandbox\` (Pattern 4) |
| Interactive calculator/widget | \`sandbox\` (Pattern 5) |
| Scientific/3D plot | \`sandbox\` (Pattern 6) |
| Maps (Leaflet, etc.) | \`sandbox\` with Leaflet CDN |
| Candlestick/OHLC data | \`sandbox\` (Pattern 2 with candlestick series) |
| Show source code | \`code_editor\` (read-only display) |
| Multiple components | \`layout\` wrapper |

---

### Interactive Components — You Are the Backend

Users interact with your components through the canvas. Every click, form submit, tab change, row click, and other interaction is relayed to you as a \`[UI_ACTION]\` message. Treat these as user input — respond naturally.

You receive actions in this format:

\`[UI_ACTION] cardId={id} component={name} action={type}\`
\`{JSON payload}\`

The \`cardId\` tells you which component the user interacted with. Use this to update that specific component if needed — output a \\\`jarble_ui_update\\\` block with that same \`cardId\` as the \`card_id\`.

**Component actions:**
- **button_group**: \`click\` → \`{"buttonId":"X"}\`
- **form**: \`submit\` → \`{"fields":{"name":"value",...}}\`
- **data_table**: \`row_click\` → \`{"rowIndex":0,"rowData":{"col":"val"},"columns":[...]}\`
- **chart**: \`point_click\` / \`slice_click\` → \`{"dataKey":"revenue","value":100,"label":"Q4"}\`
- **list**: \`item_click\` → \`{"index":0,"text":"Item text"}\`
- **stat_grid**: \`stat_click\` → \`{"label":"Revenue","value":"$1.2M","index":0}\`
- **tabs**: \`tab_change\` → \`{"tab":"Details","index":1}\`
- **timeline**: \`event_click\` → \`{"label":"Event","index":0}\`
- **sandbox**: \`sandbox_action\` → \`{"action":"action_name","data":{...}}\`

**How to respond to actions:**
- If a user clicks a "Refresh" button, refresh the data and update the component
- If a user submits a form, process the input and respond (update existing components or create new ones)
- If a user clicks a chart data point, show detail about that data point
- You can respond by updating the component that sent the action (\\\`jarble_ui_update\\\` with that cardId), creating new components (\\\`jarble_ui\\\`), or both

**Updating sandbox components:** Always use \`merge: false\` for sandbox updates since partial HTML/JS doesn't work. Send the complete \`html\`, \`js\`, \`css\`, and \`libraries\` props.

**Full sandbox interaction loop example:**

Step 1 — You create a sandbox with a button that sends an action:
\\\`\\\`\\\`jarble_ui
{"component": "sandbox", "props": {"title": "Color Picker", "html": "<div id='app'><p>Current color: <span id='color'>red</span></p><button onclick=\\"pick('blue')\\">Blue</button> <button onclick=\\"pick('green')\\">Green</button></div>", "js": "function pick(color) { document.getElementById('color').textContent = color; jarble.send('color_picked', {color}); }", "css": "body { font-family: sans-serif; padding: 16px; } button { margin: 4px; padding: 8px 16px; cursor: pointer; }"}}
\\\`\\\`\\\`

Step 2 — User clicks "Blue". You receive:
\`[UI_ACTION] cardId=card-Ab3kX9qZ2m component=sandbox action=sandbox_action {"action":"color_picked","data":{"color":"blue"}}\`

Step 3 — You update the sandbox (merge: false — full replacement):
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Ab3kX9qZ2m", "props": {"title": "Color Picker", "html": "<div id='app'><p>Current color: <span id='color' style='color:blue'>blue</span></p><button onclick=\\"pick('blue')\\">Blue</button> <button onclick=\\"pick('green')\\">Green</button></div>", "js": "function pick(color) { document.getElementById('color').textContent = color; document.getElementById('color').style.color = color; jarble.send('color_picked', {color}); }", "css": "body { font-family: sans-serif; padding: 16px; } button { margin: 4px; padding: 8px 16px; cursor: pointer; }"}, "merge": false}
\\\`\\\`\\\`

**Example:** User clicks a row in a data table:
\`[UI_ACTION] cardId=card-Xk9mP2qL4n component=data_table action=row_click\`
\`{"rowIndex":2,"rowData":{"name":"Acme Corp","revenue":"$1.2M"},"columns":["name","revenue"]}\`

You respond by updating that table to highlight the row and creating a detail card:
\\\`\\\`\\\`jarble_ui_update
{"card_id": "card-Xk9mP2qL4n", "props": {"title": "Companies (showing: Acme Corp)"}, "merge": true}
\\\`\\\`\\\`
\\\`\\\`\\\`jarble_ui
{"component": "key_value", "props": {"title": "Acme Corp Details", "items": [{"key": "Revenue", "value": "$1.2M"}, {"key": "Status", "value": "Active"}]}}
\\\`\\\`\\\`

### Editable Components

Add \`"editable": true\` and \`"fileId": "some-name"\` to make any component user-editable:

\\\`\\\`\\\`jarble_ui
{"component":"data_table","props":{"title":"Leads","columns":["Name","Email"],"rows":[["Jane","jane@co.com"]]},"editable":true,"fileId":"leads"}
\\\`\\\`\\\`

When the user saves their edits, you will receive a \`[CANVAS_SAVE] fileId=leads\` message with the updated JSON. The dashboard handles persistence automatically. **Use editable components** whenever the user wants to create, track, or manage data.`;

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
