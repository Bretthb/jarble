# Marketplace Architecture for Custom Components

## System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              JARBLE PLATFORM                                 │
│                                                                              │
│  ┌─────────────────┐     ┌────────────────────┐     ┌──────────────────────┐ │
│  │  CREATOR STUDIO  │     │   MARKETPLACE API   │     │   COMPONENT STORE   │ │
│  │                 │     │   (tRPC router)     │     │                      │ │
│  │  - Build & test │────▶│  - Browse/search    │◀───▶│  S3/R2 bucket:       │ │
│  │  - Upload pkg   │     │  - Install/uninstall│     │    /packages/{id}/   │ │
│  │  - View stats   │     │  - Purchase flow    │     │      manifest.json   │ │
│  │  - Manage vers  │     │  - Reviews & ratings│     │      template.json   │ │
│  └─────────────────┘     │  - Creator CRUD     │     │      sandbox.html    │ │
│                          └────────┬───────────┘     │      preview.png     │ │
│                                   │                  │      README.md       │ │
│                                   ▼                  └──────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │                         DATABASE (Drizzle)                             │   │
│  │                                                                        │   │
│  │  marketplace_components ──┐                                            │   │
│  │  component_versions ──────┤    component_installs ────┐                │   │
│  │  component_reviews ───────┤    component_purchases ───┤                │   │
│  │  creator_profiles ────────┘    component_analytics ───┘                │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌───────────────────────────┐    ┌──────────────────────────────────────┐   │
│  │   STRIPE CONNECT           │    │   DEPLOYMENT (pod)                   │   │
│  │                           │    │                                      │   │
│  │  - Creator payouts        │    │  /data/marketplace/{pkg_id}/         │   │
│  │  - Platform fees (20%)    │    │    manifest.json                     │   │
│  │  - Purchase processing    │    │    template.json | sandbox.html      │   │
│  │                           │    │                                      │   │
│  │  jarble_platform_account  │    │  MCP server → list_components        │   │
│  │       ↕                   │    │    includes installed marketplace     │   │
│  │  creator_stripe_account   │    │    components in the response        │   │
│  └───────────────────────────┘    └──────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │                     SECURITY PIPELINE                                    │ │
│  │                                                                          │ │
│  │  Upload → Static analysis → Automated scan → Manual review → Published  │ │
│  │           (JSON lint,        (CSP check,      (code components           │ │
│  │            schema valid,      sandbox escape,   only, queued)            │ │
│  │            size limits)       XSS patterns)                              │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Component Package Format

### Two Tiers

| Tier | Name | Contains | Security | Review |
|------|------|----------|----------|--------|
| **Tier 1** | Template Component | JSON template with `{{variable}}` placeholders | Safe — only composes built-in primitives | Auto-approved (passes validation) |
| **Tier 2** | Sandbox Component | HTML/CSS/JS rendered in sandboxed iframe | Isolated — double-iframe, strict CSP | Automated scan + manual review |

### Package Structure

```
component-package/
├── manifest.json          # Required — metadata, tier, pricing, schema
├── template.json          # Tier 1 only — layout array with placeholders
├── sandbox.html           # Tier 2 only — self-contained HTML document
├── sandbox.css            # Tier 2 optional — extracted styles
├── sandbox.js             # Tier 2 optional — extracted scripts
├── preview.png            # Required — 800x600 preview screenshot
├── preview-dark.png       # Optional — dark mode preview
├── README.md              # Required — usage docs, examples
├── examples/              # Optional — example prop payloads
│   ├── basic.json
│   └── advanced.json
└── icon.svg               # Optional — 64x64 component icon
```

### manifest.json Spec

```jsonc
{
  // ── Identity ──
  "name": "sales_dashboard",                    // lowercase, a-z0-9_, unique per creator
  "displayName": "Sales Dashboard",              // Human-readable
  "description": "Real-time sales metrics with sparklines and trend indicators",
  "version": "1.2.0",                           // Semver
  "tier": "template",                            // "template" | "sandbox"

  // ── Creator ──
  "author": {
    "id": "usr_abc123",                          // Jarble user ID
    "name": "DataViz Pro",
    "url": "https://example.com"                 // Optional
  },

  // ── Categorization ──
  "category": "dashboard",                       // Primary category
  "tags": ["sales", "metrics", "sparkline", "real-time"],
  "icon": "icon.svg",

  // ── Component Schema (how the bot uses it) ──
  "propsSchema": {
    "type": "object",
    "properties": {
      "revenue": { "type": "number", "description": "Total revenue in dollars" },
      "orders": { "type": "number", "description": "Total order count" },
      "trend": {
        "type": "array",
        "items": { "type": "number" },
        "description": "Array of 7 daily revenue values for sparkline"
      },
      "period": { "type": "string", "description": "Time period label, e.g., 'Q4 2025'" }
    },
    "required": ["revenue", "orders"]
  },

  // ── Bot Integration ──
  "botDescription": "Render a sales dashboard with revenue, order count, and trend sparkline. Best for periodic sales reports.",
  "examplePrompts": [
    "Show me a sales dashboard for Q4",
    "Display today's revenue metrics"
  ],
  "exampleProps": {
    "revenue": 142500,
    "orders": 1847,
    "trend": [18000, 21000, 19500, 22000, 20000, 24000, 18000],
    "period": "Q4 2025"
  },

  // ── Pricing ──
  "pricing": {
    "model": "free",                             // "free" | "one_time" | "subscription"
    "priceUsdCents": 0,                          // 0 for free, e.g., 499 = $4.99
    "stripePriceId": null                        // Set by platform after Stripe product created
  },

  // ── Requirements ──
  "minJarbleVersion": "1.0.0",                   // Minimum platform version
  "dependencies": [],                            // Future: other marketplace components

  // ── Sandbox-specific (Tier 2 only) ──
  "sandbox": {
    "entrypoint": "sandbox.html",
    "libraries": ["three", "d3"],                // CDN libs to inject
    "maxHeight": 600,                            // Default iframe height
    "permissions": []                            // Empty = most restrictive sandbox
  },

  // ── Files ──
  "files": {
    "template": "template.json",                 // Tier 1
    "preview": "preview.png",
    "readme": "README.md"
  }
}
```

