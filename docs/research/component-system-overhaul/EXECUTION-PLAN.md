# Component System Overhaul — Execution Plan

**Date**: 2026-02-28
**Branch**: `UI-polishing`
**Status**: Ready for implementation
**Based on**: 5-agent roadmap planning (reports from manifest-architect, security-hardener, streaming-researcher, prompt-optimizer, marketplace-architect)

---

## Executive Summary

Five specialized agents researched and planned the execution of the component system overhaul. Key decisions:

| Area | Verdict | Effort |
|------|---------|--------|
| **Single Component Manifest** | TypeScript shared package (`shared/component-manifest/`) — all 5 systems derive from it | 3-4 days |
| **Sandbox Security** | CSP already partially hardened. Tighten `connect-src *` → CDN allowlist. Double-iframe for marketplace later | 2-3 hours (Phase 1) |
| **Streaming/Parsing** | **NO-GO on llm-ui** — architectural mismatch. Instead: incremental block extraction on backend | 4 days |
| **Prompt Optimization** | Trim inline reference from 36→10 components. Save ~878 tokens/msg (25% reduction) | 1 day |
| **AutoFix Prop Repair** | New `autoFixProps.ts` with 20 repair rules. Runs before Zod validation | 2-3 days |
| **Marketplace** | Two tiers: template components (safe JSON) + code components (double-iframe sandbox) | Phased, weeks |

---

## Phase 1: Quick Wins (2-3 days)

### 1.1 Sandbox CSP Tightening (2-3 hours)

**File**: `Jarble-mvp/components/canvas/components/CanvasSandbox.tsx`

CSP was already partially hardened (`default-src 'none'`), but **3 critical gaps remain**:

| Vulnerability | Current | Fix |
|---------------|---------|-----|
| `connect-src *` | Sandbox can `fetch()` ANY URL (data exfiltration) | `connect-src ${cdnOrigins}` |
| `img-src * data: blob:` | Tracking pixels from arbitrary domains | `img-src ${cdnOrigins} data: blob:` |
| `font-src * data:` | Font loading from arbitrary domains | `font-src ${cdnOrigins} data:` |

**Additional fixes**:
- Add `allow="autoplay; fullscreen"` to iframe (denies camera, mic, geolocation, payment)
- Add 30s watchdog timer in sandbox JS (report timeout via postMessage)
- Add `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.plot.ly` to `TRUSTED_CDN_ORIGINS`

**Files**:
| File | Change |
|------|--------|
| `CanvasSandbox.tsx` | Tighten CSP, add `allow` attribute, add watchdog timer |
| `next.config.ts` | Add security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) |

### 1.2 Prompt Optimization (1 day)

**File**: `jarble-api-main/src/runtimes/handlers/openclaw.ts`

**Current**: ~3,470 tokens. Component Quick Reference has all 36 components inline (~1,078 tokens = 31%).

**Change**: Keep only top 10 components inline. Bot calls `component_reference` MCP tool for the other 26.

**Top 10 to keep**: chart, data_table, card, metric_card, stat_grid, list, alert, code_block, layout, sandbox

**Also trim**: "Match component to content" guide in Layout Hints section (~240 tokens) → replace with 1-line directive.

**Savings**: ~878 tokens/msg (25% reduction). At 1,000 msgs/day = ~$78/month saved.

### 1.3 Security Headers (30 min)

**File**: `Jarble-mvp/next.config.ts`

Add to `headers()`:
```typescript
{ key: "X-Content-Type-Options", value: "nosniff" },
{ key: "X-Frame-Options", value: "DENY" },
{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
```

---

## Phase 2: Core Infrastructure (1-2 weeks)

### 2.1 Single Component Manifest (3-4 days)

**Problem**: Component data duplicated across 5 files with drift already present (descriptions differ between `listComponents.ts` and `jarble-ui-server.js`; `COMPONENT_REFERENCE` only covers 24 of 37 components).

**Solution**: Shared TypeScript package that all systems import from.

**New structure**:
```
shared/component-manifest/
├── index.ts              # COMPONENT_MANIFEST export + derived collections
├── types.ts              # ComponentManifestEntry interface
├── components/           # One file per component (37 files)
│   ├── card.ts
│   ├── chart.ts
│   └── ...
├── derive/
│   ├── promptText.ts     # Generate soul.md reference from manifest
│   ├── mcpReference.ts   # Generate MCP server data from manifest
│   └── nameList.ts       # Generate name lists/sets from manifest
└── schemas/              # Zod schemas (moved from registry.ts)
    └── index.ts
```

