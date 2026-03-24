# Jarble — Investor Pitch Deck

---

## Slide 1: Title

# Jarble

### The No-Code Agent Orchestration Platform

**Deploy AI agents in minutes. Orchestrate them visually. Monetize them in a marketplace.**

*Pre-seed / Seed Stage | 2026*

---

## Slide 2: The Problem

### Building AI agents is broken

The demand for AI agents is exploding, but the path from idea to running agent is riddled with friction:

| Pain Point | Who Feels It |
|------------|-------------|
| **Code-first tooling** — CrewAI, LangGraph, and AutoGen require Python expertise and custom orchestration code | Non-technical founders, business teams, solopreneurs |
| **DevOps overhead** — Every agent needs servers, networking, storage, TLS, and monitoring | Small teams without dedicated infrastructure engineers |
| **Platform fragmentation** — Connecting an agent to WhatsApp requires different code than Discord, Slack, or Telegram | Anyone deploying across channels |
| **No marketplace for capabilities** — Agents are siloed; there is no way to discover, install, or sell agent skills and UI components | Developers who build useful agent tools but have no distribution |
| **No visual orchestration** — Multi-agent workflows require code-level DAG construction with no visual feedback loop | Teams building complex agent pipelines |

**The result:** Only well-funded engineering teams can ship production AI agents. Everyone else is locked out.

---

## Slide 3: The Solution

### Jarble makes AI agents accessible to everyone

**One platform. Zero code. Full lifecycle.**

```
   Idea  →  Configure  →  Deploy  →  Orchestrate  →  Monetize
   (60s)     (wizard)     (1-click)   (visual DAG)    (marketplace)
```

**Four core capabilities:**

1. **No-Code Agent Deployment** — A guided wizard takes users from "name your bot" to a live, running agent in under 2 minutes. Pick a runtime, choose an LLM provider (OpenAI, Anthropic, Google, or 200+ models via OpenRouter), and deploy. Every agent gets a web chat interface with rich UI rendering, plus optional connections to WhatsApp, Discord, Slack, and Telegram.

2. **Rich Generative UI** — Agents don't just return text. They render interactive dashboards, charts, tables, forms, code editors, 3D visualizations, and sandboxed web apps — all inline in the conversation. 45 canvas components ship out of the box, powered by a custom MCP (Model Context Protocol) server.

3. **Visual Agent Orchestration** — Build multi-agent pipelines with a drag-and-drop flow canvas. Chain agents together, add conditional branching, human-in-the-loop approval gates, feedback loops, and nested subflows. The DAG engine executes in parallel where possible and streams results in real time via SSE.

4. **Agent Marketplace** — A two-sided marketplace where creators publish services and UI components, and agent owners install them to extend capabilities. Services run on creator infrastructure — Jarble handles discovery, billing, and trust. This is distributed compute, not just a store.

---

## Slide 4: Product Demo

### What to show in a live demo

**Scene 1 — Agent Creation (90 seconds)**
- Open the onboarding wizard. Name the agent. Select the OpenClaw runtime. Paste an OpenRouter API key. Click Deploy. Show the Kubernetes pod spinning up in real time via the status stream. Open the web chat URL.

**Scene 2 — Generative UI in Action**
- Ask the agent: "Show me a sales dashboard for Q1." Watch it render a live chart, KPI stat cards, and a data table — all inline in the chat, on a freeform canvas. Click into a chart to edit it. Ask the agent to refine it. Show the typewriter text reveal and streaming reasoning.

**Scene 3 — Multi-Agent Flow**
- Open the flow canvas. Drag three deployment nodes: a research agent, an analysis agent, and a report writer. Connect them. Add a human-in-the-loop approval node before the final output. Execute the flow and watch each step stream results in real time. Show cycle support — the analysis agent retries until confidence is above a threshold.

**Scene 4 — Marketplace**
- Browse the component marketplace. Install a "Financial Charts" component pack onto a deployment. Show the agent immediately gaining access to candlestick charts and portfolio visualizations. Browse the service marketplace — install a web search service. The agent can now search the internet.

---

## Slide 5: How It Works

### Architecture: Bot-as-a-Pod

