# Next Agentic Runtime — Candidate Evaluation

**Status:** Draft
**Date:** 2026-04-19
**Ticket:** [JAR-115](https://linear.app/jarble/issue/JAR-115)
**Companion doc:** [`runtime-abstraction-proposal.md`](./runtime-abstraction-proposal.md)
**Recommendation:** **ZeroClaw** — finish the runtime that is already in the catalog — as the second production runtime. ElizaOS is kept as a runner-up if ZeroClaw fails to meet operational bar.

> **Revision note (2026-04-19):** The first draft recommended ElizaOS. Revised after discovering that `runtimes/zeroclaw/` is not a stub — it is a code-complete handler wrapping an upstream Rust binary. Finishing what exists is cheaper, more honest, and automatically tests the abstraction, because ZeroClaw genuinely is not OpenClaw.

## Context

Today Jarble has exactly one production runtime (**OpenClaw**) and one stub (**ZeroClaw**). The runtime catalog is meant to be the marketplace's distribution surface, but without a credible second runtime, "runtime-agnostic" is a claim rather than a fact. This doc picks the runtime to integrate next.

The companion proposal (`runtime-abstraction-proposal.md`) enumerates the ten platform surfaces that currently leak OpenClaw assumptions. **Any second runtime integration is bottlenecked on the L+M-sized abstractions in that doc** — the candidate pick below is designed to minimize the marginal cost on top of that work.

## Candidates considered

Six candidates — five modern OSS agentic runtimes plus the one already in our own catalog.

0. **ZeroClaw** — upstream Rust binary ([`zeroclaw-labs/zeroclaw`](https://github.com/zeroclaw-labs/zeroclaw), Apache-2.0 + MIT dual-licensed) wrapped by a Jarble handler + Dockerfile at `runtimes/zeroclaw/`. **Already registered in our runtime catalog** (see `jarble-api-main/src/runtimes/handlers/zeroclaw.ts`). Ships a **React 19 dashboard embedded in the gateway binary** (Axum serves it on `127.0.0.1:42617` by default — chat, memory browser, config editor, cron manager, tool inspector).
1. **[ElizaOS](https://github.com/elizaOS/eliza)** (formerly ai16z/eliza) — TypeScript character-based agent runtime.
2. **[Letta](https://github.com/letta-ai/letta)** (formerly MemGPT) — stateful agent server with a dedicated ADE UI.
3. **[Dify](https://github.com/langgenius/dify)** — full-stack OSS agent platform with native iframe embed.
4. **[LangGraph](https://github.com/langchain-ai/langgraph)** — graph-based agent orchestration, BYO UI via Agent Chat UI.
5. **[CrewAI](https://github.com/crewAIInc/crewAI)** — role-based multi-agent framework.

Source research, version dates, and per-candidate profiles are at the end of this doc. Scores below are on 1–5 scales with one-line rationale.

## Scoring matrix

All scores are relative to Jarble's integration need, not absolute quality. 5 = drops in cleanly / strongest fit. 1 = major mismatch.

| Dimension | **ZeroClaw** | ElizaOS | Letta | Dify | LangGraph | CrewAI |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|
| Interface fit (matches post-`JAR-115` `RuntimeHandler`) | **5** (handler already exists) | 4 | 4 | 3 | 3 | 3 |
| Native UI iframe-ability | 4 (bundled React dashboard, bearer-token auth) | **5** | 3 | **5** | 3 | 2 |
| MCP client support | 3 (tool inspector in UI; MCP-specific support TBD) | 3 | 3 | **5** | 4 | 4 |
| Model provider flexibility (BYOK / OpenRouter) | **5** (22+ providers) | **5** | **5** | **5** | **5** | **5** |
| K8s deployment model (per-deployment pod) | **5** (Dockerfile exists) | 4 | 4 | 2 | 3 | 3 |
| Subagent / multi-agent primitive | 2 (none) | 4 | 4 | 3 | 4 | **5** |
| Messaging adapters (Discord/Telegram/WhatsApp) | 2 (none in core) | **5** | 4 | 2 | 1 | 2 |
| Memory model vs. our `memoryScope` knob | 4 (SQLite w/ hybrid search + memory browser UI) | 4 | **5** | 3 | 3 | 4 |
| License compatibility for managed hosting | **5** (Apache-2.0 + MIT dual) | **5** (MIT) | **5** (Apache-2.0) | 2 (Dify OSS License) | 3 (MIT lib / server non-commercial) | **5** (MIT) |
| Maturity & release cadence | 3 (small upstream team) | 4 | 4 | **5** | **5** | 4 |
| Implementation effort (lower = better, inverted for table) | **5** (code-complete — operational work only) | **5** (low) | 3 | 2 | 3 | 3 |
| **Weighted total (sum)** | **43** | **48** | **44** | **37** | **37** | **40** |

Two things stand out in ZeroClaw's row:

- It scores **2/5 on subagents** and **2/5 on messaging adapters** — real weaknesses, not hidden.
- It scores **5/5 on interface fit, K8s deployment, license, and implementation effort** — because the code is already in the tree and the upstream license is clean dual Apache-2.0 / MIT. This is the decisive factor for "second runtime" as a forcing-function claim.

ElizaOS still wins the raw sum (48 vs. 43) on builder-facing richness, but the sum weights every dimension equally. The **"already in the catalog" signal is categorical, not incremental** — it is worth more than five evenly-weighted 1-point deltas. The Recommendation section below shows why.

> **Revised 2026-04-19 (second pass):** The first revision scored ZeroClaw 1/5 on native UI. That was wrong. Upstream ships a **React 19 + Vite 6 + Tailwind 4 dashboard embedded in the gateway binary**, with chat, memory browser, config editor, cron manager, and tool inspector — not a headless API. Scoring corrected from 1 → 4. License also corrected after confirming upstream is Apache-2.0 + MIT dual (4 → 5). The "text-only Control Panel" framing in the recommendation has been replaced with "iframe the ZeroClaw dashboard via the new `NativeUiHost`."

Rationale for the lowest / most surprising scores:

- **Dify license (2/5)** — Dify OSS License is Apache-2.0 *plus* multi-tenant-SaaS and logo restrictions. Managed hosting plausibly triggers the multi-tenant clause. Needs explicit legal review before any integration work. Blocking a ticket on legal is expensive; we can do it, but not as the default.
- **LangGraph license (3/5)** — the core library is MIT, but the LangGraph Server container is non-commercial without a `LANGGRAPH_CLOUD_LICENSE_KEY`. Aegra is an MIT-licensed drop-in but is immature. **Note:** this 3/5 applies to a *full* LangGraph integration that uses the Server container. The dummy "echo agent" adapter recommended below uses only the MIT-licensed library and is unaffected.
- **Dify K8s fit (2/5)** — Dify's architecture is API + worker + web + sandbox + vector DB. That is not a per-deployment pod shape. Running a Dify instance per Jarble deployment is over-provisioned; running one shared Dify with multiple apps breaks our ingress + gateway-token auth model.
- **CrewAI native UI (2/5)** — "Crew Studio" is Streamlit-grade community tooling. Iframe-able in theory, not tenant-facing in practice.
- **LangGraph messaging (1/5)** — DIY via webhooks. We would write every Discord/Telegram adapter ourselves.

## Per-candidate assessment against the expanded interface

Each candidate is evaluated against the ten surfaces from the proposal doc.

### ZeroClaw (already in catalog)

Status: handler at `jarble-api-main/src/runtimes/handlers/zeroclaw.ts` + runtime image at `runtimes/zeroclaw/` (Dockerfile, entrypoint, file-watcher). Declares `needsLlm: true`, `hasPlatforms: true`, `hasSkills: false`, `hasSystemPrompt: false`. Exposes the gateway on `127.0.0.1:42617` upstream (our Dockerfile currently maps port 3000 — needs reconciling). Ships a **React dashboard embedded in the gateway** (chat, memory browser, config editor, cron manager, tool inspector). Supports 22+ AI providers via the upstream Rust binary. **Apache-2.0 + MIT dual-licensed.**

| Surface | Fit | Notes |
|---------|-----|-------|
| 1. Native UI | ✅ | React 19 + Vite 6 + Tailwind 4 dashboard, bundled into the gateway binary. Auth via a **6-digit pairing code → Bearer token** exchange. Maps to `NativeUiHost { mode: "iframe", authHandoff: "bearer-header" }` **if** we can automate pairing-code minting server-side (open question for JAR-123). |
| 2. Chat transport | ✅ | Gateway API + WebSocket for streaming (`bearer.<token>` sub-protocol for WS auth). Fits `chatTransport: "http-stream"` for the REST path; WS is a future optimization. No Ed25519 gateway token. |
| 3. Canvas | ❌ | No canvas-block protocol. Text-only rendering in Workspace. |
| 4. Config surface | ✅ | Handler already renders a TOML config via `renderConfigs()`. Needs the PVC-layout lint from Surface 4 to confirm paths are under reserved prefixes. |
| 5. Ingress / auth | ⚠ | Handler exists but ingress is not yet wired — the forward-auth middleware is OpenClaw-specific (JAR-121). ZeroClaw needs the `bearer-header` auth strategy. `ZEROCLAW_ALLOW_PUBLIC_BIND=true` already set in the Dockerfile, so the runtime can bind `0.0.0.0`. |
| 6. Model switch | ⚠ | Env-var-driven (`PROVIDER=openrouter`); restart required. `modelSwitch: "restart"`. |
| 7. Subagents | ❌ | `hasSystemPrompt: false`, `hasSkills: false`. No subagent primitive. `supportsNativeSubagents: false` (implicit). |
| 8. Secrets | ✅ | Handler already emits different env var names than OpenClaw (`PROVIDER` vs `LLM_PROVIDER`). Benefits immediately from the split in Surface 8. |
| 9. Probes | ⚠ | Dockerfile declares `HEALTHCHECK CMD zeroclaw doctor` (exec-based). Needs a HTTP readiness probe on the gateway port for K8s. |
| 10. Topology | ✅ | Single container, Longhorn PVC at `/data`. `kind: "k8s-deployment"`, `containerName: "zeroclaw"`, `pvcMountPath: "/data"`. |

**Gaps flagged:**

- **Pairing-code automation is unverified.** The upstream dashboard expects a human to enter a 6-digit code once to mint a Bearer token. For a multi-tenant SaaS, we need either (a) a CLI/API path to issue codes programmatically at pod boot, (b) a pre-authenticated token we inject into the pod, or (c) a small patch to upstream to add a headless token-provisioning endpoint. This is the biggest open risk for the Control Panel iframe story — scoped explicitly as a spike in JAR-123.
- **X-Frame-Options / CORS headers unknown.** Not documented upstream. If the gateway emits `X-Frame-Options: DENY` or a restrictive CSP, iframe embedding is blocked until upstream adds a config knob.
- **No subagents / skills / system prompt.** ZeroClaw's builder-facing feature surface is a narrow subset of OpenClaw's. The wizard needs to hide those steps for ZeroClaw deployments. Good stress test for Surface 10 (`managedBy` → `topology`) and for runtime-awareness in the frontend (JAR-100).
- **No messaging adapters in core.** Discord/Telegram/WhatsApp deployments on ZeroClaw would need a bridge, or the wizard must gate messaging steps behind `hasPlatforms` + a per-platform capability check.
- **Port reconciliation.** Our Dockerfile exposes 3000; upstream defaults to `127.0.0.1:42617`. Either change the Dockerfile to match upstream, or override the bind via CLI flag / env var. Verify during JAR-123.
- **Operational unknowns.** The handler exists but we do not know whether a ZeroClaw deployment actually boots on K3s today. This is the *real work* — and it is cheaper to discover than building a brand-new ElizaOS handler.

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
| **ZeroClaw** | Shortest — handler exists; the work is operational (does it boot? can we auto-mint the dashboard's Bearer token?) plus landing the abstractions it needs | Cheapest credible claim to "runtime-agnostic". Forces Surface 1 (bundled dashboard via iframe + bearer-header handoff), Surface 5 (non-gateway-token auth), and Surface 10 (topology) to be real. Also lands a real alternative builder UI for Control Panel. |
| **ElizaOS** | Short (TS stack match + bundled UI + built-in messaging cover 3 of our hardest surfaces) | Broadens marketplace to character/personality-driven agents. Complements OpenClaw's skill-first model. |
| **Letta** | Medium, blocked on MCP-direction uncertainty and Postgres-per-deployment question | Memory-first differentiator. Premium positioning. |
| **Dify** | Long, blocked on legal review and topology redesign | Plugs us into the largest OSS agent ecosystem. High reward, high risk. |
| **LangGraph** | Medium, blocked on server licensing + graphs-as-code UX | Power-user surface. Flows parity. |
| **CrewAI** | Medium, we own the entire UI | Best multi-agent primitive. Overlap with our Flows engine — maybe too much. |

## Recommendation — ZeroClaw, with ElizaOS as runner-up

### The primary pick: ZeroClaw

**Why ZeroClaw:**

1. **It is already in the catalog.** A handler, a Dockerfile, an entrypoint, and a file-watcher exist in `runtimes/zeroclaw/` and `jarble-api-main/src/runtimes/handlers/zeroclaw.ts`. The cheapest credible "second runtime" is the one whose integration is already ~80% done.
2. **It is genuinely not OpenClaw.** Different process (Rust binary, not OpenClaw's workspace shape), different config format (TOML, not `soul.md`), different env-var names (`PROVIDER` not `LLM_PROVIDER`), different gateway (pairing-code Bearer auth, not Ed25519), different native UI (React dashboard embedded in the gateway binary rather than OpenClaw's Control UI on a different port). Every difference forces one of the ten abstraction surfaces to be real — in a way a hand-rolled dummy adapter cannot fake.
3. **It is the most honest forcing function we have.** The LangGraph echo-agent was drafted because the original draft picked ElizaOS and needed a cheap validator. ZeroClaw plays that role automatically: if JAR-121's chat adapter registry is wrong, ZeroClaw will not boot. That is a pass/fail signal the proposal needs.
4. **Operational work is the real work.** Finishing ZeroClaw forces us to confront questions we were going to have to answer for ElizaOS anyway — probe shape, ingress without gateway-token auth, wizard awareness of `hasSystemPrompt: false`, **iframe-embedding a different vendor's dashboard with a different auth handoff** — but against code that is already in the tree and cannot be rescoped mid-integration.
5. **The native-UI story is stronger than initially assessed.** Upstream ships a React 19 + Vite 6 + Tailwind 4 dashboard embedded in the gateway binary (chat, memory browser, config editor, cron manager, tool inspector). That gives the Control Panel tab a real embedded UI for ZeroClaw deployments — not a text-only fallback — **conditional on the pairing-code → Bearer-token mint being automatable** (tracked as a spike in JAR-123).
6. **License is clean.** Apache-2.0 + MIT dual — no legal review overhead.
7. **Marketplace implication is modest, not zero.** A lightweight Rust runtime with 22+ providers and its own rich admin UI is a credible cost-optimized offering for builders who don't need OpenClaw's skill marketplace. Not a breakout product, but not an idle runtime either.

**Strategic fit.** ZeroClaw does not broaden the marketplace the way ElizaOS (character-first) would. It does, however, prove the catalog is a real product surface rather than a one-entry list — which is the prerequisite for any future third-runtime bet.

**Risk profile.** Worst case: ZeroClaw cannot be made to boot reliably on K3s and the upstream Rust maintainer stalls, so we cancel the integration and pivot to ElizaOS. This is *strictly cheaper* than starting with ElizaOS, because:
- The abstraction work lands either way (JAR-117-121).
- Any bugs surfaced by ZeroClaw make the subsequent ElizaOS integration easier.
- We have ≤1 engineering week sunk before we know whether ZeroClaw is viable; ElizaOS would be ≥2 weeks before the same signal.

### Runner-up: ElizaOS

Keep ElizaOS on the shelf as the next-in-line integration. The analysis above still stands — if ZeroClaw fails operationally, or if the marketplace product case for a character-first runtime strengthens (JAR-79), ElizaOS is the preferred successor. The `runtimes/elizaos/` Dockerfile and handler are ~2 engineer-weeks of work on top of the abstractions.

### Why we're dropping the "LangGraph echo dummy" idea

The echo dummy was a forcing function designed around the assumption that the real second runtime (ElizaOS) was too expensive to use for validation. That assumption is wrong if ZeroClaw is the pick — ZeroClaw **is** the forcing function, and it happens to also be the real second runtime. Keeping a separate dummy adapter would be two runtimes of similar shape (neither has a native UI, both use HTTP stream transport), which provides no extra signal.

If the abstraction PRs land and we still want a trivial pass/fail test before booting ZeroClaw on a real cluster, we can land a tiny in-test `FakeRuntimeHandler` in the conformance test suite instead of a runtime image. That captures the same validation at a fraction of the cost.

### Follow-up ticket structure

1. **`JAR-117` Runtime abstraction program** (parent) — unchanged.
2. **`JAR-118`-`JAR-121` Phase 1-4** — unchanged. These land first; ZeroClaw cannot boot without them.
3. **`JAR-123` ZeroClaw runtime integration** (M, after Phase 4 lands) — rename and rescope. Work is operational: boot a pod, wire the ingress with a non-gateway-token auth strategy, wire chat through the adapter registry, hide irrelevant wizard steps (`hasSkills: false` / `hasSystemPrompt: false`), run an end-to-end smoke test.
4. **`JAR-122` LangGraph echo** — **canceled.** The validation role folds into JAR-123 (ZeroClaw is the integration *and* the forcing function).
5. **`JAR-124` ElizaOS runtime integration (runner-up)** — new ticket, low priority, sits in the backlog for after ZeroClaw ships.

## Out of scope

- Picking the *third* runtime. Letta, Dify, CrewAI, and ElizaOS (as runner-up to ZeroClaw) are parked as future work.
- Deciding whether a character-file marketplace (ElizaOS) gets its own top-level surface — deferred to the runner-up integration.
- LangGraph Server licensing — LangGraph is now out of the shortlist since the echo dummy is dropped.
- Auditing the ZeroClaw upstream (`theonlyhennygod/zeroclaw`) — the upstream license, release cadence, and maintainer health are a precondition of JAR-123, not of this evaluation.

## Candidate profiles (reference)

All candidate profiles as of **April 2026**. Stars are approximate.

### ZeroClaw
- **Source:** `jarble-api-main/src/runtimes/handlers/zeroclaw.ts` (Jarble handler) wrapping upstream [`zeroclaw-labs/zeroclaw`](https://github.com/zeroclaw-labs/zeroclaw) Rust binary (also mirrored at `theonlyhennygod/zeroclaw`).
- **Runtime image:** `runtimes/zeroclaw/Dockerfile` — debian-slim base, ~3.4 MB binary extracted from the upstream image.
- **Native UI:** ✅ **React 19 + Vite 6 + Tailwind 4 dashboard embedded in the gateway binary** (Axum serves it). Features: real-time chat, memory browser, config editor, cron manager, tool inspector. Default bind: `127.0.0.1:42617` (needs `ZEROCLAW_ALLOW_PUBLIC_BIND=true` to serve externally — already set in our Dockerfile).
- **Dashboard auth:** 6-digit **pairing-code** → `/pair` endpoint → Bearer token. WS uses `bearer.<token>` sub-protocol. Automatability for our multi-tenant case is a JAR-123 spike.
- **MCP:** Tool inspector in dashboard suggests tool support; MCP-specific compatibility is unconfirmed.
- **License:** ✅ **Apache-2.0 + MIT dual.**
- **Capabilities declared:** `needsLlm: true`, `hasPlatforms: true`, `hasSkills: false`, `hasSystemPrompt: false`.
- **Env var shape:** `PROVIDER`, `ZEROCLAW_ALLOW_PUBLIC_BIND`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. Notably different from OpenClaw's `LLM_*` prefix — exercises the secret-split abstraction (Surface 8).
- **Health:** Dockerfile declares `HEALTHCHECK CMD zeroclaw doctor` (exec-based; needs HTTP probe on the gateway port for K8s).
- **Sources:** [zeroclaw-labs/zeroclaw README](https://github.com/zeroclaw-labs/zeroclaw), [Web dashboard architecture (DeepWiki)](https://deepwiki.com/zeroclaw-labs/zeroclaw/10.7-web-dashboard).

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
