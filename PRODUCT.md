# Jarble — Product Vision

**Last updated:** 2026-05-12

This is the single source of truth for what Jarble is, how it works, and where it is going. Every feature, PR, and design decision should align with this document. If anything in the codebase contradicts this, **this document wins** and the code is on a path to be reconciled.

---

## Executive Summary

Jarble is an **Agent Infrastructure Platform**. It deploys, scales, runs, and orchestrates **Agent Harnesses** on a unified, managed Kubernetes cluster, abstracting away the operational mess so builders can focus on agent behavior and business outcomes — not pods, ingress, secrets, autoscaling, or LLM routing.

The platform is **harness-agnostic by design**. **OpenClaw is the only Agent Harness currently shipping** to end users; the architecture (the `RuntimeHandler` interface, per-deployment K8s isolation, config sync pipeline, and per-deployment ingress) is built so additional harnesses plug in without rewriting the platform core.

The moat is not any single agent, model, or harness. The moat is the **infrastructure every agent runs on** — harness-agnostic, framework-agnostic, model-agnostic.

**Build. Deploy. Earn.**

---

## Naming

Throughout this document and all user-facing copy:

- **Agent Harness** is the per-deployment process running an agent. OpenClaw is one harness. ZeroClaw will be the second when shipped.
- The earlier name "Agent Runtime" is **deprecated** in product/marketing/architectural copy. Code identifiers that still say `runtime` (`RuntimeHandler`, `runtimes/handlers/`, `runtimeCatalog`, `RUNTIME_EXTRA_STEPS`) are intentionally preserved — only the user-facing term is changing.
- The chat UI surface is **always provided by the harness itself** (OpenClaw's webchat for the only currently-shipping harness). Jarble does not ship its own chat or canvas component library going forward. Legacy canvas/chat code may still exist in `Jarble-mvp/components/canvas/` and `Jarble-mvp/hooks/useCanvasChat.ts` while it is phased out, but it is not the product surface and should not be added to.

---

## Core Capabilities

### 1. Harness-agnostic deployment

Jarble runs each Agent Harness as an isolated Kubernetes pod with its own persistent storage and config. Adding a new harness is an implementation of the `RuntimeHandler` interface plus a container image — no platform-core changes required.

- **Per-deployment subdomain** with Auth0-backed forward-auth surfaces the harness's own webchat to authenticated end users.
- **Config sync pipeline** writes the deployment's system prompt, model, MCP config, and platform credentials into the harness's expected file/env layout.
- **Secret isolation** via K8s Secrets + AES-256-GCM encryption at the platform layer.

### 2. Orchestration canvas

A visual, drag-and-drop editor (built on `@xyflow/react`) lets builders wire deployments together into multi-agent workflows. This canvas is owned by Jarble and is distinct from any per-message UI a harness might render.

- **DAG-based execution** with cycles, human-in-the-loop nodes, subflows, and template variables.
- **Workflow lifecycle:** save, share within an organization, and (future) publish to the marketplace.
- **Inter-agent transport (planned):** gRPC.

### 3. Organizations & access control

Teams collaborate through Organizations with role-based permissions.

- **RBAC** with owner / admin / member roles.
- **Scoped deployments.** Deployments can be personal or owned by an org; access checks enforce both.
- **Invite flow** via email with token expiry.

### 4. Benchmarking & competitive analysis (future)

Once a second harness is in production, Jarble will score harnesses side-by-side across reasoning, tool-use, speed, and cost on identical workloads. Builders and businesses pick on merit. Not yet shipped.

---

## User Model

Everyone signs up as an individual first, the same way GitHub works. Individuals can create or join unlimited organizations. There are no separate "business" vs "builder" accounts — the same person can build an agent and deploy it for their company.

### Builder workflow (today)

1. Pick a harness (OpenClaw today).
2. Configure: system prompt, LLM model + provider, MCP connections, messaging-platform credentials.
3. Deploy. Jarble provisions the pod and exposes the harness's webchat at the per-deployment subdomain.
4. (Future) Publish to the marketplace and earn on every deployment.

### Business workflow (today)

1. Receive a deployment URL or be invited into an org.
2. Use the agent through the harness's webchat at the per-deployment subdomain, or through the messaging platforms it has been wired up to (WhatsApp, Discord, Slack, Telegram).
3. (Future) Browse the marketplace and one-click deploy community-built agents.

---

## Technical Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui |
| API | Express + tRPC |
| Database | Drizzle ORM, PostgreSQL via Neon (only — MySQL/SQLite providers were removed) |
| Auth | Auth0 (Google OAuth), RBAC, per-deployment forward-auth + signed cookie |
| Payments | Stripe (subscriptions, webhooks) |
| Infrastructure | Hetzner Cloud, Terraform, K3s, Longhorn, Traefik |
| LLM Routing | OpenRouter (OpenAI, Anthropic, Google, more); BYOK supported |
| Agent Harness | OpenClaw (only currently-shipping harness) |
| Messaging Platforms | Native plumbing for WhatsApp, Discord, Slack, Telegram |
| Observability | OpenTelemetry + Langfuse |
| Inter-agent transport (planned) | gRPC |

### Key architectural decisions

- **Harness-agnostic by design.** Anything that only works with OpenClaw internals belongs in `runtimes/handlers/openclaw.ts` (or its harness-specific siblings), never in the platform core.
- **OpenRouter handles model routing.** No lock-in to any single LLM provider. BYOK supported.
- **Individual-first user model.** Organizations are containers, not gatekeepers.
- **K3s isolates every deployment.** Each agent runs in its own pod with its own PVC, Service, and Ingress.
- **Postgres only at runtime.** The Vitest in-memory SQLite mirror is a test fixture, not a production provider.
- **The harness owns the chat UI.** Jarble's per-deployment subdomain is a routing + auth surface, not a chat client. Adding a Jarble-built chat UI on top is out of scope.

---

## Future Roadmap

### Marketplace

Builders will be able to publish and share:

- **Harness-agnostic assets** — skills, sub-agents, and orchestration-canvas workflow templates that work across harnesses.
- **Harness-specific assets** — published deployment templates so others can fork and customize.

Marketplace is **not yet shipped.** Any UI element or copy that implies "browse the marketplace today" is a roadmap aspiration, not a current product surface.

### Workflow publishing

Orchestration-canvas workflows become first-class shareable artifacts — forkable, remixable, and monetizable.

### Harness benchmarking

Once a second harness ships, every harness on the platform is continuously scored on identical workloads.

---

## Non-Goals

These are the design constraints that bound every feature decision. If a proposal drifts toward any of them, it is wrong.

- **Jarble does not ship a chat UI.** The harness owns chat. Do not add or expand a Jarble-built chat client, conversation panel, "rich UI components", or "canvas component library" on the per-deployment surface. Legacy code in `components/canvas/` is on a path to deletion, not expansion.
- **Single-agent workflows are the floor, not the ceiling.** The platform exists to orchestrate teams of agents. Canvas, RBAC, and transport must be built for multi-agent cases even when the current user has only one agent.
- **No model lock-in.** Every LLM call routes through OpenRouter or BYOK. Never hardcode an OpenAI / Anthropic / Google endpoint. Never assume a specific model family's tool-use or context shape.
- **No harness lock-in.** OpenClaw is the first harness, not the only one. Features that only work with OpenClaw internals belong in `runtimes/handlers/openclaw.ts`, not the platform core.

---

## The Flywheel

More builders means more harnesses available, more agents shipped, and more deployments running on Jarble. More deployments means more businesses on the platform. More businesses means more demand for builders. The infrastructure compounds with every harness, benchmark, and orchestration workflow added to it — that is the moat.

---

## Core Value Proposition

Jarble eliminates the gap between having an AI agent idea and having it running, scaled, observable, and reachable from every tool your team already uses.

**Build. Deploy. Earn.**

---

## Rules for Development

1. Every feature should move toward the harness-agnostic, two-sided platform vision — not away from it.
2. If a feature only serves one side (builders or businesses), it must clearly unblock the other side later.
3. Simplify ruthlessly — if a user needs a tutorial to understand a flow, the flow is wrong.
4. OpenClaw is the only currently-shipping harness. Build new harness abstractions only when a second harness is actually being onboarded.
5. **Do not add to the legacy canvas / chat / `jarble-ui-server.js` surface.** That code is in deprecation, not active product development.
6. The platform should feel fast, minimal, and intentional — not AI-generated.
7. When in doubt, reference this document.

---

*This document is maintained by the founding team. To propose changes, open a PR with your reasoning.*