```
User (browser/mobile)
  │
  ├── Web Chat (jarble.ai/d/[id])
  ├── WhatsApp / Discord / Slack / Telegram
  │
  ▼
┌─────────────────────────────────────────┐
│  Next.js 15 Frontend (React 19)         │
│  - Chat UI with streaming + typewriter  │
│  - Canvas workspace (45 components)     │
│  - Flow builder (@xyflow/react)         │
└─────────────┬───────────────────────────┘
              │ tRPC + SSE
              ▼
┌─────────────────────────────────────────┐
│  Express + tRPC API (80+ procedures)    │
│  - Auth0 JWT authentication             │
│  - Stripe billing                       │
│  - Flow execution engine (DAG runner)   │
│  - Service proxy + circuit breaker      │
│  - MCP UI server (render_ui, etc.)      │
└─────────────┬───────────────────────────┘
              │ K8s API
              ▼
┌─────────────────────────────────────────┐
│  Kubernetes Cluster (K3s on Hetzner)    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Pod A   │ │  Pod B  │ │  Pod C  │   │
│  │(Agent 1) │ │(Agent 2)│ │(Agent 3)│   │
│  │ OpenClaw │ │ZeroClaw │ │OpenClaw │   │
│  └─────────┘ └─────────┘ └─────────┘   │
│  - Longhorn persistent storage          │
│  - Traefik ingress                      │
│  - ConfigSync for live config updates   │
└─────────────────────────────────────────┘
              │
              ▼
   LLM Providers (OpenRouter, OpenAI,
   Anthropic, Google — 200+ models)
```

**Key architectural decisions:**

- **Each agent is an isolated Kubernetes pod** — full process isolation, dedicated storage, independent lifecycle. No noisy-neighbor issues.
- **MCP server for UI rendering** — The agent calls `render_ui` to produce structured component JSON. The frontend renders it as interactive canvas blocks. This separates UI generation from LLM output parsing.
- **BYOK (Bring Your Own Key)** — Users pay their LLM provider directly. Jarble charges only for compute hosting. Zero markup on AI costs.
- **Real-time everything** — SSE streams for chat, deployment status, logs, QR pairing, and flow execution. No polling.

---

## Slide 6: Market Opportunity

### A $100B+ addressable market at the intersection of three waves

| Market | 2025 Size | 2028 Projected | CAGR | Source |
|--------|-----------|---------------|------|--------|
| AI Agent Platforms | $5.3B | $47B | 44.8% | MarketsandMarkets (2024) |
| No-Code/Low-Code Development | $26.9B | $65B | 28.4% | Gartner (2024) |
| Chatbot & Conversational AI | $12.2B | $32B | 23.3% | Grand View Research (2024) |
| iPaaS / Integration Platforms | $11.1B | $26B | 25.7% | Fortune Business Insights |

**Jarble's TAM/SAM/SOM:**

- **TAM (Total Addressable Market):** $47B — Every business deploying AI agents across channels
- **SAM (Serviceable Addressable Market):** $8B — Non-technical teams and solopreneurs who need no-code agent tooling with visual orchestration
- **SOM (Serviceable Obtainable Market):** $200M — Early adopters in the no-code AI space within 3 years of launch

**Tailwinds:**
- Every major LLM provider is pushing agents (OpenAI Agents SDK, Anthropic MCP, Google A2A)
- Enterprise AI budgets are shifting from "experiments" to "production deployments"
- The no-code movement has proven that visual builders win mass adoption (Zapier: $5B valuation, Webflow: $4B, Bubble: $200M ARR)

---

## Slide 7: Competitive Landscape

### Jarble occupies a unique position: visual-first, full-lifecycle, marketplace-native

```
                        Code-First              No-Code / Visual
                    ┌─────────────────────┬─────────────────────┐
                    │                     │                     │
   Agent            │   CrewAI            │                     │
   Orchestration    │   LangGraph         │     ★ JARBLE ★      │
                    │   AutoGen           │                     │
                    │                     │                     │
                    ├─────────────────────┼─────────────────────┤
                    │                     │                     │
   Single Agent /   │   Custom code       │   Botpress          │
   Chatbot          │   (Python/JS)       │   Voiceflow         │
                    │                     │   Chatfuel          │
                    │                     │                     │
                    └─────────────────────┴─────────────────────┘
```

