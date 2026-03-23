# Jarble Platform Roadmap

> **Last updated:** 2026-03-14
>
> Jarble is a no-code AI bot deployment platform where users deploy LLM-powered bots, benchmark them against each other, build generative UI dashboards, and buy & sell services in a marketplace — all without writing code.

---

## The Five Pillars

| # | Pillar | One-liner |
|---|--------|-----------|
| 1 | **No-Code Deploy** | Pick a runtime, choose an LLM, deploy to any messaging platform in minutes |
| 2 | **Benchmark** | Rate, rank, and compare bots across domains with public leaderboards |
| 3 | **Gen UI (Dashboard)** | Bots render rich interactive dashboards — charts, tables, 3D, live widgets — via natural language |
| 4 | **Buy & Sell** | A marketplace for services and components that bots can install and use |
| 5 | **Developer Platform** | API keys, agent mesh, and protocols for external developers to build on Jarble |

---

## Pillar 1: No-Code Deploy

Deploy an AI bot to WhatsApp, Discord, Slack, or Telegram — no code, no servers, no config files.

### Current State (Shipped)

- **Guided onboarding wizard** — 4-step flow: Name → Runtime → LLM Setup → Deploy
- **2 runtimes** — OpenClaw and ZeroClaw, pulled from runtime catalog
- **4 LLM providers** — OpenRouter, OpenAI, Anthropic, Google (BYOK with auto-detection + server-side validation)
- **Included-credits mode** — Tiered $5–$100/mo plans via OpenRouter sub-accounts
- **4 messaging platforms** — WhatsApp (QR pairing), Telegram (bot token + poll), Discord, Slack
- **Deployment lifecycle** — Create → Deploy → Start/Stop/Restart, with K8s pod management
- **Configuration dashboard** — Sidebar tabs for General, Model, Platforms, Skills, Components, Logs, Advanced
- **Deployment forking** — Fork any public deployment with one click
- **Free trial** — 7-day trial with `canDeploy` enforcement
- **Platform credential encryption** — AES-256-GCM at rest
- **Background services** — Storage enforcement, subscription enforcement, status reconciler, webhook cleanup

### Phase 1: Polish & Reliability

- [ ] Fix platform connection step — currently only available post-deploy in config panel; add optional platform step in wizard flow
- [ ] Seed runtime catalog with hardware recommendations and default templates
- [ ] Add deployment health dashboard — uptime %, restart count, error rate over 24h/7d/30d
- [ ] One-click redeploy on config change (currently requires manual restart)
- [ ] Deployment cloning (fork your own deployment with config overrides)

### Phase 2: More Runtimes & Platforms

- [ ] Additional runtimes — `discordbot` (lightweight Discord-only), `slack-app` (Slack-native)
- [ ] LINE messaging platform integration
- [ ] Facebook Messenger integration
- [ ] Microsoft Teams integration
- [ ] Custom runtime upload — bring your own Docker image with a runtime manifest

### Phase 3: Advanced Deployment Features

- [ ] Multi-region deployment — select deployment region (US, EU, Asia)
- [ ] Auto-scaling — scale pods based on message throughput
- [ ] Deployment versioning — rollback to previous configurations
- [ ] A/B testing — split traffic between two deployment configs
- [ ] Scheduled deployments — deploy at a specific time, auto-stop after window
- [ ] Custom domain mapping — `mybotname.jarble.ai` vanity URLs

---

## Pillar 2: Benchmark

Rate, rank, and discover the best bots. Public leaderboards drive competition and quality.

### Current State (Shipped)

- **Full DB schema** — Domains, ratings, domain scores, service benchmark samples/aggregates, reviews
- **Benchmarks tRPC router** — 12+ procedures: rate deployments, leaderboards, service metrics, reviews
- **Explore page** (`/explore`) — Featured bots, domain leaderboard, service leaderboard, trending (most forked), search
- **Confidence scoring** — Rating confidence bands (low/medium/high) based on sample count
- **Public profiles** — Bio, specialty tags (up to 5), showcase prompts (up to 10)
- **Service reviews** — 1–5 stars with titles, bodies, creator responses

