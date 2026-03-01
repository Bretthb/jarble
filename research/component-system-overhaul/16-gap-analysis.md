# Report 16: Gap Analysis — Blind Spots in Component System

**Agent**: gap-analyzer
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

After completing 15 research reports covering competitors, performance, security, interactivity, libraries, and multi-platform UX, a codebase-wide audit revealed 14 additional gaps not addressed by any prior research. The most critical are: zero production observability, broken mobile experience, untested core logic, and no analytics.

---

## 1. Monitoring / Observability (CRITICAL)

### Current State
- Pino structured logging → stdout (no aggregation configured)
- `CanvasErrorBoundary.componentDidCatch` → `console.error` only
- K8s liveness/readiness probes exist
- `/health` endpoint exists
- No error tracking service, no distributed tracing, no custom metrics

### What's Missing
- **No Sentry/Bugsnag/Rollbar**: Frontend React errors and backend exceptions are invisible in production. `CanvasErrorBoundary` catches render errors but reports nowhere.
- **No log aggregation**: Pino writes JSON to stdout. No Fluentd, Loki, or ELK configured in `infrastructure/`. Logs are ephemeral.
- **No distributed tracing**: SSE requests span 10-30 seconds across frontend → tamboAgent → OpenClaw gateway → MCP stdio. No trace ID correlation.
- **No Prometheus/Grafana**: No metrics endpoint, no dashboards, no alerting on error rates or latency.
- **No uptime monitoring**: No health check pings from external services.

### Recommended Fix
```
Phase 1 (1 day):
- Add @sentry/nextjs to frontend (error boundary integration, SSE error tracking)
- Add @sentry/node to API (express error handler, tRPC error formatter)
- Configure source maps upload for meaningful stack traces

Phase 2 (2-3 days):
- Add OpenTelemetry SDK to API for distributed tracing
- Inject trace IDs into SSE event headers for end-to-end correlation
- Add Prometheus metrics endpoint (/metrics) with:
  - sse_connections_active (gauge)
  - ui_block_parse_errors_total (counter, by component type)
  - zod_validation_failures_total (counter, by component type)
  - canvas_cards_rendered_total (counter)
  - tambo_agent_duration_seconds (histogram)

Phase 3 (1 week):
- Grafana dashboards for component health, SSE reliability, pod performance
- PagerDuty/Opsgenie alerting on error rate spikes
- Log aggregation via Loki or Cloudwatch
```

### Impact: CRITICAL
You are flying blind in production. Component failures, SSE disconnects, and Zod validation errors are silent.

---

## 2. Mobile Responsiveness (HIGH)

### Current State
- `useMobile.tsx` hook with 768px breakpoint exists
- `DashboardCanvas.tsx` has responsive column count (3/2/1 based on width)
- Chat panel: fixed 400px width, canvas fills remaining space
- Resizable splitter bar: `mousedown`/`mousemove` only

### What's Broken on Mobile
- **Chat + canvas layout**: At 375px (iPhone), the 400px fixed chat panel overflows. No mobile breakpoint collapses to single-column.
- **Drag-to-reorder**: `SimpleCanvasGrid.tsx` uses `pointermove`/`pointerup` only. Zero `touch-action` CSS management. Drag is non-functional on touch devices.
- **Resize handles**: Bottom-right corner resize is mouse-only. No touch alternative.
- **Splitter bar**: Mouse-only. Cannot resize chat/canvas split on touch.
- **Freeform canvas**: Absolute-positioned cards with pixel coordinates assume large viewports.

### Recommended Fix
```
Phase 1 (Quick — 1 day):
- Add responsive breakpoint to CanvasWorkspace:
  - Desktop (>768px): side-by-side chat + canvas
  - Mobile (<768px): stacked with tab toggle (Chat | Canvas)
- Set touch-action: none on draggable card headers

Phase 2 (Medium — 3-5 days):
- Replace pointer events with @dnd-kit or native touch handlers
- Mobile-optimized card layout: single column, no absolute positioning
- Touch-friendly resize (long-press to enter resize mode)
- Bottom sheet for canvas on mobile instead of side panel

Phase 3 (Polish — 1 week):
- Mobile-specific card rendering (collapsed by default, tap to expand)
- Swipe gestures for card navigation
- Mobile canvas toolbar (floating action button instead of top bar)
```