| Competitor | Strength | Jarble Advantage |
|-----------|----------|-----------------|
| **CrewAI** | Strong multi-agent framework, large open-source community | Visual builder (no Python required), built-in marketplace, hosted infrastructure |
| **LangGraph** | Sophisticated state machines, LangSmith observability | No-code flow canvas, native web SSE streaming (vs desktop-only LangGraph Studio), one-click deploy |
| **Botpress / Voiceflow** | Established chatbot platforms, template libraries | LLM-native (not template-based), rich generative UI (45 canvas components), agent orchestration |
| **blink.new / v0** | Fast AI-generated UI prototypes | Full agent lifecycle (not just sandboxes), persistent deployments, multi-platform messaging |
| **Zapier / Make** | Massive integration catalog, proven no-code model | AI-native (agents, not triggers/actions), generative UI, marketplace for agent capabilities |

**Jarble's moat deepens with every user:**
- Each published component and service makes the marketplace more valuable
- The Agent Forking Flywheel means top community agents improve platform quality for everyone
- Visual orchestration + marketplace creates a network effect that code-first tools cannot replicate

---

## Slide 8: Business Model

### Multi-layered revenue with strong unit economics

```
┌──────────────────────────────────────────────────────────┐
│                    REVENUE STREAMS                         │
├──────────────┬───────────────┬──────────────┬────────────┤
│  Compute     │  Marketplace  │  Agent       │  Enterprise│
│  Hosting     │  Revenue      │  Credits     │  Contracts │
│  (recurring) │  Share        │  (usage)     │            │
│              │               │              │            │
│  $32+/mo     │  70/30 split  │  Per-call    │  Custom    │
│  per agent   │  on component │  billing for │  pricing   │
│              │  & service    │  agent-to-   │  for teams │
│              │  sales        │  agent calls │            │
└──────────────┴───────────────┴──────────────┴────────────┘
```

**1. Compute Hosting (Core Revenue)**
- Per-deployment monthly pricing based on runtime tier
- Starting at $32/month per agent deployment
- Scales with CPU, RAM, and storage allocation
- 7-day free trial, no credit card required

**2. Marketplace Revenue Share**
- 70% to creator, 30% to Jarble on all marketplace transactions
- Applies to both component sales and service subscriptions
- Incentivizes a creator ecosystem — more supply attracts more demand

**3. Agent Credits (Usage-Based)**
- Per-call billing when agents invoke other agents via the mesh gateway
- Enables monetizable multi-agent flows
- Credits consumed at execution time, metered and billed via Stripe

**4. Enterprise (Future)**
- Dedicated infrastructure, custom SLAs, team/org accounts
- Priority support, compliance features (SOC 2, GDPR)

**Why BYOK matters for margins:**
Jarble never touches LLM costs. Users pay OpenRouter/OpenAI/Anthropic directly. This means Jarble's hosting revenue is pure infrastructure margin — no volatile AI cost pass-through. Gross margins target 70%+ at scale.

---

## Slide 9: Traction & Current State

### Built product, approaching beta launch

| Metric | Value |
|--------|-------|
| **Canvas Components** | 45 interactive UI components (charts, tables, forms, 3D, sandboxes, code editors) |
| **API Procedures** | 80+ tRPC procedures across 15 routers |
| **Test Coverage** | 82 API test files, 37 frontend test files |
| **Flow Engine** | DAG execution with cycles, HITL, nested subflows, parallel batching |
| **Messaging Platforms** | WhatsApp (QR pairing), Discord, Slack, Telegram |
| **LLM Providers** | 200+ models via OpenRouter, plus direct OpenAI, Anthropic, Google |
| **Infrastructure** | Production Kubernetes cluster on Hetzner Cloud (Terraform IaC) |
| **Auth & Billing** | Auth0 (JWT + OAuth) + Stripe (subscriptions, webhooks, metered billing) |
| **Marketplace** | Component + service marketplace with versioning, reviews, HMAC-signed proxy |
| **Security** | AES-256-GCM credential encryption, CSP-sandboxed iframes, circuit breakers |

**Key milestones:**

- **Product built end-to-end** — From onboarding wizard to deployed agent to marketplace, the full user journey works
- **Beta launch: March 29, 2026** — Public beta with free trial
- **Orchestration system complete** — Visual flow builder with competitive feature parity to CrewAI/LangGraph, but no-code
- **Agent Forking Flywheel designed** — Database schema, forkability scoring, and public leaderboards built; ready for community activation
- **Developer platform foundations** — API key management, mesh gateway, A2A agent cards, bridge-fetch dispatchers

**Current stage:** Pre-revenue. Product-complete. Approaching public beta.

---

## Slide 10: Technology Moat

### Compounding advantages that are hard to replicate