**ComponentManifestEntry** fields:
- `name`, `description`, `reference` (prop docs)
- `propsSchema` (Zod), `category`, `layout` (defaultHint, defaultSize)
- `loading` (static/dynamic), `expensive`, `aliases`, `splittable`
- `tags`, `builtin`, `renderOrder`, `promptGuidance`

**Migration order** (one system at a time, each independently deployable):
1. Create `shared/component-manifest/` with types and 37 entry files
2. Move Zod schemas from `registry.ts` to `shared/component-manifest/schemas/`
3. Write verification test: derived output must match current hardcoded values
4. Migrate `componentResolver.ts` (simplest — just a Set)
5. Migrate `listComponents.ts` descriptions
6. Migrate `registry.ts` (React imports stay local, schemas from manifest)
7. Migrate `types.ts` (DEFAULT_CARD_SIZES, SPLITTABLE_COMPONENTS)
8. Migrate `jarble-ui-server.js` (build script generates JSON snapshot for plain JS)
9. Migrate `openclaw.ts` (JARBLE_UI_PROMPT generated from manifest)
10. Delete orphaned definitions, add CI sync check

**Net effect**: Adding a component goes from **5-8 files → 2 files**:
1. `shared/component-manifest/components/{name}.ts` — manifest entry
2. `Jarble-mvp/components/canvas/components/Canvas{Name}.tsx` — React component

**Sharing mechanism**: TypeScript path aliases in both `tsconfig.json` files:
```json
{ "paths": { "@jarble/component-manifest": ["../shared/component-manifest/index.ts"] } }
```

For MCP server (plain JS on pods): build script generates `generated/component-data.json`.

### 2.2 AutoFix Prop Repair (2-3 days)

**New file**: `Jarble-mvp/lib/autoFixProps.ts` (~250-300 lines)

Runs BEFORE Zod validation in `CanvasRenderer.tsx`. Catches common LLM errors that currently show error cards.

**20 repair rules across 6 categories**:

| Category | Rules | Examples |
|----------|-------|---------|
| Type Coercion | coerce-number-to-string, coerce-string-to-number, coerce-boolean-strings | `value: "42"` → `42`, `"true"` → `true` |
| Enum Normalization | enum-variant-alias, chart-type-alias, size-enum-alias | `"danger"` → `"error"`, `"doughnut"` → `"pie"` |
| Missing Defaults | alert-default-variant, steps-default-current, chart-default-xAxisKey | `alert` without variant → `"info"` |
| Structural Fixes | unwrap-nested-props, wrap-single-to-array, rows-object-to-array | `{props: {title}}` → `{title}` |
| Field Aliases | content→body, description→message, name→label, data→items | Covers gaps not in Zod transforms |
| Data Normalization | chart-data-normalize, sparkline-normalize, progress-percent-strip, tree-add-missing-keys | `"75%"` → `75` |

**Component name normalization** map: 30+ aliases including casing variants (`DataTable`→`data_table`) and semantic aliases (`table`→`data_table`, `graph`→`chart`, `kpi`→`metric_card`).

**Guardrails**:
- Never invents data — only transforms existing values
- Never removes fields — only adds defaults or transforms types
- All repairs logged (dev: console, prod: Sentry breadcrumb)
- High-confidence rules only (ambiguous cases skipped)

**Integration**:
```typescript
// CanvasRenderer.tsx
const fixed = autoFixProps(block.component, block.props);
const entry = CANVAS_COMPONENTS[fixed.component];
const result = entry.propsSchema.safeParse(fixed.props);
if (fixed.repairs.length > 0) logRepairs(block.id, fixed.component, fixed.repairs);
```

### 2.3 Incremental Streaming (2-3 days)

**Verdict**: NO-GO on `llm-ui` library. Architectural mismatch:
- llm-ui renders blocks inline in chat; Jarble dispatches to separate canvas
- No support for triple-backtick fenced blocks
- Would regress from structured SSE events to raw text parsing on client
- Pre-1.0 library, no updates in ~2 years, ~200KB bundle cost

**Instead**: Three zero-dependency improvements:

**Phase A: Incremental block extraction (2-3 days)**

File: `jarble-api-main/src/services/openclawGateway.ts`

Currently blocks only extract on `state: "final"`. Change to extract on each `state: "delta"`:

```typescript
const emittedBlockIds = new Set<string>();
if (state === "delta") {
  fullText = text;
  const { uiBlocks } = extractUIBlocks(fullText);
  for (const block of uiBlocks) {
    if (!emittedBlockIds.has(block.id)) {
      emittedBlockIds.add(block.id);
      onBlockDetected?.(block);
    }
  }
  onDelta?.(text);
}
```

**Phase B: Fix nested backtick edge case (1 day)**

File: `jarble-api-main/src/utils/uiBlockParser.ts`

Replace greedy regex with JSON-aware parser that tracks brace depth.

**Phase C: rAF smoothing (optional, 0.5 days)**

File: `Jarble-mvp/hooks/useCanvasChat.ts`

Add `requestAnimationFrame` throttle to `setStreamingText` (~20 lines).

---

## Phase 3: Marketplace Foundation (2-4 weeks)

Full marketplace architecture: `17-marketplace-architecture.md` (57KB detailed design doc)

### 3.1 Component Package Format

Two tiers of marketplace components:

| Tier | Format | Security | Rendering |
|------|--------|----------|-----------|
| **Template** | `manifest.json` + `template.json` | Safe (no code execution, auto-approved) | Direct React via `CustomComponentRenderer` |
| **Code/Sandbox** | `manifest.json` + `sandbox.html` | Double-iframe + strict CSP, requires review | Via `CanvasSandbox.tsx` |

**Storage**: Central S3/R2 bucket for versioned packages. Installed components synced to pod PVC at `/data/marketplace/{id}/` via existing configSync pipeline.

**Bot integration**: Zero bot changes needed. `list_components` MCP tool extended to read from `/data/marketplace/` alongside `/data/components/`. `render_ui` resolves templates to built-in primitives, sandbox components to `sandbox` blocks.

**Monetization**: Stripe Connect Standard. 80/20 revenue split (creator/platform). Free, one-time, and subscription pricing.

### 3.2 Double-Iframe Architecture (for code components)

```
┌─────────────────────────────────────────┐
│  Jarble App (app.jarble.ai)             │
│  ┌───────────────────────────────────┐  │
│  │  OUTER IFRAME (sandbox.jarble.ai) │  │
│  │  sandbox="allow-scripts            │  │
│  │          allow-same-origin"        │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  INNER IFRAME (srcdoc)      │  │  │
│  │  │  sandbox="allow-scripts"    │  │  │
│  │  │  [component code runs here] │  │  │
│  │  └─────────────────────────────┘  │  │
│  │  Bridge: postMessage relay        │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

- **Outer iframe**: Different origin (sandbox.jarble.ai). Server-controlled CSP.
- **Inner iframe**: Opaque origin (srcdoc). No access to anything outside.
- **Bridge**: JSON-RPC 2.0 postMessage protocol with origin validation.

### 3.3 Marketplace API

New tRPC router: `marketplace`

**Endpoints**:
- `marketplace.list` — Browse/search components (category, tags, price, rating)
- `marketplace.get` — Get component details
- `marketplace.install` — Install component to deployment
- `marketplace.uninstall` — Remove component from deployment
- `marketplace.publish` — Submit component for review
- `marketplace.review` — Rate/review a component
- `marketplace.myComponents` — Creator's published components
- `marketplace.analytics` — Install/usage stats for creators

**New DB tables**:
- `marketplace_components` — Published components (manifest, code, author, version, pricing, status)
- `component_installs` — Which deployments have which marketplace components
- `component_reviews` — Ratings and reviews
- `component_versions` — Version history

### 3.4 Bot Integration

When a deployment installs a marketplace component:
1. Component manifest added to `list_components` MCP tool response
2. Component reference available via `component_reference` MCP tool
3. Bot discovers it naturally through existing tool calls
4. Template components render via `CustomComponentRenderer`
5. Code components render via double-iframe `MarketplaceSandbox`

---

## Phase 4: Polish & Scale (ongoing)

### 4.1 Server-Side Library URL Validation

File: `jarble-api-main/src/utils/uiBlockParser.ts`

Validate sandbox `libraries` array against CDN allowlist before forwarding to frontend.

### 4.2 CSP Report-Only Monitoring

Deploy CSP changes in `Report-Only` mode for 1 week before enforcing. Monitor console for violations.

### 4.3 Manifest CI Check

Add `npm run check:manifest` that verifies:
- Every name in manifest has a corresponding `Canvas{Name}.tsx` file
- No orphaned React components without manifest entries
- Derived output matches expected format

### 4.4 AutoFix Monitoring Dashboard

Track repair rule frequency via Sentry breadcrumbs. If a rule fires >50% of the time → fix the prompt instead.

---

## Dependency Graph

```
Phase 1 (Quick Wins)
├── 1.1 CSP Tightening          ──── no deps
├── 1.2 Prompt Optimization     ──── no deps
└── 1.3 Security Headers        ──── no deps

