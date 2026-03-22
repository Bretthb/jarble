# Jarble Platform Mega-Upgrade — Blink-Inspired + Agent Marketplace + MicroVM Isolation

## Context

Competitive analysis of blink.new + Gemini architecture research revealed three upgrade tracks:
1. **UI/UX** — Pages, reasoning, design consistency, templates, RAG, confirmations
2. **Infrastructure** — MicroVM isolation for untrusted agent code (gVisor → Kata + Cloud Hypervisor)
3. **Agent Marketplace** — Agents discover, call, and sell services to each other via Marketplace Hub

Both Jarble and Blink use OpenClaw. Blink hosts on Fly.io Firecracker VMs; Jarble hosts on k3s/Hetzner. **Critical finding: Hetzner Cloud VPS does NOT support nested virtualization** — Firecracker/Kata require bare metal servers. gVisor works now.

---

## Track A: UI/UX Improvements (Phases 1-6)

### Phase 1: Design Intent Tracking (2-3 days)

Bot maintains visual consistency by tracking style choices per-session.

| Step | File | Change |
|------|------|--------|
| 1.1 | `jarble-api-main/src/mcp/jarble-ui-server.js` | Add `update_design_context` tool → writes to `/data/workspace/design-context.json`. Auto-infer styles in `executeRenderUi` (extract colorPalette, chartStyle from rendered components) |
| 1.2 | `jarble-api-main/src/utils/eventTypes.ts` | Add `CUSTOM_DESIGN_CONTEXT = "jarble.design.context"` |
| 1.3 | `Jarble-mvp/hooks/useCanvasChat.ts` | Handle design context CUSTOM event, include as `[DESIGN_CONTEXT]` block in subsequent messages |
| 1.4 | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | +3 lines to JARBLE_UI_PROMPT: match palette/style from context |

---

### Phase 2: Agent Persona Templates (4-5 days)

Rich persona gallery in onboarding wizard.

| Step | File | Change |
|------|------|--------|
| 2.1 | `jarble-api-main/src/db/schema.sqlite.ts` | Add `personaTemplates` table (id, name, slug, category, systemPrompt, recommendedTools, defaultTheme, suggestedLlm, exampleConversation, showcasePrompts) |
| 2.2 | `jarble-api-main/src/db/init.ts` | Seed 12-15 personas: General, Sales, Support, Research, Education, Developer, Creative, Data |
| 2.3 | `jarble-api-main/src/trpc/routers/template.ts` | Rewrite from hardcoded → DB-backed: list, getById, listByCategory |
| 2.4 | `Jarble-mvp/views/onboarding/wizardStepConfig.ts` | Add `"persona"` step after Name, before Runtime |
| 2.5 | `Jarble-mvp/views/onboarding/steps/StepChoosePersona.tsx` | **NEW** — Category tabs + card grid with preview popover |
| 2.6 | `Jarble-mvp/views/OnboardingWizard.tsx` | Render StepChoosePersona |
| 2.7 | `jarble-api-main/src/trpc/routers/deployment.ts` | Accept `personaTemplateId` in create → apply systemPrompt, llm, theme |

---

### Phase 3: Pages System (7-10 days)

Full-screen multi-component page layouts (dashboards, kanban, CRM, settings).

**Design decisions:**
- `page` = new component type (not overloaded `layout`)
- Full-screen = modal overlay inside canvas panel (chat stays visible on left)
- Auto-opens in fullscreen when bot renders a page
- Decomposable back to individual cards via UNGROUP
- `render_page` MCP tool emits single `jarble_ui` block

#### Shared Layer
| Step | File | Change |
|------|------|--------|
| 3.1 | `shared/component-manifest/pages/types.ts` | **NEW** — PageType union, PageSectionDef, PageTemplateDef |
| 3.2 | `shared/component-manifest/pages/templates.ts` | **NEW** — 7 templates: dashboard, settings, kanban, crm, landing, data_explorer, form_wizard |
| 3.3 | `shared/component-manifest/components/page.ts` | **NEW** — Manifest entry: category "specialized", renderOrder 0 |
| 3.4 | `shared/component-manifest/index.ts` | Register page entry, re-export PAGE_TEMPLATES |
| 3.5 | Schemas file | Add `pageSchema` (type, title, sections record, navigation?) |

