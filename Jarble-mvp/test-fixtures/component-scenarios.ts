/**
 * Visual QA Test Fixtures — 7 scenario groups covering all 38 canvas components.
 *
 * Each scenario is an array of CanvasCard objects with realistic, professional data.
 * Props are designed to pass Zod validation from @jarble/component-manifest schemas.
 *
 * Usage: inject into localStorage as `jarble-canvas-{deploymentId}` in PersistedState format.
 */

// ── Types (matching useCanvasPersistence.ts PersistedState) ─────────────────

export interface PersistedCard {
  id: string;
  component: string;
  props: Record<string, unknown>;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minimized: boolean;
  createdAt: number;
  title?: string;
}

export interface PersistedState {
  cards: PersistedCard[];
  viewportOffset: { x: number; y: number };
  zoom: number;
  savedAt: number;
  mode: "dashboard" | "freeform";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let cardCounter = 0;
const ts = Date.now();

function makeCard(
  component: string,
  props: Record<string, unknown>,
  size: { width: number; height: number },
  title?: string
): PersistedCard {
  cardCounter++;
  return {
    id: `qa-${component}-${cardCounter}`,
    component,
    props,
    position: { x: 0, y: 0 },
    size,
    minimized: false,
    createdAt: ts - cardCounter * 1000,
    title,
  };
}

// ── Scenario 1: Sales Dashboard ─────────────────────────────────────────────

export const salesDashboard: PersistedCard[] = [
  makeCard("stat_grid", {
    stats: [
      { label: "Total Revenue", value: "$1.24M", change: "+12.5%" },
      { label: "Active Customers", value: 3847, change: "+8.2%" },
      { label: "Avg. Order Value", value: "$342", change: "-2.1%" },
      { label: "Conversion Rate", value: "3.8%", change: "+0.5%" },
    ],
  }, { width: 400, height: 200 }, "Q1 Sales KPIs"),

  makeCard("chart", {
    type: "line",
    title: "Monthly Revenue Trend",
    data: [
      { month: "Jul", revenue: 84000, target: 80000 },
      { month: "Aug", revenue: 91000, target: 85000 },
      { month: "Sep", revenue: 88000, target: 90000 },
      { month: "Oct", revenue: 105000, target: 95000 },
      { month: "Nov", revenue: 112000, target: 100000 },
      { month: "Dec", revenue: 134000, target: 110000 },
      { month: "Jan", revenue: 128000, target: 120000 },
      { month: "Feb", revenue: 142000, target: 125000 },
    ],
    dataKeys: ["revenue", "target"],
    xAxisKey: "month",
    colors: ["#3b82f6", "#94a3b8"],
    showLegend: true,
    showGrid: true,
  }, { width: 460, height: 300 }, "Revenue Trend"),

  makeCard("chart", {
    type: "bar",
    title: "Revenue by Product",
    data: [
      { product: "Enterprise", q1: 420000, q2: 380000 },
      { product: "Pro", q1: 310000, q2: 340000 },
      { product: "Starter", q1: 180000, q2: 210000 },
      { product: "Free Trial", q1: 45000, q2: 52000 },
    ],
    dataKeys: ["q1", "q2"],
    xAxisKey: "product",
    colors: ["#6366f1", "#a78bfa"],
    stacked: false,
    showLegend: true,
  }, { width: 460, height: 300 }, "Product Breakdown"),

  makeCard("data_table", {
    title: "Top 10 Customers",
    columns: ["Customer", "Revenue", "Orders", "LTV", "Status"],
    rows: [
      ["Acme Corp", "$128,400", 47, "$342,100", "Enterprise"],
      ["TechStart Inc", "$94,200", 31, "$218,500", "Pro"],
      ["GlobalTrade", "$87,600", 28, "$195,800", "Enterprise"],
      ["DataFlow Ltd", "$72,300", 24, "$168,200", "Pro"],
      ["CloudPeak", "$68,900", 22, "$152,400", "Enterprise"],
      ["NetBridge", "$61,200", 19, "$134,800", "Pro"],
      ["PixelForge", "$54,800", 17, "$112,300", "Starter"],
      ["StreamLine", "$48,500", 15, "$98,600", "Pro"],
      ["CodeVault", "$43,200", 14, "$87,400", "Starter"],
      ["BrightPath", "$38,900", 12, "$76,200", "Starter"],
    ],
  }, { width: 460, height: 300 }, "Top Customers"),

  makeCard("progress", {
    label: "Quarterly Target ($1.5M)",
    value: 83,
    variant: "success",
  }, { width: 280, height: 90 }, "Q1 Progress"),

  makeCard("alert", {
    title: "Q1 Closing Soon",
    message: "Only 18 days left in Q1. Current pace: $1.24M of $1.5M target. Need $17.2K/day to hit goal.",
    variant: "info",
  }, { width: 340, height: 100 }, "Quarter Alert"),
];

// ── Scenario 2: Project Management ──────────────────────────────────────────

export const projectManagement: PersistedCard[] = [
  makeCard("stat_grid", {
    stats: [
      { label: "Sprint Velocity", value: 42, change: "+3 pts" },
      { label: "Open Issues", value: 18, change: "-5" },
      { label: "PR Merge Time", value: "4.2h", change: "-1.8h" },
      { label: "Test Coverage", value: "87%", change: "+2.3%" },
    ],
  }, { width: 400, height: 200 }, "Sprint 14 Metrics"),

  makeCard("timeline", {
    title: "Project Milestones",
    events: [
      { label: "Alpha Release", description: "Core features complete, internal testing", timestamp: "2026-01-15", status: "completed" },
      { label: "Beta Launch", description: "Public beta with 50 users", timestamp: "2026-02-01", status: "completed" },
      { label: "Security Audit", description: "Third-party penetration testing", timestamp: "2026-02-20", status: "active" },
      { label: "GA Release", description: "General availability with full docs", timestamp: "2026-03-15", status: "pending" },
      { label: "Enterprise Features", description: "SSO, RBAC, audit logs", timestamp: "2026-04-01", status: "pending" },
    ],
  }, { width: 320, height: 280 }, "Milestones"),

  makeCard("list", {
    title: "Sprint Backlog",
    items: [
      { text: "Implement WebSocket reconnection", description: "Auto-reconnect with exponential backoff", badge: "High", badgeVariant: "destructive" },
      { text: "Add rate limiting to API", description: "Token bucket algorithm, 100 req/min", badge: "High", badgeVariant: "destructive" },
      { text: "Dashboard performance optimization", description: "Reduce bundle size by 40%", badge: "Medium", badgeVariant: "warning" },
      { text: "Update onboarding wizard", description: "Add runtime selection step", badge: "Medium", badgeVariant: "warning" },
      { text: "Fix timezone handling in scheduler", description: "Use Temporal API for date math", badge: "Low", badgeVariant: "secondary" },
    ],
    ordered: true,
  }, { width: 320, height: 260 }, "Backlog"),

  makeCard("progress", {
    label: "Sprint 14 Progress",
    value: 68,
    variant: "default",
  }, { width: 280, height: 90 }, "Sprint Progress"),

  makeCard("card", {
    title: "Project Nova",
    subtitle: "Next-gen deployment platform",
    body: "A complete rewrite of the bot deployment infrastructure using Kubernetes operators for lifecycle management. Target: 50% reduction in deployment time.",
    status: "info",
  }, { width: 300, height: 180 }, "Project Summary"),

  makeCard("header", {
    title: "Team: Platform Engineering",
    subtitle: "8 engineers · Sprint 14 · Feb 17 - Mar 2",
    level: 2,
    divider: true,
  }, { width: 360, height: 70 }, "Team Header"),
];

// ── Scenario 3: Support Analytics ───────────────────────────────────────────

export const supportAnalytics: PersistedCard[] = [
  makeCard("chart", {
    type: "area",
    title: "Ticket Volume (30 days)",
    data: [
      { day: "Feb 1", tickets: 45, resolved: 42 },
      { day: "Feb 5", tickets: 52, resolved: 48 },
      { day: "Feb 10", tickets: 38, resolved: 40 },
      { day: "Feb 15", tickets: 67, resolved: 55 },
      { day: "Feb 20", tickets: 58, resolved: 60 },
      { day: "Feb 25", tickets: 43, resolved: 45 },
      { day: "Mar 1", tickets: 51, resolved: 47 },
    ],
    dataKeys: ["tickets", "resolved"],
    xAxisKey: "day",
    colors: ["#ef4444", "#22c55e"],
    showLegend: true,
    showGrid: true,
  }, { width: 460, height: 300 }, "Ticket Volume"),

  makeCard("stat_grid", {
    stats: [
      { label: "Avg Response Time", value: "2.4h", change: "-18min" },
      { label: "First Contact Resolution", value: "73%", change: "+5%" },
      { label: "CSAT Score", value: "4.6/5", change: "+0.2" },
      { label: "Active Tickets", value: 23, change: "-7" },
    ],
  }, { width: 400, height: 200 }, "Response Metrics"),

  makeCard("data_table", {
    title: "Open Tickets",
    columns: ["ID", "Subject", "Priority", "Assignee", "Age"],
    rows: [
      ["#4521", "Login fails with SSO", "Critical", "Sarah K.", "2h"],
      ["#4518", "Dashboard slow on mobile", "High", "Mike R.", "6h"],
      ["#4515", "Export CSV missing columns", "Medium", "Lisa M.", "1d"],
      ["#4512", "Webhook retries not working", "High", "James L.", "1d"],
      ["#4509", "Dark mode toggle broken", "Low", "Unassigned", "3d"],
      ["#4506", "API rate limit too strict", "Medium", "Sarah K.", "3d"],
    ],
  }, { width: 460, height: 300 }, "Open Tickets"),

  makeCard("alert", {
    title: "SLA Breach Warning",
    message: "3 tickets are approaching SLA deadline. Ticket #4521 (Critical) has 45 minutes remaining. Escalation will trigger automatically.",
    variant: "warning",
  }, { width: 340, height: 100 }, "SLA Warning"),

  makeCard("accordion", {
    items: [
      { title: "How do I reset my API key?", content: "Go to Settings → API Keys → Click 'Regenerate'. Your old key will be invalidated immediately." },
      { title: "Why is my deployment stuck at 'creating'?", content: "This usually means npm install is still running. Wait 2-3 minutes. If it persists, try restarting the deployment." },
      { title: "Can I use my own domain?", content: "Custom domains are available on the Enterprise plan. Contact sales@jarble.ai for details." },
      { title: "How do I connect WhatsApp?", content: "Navigate to your deployment → Channels → WhatsApp. Scan the QR code with WhatsApp on your phone." },
    ],
    type: "single",
  }, { width: 400, height: 300 }, "FAQ"),

  makeCard("tabs", {
    tabs: [
      { label: "Email", content: "Email: 42% of tickets (avg resolution: 4.2h)\nTop issues: billing, account access, data export" },
      { label: "Chat", content: "Live Chat: 35% of tickets (avg resolution: 12min)\nTop issues: deployment help, configuration, quick fixes" },
      { label: "Phone", content: "Phone: 15% of tickets (avg resolution: 8min)\nEnterprise-only, scheduled callbacks within 1h" },
      { label: "Social", content: "Social: 8% of tickets (avg resolution: 1.5h)\nTwitter/X mentions, Discord community, GitHub issues" },
    ],
    defaultTab: 0,
  }, { width: 400, height: 300 }, "Channels"),
];

// ── Scenario 4: Developer Documentation ─────────────────────────────────────

export const developerDocs: PersistedCard[] = [
  makeCard("code_block", {
    code: `// Create a new deployment via the API
const response = await fetch('https://api.jarble.ai/trpc/deployment.create', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'my-chatbot',
    runtime: 'openclaw',
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4-5-20250514',
    systemPrompt: 'You are a helpful assistant.',
  }),
});

const { id, status } = await response.json();
console.log(\`Deployment \${id} is \${status}\`);`,
    language: "typescript",
    title: "Quick Start: Create Deployment",
  }, { width: 400, height: 240 }, "API Example"),

  makeCard("card", {
    title: "Getting Started",
    subtitle: "Build your first bot in 5 minutes",
    body: "1. Sign up at app.jarble.ai\n2. Create a new deployment\n3. Choose a runtime (OpenClaw recommended)\n4. Add your LLM API key\n5. Connect a messaging platform\n\nThat's it! Your bot is live.",
    icon: "🚀",
  }, { width: 300, height: 180 }, "Getting Started"),

  makeCard("key_value", {
    title: "Configuration Reference",
    items: [
      { key: "RUNTIME", value: "openclaw | zeroclaw" },
      { key: "LLM_PROVIDER", value: "anthropic | openai | openrouter | google" },
      { key: "LLM_MODEL", value: "claude-sonnet-4-5-20250514 | gpt-4o | etc." },
      { key: "GATEWAY_PORT", value: "18789 (default)" },
      { key: "LOG_LEVEL", value: "debug | info | warn | error" },
      { key: "MAX_TOKENS", value: "4096 (default)" },
    ],
  }, { width: 320, height: 220 }, "Config Reference"),

  makeCard("list", {
    title: "Changelog v2.4",
    items: [
      { text: "Canvas component marketplace", description: "Browse, install, and publish custom UI components", icon: "🎨" },
      { text: "Multi-provider LLM support", description: "Switch between Anthropic, OpenAI, Google, and OpenRouter", icon: "🤖" },
      { text: "WhatsApp QR pairing", description: "Scan to connect — no phone number needed", icon: "📱" },
      { text: "Real-time SSE dashboard", description: "Live deployment status without polling", icon: "⚡" },
    ],
  }, { width: 320, height: 260 }, "Changelog"),

  makeCard("tabs", {
    tabs: [
      { label: "TypeScript", content: "```typescript\nimport { JarbleClient } from '@jarble/sdk';\nconst client = new JarbleClient({ apiKey: 'sk-...' });\nconst bot = await client.deployments.create({ runtime: 'openclaw' });\n```" },
      { label: "Python", content: "```python\nfrom jarble import Client\nclient = Client(api_key='sk-...')\nbot = client.deployments.create(runtime='openclaw')\n```" },
      { label: "cURL", content: "```bash\ncurl -X POST https://api.jarble.ai/trpc/deployment.create \\\n  -H 'Authorization: Bearer sk-...' \\\n  -d '{\"runtime\":\"openclaw\"}'\n```" },
    ],
    defaultTab: 0,
  }, { width: 400, height: 300 }, "SDK Examples"),
];

// ── Scenario 5: Interactive Forms ───────────────────────────────────────────

export const interactiveForms: PersistedCard[] = [
  makeCard("form", {
    title: "Contact Sales",
    fields: [
      { name: "name", label: "Full Name", type: "text", placeholder: "John Doe", required: true },
      { name: "email", label: "Work Email", type: "email", placeholder: "john@company.com", required: true },
      { name: "company", label: "Company", type: "text", placeholder: "Acme Corp" },
      { name: "team_size", label: "Team Size", type: "select", options: ["1-10", "11-50", "51-200", "200+"], required: true },
      { name: "message", label: "Tell us about your needs", type: "textarea", placeholder: "We're looking for..." },
    ],
    submitLabel: "Request Demo",
  }, { width: 360, height: 320 }, "Contact Form"),

  makeCard("button_group", {
    buttons: [
      { id: "approve", label: "Approve", variant: "default", icon: "✓" },
      { id: "reject", label: "Reject", variant: "destructive", icon: "✕" },
      { id: "defer", label: "Defer", variant: "secondary" },
      { id: "escalate", label: "Escalate", variant: "outline" },
    ],
  }, { width: 300, height: 70 }, "Actions"),

  makeCard("chart", {
    type: "pie",
    title: "Survey Results: Preferred Runtime",
    data: [
      { runtime: "OpenClaw", votes: 156 },
      { runtime: "ZeroClaw", votes: 89 },
      { runtime: "Custom", votes: 34 },
      { runtime: "Undecided", votes: 21 },
    ],
    dataKeys: ["votes"],
    xAxisKey: "runtime",
    colors: ["#3b82f6", "#8b5cf6", "#f59e0b", "#94a3b8"],
    showLegend: true,
  }, { width: 460, height: 300 }, "Survey Results"),

  makeCard("metric_card", {
    label: "Form Submissions",
    value: 1247,
    change: "+23% this week",
    trend: "up",
    sparkline: [12, 19, 15, 28, 24, 31, 35, 29, 42, 38],
  }, { width: 260, height: 140 }, "Submissions"),

  makeCard("alert", {
    title: "Form Submitted Successfully",
    message: "Thank you! Our team will get back to you within 24 hours. Check your email for a confirmation.",
    variant: "success",
  }, { width: 340, height: 100 }, "Success Message"),
];

// ── Scenario 6: Media & Geo ─────────────────────────────────────────────────

export const mediaAndGeo: PersistedCard[] = [
  makeCard("map", {
    center: [37.7749, -122.4194] as [number, number],
    zoom: 12,
    markers: [
      { lat: 37.7749, lng: -122.4194, label: "HQ - San Francisco" },
      { lat: 37.3861, lng: -122.0839, label: "R&D - Mountain View" },
      { lat: 37.5585, lng: -122.2711, label: "Data Center - San Mateo" },
    ],
    title: "Office Locations",
    height: 400,
  }, { width: 560, height: 460 }, "Office Map"),

  makeCard("image", {
    src: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop",
    alt: "Modern office space with collaborative work areas",
    caption: "Our San Francisco headquarters — designed for collaboration",
  }, { width: 360, height: 280 }, "Office Photo"),

  makeCard("video", {
    url: "https://www.w3schools.com/html/mov_bbb.mp4",
    title: "Product Demo — Q1 2026",
    controls: true,
    loop: false,
    muted: true,
  }, { width: 560, height: 420 }, "Demo Video"),

  makeCard("image_gallery", {
    title: "Team Offsite — Feb 2026",
    images: [
      { src: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&h=300&fit=crop", alt: "Team collaboration session", caption: "Design sprint kickoff" },
      { src: "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=400&h=300&fit=crop", alt: "Team building activity", caption: "Escape room challenge" },
      { src: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=300&fit=crop", alt: "Group dinner", caption: "Team dinner at the pier" },
    ],
    columns: 3,
  }, { width: 500, height: 400 }, "Team Photos"),

  makeCard("card", {
    title: "San Francisco HQ",
    subtitle: "Primary Office",
    body: "123 Market Street, Suite 400\nSan Francisco, CA 94105\n\nOpen Mon-Fri, 9AM-6PM PST\nParking available in basement level B2",
    icon: "📍",
  }, { width: 300, height: 180 }, "Location Details"),
];

// ── Scenario 7: Individual Stress Tests ─────────────────────────────────────
// One card per component not sufficiently covered in scenarios 1-6.

export const stressTests: PersistedCard[] = [
  makeCard("divider", {
    label: "Section Break",
    variant: "dashed",
    spacing: "md",
  }, { width: 300, height: 30 }, "Divider"),

  makeCard("descriptions", {
    title: "Server Configuration",
    items: [
      { label: "Instance Type", value: "c5.2xlarge" },
      { label: "vCPUs", value: 8 },
      { label: "Memory", value: "16 GB" },
      { label: "Storage", value: "500 GB NVMe SSD" },
      { label: "Network", value: "10 Gbps" },
      { label: "Region", value: "us-east-1" },
    ],
    columns: 2,
    bordered: true,
  }, { width: 320, height: 220 }, "Server Config"),

  makeCard("steps", {
    current: 2,
    items: [
      { title: "Create Account", description: "Sign up with email or SSO" },
      { title: "Choose Runtime", description: "Select OpenClaw or ZeroClaw" },
      { title: "Configure LLM", description: "Add your API key and model" },
      { title: "Deploy", description: "Launch your bot to production" },
    ],
    direction: "horizontal",
  }, { width: 460, height: 120 }, "Setup Steps"),

  makeCard("result", {
    status: "success",
    title: "Deployment Created Successfully",
    subtitle: "Your bot 'customer-support-v2' is now live and accepting messages on WhatsApp and Telegram.",
  }, { width: 360, height: 240 }, "Success Result"),

  makeCard("statistic", {
    value: 99.97,
    title: "Uptime",
    suffix: "%",
    precision: 2,
  }, { width: 240, height: 120 }, "Uptime Stat"),

  makeCard("tag_cloud", {
    title: "Popular Topics",
    tags: [
      { text: "deployment", color: "#3b82f6", size: "large" },
      { text: "kubernetes", color: "#8b5cf6", size: "large" },
      { text: "chatbot", color: "#22c55e", size: "medium" },
      { text: "whatsapp", color: "#25d366", size: "medium" },
      { text: "LLM", color: "#f59e0b", size: "large" },
      { text: "API", color: "#ef4444", size: "small" },
      { text: "webhook", color: "#06b6d4", size: "small" },
      { text: "discord", color: "#5865f2", size: "medium" },
      { text: "terraform", color: "#844fba", size: "small" },
      { text: "monitoring", color: "#64748b", size: "small" },
    ],
  }, { width: 360, height: 200 }, "Tag Cloud"),

  makeCard("tree", {
    title: "Project Structure",
    data: [
      {
        title: "src/",
        key: "src",
        children: [
          {
            title: "components/",
            key: "components",
            children: [
              { title: "Canvas.tsx", key: "canvas" },
              { title: "Chat.tsx", key: "chat" },
              { title: "Dashboard.tsx", key: "dashboard" },
            ],
          },
          {
            title: "services/",
            key: "services",
            children: [
              { title: "auth.ts", key: "auth" },
              { title: "api.ts", key: "api" },
            ],
          },
        ],
      },
      {
        title: "tests/",
        key: "tests",
        children: [
          { title: "unit/", key: "unit" },
          { title: "e2e/", key: "e2e" },
        ],
      },
    ],
    defaultExpandAll: true,
  }, { width: 360, height: 300 }, "File Tree"),

  makeCard("blockquote", {
    text: "The best way to predict the future is to invent it.",
    attribution: "Alan Kay",
    variant: "default",
  }, { width: 360, height: 150 }, "Quote"),

  makeCard("avatar", {
    name: "Sarah Chen",
    subtitle: "Engineering Lead · Platform Team",
    size: "lg",
  }, { width: 200, height: 80 }, "Avatar"),

  makeCard("carousel", {
    items: [
      { title: "Step 1: Create", description: "Set up your bot with a few clicks. No coding required.", image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=250&fit=crop" },
      { title: "Step 2: Configure", description: "Choose your LLM, set personality, and connect channels.", image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=250&fit=crop" },
      { title: "Step 3: Deploy", description: "One click to go live on WhatsApp, Discord, Slack, or Telegram.", image: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=400&h=250&fit=crop" },
    ],
    autoplay: false,
  }, { width: 460, height: 320 }, "Feature Carousel"),

  makeCard("audio", {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    title: "Podcast: Building Bots at Scale — Episode 12",
  }, { width: 320, height: 100 }, "Audio Player"),

  makeCard("text_message", {
    botText: "Hello! I'm your customer support assistant. I can help with account issues, billing questions, and technical support. What can I help you with today?",
    userText: "I need help resetting my API key",
  }, { width: 360, height: 240 }, "Chat Preview"),

  makeCard("sandbox", {
    html: `<div id="app" style="display:flex;align-items:center;justify-content:center;height:100%;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);font-family:system-ui">
  <div style="text-align:center;color:white">
    <h1 style="font-size:2.5em;margin:0">Hello Sandbox</h1>
    <p style="opacity:0.8;font-size:1.2em">Custom HTML/CSS/JS rendering</p>
    <div id="counter" style="font-size:3em;margin-top:20px">0</div>
    <button onclick="count++" style="margin-top:10px;padding:8px 24px;border:2px solid white;background:transparent;color:white;border-radius:8px;cursor:pointer;font-size:1em">Click me</button>
  </div>
</div>`,
    js: `let count = 0;
const el = document.getElementById('counter');
setInterval(() => { el.textContent = count; }, 100);`,
    height: 300,
    title: "Interactive Sandbox",
  }, { width: 700, height: 600 }, "Sandbox Demo"),

  makeCard("code_editor", {
    code: `function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Generate first 10 Fibonacci numbers
const sequence = Array.from({ length: 10 }, (_, i) => fibonacci(i));
console.log(sequence); // [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]`,
    language: "typescript",
    title: "Fibonacci Generator",
    readOnly: false,
    height: 250,
  }, { width: 600, height: 500 }, "Code Editor"),

  makeCard("spreadsheet", {
    title: "Budget Tracker",
    data: [
      { Category: "Engineering", Q1: 250000, Q2: 275000, Q3: 290000, Q4: 310000 },
      { Category: "Marketing", Q1: 120000, Q2: 135000, Q3: 150000, Q4: 160000 },
      { Category: "Sales", Q1: 180000, Q2: 195000, Q3: 210000, Q4: 225000 },
      { Category: "Operations", Q1: 90000, Q2: 95000, Q3: 100000, Q4: 105000 },
      { Category: "Total", Q1: 640000, Q2: 700000, Q3: 750000, Q4: 800000 },
    ],
    height: 300,
  }, { width: 600, height: 500 }, "Spreadsheet"),

  makeCard("layout", {
    title: "Dashboard Layout",
    children: [
      {
        component: "metric_card",
        props: { label: "Users", value: "12.4K", change: "+8%", trend: "up" },
      },
      {
        component: "metric_card",
        props: { label: "Revenue", value: "$84K", change: "+12%", trend: "up" },
      },
      {
        component: "alert",
        props: { message: "System healthy — all services operational", variant: "success" },
      },
    ],
    columns: 3,
    direction: "grid",
    gap: 12,
  }, { width: 600, height: 360 }, "Nested Layout"),

  makeCard("badge", {
    text: "Production",
    variant: "success",
    icon: "●",
  }, { width: 180, height: 50 }, "Status Badge"),

  makeCard("metric_card", {
    label: "API Latency",
    value: "42ms",
    change: "-12ms from last week",
    trend: "down",
    sparkline: [65, 58, 52, 48, 45, 42, 44, 40, 42],
  }, { width: 260, height: 140 }, "Latency Metric"),
];

// ── Scenario Builder ────────────────────────────────────────────────────────

export const ALL_SCENARIOS: Record<string, PersistedCard[]> = {
  "Sales Dashboard": salesDashboard,
  "Project Management": projectManagement,
  "Support Analytics": supportAnalytics,
  "Developer Docs": developerDocs,
  "Interactive Forms": interactiveForms,
  "Media & Geo": mediaAndGeo,
  "Stress Tests": stressTests,
};

/**
 * Build a PersistedState object ready for localStorage injection.
 */
export function buildPersistedState(cards: PersistedCard[]): PersistedState {
  return {
    cards,
    viewportOffset: { x: 0, y: 0 },
    zoom: 1,
    savedAt: Date.now(),
    mode: "dashboard",
  };
}

/**
 * Build the full localStorage value as a JSON string.
 */
export function buildLocalStorageValue(cards: PersistedCard[]): string {
  return JSON.stringify(buildPersistedState(cards));
}