### Phase 1: Fix & Seed

- [ ] Fix `"forks"` metric — not in leaderboard enum, explore page will throw; add forks-based ranking
- [ ] Seed domain taxonomy — create initial domains (customer-support, creative-writing, coding, research, education, gaming, etc.)
- [ ] Admin panel for domain CRUD, featured deployment curation, review moderation
- [ ] Populate service benchmark samples — add timing middleware to service proxy to record latency/success per call

### Phase 2: Automated Evaluation

- [ ] **Eval harness** — define eval suites per domain (prompt → expected output patterns)
- [ ] **LLM-as-judge** — automated scoring using a reference model (e.g., Claude) to rate bot responses
- [ ] **Scheduled benchmarks** — nightly runs that re-evaluate top bots and update scores
- [ ] **Eval builder UI** — create custom eval suites in the dashboard (no code)
- [ ] **Badge system** — "Top 10 in Customer Support", "Most Creative", "Speed Demon" badges on profiles

### Phase 3: Community & Competition

- [ ] **Arena mode** — side-by-side blind comparison (user picks winner, ELO ranking)
- [ ] **Challenges** — time-limited competitions with prizes ("Best coding bot this week")
- [ ] **Domain-specific leaderboards** — nested sub-domains (coding → python, javascript, etc.)
- [ ] **Benchmark history** — track score trends over time per deployment
- [ ] **Embeddable badges** — "Rated #3 on Jarble" SVG badges for external sites

---

## Pillar 3: Gen UI (Dashboard)

Bots don't just chat — they render rich, interactive dashboards. Charts, tables, forms, 3D visualizations, live widgets, all generated from natural language.

### Current State (Shipped)

- **44 canvas components** — Layout primitives, data display (charts, tables, stats), media (image galleries, video, audio), interactive (forms, code editors, spreadsheets), sandboxes
- **MCP UI server** — `render_ui`, `define_component`, `list_components`, `component_reference`, `skill_reference` tools
- **Sandbox system** — CSP-sandboxed iframes, ESM import maps, postMessage bridge (`jarble.fetch()`, `jarble.ask()`), circuit breaker
- **Theming** — 9 color presets, 8 chat skins, CSS variable resolution, per-deployment persistence, natural-language theme switching
- **Canvas workspace** — CSS-grid auto-layout, responsive breakpoints, type-priority sorting, `layoutHint` support
- **12 inline editors** — Edit charts, tables, cards, code blocks, etc. directly in the canvas
- **Bot-ask bridge** — Sandbox components can ask the bot contextual questions (isolated sessions, rate-limited)
- **Bridge-fetch** — 7 tool dispatchers (web search, fetch, news, currency, timezone, wikipedia, service call)
- **File manager** — Drag-and-drop upload to pod PVC, file list, download/delete
- **Artifact persistence** — Canvas cards survive navigation, live SSE updates
- **3 specialist agents** — Component agent, data agent, workflow agent for delegated tasks

### Phase 1: Canvas UX

- [ ] **Drag-and-drop reorder** — manually rearrange canvas cards, persist layout
- [ ] **Card resize** — drag handles to resize individual cards within the grid
- [ ] **Canvas card minimize/maximize** — collapse cards to title bar, expand to full width
- [ ] **Undo/redo** — canvas state history with Ctrl+Z/Ctrl+Y
- [ ] **Canvas zoom & pan** — for complex dashboards with many cards
- [ ] Consolidate `SimpleCanvasGrid` vs `DashboardCanvas` — single grid implementation

### Phase 2: Dashboard Sharing & Export

- [ ] **Public dashboard URLs** — share a read-only canvas snapshot as `jarble.ai/dash/[id]`
- [ ] **Dashboard templates** — save and reuse canvas layouts ("Sales Dashboard", "Analytics Overview")
- [ ] **Export** — PDF, PNG, and CSV export of individual cards or entire dashboards
- [ ] **Embed mode** — `<iframe>` embeddable dashboards for external sites
- [ ] **Scheduled reports** — auto-generate and email dashboard snapshots on a cron

