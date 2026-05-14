# Dashboard UI/UX Improvement Plan

**Status:** Approved 2026-05-13
**Owner:** Tanner
**Source research:** Three-agent investigation 2026-05-13 — design-system inventory, dashboard UX teardown, and competitive scan across Vercel / Linear / Stripe / Render / Cloudflare / Supabase / Fly.io / PlanetScale.

This document is the source of truth for the dashboard refresh and the broader UI direction it kicks off. It supersedes any older marketing-page rewrite proposals. Linear tickets dispatched from this plan reference it by path.

---

## What we found

Three things, ordered by importance:

1. **Jarble already has a distinctive visual identity, you just don't see it consistently.** Warm-red primary `#c85a5a`, Playfair Display headings + Inter body, dark-mode paper-grain noise overlay, soft vignette, `.charcoal-glow` utility shadows, a hand-rolled magnetic breathing hero in `InteractiveHero.tsx`. This is *not* a generic AI-template look — it's an artisanal one. The fix is **propagation**, not invention.
2. **The dashboard's bones are honest.** `views/Dashboard.tsx` (762 lines) loads real data via batched tRPC queries (`getStorageUsageBatch`, `getDeploymentPrices`), pushes live status via SSE, has zero glassmorphism / gradient-blob / "Welcome back 👋" fluff, and shows a workspace banner that earns its space. The opportunity is **density and tone**, not teardown.
3. **The two real gaps are typography rhythm and a monospace voice.** No heading scale (everything just inherits `font-serif`), no monospace anywhere — so IDs, durations, token counts blend into prose and the product reads softer than it should for an infrastructure tool.

The 51 shadcn primitives in `components/ui/` include ~36 unused (already tracked in JAR-91). Motion is CSS-keyframe based with 8 named animations in `globals.css`; framer-motion is imported in `Dashboard.tsx` but never actually used.

## Design principles (the north stars)

1. **Layer monospace onto the existing serif/sans pair.** Three-font system: **Playfair Display** (display headings only), **Inter** (body), **Geist Mono** (every identifier, duration, token count, model name, region tag, log line). This is the single highest-leverage change for "feels like real infra."
2. **Codify a typography scale.** Five sizes, one heading family, one body family, one mono family. Locks the rhythm.
3. **Density wins, but warm.** Borrow Linear/Stripe row density, but render it on Jarble's existing warm palette + paper grain — don't paste in cold Vercel-black aesthetic.
4. **Status is uppercase microtype.** `RUNNING / BUILDING / CRASHED / IDLE` at 10–11px caps with the existing `StatusBadge` color palette + pulse ring (already shipped).
5. **Time is relative, with truth on hover.** "3m ago" with tooltip showing the absolute timestamp.
6. **Copy-on-click on every identifier.** Reuses the warm-red focus state for the toast confirmation.
7. **One signature differentiator: harness lineage view.** PlanetScale-style fork tree. No agent platform has it. Ship as a tab stub in Phase 1, fill in Phase 2.

## Phase 0 — Foundation

Must land before any of the rest. Estimated 2–3 days.

### 0A. Typography scale tokens
Add to `globals.css`'s `@theme` block:

```css
--font-mono: 'Geist Mono', ui-monospace, 'JetBrains Mono', monospace;
--text-display: 2.25rem / 1.15;       /* Playfair, page hero */
--text-h1: 1.5rem / 1.25;             /* Playfair, section header */
--text-h2: 1.125rem / 1.3;            /* Inter semibold */
--text-body: 0.875rem / 1.5;          /* Inter, default */
--text-micro: 0.6875rem / 1;          /* Inter caps, status pills */
--text-mono: 0.8125rem / 1.4;         /* Geist Mono, identifiers */
```

Replace ad-hoc `text-sm` / blanket `font-serif` usages with these tokens via class utilities (`.text-display`, `.text-h1`, etc).