### Impact: HIGH
The entire canvas workspace is effectively broken on mobile/tablet. This affects any user who tries to interact with their bot on a phone.

---

## 3. Testing (HIGH)

### Current State
- `canvas-components.spec.ts`: Playwright E2E tests for 7 simple components
- `ChatErrorCard.test.tsx`: 22 Vitest/RTL unit tests
- `componentResolver.test.ts`: Backend unit tests for custom component resolver
- `vitest.config.ts` and `playwright.config.ts` exist and are configured
- **No CI pipeline** (no `.github/workflows/`)

### What's Untested (highest value)
| File | Why It Matters |
|------|---------------|
| `canvasReducer.ts` | Core state logic: ADD/REMOVE/SPLIT/MERGE/REORDER/RESTORE. Pure functions, perfect for unit tests. |
| `uiBlockParser.ts` | Regex parsing, 20-block limit, 100KB block size cap, `jarble_ui`/`jarble_ui_update`/`jarble_ui_define` extraction. |
| `useCanvasPersistence.ts` | 2MB budget enforcement, 7-day expiry, selective prop persistence, serialization/deserialization. |
| `StreamingBotMessage.tsx` | SSE assembly: text delta accumulation, UI block assembly from START→PROPS→END events. |
| All 56+ canvas components | Zero component-level unit tests. Only 7 tested via Playwright. |
| tRPC routers | Zero API-level tests for deployment, openrouter, billing, platformCredentials. |
| `configSync.ts` | Config sync pipeline: DB → PVC → Secret → restart → poll. Complex orchestration, untested. |

### Recommended Fix
```
Phase 1 (2-3 days — highest value):
- Unit tests for canvasReducer.ts (all 8 action types, edge cases)
- Unit tests for uiBlockParser.ts (valid blocks, malformed JSON, size limits, edge cases)
- Unit tests for useCanvasPersistence.ts (budget enforcement, expiry, selective persistence)
- Set up GitHub Actions CI: npm run check && npm run test on PR

Phase 2 (1 week):
- Component snapshot/render tests for top 10 most-used canvas components
- Integration tests for StreamingBotMessage SSE assembly
- API integration tests for deployment lifecycle (create → start → stop → delete)

Phase 3 (ongoing):
- Visual regression tests (Chromatic or Percy) for canvas components
- E2E tests for the deployment wizard flow
- Load testing for SSE concurrent connections
```

### Impact: HIGH
The reducer, parser, and persistence hook are the highest-value untested units. Bugs there affect every user session. No CI means tests that exist don't run automatically.

---

## 4. Analytics / Telemetry (HIGH)

### Current State
- `views/Analytics.tsx` shows deployment-level usage (runtime distribution, LLM credits) — internal dashboard, not product analytics
- `CanvasRenderer.tsx` measures expensive component renders in dev mode only (`console.warn` if >100ms)
- No product analytics service

### What's Missing
- **Component usage tracking**: Which of the 56+ components do bots actually render? Which are never used?
- **Zod validation failure rates**: Which components have the highest schema failure rates? Which LLM providers produce the worst JSON?
- **User canvas interactions**: Splits, merges, drag-to-reorder, saves to library — what features do users actually use?
- **Chat metrics**: Messages per session, streaming errors, SSE disconnects, average response time
- **Deployment wizard drop-off**: Where do users abandon the onboarding flow?
- **Canvas performance**: Time-to-first-card, time-to-interactive, cards-per-session distribution