### template.json (Tier 1 Example)

```json
{
  "name": "sales_dashboard",
  "description": "Sales metrics dashboard",
  "layout": [
    {
      "component": "header",
      "props": {
        "title": "Sales Dashboard — {{period}}",
        "subtitle": "Key performance metrics",
        "level": 2
      }
    },
    {
      "component": "stat_grid",
      "props": {
        "stats": [
          { "label": "Revenue", "value": "{{revenue}}", "icon": "dollar-sign" },
          { "label": "Orders", "value": "{{orders}}", "icon": "shopping-cart" },
          { "label": "Avg Order", "value": "{{avg_order}}", "icon": "trending-up" }
        ]
      }
    },
    {
      "component": "metric_card",
      "props": {
        "label": "Revenue Trend",
        "value": "{{revenue}}",
        "sparkline": "{{trend}}"
      }
    }
  ]
}
```

### Tier 1 vs Existing `jarble_ui_define`

The marketplace template format is a superset of the existing `define_component` / `jarble_ui_define` system:

| Feature | Current `define_component` | Marketplace Template |
|---------|---------------------------|---------------------|
| Storage | PVC `/data/components/` | Platform DB + S3/R2 |
| Scope | Single deployment | Cross-deployment, shareable |
| Schema | None (freeform props) | `propsSchema` (JSON Schema) |
| Versioning | None (overwrite) | Semver |
| Discovery | `list_components` MCP tool | Marketplace browse + search + `list_components` |
| Bot guidance | `description` field | `botDescription` + `examplePrompts` + `exampleProps` |
| Preview | None | `preview.png` required |

**Migration path**: Existing `define_component` definitions can be "promoted" to marketplace components by wrapping them in the manifest format. The existing PVC-based system continues to work for deployment-local custom components.

---

## 2. Discovery & Distribution

### Browsing & Search

Users discover components through a dedicated `/marketplace` page with:

- **Category filters**: dashboard, chart, form, media, utility, game, visualization, layout, social
- **Sort options**: popular, newest, highest-rated, most-installed, trending
- **Search**: Full-text search on name, description, tags, author
- **Tier filter**: template-only, sandbox-only, all
- **Price filter**: free, paid, all

### Installation Flow

```
1. User browses marketplace → finds component
2. Click "Install" (free) or "Purchase" (paid)
   └── Paid: Stripe Checkout → one_time charge or subscription
3. Platform writes to `component_installs` table
4. configSync pipeline writes component package to pod PVC:
   /data/marketplace/{component_id}/
     manifest.json
     template.json | sandbox.html
5. MCP server picks it up on next `list_components` call
6. Bot can now use it via `render_ui`
```

### Storage Architecture

**Central Registry (S3/R2 bucket):**
- All published packages stored at `packages/{component_id}/{version}/`
- Immutable once published (versions are append-only)
- CDN-fronted for fast downloads

**Per-Deployment PVC:**
- Installed components synced to `/data/marketplace/{component_id}/`
- configSync handles write on install, delete on uninstall
- MCP server reads from this directory alongside `/data/components/` (local custom)

### Versioning

- Semver (major.minor.patch)
- **Minor/patch updates**: Auto-installed for free components, notification for paid
- **Major updates**: Require manual approval (may break bot prompts)
- Users can pin a version or auto-update
- Old versions remain available (no breaking existing installs)
- Creator can deprecate (but not delete) old versions

```
component_versions table tracks:
  - version string
  - changelog
  - package URL (S3 key)
  - compatibility flags
  - download count per version
```

---

## 3. Monetization

### Pricing Models

| Model | Description | Stripe Integration |
|-------|-------------|-------------------|
| **Free** | No charge, unlimited installs | No Stripe flow |
| **One-time** | Single purchase, permanent access | `mode: "payment"` Checkout |
| **Subscription** | Monthly access, cancel anytime | `mode: "subscription"` Checkout |

### Stripe Connect Integration

Jarble already uses Stripe for deployment billing. The marketplace extends this with **Stripe Connect** for creator payouts:

```
Creator signs up for payouts → Stripe Connect onboarding (Standard account)
  → creator_profiles.stripeConnectAccountId set

Purchase flow:
  1. Buyer clicks "Purchase" → POST /trpc/marketplace.createCheckout
  2. API creates Stripe Checkout Session with:
     - payment_intent_data.application_fee_amount = price * 0.20 (20% platform fee)
     - payment_intent_data.transfer_data.destination = creator's Stripe account
  3. Buyer completes payment → Stripe webhook fires
  4. API handles checkout.session.completed:
     - Creates component_purchases record
     - Creates component_installs for buyer's selected deployment(s)
     - Triggers configSync to write to PVC
```