### Phase 3: Real-Time & Collaboration

- [ ] **Live data binding** — components auto-refresh from APIs/databases on an interval
- [ ] **Real-time collaboration** — multiple users viewing/editing the same canvas (CRDT-based)
- [ ] **Canvas commenting** — annotate cards with comments for team discussion
- [ ] **Conditional rendering** — show/hide cards based on data conditions or user roles
- [ ] **Custom component SDK** — public SDK for third-party developers to build canvas components
- [ ] **Canvas variables** — define variables that flow between components (e.g., date range picker filters a chart)

---

## Pillar 4: Buy & Sell Services and Components

A marketplace where creators publish services and components, and bot owners install them to extend their bots' capabilities.

### Current State (Shipped)

- **Component marketplace** — Browse, search, filter by category/tier/pricing, cursor-based pagination
- **Component lifecycle** — Submit → admin publish → install/uninstall on deployments
- **Component versioning** — `componentVersions` table, version history
- **Two component tiers** — `template` (schema-driven) and `sandbox` (arbitrary HTML/JS)
- **Service marketplace** — Browse, publish, install, uninstall, usage tracking
- **Service proxy** — HMAC-signed requests, circuit breaker, rate limiting, input/output validation
- **Service heartbeat** — Self-registration, health checks, auto-mark unhealthy
- **Service handshake** — Install-time HMAC secret exchange, encrypted credential storage
- **Async service jobs** — Job queue for long-running operations
- **Service streaming** — SSE for streamed service responses
- **Star ratings & reviews** — 1–5 stars with creator responses
- **Stripe billing** — Subscription overview, invoice history, customer portal, webhook handling
- **Storage metering** — Usage-based limits per subscription tier

### Phase 1: Creator Experience

- [ ] **Creator dashboard** — earnings, installs, ratings, and usage analytics for your published services/components
- [ ] **Stripe Connect integration** — creator payouts (revenue share model)
- [ ] **Component purchases** — Stripe checkout flow for paid components (schema exists, checkout missing)
- [ ] **Service versioning** — version table for services (components already have this)
- [ ] **In-marketplace preview** — live sandbox preview on component detail pages
- [ ] **Usage analytics UI** — per-service spend and call volume charts for bot owners

### Phase 2: Monetization & Trust

- [ ] **Tiered pricing models** — free, freemium (X calls free then paid), flat-rate, per-call
- [ ] **Usage-based billing** — metered billing for pay-per-call services via Stripe
- [ ] **Verified creator program** — identity verification, trust badges, priority listing
- [ ] **Service SLA tiers** — guaranteed uptime/latency with financial backing
- [ ] **Refund/dispute flow** — automated refund for services not meeting SLA
- [ ] **Bundle pricing** — discounted packages of related services/components

### Phase 3: Ecosystem Growth

- [ ] **Self-hosted service SDK** — npm package + docs for external developers to register services
- [ ] **Component builder** — in-browser visual component builder (no-code)
- [ ] **Service templates** — starter templates for common service patterns (weather, news, analytics)
- [ ] **Affiliate/referral program** — earn credit for referring new creators or users
- [ ] **Featured collections** — curated "Best for Customer Support", "Data Analysis Toolkit", etc.
- [ ] **Service composition** — chain multiple services into a pipeline (output of A → input of B)

---

## Pillar 5: Developer Platform

API keys, agent mesh, and open protocols for developers building on Jarble.

### Current State (Shipped)