### Recommended Fix
```
Phase 1 (half day):
- Add PostHog (or Mixpanel/Amplitude) — single initialization in app/layout.tsx
- Track key events:
  - component_rendered { component, deploymentId, provider }
  - component_validation_failed { component, error, provider }
  - canvas_action { action: split|merge|reorder|save, cardCount }
  - chat_message_sent { deploymentId }
  - sse_error { type, deploymentId }
  - wizard_step_completed { step, runtime }
  - wizard_abandoned { step, runtime }

Phase 2 (2-3 days):
- Backend event tracking:
  - mcp_tool_called { tool, deploymentId, duration }
  - ui_block_parsed { component, valid: bool, deploymentId }
  - sse_stream_started/ended { deploymentId, duration, cardCount }
- Build PostHog dashboards for component health and user engagement

Phase 3 (1 week):
- Cohort analysis: which component types correlate with user retention
- Funnel analysis: wizard completion rate by runtime
- Component error rate alerting
```

### Impact: HIGH
Cannot make data-driven decisions about which components to improve, which to deprecate, or where users struggle. Effort is trivially low (PostHog is a script tag + `posthog.capture()` calls).

---

## 5. Accessibility (a11y) (HIGH)

### Current State
- `aria-label` on canvas toolbar buttons (split, save, close)
- shadcn/ui components bring Radix UI ARIA attributes
- `CanvasForm` uses `<label>` wrapping (but not `htmlFor`/`id` pairs)
- `SimpleCanvasGrid` and `DashboardCanvas` have `onKeyDown` on some buttons

### What's Missing

| Component | Issue | Fix |
|-----------|-------|-----|
| `CanvasDataTable` | Clickable `<tr>` with `onClick` but no `role="button"`, `tabIndex`, `onKeyDown` | Add `role="row"`, `tabIndex={0}`, `onKeyDown` for Enter/Space |
| `CanvasAlert` | No `role="alert"` or `aria-live` | Add `role="alert"` to container |
| `CanvasProgress` | No `role="progressbar"`, no `aria-valuenow/min/max` | Add `role="progressbar"` + aria-value attributes |
| `CanvasForm` | `<label>` wrapping but no `htmlFor`/`id` | Add explicit `id` to inputs, `htmlFor` to labels |
| Canvas drag/resize | Pointer events only, no keyboard alternative | Add keyboard shortcuts (arrow keys for move, shift+arrows for resize) |
| Streaming indicator | "Thinking..." has no `aria-live="polite"` | Wrap in `aria-live="polite"` region |
| Chat textarea | No `aria-label` | Add `aria-label="Message input"` |
| Canvas landmark | No landmark role | Add `role="main"` or `<main>` to canvas region |
| `CanvasButtonGroup` | Buttons have no `aria-pressed` for toggle state | Add `aria-pressed` when `mode: "toggle"` |

### Recommended Fix
```
Phase 1 (1 day — quick wins):
- Add role attributes to CanvasAlert, CanvasProgress, CanvasDataTable
- Add aria-label to chat textarea
- Add aria-live to streaming indicator
- Fix CanvasForm label-input associations

Phase 2 (3-5 days):
- Keyboard navigation for canvas cards (Tab to focus, Enter to expand, arrow keys)
- Skip-to-content link for canvas
- Focus management after card add/remove/split/merge

Phase 3 (1-2 weeks):
- Full WCAG 2.1 AA audit
- Screen reader testing (NVDA, VoiceOver)
- High contrast mode support
- Reduced motion preferences (respect prefers-reduced-motion)
```

### Impact: HIGH for enterprise/regulated deployments. The `CanvasDataTable` row-click issue affects one of the most-used interactive components.

---

## 6. Authorization — Verify Deployment Access (HIGH)

### Current State
- `/d/[id]` requires Auth0 authentication
- Page calls `trpc.deployment.getById({id})` and renders if data returned
- No explicit user ownership check visible in the frontend page code

### Risk
If the backend `getById` query does **not** filter by `userId`, any authenticated Jarble user could access any deployment's chat by guessing/iterating deployment IDs.

### Recommended Fix
```
Immediate (30 minutes):
1. Verify in jarble-api-main/src/trpc/routers/deployment.ts that getById includes
   a WHERE clause like: eq(deployments.userId, ctx.user.id)
2. If missing, add it immediately
3. Add a backend test that confirms a user cannot access another user's deployment
```