### 0B. Adopt Geist Mono
Self-host via `@vercel/font` (preferred — local, no third-party request) or load from Google Fonts. Wire into the `--font-mono` token. Subsequent component work assumes it's available.

### 0C. Document existing utilities
`.card-surface`, `.section-group`, `.info-box`, `.charcoal-glow`, `.charcoal-glow-strong`, `.charcoal-stroke` already exist in `globals.css` but are used inconsistently. Document them in a new `Jarble-mvp/components/ui/README.md` and add a `.claude/rules/` note steering future code to use them instead of reinventing card chrome.

### 0D. Parallel cleanup (existing ticket: JAR-91)
The 36-unused-shadcn delete is already tracked in JAR-91. Phase 0 does not block on it; the two should land in the same release window for cleanliness.

### 0E. Remove unused framer-motion import
Delete the unused `import { motion } from "framer-motion"` in `Dashboard.tsx`. Motion stays CSS-keyframe based.

## Phase 1 — Dashboard refresh

Estimated 4–6 weeks across the sub-tickets below.

### 1A. KPI hero strip
Stripe-style four-tile strip on top of the dashboard:
- **Active deployments** — count + sparkline of count over last 7d
- **Last 24h messages** — count + sparkline
- **Token spend this period** — USD + sparkline + period selector
- **Health** — `RUNNING / FAILED / PENDING` pill counts

Built on a new `<KPITile>` + `<Sparkline>` (minimal SVG, no axes, no legend). Tiles use `.card-surface` (existing utility) + Geist Mono for the big number. **Period selector in monospace**. Sparkline stroke = primary warm-red at 60% opacity.

**Data dependency:** the "token spend" tile assumes a queryable per-deployment token-spend stream. If that doesn't exist as a single query yet, scope the tile down to "last 24h request count" (already available via existing batched queries) and file a follow-up for the spend metric.

### 1B. DeploymentCard density toggle (row | card)
Refactor to `<DeploymentCard density="row|card">`. Default to row mode when the user has more than 5 deployments, persist the preference per user.

Each row carries:
- Existing `<StatusBadge>` (ships unchanged — already perfect)
- Deployment name (Inter semibold)
- Monospace `{id}.agents.jarble.ai` with copy-on-click
- Harness-type chip — `OPENCLAW` in 10px mono caps
- 24h sparkline of request volume / token spend
- Last activity (relative + tooltip)
- Existing price + LLM-mode chips
- Existing action cluster (stop / start / restart / delete / open chat)

Zero changes to the data layer. The batched `getStorageUsageBatch` and `getDeploymentPrices` queries stay as-is.

### 1C. Cmd-K palette
Global command palette via shadcn's `cmdk`. Verbs scoped by context:
- `restart {deployment}`, `stop {deployment}`, `open chat`, `view logs`, `view config`
- `switch org`, `create deployment`, `invite teammate`
- Fuzzy match deployment names + IDs (mono-rendered in the result list)

The palette uses Inter for verbs and Geist Mono for the deployment IDs — visual proof the mono voice ties everything together.

### 1D. Per-deployment management route
New route `/deployments/[id]` (separate from chat at `/d/[id]`). Tabs:
- **Overview** — health, recent activity, billing snapshot
- **Logs** — streaming pod logs (Geist Mono, dense)
- **Config** — system prompt, model, MCP, platform credentials
- **Connections** — wired messaging platforms
- **Lineage** — *stub for Phase 2*, show a "Coming soon" placeholder with a small ASCII tree

### 1E. Empty state
Replace today's `py-24` empty state with a single sentence + a primary action button + 3 starter-template rows directly below. No decorative illustration.

### 1F. Workspace banner
"Viewing organization deployments · owner" → `ORG · acme-inc · OWNER` in Geist Mono caps. Single line. Half the height. Same logic, less chrome.