### Revenue Split

| Party | Share | Notes |
|-------|-------|-------|
| Creator | 80% | Direct deposit via Stripe Connect |
| Jarble Platform | 20% | Covers hosting, review, infrastructure |
| Stripe fees | ~2.9% + 30c | Deducted from total before split |

### Access Control

```typescript
// Middleware: check component access before serving
async function checkComponentAccess(userId: string, componentId: string): boolean {
  const component = await db.query.marketplaceComponents.findFirst({
    where: eq(marketplaceComponents.id, componentId)
  });

  if (!component) return false;
  if (component.pricingModel === "free") return true;
  if (component.creatorId === userId) return true; // Creators always have access

  const purchase = await db.query.componentPurchases.findFirst({
    where: and(
      eq(componentPurchases.userId, userId),
      eq(componentPurchases.componentId, componentId),
      eq(componentPurchases.status, "active")
    )
  });

  return !!purchase;
}
```

---

## 4. Security Model

### Tier 1: Template Components (Safe by Design)

Template components are inherently safe because they:
- Contain **only JSON** — no executable code
- Reference **only built-in primitives** (validated against `BUILTIN_COMPONENTS` set)
- Use **{{variable}} substitution** — no eval, no code generation
- Are validated by `componentResolver.ts` on both upload and render

**Automated checks on upload:**
1. JSON syntax validation
2. Schema validation against manifest spec
3. All `layout[].component` values must be in `BUILTIN_COMPONENTS`
4. No `sandbox` component references (template tier cannot embed sandboxes)
5. Size limit: 50KB for template.json, 5MB total package
6. `propsSchema` must be valid JSON Schema

**Result**: Template components are auto-approved with zero manual review.

### Tier 2: Sandbox Components (Isolated Execution)

Sandbox components execute arbitrary HTML/CSS/JS and require strict isolation:

**Double-iframe architecture:**
```
┌─────────────────────── Jarble App (main frame) ──────────────────────────┐
│                                                                           │
│  ┌─────────────────────── Outer iframe (about:blank) ──────────────────┐ │
│  │  sandbox="allow-scripts"                                             │ │
│  │  CSP: default-src 'none'; script-src 'unsafe-inline';               │ │
│  │       style-src 'unsafe-inline'; img-src data: https:                │ │
│  │                                                                      │ │
│  │  ┌─────────────────── Inner iframe (srcdoc) ─────────────────────┐  │ │
│  │  │  sandbox="allow-scripts"                                       │  │ │
│  │  │  The actual component HTML/CSS/JS runs here                    │  │ │
│  │  │                                                                │  │ │
│  │  │  NO access to:                                                 │  │ │
│  │  │    - parent window (cross-origin)                              │  │ │
│  │  │    - cookies, localStorage, sessionStorage                     │  │ │
│  │  │    - fetch/XHR to Jarble API                                   │  │ │
│  │  │    - top-level navigation                                      │  │ │
│  │  │    - popups, forms, downloads                                  │  │ │
│  │  │                                                                │  │ │
│  │  │  CAN access:                                                   │  │ │
│  │  │    - window.__JARBLE_PROPS__ (read-only injected props)        │  │ │
│  │  │    - jarble.send(action) (postMessage bridge)                  │  │ │
│  │  │    - CDN-loaded libraries (Three.js, D3, etc.)                 │  │ │
│  │  └────────────────────────────────────────────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

**Automated scan on upload:**
1. Static analysis for dangerous patterns:
   - `document.cookie`, `localStorage`, `sessionStorage`
   - `window.parent`, `window.top`, `parent.postMessage` (except `jarble.send`)
   - `eval()`, `Function()`, `setTimeout(string)`, `setInterval(string)`
   - `fetch()` / `XMLHttpRequest` to non-CDN domains
   - `<script src="...">` to non-whitelisted CDNs
   - `<iframe>`, `<object>`, `<embed>` tags
2. CSP header validation — must not weaken the platform CSP
3. Total size limit: 1MB for sandbox.html, 5MB total package
4. Library whitelist check (only approved CDN libraries)

**Manual review required for:**
- All Tier 2 components before first publish
- Major version updates
- Components flagged by automated scan
- Components that request elevated permissions

**What a malicious component could attempt and mitigations:**

| Attack Vector | Mitigation |
|---------------|-----------|
| XSS / cookie theft | Double-iframe, no `allow-same-origin`, no cookie access |
| Phishing (fake login) | No `allow-top-navigation`, no `allow-popups-to-escape-sandbox`, visual sandbox indicator badge |
| Crypto mining | CPU/memory limits via iframe resource constraints, abuse reporting |
| Data exfiltration | CSP `connect-src 'none'` blocks all network requests |
| Clickjacking | Inner iframe has no `allow-top-navigation` |
| DOM manipulation of parent | Cross-origin isolation, no `allow-same-origin` |
| Props poisoning | Props are Zod-validated before injection into `__JARBLE_PROPS__` |

### Review Queue

```
Upload → Auto-scan
  ├── Tier 1 + passes all checks → Auto-approved → Published
  ├── Tier 2 + passes auto-scan → Queued for manual review → Published/Rejected
  └── Any tier + fails auto-scan → Rejected with reasons