### Impact: Potentially CRITICAL security gap. Trivial to verify and fix.

---

## 7. LLM Provider Differences (MEDIUM)

### Current State
- System prompt (`JARBLE_UI_PROMPT`) is provider-agnostic
- `component_reference` MCP tool exists but usage is optional
- No telemetry on Zod failure rates per provider

### What's Missing
- **No provider-specific prompt tuning**: Claude 3.5 Sonnet generates reliable JSON; GPT-4o-mini frequently produces malformed blocks. Gemini handles tool-use differently. The prompt makes no accommodation.
- **No retry/correction on validation failure**: Zod failure = "Invalid props" error card shown to user. No automatic retry or correction request to the LLM.
- **No quality metrics per provider**: Cannot quantify which providers produce better UI JSON.

### Recommended Fix
```
Phase 1 (1-2 days):
- Add provider/model to analytics events (component_rendered, validation_failed)
- Add provider-specific prompt hints in JARBLE_UI_PROMPT:
  "IMPORTANT: Always use the exact prop names from the component schema.
   Do not add extra props. Do not nest objects unless the schema requires it."
- For smaller models, auto-inject component_reference for the 5 most-used components

Phase 2 (3-5 days):
- Implement "soft retry" on Zod failure: send error context back to LLM with
  "The jarble_ui block you generated had validation errors: {errors}. Please regenerate."
- Track retry success rate per provider
- Build per-provider quality dashboards
```

---

## 8. State Persistence — Silent Data Loss (MEDIUM)

### Current State
- `useCanvasPersistence.ts`: localStorage, 2MB budget, 7-day expiry, 300ms debounced saves
- Selective persistence: skips sandbox/spreadsheet/code_editor/video/audio, persists small-prop components, drops medium components >1KB

### What's Missing
- **Silent data loss**: Charts, large stat_grids, and medium components restore as empty shells. No visual indicator to the user.
- **No server-side persistence**: Different browser/incognito = fresh canvas.
- **No multi-tab conflict resolution**: Same deployment in two tabs → last-write-wins on localStorage.

### Recommended Fix
```
Phase 1 (half day):
- Add visual indicator to restored cards that lost their props:
  "This card's data was too large to cache. Ask the bot to regenerate it."
- Add a "Regenerate" button on empty restored cards

Phase 2 (3-5 days):
- Server-side canvas state persistence via existing canvas-files API
- Sync on page load: server state → local state merge
- Conflict resolution: last-modified-wins with notification
```

---

## 9. Theming / Branding (MEDIUM)

### Current State
- Light/dark toggle via `ThemeContext.tsx`
- CSS custom properties via Tailwind v4 (`--primary`, `--background`, etc.)
- No per-deployment customization

### What's Missing
- No per-deployment custom colors, logo, or font
- No white-label / tenant theming
- Canvas components use hardcoded Tailwind classes

### Recommended Fix
```
Phase 1 (1-2 days):
- Add optional brandColor field to deployment schema
- Override --primary CSS variable per deployment on /d/[id] page
- Add optional logoUrl to deployment → render in chat header

Phase 2 (1 week):
- Theme builder in deployment configuration
- Custom component colors propagated via CSS variables
- White-label mode: hide Jarble branding, custom favicon
```

---

## 10. Data Privacy / PII (MEDIUM)

### Current State
- AES-256-GCM encryption for platform credentials in DB
- No PII handling in canvas layer