Phase 2 (Core Infrastructure)
├── 2.1 Component Manifest      ──── no deps (but 1.2 benefits from manifest)
├── 2.2 AutoFix Prop Repair     ──── no deps (can use manifest types if ready)
└── 2.3 Incremental Streaming   ──── no deps

Phase 3 (Marketplace)
├── 3.1 Package Format          ──── depends on 2.1 (manifest)
├── 3.2 Double-Iframe           ──── depends on 1.1 (CSP)
├── 3.3 Marketplace API         ──── depends on 3.1 (format)
└── 3.4 Bot Integration         ──── depends on 3.3 (API)
```

**All Phase 1 items are independent — can be done in parallel.**
**All Phase 2 items are independent — can be done in parallel.**
**Phase 3 items are sequential.**

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Soul.md prompt regression (trimming breaks bot behavior) | High | A/B test generated vs current prompt. Keep static sections as literal strings. |
| MCP server can't import TypeScript manifest | Medium | Build-time JSON generation. CI ensures it runs before deploy. |
| CSP tightening breaks sandbox components that fetch external APIs | Medium | Sandbox should receive data via props, not fetch. Document in `render_ui` tool. Deploy as Report-Only first. |
| AutoFix masks real prompt issues | Medium | Log all repairs. If rule fires >50%, fix prompt instead. |
| Incremental block extraction emits incomplete JSON | Low | `extractUIBlocks` already handles this — it only extracts complete fenced blocks. |
| Double-iframe adds latency to marketplace components | Low | Only for code components. Template components render directly. |

---

## File Changes Summary

### Phase 1
| Action | File |
|--------|------|
| EDIT | `Jarble-mvp/components/canvas/components/CanvasSandbox.tsx` |
| EDIT | `Jarble-mvp/next.config.ts` |
| EDIT | `jarble-api-main/src/runtimes/handlers/openclaw.ts` |

### Phase 2
| Action | File |
|--------|------|
| NEW | `shared/component-manifest/` (entire directory, ~45 files) |
| NEW | `Jarble-mvp/lib/autoFixProps.ts` |
| NEW | `Jarble-mvp/lib/__tests__/autoFixProps.test.ts` |
| NEW | `scripts/generate-mcp-manifest.ts` |
| EDIT | `Jarble-mvp/components/canvas/registry.ts` |
| EDIT | `Jarble-mvp/components/workspace/types.ts` |
| EDIT | `Jarble-mvp/components/canvas/CanvasRenderer.tsx` |
| EDIT | `Jarble-mvp/tsconfig.json` |
| EDIT | `jarble-api-main/src/utils/componentResolver.ts` |
| EDIT | `jarble-api-main/src/mcp/tools/listComponents.ts` |
| EDIT | `jarble-api-main/src/mcp/jarble-ui-server.js` |
| EDIT | `jarble-api-main/src/runtimes/handlers/openclaw.ts` |
| EDIT | `jarble-api-main/tsconfig.json` |
| EDIT | `jarble-api-main/src/services/openclawGateway.ts` |
| EDIT | `jarble-api-main/src/utils/uiBlockParser.ts` |
| EDIT | `Jarble-mvp/hooks/useCanvasChat.ts` |

### Phase 3
| Action | File |
|--------|------|
| NEW | `sandbox-shell/` (outer iframe shell for sandbox.jarble.ai) |
| NEW | `jarble-api-main/src/trpc/routers/marketplace.ts` |
| NEW | DB migration (marketplace tables) |
| EDIT | `Jarble-mvp/components/canvas/components/CanvasSandbox.tsx` |
| EDIT | `Jarble-mvp/components/canvas/registry.ts` |
| EDIT | `jarble-api-main/src/mcp/jarble-ui-server.js` |

---

## Implementation Priority

**Start with Phase 1** (all items in parallel, 2-3 days total):
1. CSP tightening — highest security impact
2. Prompt optimization — immediate token savings
3. Security headers — quick win

**Then Phase 2** (all items in parallel, 1-2 weeks total):
1. Component manifest — unblocks marketplace
2. AutoFix — reduces error cards immediately
3. Incremental streaming — improves UX

**Then Phase 3** (sequential, 2-4 weeks):
1. Package format → Double-iframe → API → Bot integration