```

Review states: `draft` → `submitted` → `in_review` → `approved` / `rejected` → `published`

---

## 5. Bot Integration

### How Bots Discover Installed Marketplace Components

The existing MCP `list_components` tool already returns built-in + custom components. We extend it to include marketplace installs:

```javascript
// In jarble-ui-server.js — executeListComponents()

function executeListComponents() {
  const custom = listCustomComponents();           // /data/components/*.json
  const marketplace = listMarketplaceComponents(); // /data/marketplace/*/manifest.json  ← NEW

  const lines = ["**Built-in components:**"];
  for (const name of BUILTIN_COMPONENTS) {
    lines.push(`- \`${name}\` — ${BUILTIN_DESCRIPTIONS[name]}`);
  }

  if (marketplace.length > 0) {
    lines.push("", "**Installed marketplace components:**");
    for (const m of marketplace) {
      lines.push(`- \`${m.name}\` — ${m.botDescription}`);
      if (m.examplePrompts?.length) {
        lines.push(`  Use when: ${m.examplePrompts[0]}`);
      }
    }
  }

  if (custom.length > 0) {
    lines.push("", "**Custom (deployment-local) components:**");
    for (const c of custom) {
      lines.push(`- \`${c.name}\`${c.description ? ` — ${c.description}` : ""}`);
    }
  }

  return { isError: false, text: lines.join("\n") };
}

function listMarketplaceComponents() {
  const MARKETPLACE_DIR = "/data/marketplace";
  if (!fs.existsSync(MARKETPLACE_DIR)) return [];
  const results = [];
  for (const dir of fs.readdirSync(MARKETPLACE_DIR)) {
    const manifestPath = path.join(MARKETPLACE_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      results.push({
        name: manifest.name,
        tier: manifest.tier,
        botDescription: manifest.botDescription || manifest.description,
        examplePrompts: manifest.examplePrompts,
        exampleProps: manifest.exampleProps,
        propsSchema: manifest.propsSchema,
      });
    } catch (err) {
      console.error("[MCP] Failed to read marketplace component:", dir, err.message);
    }
  }
  return results;
}
```

### How Bots Use Marketplace Components

When `render_ui` is called with a marketplace component name:

```javascript
// In executeRenderUi()

function executeRenderUi(args) {
  const { component, props } = args;

  // 1. Built-in
  if (BUILTIN_COMPONENTS.includes(component)) {
    return renderBuiltin(component, props);
  }

  // 2. Marketplace (template tier)
  const marketplaceDef = readMarketplaceComponent(component);
  if (marketplaceDef && marketplaceDef.tier === "template") {
    const templatePath = path.join("/data/marketplace", marketplaceDef.id, "template.json");
    const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    const children = resolveCustom(template, props || {});
    const layoutBlock = JSON.stringify({ component: "layout", props: { children } });
    return { isError: false, text: "```jarble_ui\n" + layoutBlock + "\n```" };
  }

  // 3. Marketplace (sandbox tier)
  if (marketplaceDef && marketplaceDef.tier === "sandbox") {
    const sandboxPath = path.join("/data/marketplace", marketplaceDef.id, "sandbox.html");
    const html = fs.readFileSync(sandboxPath, "utf8");
    const block = JSON.stringify({
      component: "sandbox",
      props: {
        html,
        props: props || {},
        height: marketplaceDef.sandbox?.maxHeight || 400,
        title: marketplaceDef.displayName,
        libraries: marketplaceDef.sandbox?.libraries || [],
      },
    });
    return { isError: false, text: "```jarble_ui\n" + block + "\n```" };
  }

  // 4. Local custom (existing behavior)
  const def = readComponent(component);
  if (def) { /* existing custom resolution */ }

  return { isError: true, text: `Component "${component}" not found.` };
}
```

### Soul.md Prompt Changes

The `soul.md` system prompt should include a section about marketplace components when any are installed:

```markdown
## Installed Marketplace Components

The following marketplace components are available in addition to built-in components.
Use them via render_ui when they match the user's request better than built-in options.