**1. 45-Component Canvas System**
Every component is defined in a shared manifest (`@jarble/component-manifest`) that serves as the single source of truth across frontend rendering and the MCP server. Adding a new component is a 3-file change. The auto-fix pipeline catches mismatches at build time. This is not a demo — it is production-grade generative UI.

**2. MCP Server with Sandbox-First Rendering**
The custom MCP server (`render_ui`, `define_component`, `list_components`) gives LLMs structured tools to produce UI, rather than hoping they emit valid HTML. Sandboxed components run in CSP-isolated iframes with a postMessage bridge (`jarble.fetch()`, `jarble.ask()`). Agents can render anything from a simple stat card to a full interactive web app.

**3. Flow Engine with Cycle, HITL, and Subflow Support**
The orchestration engine is not a simple linear pipeline. It supports:
- Parallel execution of independent steps
- Cyclic nodes (retry-until-success loops, up to N iterations)
- Human-in-the-loop gates (pause, collect input via REST, resume)
- Nested subflows (a flow step can trigger an entire child flow)
- Template variables with runtime resolution from prior step results
- Real-time SSE streaming of every execution event

**4. Agent Mesh & Marketplace Network Effect**
Pods are interconnected. One agent can call another agent's services through the mesh gateway. The marketplace creates a network effect: more creators publishing services and components attracts more users, which attracts more creators. The Agent Forking Flywheel compounds this — top community agents can be forked as platform-hosted services, raising quality for everyone.

**5. Real-Time Streaming Architecture**
Every interaction streams in real time: chat responses (with typewriter reveal and visible reasoning), deployment status, pod logs, QR code pairing, and flow execution. This is not bolted on — SSE streaming is a first-class primitive across the entire stack.

---

## Slide 11: Go-to-Market Strategy

### Community-led growth with marketplace flywheel

**Phase 1: Developer Community (Q2 2026)**
- Launch on Product Hunt, Hacker News, and AI-focused communities
- Free tier (7-day trial) removes friction for experimentation
- Focus on AI enthusiasts, indie hackers, and solopreneurs
- Content marketing: tutorials on building AI agents without code, comparison posts vs CrewAI/LangGraph
- Discord community for support and feedback

**Phase 2: Marketplace Flywheel (Q3 2026)**
- Recruit early creators to publish components and services
- Revenue share (70/30) incentivizes quality contributions
- Featured collections and creator spotlights drive discovery
- Each new marketplace item makes every agent on the platform more capable
- Component and service install counts create visible social proof

**Phase 3: Prosumer & SMB (Q4 2026)**
- Target small businesses deploying customer support, sales, and internal agents
- Multi-agent flows become the entry point for teams with complex workflows
- Dashboard sharing and embedding for client-facing use cases
- Enterprise inquiries begin (custom deployments, SLAs, team accounts)

**Phase 4: Enterprise & Platform (2027)**
- SOC 2 compliance, GDPR tooling, team/org accounts
- Self-hosted deployment option for regulated industries
- `@jarble/sdk` for developers building on the platform
- A2A federation — agents on different Jarble instances can discover and call each other

**Distribution advantage:** The marketplace is inherently viral. Every published component or service has a creator who markets it to their own audience, driving organic traffic back to Jarble.

---

## Slide 12: Team

*[To be completed]*

| Role | Name | Background |
|------|------|-----------|
| **Founder / CEO** | | |
| **Co-Founder / CTO** | | |
| **Engineering** | | |
| **Design** | | |
| **Advisors** | | |

---

## Slide 13: The Ask

### Raising $[X]M to go from beta to market leader

**Use of Funds:**

| Category | Allocation | Purpose |
|----------|-----------|---------|
| **Engineering** | 50% | Hire 3-4 engineers (full-stack, infra, AI/ML). Accelerate marketplace, orchestration, and enterprise features. |
| **Infrastructure** | 15% | Multi-region Kubernetes clusters, CDN, database scaling, observability (OpenTelemetry, Sentry, Grafana) |
| **Marketing & Community** | 20% | Product Hunt launch, content marketing, developer evangelism, creator recruitment for marketplace |
| **Operations** | 15% | Legal (SOC 2, terms of service), office/remote tooling, Stripe/Auth0 scaling costs |

**Milestones this funding enables:**

| Timeline | Milestone |
|----------|----------|
| **Month 3** | Public launch with 500+ beta users, 10+ marketplace creators |
| **Month 6** | 2,000+ registered users, 50+ marketplace items, first paying customers |
| **Month 9** | $10K MRR, enterprise pilot with 1-2 companies, agent-to-agent protocol in production |
| **Month 12** | $50K MRR, 100+ marketplace creators, Series A readiness |