#### Frontend
| Step | File | Change |
|------|------|--------|
| 3.6 | `Jarble-mvp/components/canvas/components/CanvasPage.tsx` | **NEW** — Renders page by type, recursive child rendering via CanvasRenderer |
| 3.7 | `Jarble-mvp/components/canvas/registry.ts` | Register `page` + `pageSchema` |
| 3.8 | `Jarble-mvp/components/workspace/types.ts` | Add `fullscreenPageId` to state + OPEN/CLOSE_PAGE_FULLSCREEN actions |
| 3.9 | `Jarble-mvp/components/workspace/canvasReducer.ts` | Handle 3 new actions, extend UNGROUP for pages |
| 3.10 | `Jarble-mvp/components/workspace/PageFullscreenOverlay.tsx` | **NEW** — Absolute overlay, header bar, nav tabs, Escape to close |
| 3.11 | `Jarble-mvp/app/d/[id]/page.tsx` | Render overlay when fullscreenPageId set |
| 3.12 | `Jarble-mvp/hooks/useCanvasChat.ts` | Auto-open pages in fullscreen on TOOL_CALL_END |
| 3.13 | `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx` | Page badge, double-click opens fullscreen |

#### Backend
| Step | File | Change |
|------|------|--------|
| 3.14 | `jarble-api-main/src/mcp/jarble-ui-server.js` | Add `render_page` tool + dispatch |
| 3.15 | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Add Pages section to JARBLE_UI_PROMPT |
| 3.16 | `shared/component-manifest/skills/page-composition.ts` | **NEW** — Page skill for skill_reference |

**7 built-in page templates:**
1. **dashboard** — header, kpi_row, charts, tables
2. **settings** — sidebar_nav, content_area
3. **kanban** — header, columns (dynamic lists)
4. **crm** — header, summary, contacts, activity
5. **landing** — hero, features, testimonials, cta
6. **data_explorer** — filters, data_view, detail
7. **form_wizard** — steps, form_area, actions

---

### Phase 4: WebSocket Control Channel + Reasoning (5-7 days)

**Approach: Hybrid** — SSE for streaming, WS for control (stop, typing, confirmations).

| Step | File | Change |
|------|------|--------|
| 4.1 | `jarble-api-main/src/services/chatSessionManager.ts` | **NEW** — Maps deploymentId → active runs, enables WS↔SSE cross-channel |
| 4.2 | `jarble-api-main/src/routes/chatControl.ts` | **NEW** — WS at `/ws/chat?token=JWT&deploymentId=ID`. Protocol: stop, typing, confirm, ping/pong |
| 4.3 | `jarble-api-main/src/index.ts` | Mount WS handler |
| 4.4 | `jarble-api-main/src/routes/tamboAgent.ts` | Register with session manager. WS abort → proper TEXT_MESSAGE_END with preserved text. Add `jarble.tool.status` events alongside TOOL_CALL_START |
| 4.5 | `Jarble-mvp/hooks/useChatControl.ts` | **NEW** — Auto-connect WS, exposes stopGeneration/sendTyping/respondToConfirm. Falls back to AbortController |
| 4.6 | `Jarble-mvp/hooks/useCanvasChat.ts` | Integrate WS stop, typing indicators, tool status tracking |
| 4.7 | `Jarble-mvp/components/chat/AssistantUIChat.tsx` | ToolStatusRenderer (spinner → checkmark), structured reasoning steps |
| 4.8 | `jarble-api-main/src/services/reasoning.ts` | Non-blocking reasoning (concurrent with bot text), shorter timeout (2s) |

**Feature flag:** `ENABLE_CHAT_WS=true`. Graceful degradation when WS unavailable.

---

### Phase 5: RAG / Knowledge Base (7-10 days)

Document ingestion + vector search. Built on existing memory system's embedding infrastructure.

| Step | File | Change |
|------|------|--------|
| 5.1 | `jarble-api-main/src/services/documentParser.ts` | **NEW** — Parse PDF (`pdf-parse`), TXT/MD, DOCX (`mammoth`), URL. Semantic chunking (200-800 tokens, 50-token overlap) |
| 5.2 | `jarble-api-main/src/routes/knowledge.ts` | **NEW** — `POST .../ingest` (multipart/URL), `GET .../collections`, `DELETE .../collections/:id` |
| 5.3 | `jarble-api-main/src/mcp/jarble-ui-server.js` | Add `knowledge_search` (query→embed→cosine→top-K with sources), `list_knowledge`, `delete_knowledge` |
| 5.4 | `Jarble-mvp/components/workspace/KnowledgePanel.tsx` | **NEW** — Drag-drop upload, URL input, collection list, Brain icon in header |
| 5.5 | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Add to prompt: "Check knowledge_search first for uploaded documents. Cite sources." |