### 1G. Lineage tab stub
Create the Lineage tab on the per-deployment route as a placeholder so the slot exists. Backfill the actual `<LineageTree>` visualization in Phase 2.

## Phase 2 — Site-wide application

Estimated rolling work across multiple sprints, after Phase 1 ships.

Same patterns ported, in this order:
1. **Billing** (`views/Billing.tsx`) — KPI strip (MRR, this period, last invoice, next invoice) + dense usage table.
2. **Settings / Orgs / OrgDetail** — list-row density, mono IDs, Cmd-K integration.
3. **Onboarding wizard** — Linear-style left progress rail; the existing `WizardLoader` already hints at the visual language.
4. **Lineage view** — ship the actual visualization (`@xyflow/react` is already in the bundle for the orchestration canvas).

**Marketing pages stay soft.** `Home`, `About`, `Pricing` keep the magnetic breathing hero, the warm-red glow, the Playfair display sizes. The split between "logged out = warm and inviting" and "logged in = dense and serious" is itself a brand signal — don't collapse it.

## Engineering deliverables

New components (none require new deps beyond Geist Mono):

- `<KPITile>` — number + sparkline + delta + period
- `<Sparkline>` — SVG, no axes, takes `data: number[]` + warm-red stroke
- `<MonoId>` — Geist Mono identifier with copy-on-click + reveal-token affordance for masked secrets
- `<RelativeTime>` — `<time>` with relative text + absolute tooltip
- `<StatusPill>` — uppercase microtype variant of the existing `StatusBadge` (shares color tokens)
- `<CommandMenu>` — Cmd-K, built on shadcn `cmdk`
- `<EmptyState>` — single sentence + primary action + optional starter rows; no illustration slot
- `<LineageTree>` — *Phase 2*, built on `@xyflow/react`

Refactors:
- `<DeploymentCard density="row|card">` — single component, two layouts
- Typography: replace ad-hoc `text-sm` / `font-serif` usages with the new scale tokens

## Open decisions

1. **Geist Mono — yes/no.** Recommend yes. If you'd prefer JetBrains Mono or IBM Plex Mono for license/distinctiveness reasons, swap freely; the plan doesn't change.
2. **Density default.** Recommend row by default for >5 deployments, card otherwise. Persisted per user.
3. **Lineage tab in Phase 1 — stub or skip?** Recommend stub (creates the slot, signals the differentiator).
4. **Per-deployment management route.** Recommend new `/deployments/[id]` (bookmarkable, separate concern from chat at `/d/[id]`).
5. **Phase 0 — block Phase 1 on it, or interleave?** Recommend block. Sprint 1 of Phase 1 needs the typography tokens already in place.

## Suggested rollout

| Phase | Length | Output |
|------|--------|--------|
| 0 | 2-3 days | Type scale + Geist Mono + utility doc + framer-motion removal |
| 1A-1B | 1-2 weeks | KPI strip + DeploymentRow with density toggle |
| 1C-1F | 1 week | Cmd-K + workspace banner + empty state |
| 1D + 1G | 1-2 weeks | Per-deployment management route with tabs + lineage stub |
| 2 | rolling | Apply to Billing → Settings → Orgs → onboarding |
| Lineage | follow-up | Visualization ships in Phase 2 |

## Anti-patterns to actively retire

From the competitive scan, these are patterns to ensure do NOT creep in as we add components:

- Glassmorphic translucent cards stacked on a gradient backdrop (no real infra tool does this)
- "Welcome back, {name} 👋" hero with avatar + emoji wave
- Pastel candy-color status badges (mint/peach/lavender) — semantic colors should be muted
- Decorative AI illustrations in empty states (robots, sparkles, neural-net swirls)
- Animated gradient blobs / mesh backgrounds behind cards
- Identical card grids where every card is the same shape and size regardless of importance

## Linear tickets dispatched from this plan

See JARs created from this plan for live status. Each ticket links back here as the source of truth.