{{#each marketplace_components}}
- **{{name}}**: {{botDescription}}
  Props: {{propsSchema_summary}}
  Example: {{examplePrompts[0]}}
{{/each}}
```

This section is dynamically generated by `renderConfigs()` in the OpenClaw runtime handler when marketplace components are installed.

### Frontend Rendering

On the frontend, marketplace components are transparent to `CanvasRenderer.tsx`:

- **Template tier**: MCP server resolves templates to built-in primitives before emitting — frontend sees `layout` with `card`, `stat_grid`, etc. No frontend changes needed.
- **Sandbox tier**: MCP server emits a `sandbox` component — existing `CanvasSandbox.tsx` renders it. No frontend changes needed.

The marketplace adds a new visual indicator: a small "marketplace" badge on canvas cards for components sourced from marketplace packages (for user awareness).

---

## 6. Creator Experience

### Building a Component

**Tier 1 (Template):**
1. Creator uses the existing Jarble dashboard chat to prototype with `define_component`
2. Iterates on the layout + props until satisfied
3. Exports the definition to marketplace format via "Publish to Marketplace" button
4. Platform auto-generates `manifest.json` scaffold from the definition

**Tier 2 (Sandbox):**
1. Creator uses a local development sandbox:
   ```bash
   npx jarble-component-cli init my-component --tier sandbox
   npx jarble-component-cli dev   # Opens local preview at localhost:3456
   ```
2. Develops HTML/CSS/JS with hot reload
3. Tests with sample props via the CLI preview
4. CLI validates against manifest schema and runs automated scan locally
5. Packages into the upload format

### Submission Flow

```
1. Creator clicks "Submit Component" in Creator Studio
2. Uploads package (zip file) via presigned S3 URL
3. Backend validates:
   a. manifest.json schema validation
   b. All required files present
   c. Size limits (5MB total, 1MB per file)
   d. propsSchema is valid JSON Schema
   e. preview.png dimensions (min 400x300)
4. Tier 1: Auto-approved if validation passes → status: "published"
5. Tier 2: Queued for review → status: "in_review"
   a. Automated scan runs (pattern matching, CSP check)
   b. If scan passes, queued for manual review
   c. Reviewer tests in isolated environment
   d. Approved → "published" | Rejected → "rejected" with feedback
6. Published → appears in marketplace search results
```

### Creator Analytics Dashboard

Accessible at `/marketplace/creator`:

- **Install count** (total, by day/week/month)
- **Active installs** (currently deployed)
- **Revenue** (total, by component, by period)
- **Ratings & reviews** (with response capability)
- **Usage analytics** (render count — how often bots actually use the component)
- **Version adoption** (what % of installs are on latest version)

### Stripe Connect Onboarding

```
1. Creator clicks "Enable Payouts" in Creator Studio
2. Redirected to Stripe Connect onboarding (Standard account type)
3. Completes identity verification + bank details
4. Stripe webhook: account.updated → save stripeConnectAccountId
5. Creator can now set pricing on components
```

---

## 7. Database Schema (Drizzle SQLite format)

```typescript
// ── marketplace tables ──────────────────────────────────────────────────

export const creatorProfiles = sqliteTable("creator_profiles", {
  id: text("id").primaryKey(),                          // Same as users.id
  userId: text("user_id").notNull().references(() => users.id).unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  websiteUrl: text("website_url"),
  avatarUrl: text("avatar_url"),
  stripeConnectAccountId: text("stripe_connect_account_id"),  // Stripe Connect
  stripeConnectOnboarded: integer("stripe_connect_onboarded", { mode: "boolean" }).notNull().default(false),
  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  totalEarningsCents: integer("total_earnings_cents").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const marketplaceComponents = sqliteTable("marketplace_components", {
  id: text("id").primaryKey(),                          // cmp_xxxxxxxxxxxx
  creatorId: text("creator_id").notNull().references(() => users.id),
  name: text("name").notNull(),                         // lowercase slug
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  botDescription: text("bot_description"),               // Short desc for LLM
  tier: text("tier").notNull(),                          // "template" | "sandbox"
  category: text("category").notNull(),                  // "dashboard" | "chart" | etc.
  tags: text("tags"),                                    // JSON array of strings
  icon: text("icon"),                                    // URL to icon
  propsSchema: text("props_schema"),                     // JSON Schema string
  exampleProps: text("example_props"),                   // JSON string
  examplePrompts: text("example_prompts"),               // JSON array of strings
  pricingModel: text("pricing_model").notNull().default("free"),  // "free"|"one_time"|"subscription"
  priceUsdCents: integer("price_usd_cents").notNull().default(0),
  stripePriceId: text("stripe_price_id"),                // Stripe Price ID for paid components
  stripeProductId: text("stripe_product_id"),            // Stripe Product ID
  currentVersion: text("current_version").notNull().default("1.0.0"),
  status: text("status").notNull().default("draft"),     // draft|submitted|in_review|approved|published|rejected|deprecated
  reviewNotes: text("review_notes"),                     // Reviewer feedback
  totalInstalls: integer("total_installs").notNull().default(0),
  totalRevenueCents: integer("total_revenue_cents").notNull().default(0),
  averageRating: integer("average_rating"),              // 1-5 scaled to int (multiply by 100 for 2 decimal)
  ratingCount: integer("rating_count").notNull().default(0),
  featuredAt: text("featured_at"),                       // ISO string if featured
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  creatorNameIdx: uniqueIndex("uq_creator_component_name").on(table.creatorId, table.name),
}));

export const componentVersions = sqliteTable("component_versions", {
  id: text("id").primaryKey(),                          // ver_xxxxxxxxxxxx
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  version: text("version").notNull(),                   // Semver "1.2.0"
  changelog: text("changelog"),
  packageUrl: text("package_url").notNull(),            // S3/R2 key
  packageSizeBytes: integer("package_size_bytes").notNull(),
  manifestHash: text("manifest_hash").notNull(),        // SHA-256 of manifest.json
  status: text("status").notNull().default("published"), // published|deprecated
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: text("created_at").notNull().$defaultFn(now),
}, (table) => ({
  componentVersionIdx: uniqueIndex("uq_component_version").on(table.componentId, table.version),
}));

export const componentInstalls = sqliteTable("component_installs", {
  id: text("id").primaryKey(),                          // inst_xxxxxxxxxxxx
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id),
  versionId: text("version_id").notNull().references(() => componentVersions.id),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  pinnedVersion: text("pinned_version"),                // Null = auto-update
  autoUpdate: integer("auto_update", { mode: "boolean" }).notNull().default(true),
  syncedAt: text("synced_at"),                          // Last time synced to PVC
  installedAt: text("installed_at").notNull().$defaultFn(now),
}, (table) => ({
  deploymentComponentIdx: uniqueIndex("uq_deployment_component").on(table.deploymentId, table.componentId),
}));

export const componentPurchases = sqliteTable("component_purchases", {
  id: text("id").primaryKey(),                          // pur_xxxxxxxxxxxx
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id),
  userId: text("user_id").notNull().references(() => users.id),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),  // For subscription pricing
  amountCents: integer("amount_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  creatorPayoutCents: integer("creator_payout_cents").notNull(),
  status: text("status").notNull().default("active"),    // active|refunded|cancelled|expired
  purchasedAt: text("purchased_at").notNull().$defaultFn(now),
  expiresAt: text("expires_at"),                         // For subscriptions
}, (table) => ({
  userComponentIdx: uniqueIndex("uq_user_component_purchase").on(table.userId, table.componentId),
}));

export const componentReviews = sqliteTable("component_reviews", {
  id: text("id").primaryKey(),                          // rev_xxxxxxxxxxxx
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  rating: integer("rating").notNull(),                  // 1-5
  title: text("title"),
  body: text("body"),
  creatorResponse: text("creator_response"),            // Creator can respond
  creatorRespondedAt: text("creator_responded_at"),
  helpful: integer("helpful").notNull().default(0),     // Upvote count
  createdAt: text("created_at").notNull().$defaultFn(now),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
}, (table) => ({
  userComponentReviewIdx: uniqueIndex("uq_user_component_review").on(table.userId, table.componentId),
}));

export const componentAnalytics = sqliteTable("component_analytics", {
  id: text("id").primaryKey(),
  componentId: text("component_id").notNull().references(() => marketplaceComponents.id, { onDelete: "cascade" }),
  date: text("date").notNull(),                         // ISO date "2026-02-28"
  installs: integer("installs").notNull().default(0),
  uninstalls: integer("uninstalls").notNull().default(0),
  renders: integer("renders").notNull().default(0),      // Times bot rendered this component
  views: integer("views").notNull().default(0),          // Marketplace listing views
}, (table) => ({
  componentDateIdx: uniqueIndex("uq_component_date").on(table.componentId, table.date),
}));

// ── Relations ──

export const creatorProfilesRelations = relations(creatorProfiles, ({ one, many }) => ({
  user: one(users, { fields: [creatorProfiles.userId], references: [users.id] }),
}));

export const marketplaceComponentsRelations = relations(marketplaceComponents, ({ one, many }) => ({
  creator: one(users, { fields: [marketplaceComponents.creatorId], references: [users.id] }),
  versions: many(componentVersions),
  installs: many(componentInstalls),
  reviews: many(componentReviews),
  analytics: many(componentAnalytics),
  purchases: many(componentPurchases),
}));

export const componentVersionsRelations = relations(componentVersions, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentVersions.componentId], references: [marketplaceComponents.id] }),
}));