**Storage:** `/data/knowledge/manifest.json` + `/data/knowledge/chunks/{collectionId}.json` on PVC.
**New deps:** `pdf-parse`, `mammoth`

---

### Phase 6: Human-in-the-Loop Confirmation (5-7 days)

Split-response pattern — bot calls `confirm_action`, returns immediately, user clicks Approve/Reject, bot receives `[CONFIRMATION_RESPONSE]` in next turn.

| Step | File | Change |
|------|------|--------|
| 6.1 | `jarble-api-main/src/mcp/jarble-ui-server.js` | Add `confirm_action` + `check_confirmation` tools. Writes to `/data/workspace/confirmations.json` |
| 6.2 | `shared/component-manifest/components/confirmation.ts` | **NEW** — Manifest entry: category "interactive" |
| 6.3 | `Jarble-mvp/components/canvas/components/CanvasConfirmation.tsx` | **NEW** — Severity-colored card, countdown timer, Approve/Reject buttons |
| 6.4 | `Jarble-mvp/components/canvas/registry.ts` | Register confirmation + schema |
| 6.5 | `Jarble-mvp/app/d/[id]/page.tsx` | Handle `confirmation_response` action → update card + send response to bot |
| 6.6 | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Add to prompt: "For sensitive actions, call confirm_action first." |

---

## Track B: Infrastructure — MicroVM Isolation (Phases 7-9)

### Critical Finding

**Hetzner Cloud VPS does NOT support `/dev/kvm`** — Firecracker and Kata cannot run on current infrastructure. Must use Hetzner dedicated (bare metal) servers for hardware-level VM isolation.

**Cloud Hypervisor > Firecracker** — Firecracker requires devmapper snapshotter, has limited device types, no virtio-fs. Cloud Hypervisor boots <100ms, supports virtio-fs for PVC access, backed by Linux Foundation.

### Phase 7: gVisor on Existing VPS (2-3 weeks)

Immediate security uplift — syscall interception without hardware changes.

| Step | File | Change |
|------|------|--------|
| 7.1 | Infrastructure (k3s workers) | Install gVisor (`runsc`) on worker nodes |
| 7.2 | Infrastructure (containerd) | Add gVisor runtime handler to `config.toml.tmpl` |
| 7.3 | Infrastructure (k8s) | Create `gvisor` RuntimeClass (overhead: 100m CPU, 40Mi RAM) |
| 7.4 | `jarble-api-main/src/k8s/lifecycle.ts` | Accept `runtimeClassName` parameter in pod spec |
| 7.5 | `jarble-api-main/src/k8s/constants.ts` | Add RuntimeClass constants |
| 7.6 | `jarble-api-main/src/trpc/routers/deployment.ts` | Allow setting isolation level per deployment |
| 7.7 | Validation | Test configSync, exec, logs, MCP all work through gVisor |