- **API key management** — Full CRUD, SHA-256 hashed, prefix-indexed (`jrbl_...`), scoped (`mesh:read`, `mesh:write`), rate-limited per-min/day, max 10 per user
- **Mesh discovery** — `GET /api/mesh/services` returns installed service catalog; `GET /.well-known/jarble-mesh.json` A2A agent card
- **Mesh gateway** — `POST /api/mesh/services/:serviceId/:skillName` for external agents to invoke services
- **Bot-ask endpoint** — External callers can query a bot via REST
- **Bridge-fetch** — 7 tool dispatchers accessible from sandbox and external callers
- **3 specialist agents** — Component, data, and workflow agents with dedicated system prompts
- **Pod API** — Internal pod-to-platform communication (`X-Deployment-Id` + `X-Gateway-Token` auth)
- **Documentation pages** — `/docs/api`, `/docs/architecture`, `/docs/components`, etc.

### Phase 1: Developer Experience

- [ ] **API keys settings UI** — render key management card in Settings page (backend ready, UI needs wiring)
- [ ] **OpenAPI spec generation** — auto-generated Swagger docs from tRPC + REST routes
- [ ] **Interactive API explorer** — Swagger UI or similar at `/docs/api/explorer`
- [ ] **Rate limit headers** — return `X-RateLimit-Remaining`, `X-RateLimit-Reset` from mesh gateway
- [ ] **`@jarble/sdk` npm package** — typed client for mesh gateway, bot-ask, and bridge-fetch
- [ ] Wire workflow + data agent MCP tools in pod MCP config (currently only component agent is callable)

### Phase 2: Integrations & Webhooks

- [ ] **Webhook subscriptions** — register URLs to receive events (deployment status changes, service calls, new messages)
- [ ] **OAuth2 app flow** — third-party apps get user-scoped tokens (authorize → callback → access token)
- [ ] **Zapier/Make integration** — pre-built triggers and actions for no-code automation platforms
- [ ] **GitHub App** — deploy from a repo, auto-redeploy on push
- [ ] **Streaming mesh responses** — SSE support from mesh gateway for long-running service calls

### Phase 3: Agent-to-Agent Protocol

- [ ] **Google A2A compliance** — align mesh protocol with the Agent-to-Agent open standard
- [ ] **Agent task delegation** — agents can delegate sub-tasks to other agents and await results
- [ ] **Agent discovery federation** — discover agents across Jarble instances (federated mesh)
- [ ] **Agent reputation scoring** — reliability metrics visible to other agents before delegation
- [ ] **Multi-agent orchestration UI** — visual builder for agent pipelines and workflows
- [ ] Replace hardcoded mesh gateway internal auth (`X-Gateway-Token: mesh-gateway-internal`) with per-deployment token lookup

---

## Cross-Cutting Concerns

These span all five pillars and are ongoing priorities.

### Security & Compliance
- [ ] SOC 2 Type II audit
- [ ] GDPR data export and deletion flows
- [ ] Per-deployment audit logging (who changed what, when)
- [ ] Sandbox escape fuzzing and hardening
- [ ] Rotate encryption keys without downtime

### Infrastructure & Scalability
- [ ] Multi-region K3s clusters (currently single Hetzner region)
- [ ] Database read replicas for leaderboard/explore queries
- [ ] CDN for static canvas assets and exported dashboards
- [ ] Observability — distributed tracing (OpenTelemetry), error tracking (Sentry), metrics (Prometheus/Grafana)

### Platform UX
- [ ] Mobile-responsive canvas and workspace
- [ ] Onboarding tutorial / interactive walkthrough for first-time users
- [ ] Notification center — deployment events, marketplace updates, benchmark results
- [ ] Team/org accounts — shared deployments, role-based access

---

## Timeline (Rough Phases)

| Phase | Focus | Target |
|-------|-------|--------|
| **Phase 1** | Polish, fix bugs, seed data, complete partially-built features | Q2 2026 |
| **Phase 2** | Monetization, automated benchmarks, dashboard sharing, developer SDK | Q3 2026 |
| **Phase 3** | Ecosystem growth, A2A federation, collaboration, advanced deployment features | Q4 2026+ |

---

*This roadmap is a living document. Priorities shift as we learn from users.*
