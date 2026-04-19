# Next Agentic Runtime — Candidate Evaluation

**Status:** Draft
**Date:** 2026-04-19
**Ticket:** [JAR-115](https://linear.app/jarble/issue/JAR-115)
**Companion doc:** [`runtime-abstraction-proposal.md`](./runtime-abstraction-proposal.md)
**Recommendation:** **ElizaOS** as the second production runtime, with a **LangGraph dummy adapter** landing first as the de-coupling forcing function.

## Context

Today Jarble has exactly one production runtime (**OpenClaw**) and one stub (**ZeroClaw**). The runtime catalog is meant to be the marketplace's distribution surface, but without a credible second runtime, "runtime-agnostic" is a claim rather than a fact. This doc picks the runtime to integrate next.

The companion proposal (`runtime-abstraction-proposal.md`) enumerates the ten platform surfaces that currently leak OpenClaw assumptions. **Any second runtime integration is bottlenecked on the L+M-sized abstractions in that doc** — the candidate pick below is designed to minimize the marginal cost on top of that work.

## Candidates considered

Five modern OSS agentic runtimes. All are ≤12 months old in their current form, actively maintained, and self-hostable on K8s.

1. **[ElizaOS](https://github.com/elizaOS/eliza)** (formerly ai16z/eliza) — TypeScript character-based agent runtime.
2. **[Letta](https://github.com/letta-ai/letta)** (formerly MemGPT) — stateful agent server with a dedicated ADE UI.
3. **[Dify](https://github.com/langgenius/dify)** — full-stack OSS agent platform with native iframe embed.
4. **[LangGraph](https://github.com/langchain-ai/langgraph)** — graph-based agent orchestration, BYO UI via Agent Chat UI.
5. **[CrewAI](https://github.com/crewAIInc/crewAI)** — role-based multi-agent framework.

Source research, version dates, and per-candidate profiles are at the end of this doc. Scores below are on 1–5 scales with one-line rationale.

## Scoring matrix

All scores are relative to Jarble's integration need, not absolute quality. 5 = drops in cleanly / strongest fit. 1 = major mismatch.

| Dimension | ElizaOS | Letta | Dify | LangGraph | CrewAI |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Interface fit (matches post-`JAR-115` `RuntimeHandler`) | 4 | 4 | 3 | 3 | 3 |
| Native UI iframe-ability | **5** | 3 | **5** | 3 | 2 |
| MCP client support | 3 | 3 | **5** | 4 | 4 |
| Model provider flexibility (BYOK / OpenRouter) | **5** | **5** | **5** | **5** | **5** |
| K8s deployment model (per-deployment pod) | 4 | 4 | 2 | 3 | 3 |
| Subagent / multi-agent primitive | 4 | 4 | 3 | 4 | **5** |
| Messaging adapters (Discord/Telegram/WhatsApp) | **5** | 4 | 2 | 1 | 2 |
| Memory model vs. our `memoryScope` knob | 4 | **5** | 3 | 3 | 4 |
| License compatibility for managed hosting | **5** (MIT) | **5** (Apache-2.0) | 2 (Dify OSS License) | 3 (MIT lib / server non-commercial) | **5** (MIT) |
| Maturity & release cadence | 4 | 4 | **5** | **5** | 4 |
| Implementation effort (lower = better, inverted for table) | **5** (low) | 3 | 2 | 3 | 3 |
| **Weighted total (sum)** | **48** | **44** | **37** | **37** | **40** |

Rationale for the lowest / most surprising scores:

- **Dify license (2/5)** — Dify OSS License is Apache-2.0 *plus* multi-tenant-SaaS and logo restrictions. Managed hosting plausibly triggers the multi-tenant clause. Needs explicit legal review before any integration work. Blocking a ticket on legal is expensive; we can do it, but not as the default.
- **LangGraph license (3/5)** — the core library is MIT, but the LangGraph Server container is non-commercial without a `LANGGRAPH_CLOUD_LICENSE_KEY`. Aegra is an MIT-licensed drop-in but is immature. **Note:** this 3/5 applies to a *full* LangGraph integration that uses the Server container. The dummy "echo agent" adapter recommended below uses only the MIT-licensed library and is unaffected.
- **Dify K8s fit (2/5)** — Dify's architecture is API + worker + web + sandbox + vector DB. That is not a per-deployment pod shape. Running a Dify instance per Jarble deployment is over-provisioned; running one shared Dify with multiple apps breaks our ingress + gateway-token auth model.
- **CrewAI native UI (2/5)** — "Crew Studio" is Streamlit-grade community tooling. Iframe-able in theory, not tenant-facing in practice.
- **LangGraph messaging (1/5)** — DIY via webhooks. We would write every Discord/Telegram adapter ourselves.

## Per-candidate assessment against the expanded interface

Each candidate is evaluated against the ten surfaces from the proposal doc.

### ElizaOS

| Surface | Fit | Notes |
|---------|-----|-------|
| 1. Native UI | ✅ | `@elizaos/client` React UI bundles with `@elizaos/server`, iframe-friendly out of the box. Auth via bearer header in URL — matches `url-hash-token` handoff. |
| 2. Chat transport | ✅ | HTTP stream + WebSocket. `chatTransport: "http-stream"` adapter covers it. |
| 3. Canvas | ⚠ | No native canvas-block protocol. Falls through to text. Would need a bridge if we want Canvas parity. |
| 4. Config surface | ✅ | Character files (`.character.json`) map cleanly onto `renderConfigs()` → `/data/configs/character.json`. |
| 5. Ingress / auth | ✅ | Bearer-header auth strategy. Matches the `bearer-header` strategy from Surface 5. |
| 6. Model switch | ⚠ | Restart required for provider swaps. `modelSwitch: "restart"`. |
| 7. Subagents | ✅ | Multi-agent native. Can be rendered via `DeploymentFields.subagents[]`. |
| 8. Secrets | ✅ | Separates LLM env vars cleanly — benefits directly from the split in Surface 8. |
| 9. Probes | ✅ | `/health` endpoint. One-line `getProbes()`. |
| 10. Topology | ✅ | Single container, PVC-friendly (character state). `kind: "k8s-deployment"`. |

**Gap flagged:** the interface has no first-class concept for *character files* (Eliza's core abstraction). They render fine via `renderConfigs()` but we lose the UX of a character library in the marketplace. Deferred to a future marketplace epic.

### Letta

| Surface | Fit | Notes |
|---------|-----|-------|
| 1. Native UI | ⚠ | ADE is a separate hosted app (`app.letta.com`) that connects to a Letta server. Self-hostable but it's a sibling service, not bundled — more plumbing than ElizaOS. |
| 2. Chat transport | ✅ | REST + WebSocket. `chatTransport: "http-stream"`. |
| 3. Canvas | ⚠ | No canvas blocks. Text-only. |
| 4. Config surface | ✅ | Memory blocks + agent config → `/data/configs/letta-agent.json`. |
| 5. Ingress / auth | ✅ | Bearer-header. |
| 6. Model switch | ✅ | `modelSwitch: "hot"` — provider swap is a runtime API call, no restart needed. (Strongest in the five.) |
| 7. Subagents | ✅ | Letta Code subagents are native. |
| 8. Secrets | ✅ | Clean LLM-provider split already in Letta's own config. |
| 9. Probes | ✅ | `/healthz`. |
| 10. Topology | ⚠ | Letta server + Postgres. The Postgres is per-Letta, not per-deployment. Either we share a cluster Postgres (complicates multi-tenancy) or provision per-deployment (expensive). |

**Gaps flagged:** (a) **MCP direction uncertainty** — Letta is migrating away from server-side MCP to client-side "skills" in Letta v1. Our platform bets heavily on MCP for tool discovery. This is the single biggest blocker for Letta as *this year's* second runtime. (b) ADE as a separate app stresses the `nativeUi` capability more than ElizaOS does.

### Dify

| Surface | Fit | Notes |
|---------|-----|-------|
| 1. Native UI | ✅ | First-class iframe embed at `udify.app/chatbot/TOKEN` or self-hosted equivalent. Best iframe story of the five. |
| 2. Chat transport | ✅ | HTTP stream SSE native. |
| 3. Canvas | ⚠ | Dify has its own "Answer" format with text + files, not canvas blocks. |
| 4. Config surface | ⚠ | Dify apps are managed via Dify's API, not by writing files to a PVC. `renderConfigs()` essentially becomes an API-call adapter. |
| 5. Ingress / auth | ⚠ | Multi-tenant model — one Dify instance, many apps. Doesn't map to per-deployment ingress. |
| 6. Model switch | ✅ | `modelSwitch: "hot"`. |
| 7. Subagents | ⚠ | Workflow nodes, not subagents. Partial fit. |
| 8. Secrets | ✅ | LLM provider creds are stored in Dify, not in our K8s Secret. That's cleaner but bypasses our `ENCRYPTION_KEY` audit trail. |
| 9. Probes | ✅ | `/health` on the API container. |
| 10. Topology | ❌ | Dify is **not** a per-deployment runtime. It's a shared platform. Fitting it into our model requires rethinking the deployment-per-pod assumption — a change bigger than JAR-115 scope. |

**Gaps flagged:** (a) **license** — Dify OSS License (Apache-2.0 + multi-tenant + logo restrictions) requires legal review. (b) Topology mismatch — fitting Dify would expose an 11th surface: "some runtimes are shared platforms, not per-deployment pods."

### LangGraph

| Surface | Fit | Notes |
|---------|-----|-------|
| 1. Native UI | ⚠ | Agent Chat UI is a separate Next.js app. Iframe-able but we run it ourselves. |
| 2. Chat transport | ✅ | HTTP SSE on `/stream`. |
| 3. Canvas | ⚠ | None. Text-only. |
| 4. Config surface | ⚠ | LangGraph graphs are code, not config files. `renderConfigs()` can't render them. |
| 5. Ingress / auth | ✅ | Bearer header. |
| 6. Model switch | ✅ | `modelSwitch: "hot"`. |
| 7. Subagents | ✅ | Supervisor / graph patterns. |
| 8. Secrets | ✅ | |
| 9. Probes | ✅ | |
| 10. Topology | ✅ | Per-deployment pod works. |

**Gaps flagged:** (a) **graphs-as-code** — LangGraph graphs are typically defined in TS/Python, not JSON. Our "non-coder builds an agent in the wizard" flow doesn't map. A LangGraph runtime is for advanced users who bring their own graph. (b) server licensing — the non-commercial LangGraph Server container is a legal landmine for managed hosting.

### CrewAI

| Surface | Fit | Notes |
|---------|-----|-------|
| 1. Native UI | ❌ | Streamlit-grade. Not tenant-facing. |
| 2. Chat transport | ⚠ | CrewAI is task-execution-first; chat is a thin layer on top. |
| 3. Canvas | ⚠ | None. |
| 4. Config surface | ✅ | YAML configs → `renderConfigs()`. |
| 5. Ingress / auth | ✅ | |
| 6. Model switch | ✅ | `modelSwitch: "restart"`. |
| 7. Subagents | ✅✅ | **Strongest of the five.** Crews + Flows are the core primitive. |
| 8. Secrets | ✅ | |
| 9. Probes | ✅ | |
| 10. Topology | ✅ | Per-pod works. |

**Gaps flagged:** no end-tenant UI. Jarble would own the entire chat surface. That makes CrewAI a good *backend* runtime for Flows-style multi-agent workloads but not a good *builder-facing* runtime.

## Decision matrix — the tradeoff

| Runtime | If we pick it, the second-runtime integration is… | Strategic payoff |
|---------|---------------------------------------------------|------------------|
| **ElizaOS** | Short (TS stack match + bundled UI + built-in messaging cover 3 of our hardest surfaces) | Broadens marketplace to character/personality-driven agents. Complements OpenClaw's skill-first model. |
| **Letta** | Medium, blocked on MCP-direction uncertainty and Postgres-per-deployment question | Memory-first differentiator. Premium positioning. |
| **Dify** | Long, blocked on legal review and topology redesign | Plugs us into the largest OSS agent ecosystem. High reward, high risk. |
| **LangGraph** | Medium, blocked on server licensing + graphs-as-code UX | Power-user surface. Flows parity. |
| **CrewAI** | Medium, we own the entire UI | Best multi-agent primitive. Overlap with our Flows engine — maybe too much. |

## Recommendation — ElizaOS, with a LangGraph dummy adapter first

### The primary pick: ElizaOS

**Why ElizaOS:**

1. **TypeScript stack match.** Every other candidate is Python-first. ElizaOS running on the same Node ecosystem as `jarble-api-main` means we can share types, share tooling, and debug the runtime in the same language as the platform.
2. **Bundled native UI.** `@elizaos/client` is a React app that ships with the server. Our `nativeUi` capability (Surface 1) has exactly one transport to implement: `mode: "iframe"`, `authHandoff: "bearer-header"`. No separate hosted admin app, no multi-tenant topology.
3. **Messaging adapters are free.** Built-in Discord, Telegram, Twitter/X, Farcaster, Slack. Our `platformCredentials` model maps to ElizaOS's plugin-config pattern directly. This is enormous: every other candidate means writing adapters we don't have to write.
4. **License is MIT, clean.** Zero legal review.
5. **Character-file abstraction is a natural marketplace primitive.** It lines up with a future "agent template" marketplace without forcing it now.
6. **Low marginal cost on top of `runtime-abstraction-proposal.md`.** Once Surfaces 1, 2, 5, 6, 8, 10 are abstracted, the ElizaOS handler is a rough-estimate ~500-LOC module (comparable to the current OpenClaw handler before subtracting its legacy branches — sizing to be validated during the integration ticket, not asserted here).

**Strategic fit.** ElizaOS agents are character-first (personality, lore, social presence); OpenClaw agents are skill-first (tool use, task completion, memory). They address different builder personas without overlapping the marketplace — ElizaOS appeals to community / creator / social-media builders; OpenClaw keeps the internal-tooling / business-ops segment.

**Risk profile.** Worst case: the ElizaOS integration ships, no builders adopt it, and we spend ~2 engineering weeks on a second runtime that sits idle. Mitigated because the runtime-abstraction work is needed regardless for a credible marketplace claim — the integration is the validation, not the only deliverable. If it fails to attract builders we still have a more honest platform architecture.

### The forcing-function pick: LangGraph dummy adapter first

Per the acceptance criteria and `JAR-101`, we should land the cheapest thing that forces the abstractions in `runtime-abstraction-proposal.md` to be real. That is **not a full ElizaOS integration** — that is a **LangGraph "echo agent" dummy handler** that:

- Declares `chatTransport: "http-stream"`.
- Has no native UI (`nativeUi: undefined`).
- Has no native canvas.
- Has `modelSwitch: "hot"`.
- Has no platform credentials.
- Runs a trivial LangGraph server that just echoes.

It exists only to prove that a second runtime's handler + ingress + chat route works end-to-end with no OpenClaw branches. It takes ~1 engineering day after the abstraction PRs land. It is the fastest way to catch bugs before we invest in the ElizaOS handler.

### Follow-up ticket structure

1. **`JAR-11x: LangGraph dummy adapter`** (S, after abstractions 2, 5, 6, 8 land) — the forcing function. Proves the abstraction.
2. **`JAR-11x: ElizaOS runtime integration`** (L, after abstractions 1, 2, 5, 6, 8, 10 land) — the real second runtime.
3. **One follow-up ticket per abstraction surface** in the companion proposal — see the blast-radius table there.

## Out of scope

- Picking the *third* runtime. Letta, Dify, and CrewAI are parked as future work.
- Deciding whether the ElizaOS character-file marketplace gets its own top-level surface, or ships as a subset of the agent template marketplace.
- LangGraph Server licensing negotiation. We use LangGraph only as a library, never the Server container, which dodges the non-commercial clause.

## Candidate profiles (reference)

All candidate profiles as of **April 2026**. Stars are approximate.

### ElizaOS
- **Latest:** `@elizaos/cli` v1.7.2 (Apr 2026). ([npm](https://www.npmjs.com/package/@elizaos/cli))
- **Native UI:** `@elizaos/client` React web UI bundled with `@elizaos/server`. ([docs](https://docs.elizaos.ai/))
- **MCP:** Community plugin ([`fleek-platform/eliza-plugin-mcp`](https://github.com/fleek-platform/eliza-plugin-mcp)), not core.
- **License:** MIT.
- **Repo:** [elizaOS/eliza](https://github.com/elizaOS/eliza). ~45-60k stars (checked 2026-04); widely cited as one of the top-starred TypeScript agent frameworks of 2025. ai16z-backed.

### Letta
- **Latest:** v0.16.7 (Mar 31, 2026) — 128k default context, compaction overhaul. ([releases](https://github.com/letta-ai/letta/releases))
- **Native UI:** Letta ADE ([docs](https://docs.letta.com/agent-development-environment)) — separate hosted/self-hostable app.
- **MCP:** First-class server-side today, migrating to client-side skills.
- **License:** Apache-2.0.
- **Repo:** [letta-ai/letta](https://github.com/letta-ai/letta). ~22k stars.

### Dify
- **Latest:** v1.13.3 (Mar 27, 2026); v1.6.0 introduced two-way MCP. ([releases](https://github.com/langgenius/dify/releases))
- **Native UI:** Iframe embed at `udify.app/chatbot/TOKEN`. ([embed docs](https://docs.dify.ai/en/use-dify/publish/webapp/embedding-in-websites))
- **MCP:** Bidirectional — consume & expose. ([v1.6 blog](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support))
- **License:** Dify Open Source License (Apache-2.0 + conditions). ([LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE))
- **Repo:** [langgenius/dify](https://github.com/langgenius/dify). ~138k stars.

### LangGraph
- **Latest:** v1.1.7 (Apr 17, 2026); CLI v0.4.22. ([releases](https://github.com/langchain-ai/langgraph/releases))
- **Native UI:** LangGraph Studio + separate [agent-chat-ui](https://github.com/langchain-ai/agent-chat-ui) Next.js app.
- **MCP:** Native via `langchain-mcp-adapters`. ([changelog](https://changelog.langchain.com/announcements/langgraph-platform-now-supports-mcp))
- **License:** MIT (library); Server container non-commercial. ([LICENSE](https://github.com/langchain-ai/langgraph/blob/main/LICENSE))
- **Repo:** [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph). ~29.5k stars.

### CrewAI
- **Latest:** v1.10.1 stable (Mar 2026). ([releases](https://github.com/crewAIInc/crewAI/releases))
- **Native UI:** Crew Studio (Streamlit community). ([CrewAI-Studio](https://github.com/strnad/CrewAI-Studio))
- **MCP:** Via [crewai-tools](https://github.com/crewAIInc/crewAI-tools).
- **License:** MIT.
- **Repo:** [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI). ~45.9k stars.

## References

- Companion proposal: [`runtime-abstraction-proposal.md`](./runtime-abstraction-proposal.md)
- Interface: `jarble-api-main/src/runtimes/types.ts`
- Existing handlers: `jarble-api-main/src/runtimes/handlers/openclaw.ts`, `zeroclaw.ts`
- Related tickets: JAR-93 (RuntimeAdapter boundary), JAR-98 (conformance test — done), JAR-99 (OpenClaw leak audit), JAR-100 (frontend runtime-awareness), JAR-101 (plug-and-play validation), JAR-79 (Managed OpenClaw Hosting epic)