export const componentInstallsRelations = relations(componentInstalls, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentInstalls.componentId], references: [marketplaceComponents.id] }),
  version: one(componentVersions, { fields: [componentInstalls.versionId], references: [componentVersions.id] }),
  deployment: one(deployments, { fields: [componentInstalls.deploymentId], references: [deployments.id] }),
  user: one(users, { fields: [componentInstalls.userId], references: [users.id] }),
}));

export const componentPurchasesRelations = relations(componentPurchases, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentPurchases.componentId], references: [marketplaceComponents.id] }),
  user: one(users, { fields: [componentPurchases.userId], references: [users.id] }),
}));

export const componentReviewsRelations = relations(componentReviews, ({ one }) => ({
  component: one(marketplaceComponents, { fields: [componentReviews.componentId], references: [marketplaceComponents.id] }),
  user: one(users, { fields: [componentReviews.userId], references: [users.id] }),
}));
```

---

## 8. API Design (tRPC Router)

### New Router: `marketplace`

```typescript
// jarble-api-main/src/trpc/routers/marketplace.ts

export const marketplaceRouter = router({

  // ── Discovery ──────────────────────────────────────────────────────────

  browse: publicProcedure
    .input(z.object({
      category: z.string().optional(),
      tier: z.enum(["template", "sandbox"]).optional(),
      pricing: z.enum(["free", "paid"]).optional(),
      sort: z.enum(["popular", "newest", "top_rated", "trending"]).default("popular"),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      cursor: z.string().optional(),          // Pagination cursor
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      // Returns: { items: MarketplaceComponent[], nextCursor: string | null }
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      // Returns: Full component detail with versions, reviews summary, creator profile
    }),

  getByName: publicProcedure
    .input(z.object({ creatorName: z.string(), componentName: z.string() }))
    .query(async ({ input }) => {
      // Lookup by creator/component slug pair
    }),

  getFeatured: publicProcedure
    .query(async () => {
      // Returns: Curated featured components
    }),

  getCategories: publicProcedure
    .query(async () => {
      // Returns: Category list with component counts
    }),

  // ── Installation ───────────────────────────────────────────────────────

  install: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
      versionId: z.string().optional(),       // Default: latest
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Check access (free = always, paid = check purchase)
      // 2. Create component_installs record
      // 3. Download package from S3
      // 4. configSync: write to /data/marketplace/{id}/ on PVC
      // 5. Increment totalInstalls
      // Returns: { success: true, installedVersion: "1.2.0" }
    }),

  uninstall: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Delete component_installs record
      // 2. configSync: remove /data/marketplace/{id}/ from PVC
      // Returns: { success: true }
    }),

  listInstalled: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Returns: installed components for a deployment with version info
    }),

  updateVersion: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
      versionId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Update to a specific version, re-sync to PVC
    }),

  // ── Purchases ──────────────────────────────────────────────────────────

  createCheckout: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),               // Auto-install after purchase
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Look up component pricing
      // 2. Create Stripe Checkout Session (payment or subscription)
      //    - application_fee_amount for platform fee
      //    - transfer_data.destination for creator payout
      // 3. Return { checkoutUrl: string }
    }),

  getPurchases: protectedProcedure
    .query(async ({ ctx }) => {
      // Returns: all user's purchases with component info
    }),

  // ── Reviews ────────────────────────────────────────────────────────────

  getReviews: publicProcedure
    .input(z.object({
      componentId: z.string(),
      sort: z.enum(["newest", "highest", "lowest", "helpful"]).default("newest"),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      // Returns: { reviews: Review[], nextCursor: string | null, summary: { avg, count, distribution } }
    }),

  createReview: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      rating: z.number().min(1).max(5),
      title: z.string().max(100).optional(),
      body: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Must have installed the component to review
      // Updates averageRating on marketplace_components
    }),

  // ── Creator ────────────────────────────────────────────────────────────

  createCreatorProfile: protectedProcedure
    .input(z.object({
      displayName: z.string().min(2).max(50),
      bio: z.string().max(500).optional(),
      websiteUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Creates creator_profiles record
    }),

  getCreatorProfile: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      // Returns: creator profile with component list
    }),

  createStripeConnectLink: protectedProcedure
    .mutation(async ({ ctx }) => {
      // Creates Stripe Connect account link for onboarding
      // Returns: { url: string }
    }),

  submitComponent: protectedProcedure
    .input(z.object({
      name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      displayName: z.string().min(2).max(100),
      description: z.string().min(10).max(2000),
      botDescription: z.string().max(200).optional(),
      tier: z.enum(["template", "sandbox"]),
      category: z.string(),
      tags: z.array(z.string()).max(10),
      propsSchema: z.string(),                // JSON Schema as string
      exampleProps: z.string().optional(),     // JSON string
      examplePrompts: z.array(z.string()).max(5).optional(),
      pricingModel: z.enum(["free", "one_time", "subscription"]).default("free"),
      priceUsdCents: z.number().min(0).max(99999).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Create marketplace_components record (status: "draft")
      // 2. Generate presigned upload URL
      // Returns: { componentId: string, uploadUrl: string }
    }),

  publishComponent: protectedProcedure
    .input(z.object({ componentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // 1. Validate package is uploaded
      // 2. Run automated checks
      // 3. Tier 1: auto-approve + publish
      //    Tier 2: set status to "submitted" for review
    }),

  updateComponent: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      botDescription: z.string().optional(),
      tags: z.array(z.string()).optional(),
      priceUsdCents: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Update metadata (not code — that requires new version)
    }),

  createVersion: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      version: z.string(),                    // Must be > current version
      changelog: z.string().max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Validate semver > current
      // 2. Generate presigned upload URL for new package
      // Returns: { versionId: string, uploadUrl: string }
    }),

  deprecateComponent: protectedProcedure
    .input(z.object({ componentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Sets status to "deprecated", hidden from search but existing installs continue
    }),

  // ── Creator Analytics ──────────────────────────────────────────────────

  getCreatorAnalytics: protectedProcedure
    .input(z.object({
      componentId: z.string().optional(),     // Null = aggregate all
      period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
    }))
    .query(async ({ ctx, input }) => {
      // Returns: { installs, uninstalls, renders, revenue, ratingTrend }
    }),

  // ── Admin (review queue) ───────────────────────────────────────────────

  getReviewQueue: protectedProcedure  // Admin only
    .query(async ({ ctx }) => {
      // Returns: components with status "submitted" or "in_review"
    }),

  approveComponent: protectedProcedure  // Admin only
    .input(z.object({ componentId: z.string(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      // Set status "approved" → "published"
    }),

  rejectComponent: protectedProcedure  // Admin only
    .input(z.object({ componentId: z.string(), notes: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Set status "rejected" with review notes
    }),
});
```

### Stripe Webhook Extensions

Add to existing webhook handler:

```typescript
// In checkout.session.completed handler:
if (session.metadata?.type === "marketplace_component") {
  const { componentId, userId, deploymentId } = session.metadata;

  // Create purchase record
  await db.insert(componentPurchases).values({
    id: generateId("pur"),
    componentId,
    userId,
    stripePaymentIntentId: session.payment_intent,
    amountCents: session.amount_total,
    platformFeeCents: Math.round(session.amount_total * 0.20),
    creatorPayoutCents: Math.round(session.amount_total * 0.80),
    status: "active",
  });

  // Auto-install on the deployment
  await installComponentOnDeployment(componentId, deploymentId, userId);
}
```

---

## 9. User Installation Workflow (End-to-End)

### Free Component

```
/marketplace → Browse → Click component → "Install" button
  → Select deployment(s) from dropdown
  → Confirm
  → Backend: create component_installs + configSync writes to PVC
  → Toast: "Sales Dashboard installed on MyBot"
  → Bot can immediately use it
```

### Paid Component

```
/marketplace → Browse → Click component → "Purchase — $4.99" button
  → Select deployment for auto-install
  → Redirect to Stripe Checkout
  → Complete payment
  → Stripe webhook → create purchase + auto-install
  → Redirect back to marketplace → "Installed" badge
  → Bot can immediately use it
```

### From Chat (Bot-Initiated)

```
User: "Can you show me a sales dashboard?"
Bot: "I don't have a sales dashboard component installed.
     I found 3 marketplace components that match:
     1. Sales Dashboard by DataViz Pro (free)
     2. Executive Dashboard by ChartMaster ($2.99)
     3. Revenue Tracker by MetricsLab (free)
     Would you like me to install one?"
User: "Install #1"
Bot: [calls install_marketplace_component MCP tool]
     "Sales Dashboard has been installed. Let me render it now."
     [calls render_ui with sales_dashboard component]
```

This requires a new MCP tool `install_marketplace_component` that hits the API, but it should be gated — the bot requests, the user confirms via a button_group UI block.

---

## 10. Phased Rollout Plan

### Phase 1: Foundation (MVP) — 4-6 weeks

**Goal**: Template marketplace with free components only.

- [ ] Database schema (marketplace_components, component_versions, component_installs)
- [ ] S3/R2 bucket for package storage
- [ ] `marketplace` tRPC router (browse, getById, install, uninstall, listInstalled)
- [ ] Creator profile creation (no Stripe Connect yet)
- [ ] Component submission + auto-approval for Tier 1
- [ ] Manifest validation pipeline
- [ ] `/marketplace` browse page (grid, search, category filter)
- [ ] `/marketplace/[id]` detail page (preview, description, install button)
- [ ] configSync extension: write/remove `/data/marketplace/` on PVC
- [ ] MCP server extension: read marketplace components in `list_components` + `render_ui`
- [ ] "Install" button on deployment config page
- [ ] 5-10 seed components (created by Jarble team)

**Not included**: Paid components, sandbox tier, reviews, analytics.

### Phase 2: Sandbox & Reviews — 3-4 weeks

**Goal**: Enable sandbox components with security review pipeline.

- [ ] Tier 2 (sandbox) submission support
- [ ] Automated scan pipeline (static analysis, pattern matching)
- [ ] Admin review queue UI
- [ ] Double-iframe rendering (CSP tightening — from sandbox security research)
- [ ] Component reviews + ratings system
- [ ] Review aggregation (avg rating, distribution)
- [ ] Version management (upload new version, changelog)
- [ ] Auto-update logic (minor/patch auto, major requires confirm)
- [ ] "My Installed Components" page in deployment settings

### Phase 3: Monetization — 3-4 weeks

**Goal**: Enable paid components with Stripe Connect.

- [ ] Stripe Connect onboarding flow for creators
- [ ] One-time purchase flow (Stripe Checkout)
- [ ] Subscription purchase flow
- [ ] Revenue split (80/20) via application_fee
- [ ] Purchase access control middleware
- [ ] Creator earnings dashboard
- [ ] Purchase history for buyers
- [ ] Refund handling (Stripe webhook)
- [ ] Payout reports

### Phase 4: Growth & Polish — 2-3 weeks

**Goal**: Creator tools, analytics, and marketplace maturity.

- [ ] Creator Studio (component management, analytics dashboard)
- [ ] `jarble-component-cli` for Tier 2 local development
- [ ] Component analytics (daily installs, renders, revenue)
- [ ] Featured components curation
- [ ] "Trending" algorithm (installs velocity + rating + renders)
- [ ] Bot-initiated install flow (MCP tool + confirmation UI)
- [ ] Component collections / bundles
- [ ] Creator verification badges
- [ ] Marketplace homepage redesign (hero, categories, featured)
- [ ] SEO: public component pages at `/marketplace/{creator}/{component}`

---

## Summary of Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Two tiers (template + sandbox)** | Templates are safe-by-design and auto-approved; sandboxes enable full power with review gates |
| **S3/R2 central store + PVC sync** | Central store for versioning/distribution; PVC sync for offline pod access and fast MCP reads |
| **Stripe Connect Standard** | Creators manage their own Stripe dashboard; simpler than Custom accounts; 80/20 split via `application_fee` |
| **Auto-approve Tier 1** | JSON templates with built-in-only references cannot execute code — review adds friction without security value |
| **manifest.json with propsSchema** | JSON Schema is LLM-friendly, Zod-convertible, and standard — bots can read it to understand how to use components |
| **configSync for installs** | Reuses existing infrastructure (exec into pod, write files) rather than building a new distribution mechanism |
| **Extend MCP `list_components`** | Zero changes needed to bot behavior — marketplace components appear alongside built-ins in the tool response |
| **Frontend renders transparently** | Template tier resolves to built-in primitives; sandbox tier uses existing CanvasSandbox — no frontend component code needed |