### What's Missing
- Sensitive data in rendered components stored unmasked in localStorage
- No PII detection or redaction for canvas props
- Pino dev logger prints all payload data
- Sandbox can exfiltrate data via fetch (ties to CSP vulnerability in Report #12)

### Recommended Fix
```
Phase 1 (1 day):
- Add pino redact configuration for production logs (redact known PII fields)
- Fix sandbox CSP (already in Report #12 — blocks fetch to external URLs)

Phase 2 (1 week):
- Optional PII flag on canvas cards (set by bot: "This card contains sensitive data")
- PII-flagged cards excluded from localStorage persistence
- Add "Clear canvas data" button in settings
- GDPR data export endpoint for canvas state
```

---

## 11. Card Accumulation — Unbounded Memory (LOW-MEDIUM)

### Current State
- `MAX_BLOCKS = 20` per message in `uiBlockParser.ts`
- No limit on total cards accumulated across messages
- localStorage 2MB budget only for persistence, not in-memory

### Risk
A long session with a chatty bot: 20 blocks × 100 messages = 2000 cards in reducer state. Each card with props could consume 1-10KB of memory.

### Recommended Fix
```
Phase 1 (2 hours):
- Add MAX_CANVAS_CARDS = 100 constant
- In ADD_CARD reducer action: if cards.length >= MAX_CANVAS_CARDS,
  evict oldest non-pinned card and show toast notification
- Add "pin" action to protect important cards from eviction
```

---

## 12. Custom Component Limitations (MEDIUM)

### Current State
- `define_component` MCP tool: compose built-in components with `{{variable}}` placeholders
- JSON stored on PVC at `/data/components/`
- Max 20 children, 50KB definition, valid name format

### What's Missing
- Cannot compose other custom components recursively
- No versioning — redefine silently overwrites
- Definitions lost if pod is deleted (no backup)
- No UI for end users to define/manage components

### Recommended Fix
```
Phase 1 (1 day):
- Add version field to custom component definitions
- Keep previous version on redefine (version history)
- Backup definitions to DB alongside PVC storage

Phase 2 (1 week):
- Allow recursive composition (custom → custom, max depth 3)
- Component management UI in deployment settings
- Import/export component definitions between deployments
```

---

## 13. i18n / RTL (LOW)

### Current State
- Hardcoded `<html lang="en">`
- No i18n framework
- No RTL support
- `toLocaleTimeString` is the only locale-aware formatting

### Recommended Fix
```
Phase 1 (if needed, 1 week):
- Add next-intl with English as default
- Extract UI strings to message files
- Add dir="auto" to text-rendering components

Phase 2 (2 weeks):
- Add 2-3 priority languages
- RTL layout support via Tailwind RTL classes
- Locale-aware number/date formatting in canvas components
```

---

## 14. SEO / Sharing / Embedding (LOW)

### Current State
- Global OG tags in `app/layout.tsx`
- Authenticated-only pages, no public sharing

### Recommended Fix (when public bots are planned)
```
- Per-deployment OG metadata (bot name, description, avatar)
- Public share URLs with read-only canvas view
- Embed mode (?embed=true) stripping navigation
- "Export as PNG" button for canvas state
- oEmbed support for link previews
```

---

## Priority Matrix

| # | Gap | Severity | Effort | ROI |
|---|-----|----------|--------|-----|
| 1 | Monitoring (Sentry + logs) | Critical | 1 day | **Highest** |
| 6 | Auth check on /d/[id] | Critical | 30 min | **Highest** |
| 4 | Analytics (PostHog) | High | Half day | **Very High** |
| 5 | a11y quick wins (roles, aria) | High | 1 day | **High** |
| 3 | Testing (reducer, parser, persistence) | High | 2-3 days | **High** |
| 2 | Mobile responsiveness | High | 1-2 weeks | **High** |
| 11 | Card accumulation limit | Low-Med | 2 hours | **High** |
| 8 | State persistence warnings | Medium | Half day | **Medium** |
| 7 | LLM provider analytics | Medium | 1-2 days | **Medium** |
| 10 | Data privacy / PII | Medium | 1-3 days | **Medium** |
| 12 | Custom component versioning | Medium | 1 day | **Medium** |
| 9 | Theming / branding | Medium | 1-2 weeks | **Low-Med** |
| 13 | i18n / RTL | Low | 2-3 weeks | **Low** |
| 14 | SEO / sharing | Low | 1-2 weeks | **Low** |