---

## Slide 14: Appendix — Technical Architecture

### System Metrics

| Category | Detail |
|----------|--------|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, 45 canvas components |
| **Backend** | Express + tRPC, 15 routers, 80+ procedures, SuperJSON serialization |
| **Database** | Drizzle ORM with MySQL (prod), PostgreSQL (alt), SQLite (dev) |
| **Auth** | Auth0 with JWT + JWKS, email/password + Google + GitHub OAuth |
| **Payments** | Stripe subscriptions, checkout, webhooks, metered billing |
| **Infrastructure** | Hetzner Cloud, Terraform IaC, K3s cluster, Longhorn storage, Traefik ingress |
| **Security** | AES-256-GCM encryption, CSP sandbox isolation, HMAC-signed service proxy, circuit breakers |
| **Monitoring** | Sentry (client + server), PostHog analytics |
| **Test Suite** | 82 API test files + 37 frontend test files (Vitest) |
| **CI/Build** | TypeScript strict mode, manifest sync validation, automated type-checking |

### The Five Pillars

```
┌─────────────────────────────────────────────────────────────┐
│                      JARBLE PLATFORM                         │
├────────────┬────────────┬──────────┬──────────┬─────────────┤
│  No-Code   │ Benchmark  │  Gen UI  │  Buy &   │  Developer  │
│  Deploy    │ & Discover │(Dashboard)│  Sell    │  Platform   │
│            │            │          │(Market-  │  (API/Mesh) │
│ • Wizard   │ • Ratings  │ • 45     │  place)  │ • API keys  │
│ • 2 runtimes│ • Leader- │  compo-  │ • Compo- │ • Mesh      │
│ • 4 LLM   │   boards   │  nents   │  nents   │   gateway   │
│   providers│ • Reviews  │ • MCP    │ • Serv-  │ • A2A card  │
│ • 4 msg    │ • Public   │   server │  ices    │ • Bridge-   │
│   platforms│   profiles │ • Sand-  │ • HMAC   │   fetch     │
│ • K8s pods │ • Fork     │   boxes  │  proxy   │ • Agent     │
│ • Config   │   tracking │ • Themes │ • Rev    │   credits   │
│   sync     │            │ • Canvas │  share   │             │
└────────────┴────────────┴──────────┴──────────┴─────────────┘
```

### Orchestration Engine Detail

```
Flow Definition (JSON: nodes + edges)
         │
         ▼
┌─────────────────────────────┐
│   Flow Engine (DAG Runner)  │
│                             │
│  1. Parse entry nodes       │
│  2. Topological sort        │
│  3. Execute parallel batches│
│  4. Template var resolution │
│  5. Cycle detection + retry │
│  6. HITL pause/resume       │
│  7. Subflow delegation      │
│  8. Credit billing per step │
│                             │
│  Node Types:                │
│  • deployment (call a bot)  │
│  • transform (JS expression)│
│  • condition (branch)       │
│  • output (collect results) │
│  • waitForInput (HITL)      │
│  • subflow (nested flow)    │
└──────────────┬──────────────┘
               │
               ▼
      SSE Event Stream
  (9 event types, reconnect
   with buffered replay)
```

### Competitive Feature Matrix

| Feature | Jarble | CrewAI | LangGraph | Botpress | Voiceflow |
|---------|--------|--------|-----------|----------|-----------|
| No-code visual builder | Yes | No | No | Partial | Yes |
| Multi-agent orchestration | Yes | Yes | Yes | No | No |
| LLM-native (not template) | Yes | Yes | Yes | No | No |
| Generative UI components | 45 | No | No | No | No |
| Marketplace for capabilities | Yes | No | No | Template store | Template store |
| BYOK (no AI cost markup) | Yes | N/A (library) | N/A (library) | No | No |
| One-click multi-platform deploy | Yes | No | No | Partial | Partial |
| Cycle/loop support | Yes | Yes | Yes | No | No |
| Human-in-the-loop gates | Yes | Partial | Yes | No | No |
| Real-time SSE streaming | Yes | No | LangGraph Studio | No | No |
| Agent-to-agent mesh | Yes | No | No | No | No |
| Credit-based billing per step | Yes | No | No | No | No |

---

*This document is confidential and intended for prospective investors. Information is current as of March 2026.*