**Dual-runtime model:**
- Trusted (user's own bots): `standard` runtime (current)
- Marketplace agents (untrusted code): `gvisor` RuntimeClass

### Phase 8: Kata + Cloud Hypervisor on Dedicated Servers (4-6 weeks)

Hardware-level VM isolation for marketplace agents.

| Step | Description |
|------|-------------|
| 8.1 | Provision Hetzner AX42 dedicated server (AMD EPYC, 64GB RAM, ~52 EUR/mo) |
| 8.2 | Install Ubuntu 22.04+, verify `/dev/kvm` |
| 8.3 | Join as k3s worker node to existing control plane |
| 8.4 | Install Kata Containers + Cloud Hypervisor VMM |
| 8.5 | Create `kata-clh` RuntimeClass with scheduling constraints (`nodeSelector: jarble.ai/runtime-capable=kata`) |
| 8.6 | Test: deploy agent pod with `runtimeClassName: kata-clh` |
| 8.7 | Validate: networking (Service/DNS), storage (PVC via virtio-fs), exec (kubectl exec through kata-agent) |

**Architecture:**
```
┌─ Hetzner Cloud VPS (k3s control plane) ────────┐
│  k3s server, Jarble API, ingress, monitoring    │
└───────────────────┬─────────────────────────────┘
                    │ k3s join
┌─ Hetzner Dedicated AX42 (k3s worker, bare metal) ─┐
│  /dev/kvm available                                 │
│  Kata + Cloud Hypervisor runtime                    │
│  Agent pods → each in its own MicroVM               │
│  ~50-100 agents per server at ~100MiB overhead each │
└─────────────────────────────────────────────────────┘
```

### Phase 9: Pod Security Hardening (1-2 weeks)

| Step | Description |
|------|-------------|
| 9.1 | Apply `Restricted` Pod Security Standards to jarble namespace |
| 9.2 | `runAsNonRoot: true`, drop ALL capabilities, `readOnlyRootFilesystem: true` |
| 9.3 | Add namespace-level ResourceQuotas (prevent runaway agent resource consumption) |
| 9.4 | RuntimeClass `overhead.podFixed` for accurate scheduling (Kata: 250m CPU, 160Mi RAM) |

---

## Track C: Agent Marketplace — Marketplace Hub Pattern (Phases 10-13)

### Architecture: Marketplace Hub

Per Gemini's recommendation (and confirmed by research): agents **never talk directly to each other**. All inter-agent communication flows through a **Marketplace Hub** — a central proxy that maintains the agent directory, authenticates requests, and routes calls.

```
Agent A ──MCP call_agent──→ Marketplace Hub ──A2A/HTTPS──→ Agent B (MicroVM)
                               │
                          ┌────┴─────┐
                          │ Verify   │
                          │ Credits  │
                          │ Auth     │
                          │ Rate lim │
                          │ Meter    │
                          └──────────┘
```

**Protocol choices:**
- **MCP** for tool access (already in place)
- **A2A** (Google, v0.3) for agent-to-agent communication — Agent Cards, task lifecycle, SSE streaming
- **AgentService CRD** for K8s-native discovery
- **Credit-based billing** for micropayments between agents

### Phase 10: Agent Registry + Discovery (3-4 weeks)

| Step | File | Change |
|------|------|--------|
| 10.1 | `infrastructure/` (Terraform) | Define `AgentService` CRD (`marketplace.jarble.ai/v1alpha1`) with skills, pricing, capabilities, endpoint, visibility |
| 10.2 | `jarble-api-main/src/k8s/operator.ts` | Add AgentService CRD CRUD alongside OpenClawInstance |
| 10.3 | OpenClaw pods (ConfigMap) | Serve A2A Agent Card at `/.well-known/agent-card.json` (identity, skills, auth) |
| 10.4 | `jarble-api-main/src/trpc/routers/` | New `agent` router: `list`, `get`, `register`, `search`, `getAgentCard` |
| 10.5 | `jarble-api-main/src/mcp/jarble-ui-server.js` | Add `discover_agents` MCP tool (search by capability) and `call_agent` MCP tool (invoke another agent's skill via Hub) |
| 10.6 | `Jarble-mvp/components/marketplace/` | Agent marketplace UI — browse agents by skill, pricing, ratings |

**AgentService CRD key fields:**
```yaml
spec:
  deploymentId: "abc123"
  name: "Weather Intelligence Agent"
  endpoint: { url: "http://dep-abc123.jarble.svc:18789", protocol: a2a }
  skills: [{ id: "forecast", name: "7-Day Forecast", priceCredits: 3 }]
  pricing: { model: credit, creditsPerCall: 1 }
  visibility: public | private | unlisted
```

### Phase 11: Marketplace Hub + Credits (3-4 weeks)

The Hub is a standard k3s pod (or part of the Jarble API) that mediates all agent-to-agent calls.

| Step | File | Change |
|------|------|--------|
| 11.1 | `jarble-api-main/src/services/marketplaceHub.ts` | **NEW** — Central proxy: receives MCP `call_agent` requests, validates auth + credits + rate limits, proxies to target agent via A2A HTTPS/SSE, meters usage |
| 11.2 | `jarble-api-main/src/db/schema.sqlite.ts` | Add `agentCredits` table (append-only ledger: userId, amount, balance, reason, reference) and `agentUsage` table (caller, callee, skill, credits, latency, status) |
| 11.3 | `jarble-api-main/src/trpc/routers/billing.ts` | Extend: credit pack purchases via Stripe ($5=500, $20=2500), credit balance query, withdrawal to Stripe |
| 11.4 | `jarble-api-main/src/services/platformTokens.ts` | **NEW** — Issue JWT platform tokens: scoped to specific skills, time-limited, budget-capped. Used by Hub to authorize proxied calls |
| 11.5 | K8s NetworkPolicies | Default deny inter-agent traffic. Allow: Jarble API → all agents (health/config). Generate per-authorization NetworkPolicies when agents are granted access |
| 11.6 | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Add to system prompt: "Use `discover_agents` to find marketplace agents. Use `call_agent` to invoke their skills. Credits are deducted per call." |

**Revenue share:** Agent owners earn 70% of credits charged. Platform retains 30%.

**Call flow:**
1. Agent A calls `call_agent` MCP tool → request goes to Jarble API (Marketplace Hub)
2. Hub checks: caller has credits? authorized for this skill? within rate limits?
3. Hub issues platform JWT token scoped to the specific skill
4. Hub proxies request to Agent B via A2A HTTPS with Bearer token
5. Agent B processes, returns response (streaming via SSE if needed)
6. Hub meters usage, deducts credits from Agent A, credits Agent B owner
7. Response returned to Agent A via MCP tool result

### Phase 12: Agent Publishing + Dashboard (2-3 weeks)

| Step | File | Change |
|------|------|--------|
| 12.1 | `Jarble-mvp/views/` | Agent publish wizard — define skills, set pricing, write description, submit for review |
| 12.2 | `jarble-api-main/src/trpc/routers/agent.ts` | Publish workflow: draft → pending_review → published. Admin approval |
| 12.3 | `Jarble-mvp/components/workspace/AgentDashboard.tsx` | **NEW** — Agent owner dashboard: revenue, usage analytics, call logs, per-skill metrics |
| 12.4 | `jarble-api-main/src/mcp/jarble-ui-server.js` | Add `advertise_capabilities` MCP tool so bots can self-register skills |

### Phase 13: Scale — Linkerd + NATS (4-6 weeks, when needed)

Only when agent count exceeds 10-50 concurrent pods:

| Step | Description |
|------|-------------|
| 13.1 | Install Linkerd for auto-mTLS across all agent pods (lowest overhead mesh, Rust proxy) |
| 13.2 | Add NATS for async usage events, capability update broadcasts, notifications |
| 13.3 | Move from API-proxied calls to direct agent-to-agent with metering sidecar |
| 13.4 | Semantic search for agent discovery (embed skill descriptions, vector similarity) |
| 13.5 | Agent health monitoring + auto-deregistration of unhealthy agents |
| 13.6 | SLA enforcement + automatic credit refunds for failed calls |

---

## Summary Table

| Phase | Track | Feature | Days | Priority |
|-------|-------|---------|------|----------|
| 1 | A (UI) | Design Intent Tracking | 2-3 | Immediate |
| 2 | A (UI) | Agent Persona Templates | 4-5 | Immediate |
| 3 | A (UI) | Pages System | 7-10 | High |
| 4 | A (UI) | WS Control + Reasoning | 5-7 | High |
| 5 | A (UI) | RAG / Knowledge Base | 7-10 | Medium |
| 6 | A (UI) | Human-in-the-Loop | 5-7 | Medium |
| 7 | B (Infra) | gVisor on existing VPS | 10-15 | High |
| 8 | B (Infra) | Kata + Cloud Hypervisor | 20-30 | Medium |
| 9 | B (Infra) | Pod Security Hardening | 5-10 | High |
| 10 | C (Marketplace) | Agent Registry + Discovery | 15-20 | Medium |
| 11 | C (Marketplace) | Marketplace Hub + Credits | 15-20 | Medium |
| 12 | C (Marketplace) | Agent Publishing + Dashboard | 10-15 | Medium |
| 13 | C (Marketplace) | Linkerd + NATS (scale) | 20-30 | Low (future) |

**Recommended execution order:**
- **Sprint 1:** Phases 1-2 (quick UI wins, 1 week)
- **Sprint 2:** Phase 3 (pages system, 2 weeks)
- **Sprint 3:** Phases 4 + 7 in parallel (WS + gVisor, 2 weeks)
- **Sprint 4:** Phases 5 + 9 (RAG + security hardening, 2 weeks)
- **Sprint 5:** Phase 6 + Phase 10 start (confirmation + agent registry, 2 weeks)
- **Sprint 6-8:** Phases 10-12 (marketplace hub, credits, dashboard, 6 weeks)
- **Future:** Phases 8 + 13 (Kata bare metal + service mesh, when scale demands)

## Verification

- **Phase 1:** Render 3+ charts in one conversation → verify consistent color palette
- **Phase 2:** Create deployment → verify persona gallery → verify system prompt applied
- **Phase 3:** "Build me a sales dashboard" → fullscreen page → ungroup → marketplace publish
- **Phase 4:** Stop mid-stream → partial text preserved. Reasoning shows "Searching web..." inline
- **Phase 5:** Upload PDF → ask question → cited answer with source
- **Phase 6:** Bot tries deletion → confirmation card → approve → action executes
- **Phase 7:** Deploy marketplace agent with gVisor → verify exec, configSync, logs all work
- **Phase 8:** Deploy on dedicated server with Kata → verify VM isolation
- **Phase 10-11:** Agent A discovers Agent B → calls skill via Hub → credits deducted → response returned
