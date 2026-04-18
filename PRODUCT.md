# Jarble -- Product Vision

**Last updated:** 2026-04-18

This is the single source of truth for what Jarble is, how it works, and where it is going. Every feature, PR, and design decision should align with this document. If anything in the codebase contradicts this, this document wins.

---

## Executive Summary

Jarble is a hybrid **Platform-as-Infrastructure (PaI)** and **Agent-as-Infrastructure (AaI)** layer for deploying, scaling, and orchestrating agentic runtimes. It runs on high-performance Hetzner VPS instances managed by a unified **k3s** cluster, abstracting the mess of infrastructure so builders can focus on agent behavior and intelligence, not plumbing.

The moat is not any single agent or model. The moat is the **infrastructure every agent runs on** -- runtime-agnostic, framework-agnostic, model-agnostic.

**Build. Deploy. Earn.**

---

## Core Capabilities

### 1. Flexible Runtime Deployment & UI Adaptation

Jarble deploys diverse agentic runtimes side-by-side on the same cluster. Each deployment gets an isolated pod with its own storage and config.

- **Native UI passthrough.** If a runtime ships with its own interface, Jarble serves it directly.
- **Jarble Dynamic UI.** For runtimes without a native UI, Jarble provides a chat + canvas experience that works with any runtime -- rich UI components (charts, tables, 3D visualizations, live widgets) rendered inline via an MCP UI server.
- **OpenClaw is the reference runtime today.** Other runtimes will be onboarded as the platform matures.

### 2. Benchmarking & Competitive Analysis

Runtimes are evaluated side-by-side regardless of their underlying framework, so builders and businesses can pick on merit.

- **Categorized performance.** Runtimes scored across specific domains: reasoning, tool-use, speed, cost-efficiency.
- **Competitive analysis.** Runtimes compared directly across identical workloads, regardless of underlying framework.
- **Continuous benchmarking** drives competition and iterative improvement across the runtime ecosystem.

### 3. Runtime-Agnostic Orchestration

A no-code visual builder on an infinite canvas lets users wire runtimes together into multi-agent workflows without touching code.

- **Drag-and-drop** composition on an infinite canvas.
- **Communication patterns:** delegation, collaboration, and reporting between agents.
- **Workflow lifecycle:** save, share, and (future) publish to the marketplace.
- **Inter-agent transport (planned):** gRPC.

### 4. Organizations & Access Control

Teams collaborate through Organizations with role-based permissions.

- **RBAC.** Members access only the deployments relevant to their role.
- **Scoped orchestration.** Users interact only with the parts of workflows assigned to them.
- **Shared infrastructure.** Agentic runtimes are owned at the organization level (currently under the organization owner).

This lets large, complex workflows be segmented across teams with fine-grained control over who can view, manage, and orchestrate specific components.

---

## User Model

Everyone signs up as an individual first, the same way GitHub works. Individuals can create or join unlimited organizations. There are no separate "business" vs "builder" accounts -- the same person can build an agent and deploy it for their company.

### Builder Workflow

1. Pick a runtime.
2. Write a system prompt.
3. Add MCP connections (tools the agent can use).
4. Install skills and components from the marketplace.
5. Publish to the marketplace.
6. Earn on every deployment.

Any published agent can be forked, customized, and republished.

### Business Workflow

1. Browse the marketplace by workflow category.
2. Deploy in one click.
3. Agent runs inside the tools the team already uses.

---

## Technical Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui |
| API | Express + tRPC |
| Database | Drizzle ORM, PostgreSQL (Neon) |
| Auth | Auth0 (Google OAuth), RBAC |
| Payments | Stripe (subscriptions, webhooks) |
| Infrastructure | Hetzner Cloud, Terraform, k3s, Longhorn, Traefik |
| LLM Routing | OpenRouter (OpenAI, Anthropic, Google, and more) |
| Agent Runtime | OpenClaw (reference runtime) |
| Orchestration Transport (planned) | gRPC |
| MCP | Custom stdio MCP server for UI rendering and agent tooling |
| Chat | @assistant-ui/react, SSE streaming |

### Key Architectural Decisions

- **OpenClaw is the reference runtime.** Runtime-agnostic design means additional runtimes plug in without rewrites.
- **OpenRouter handles model routing.** No lock-in to any single provider. BYOK supported.
- **Individual-first user model.** Organizations are containers, not gatekeepers.
- **k3s isolates every deployment.** Each agent runs in its own pod with its own storage.
- **Inter-agent orchestration will speak gRPC (planned).** Keeps workflow composition language- and runtime-neutral as the runtime ecosystem grows. Not yet implemented -- current inter-service communication is HTTP + SSE (frontend ↔ API) and tRPC (client ↔ server).

---

## Future Roadmap

### Marketplace

Builders will be able to publish and share:

- **Runtime-agnostic assets** -- skills, sub-agents, and agent-team workflow templates that work across runtimes.
- **Runtime-specific assets** -- cloned versions of agentic runtimes (excluding sensitive or personal data) so others can fork and customize.

### Workflow Publishing

Workflows built on the canvas become first-class shareable artifacts -- forkable, remixable, and monetizable.

### Expanded Benchmarking

- **Runtime benchmarking** (live) -- performance across tasks and domains.
- **Workflow benchmarking** (future) -- measures agent communication efficiency, task coverage, and system-level performance across multi-agent flows.

---

## Non-Goals

These are the design constraints that bound every feature decision. If a proposal drifts toward any of them, it is wrong.

- **Chat widgets are not the product.** Agents are autonomous workers. UI is how people observe and redirect them -- not the thing being sold. Do not build features that reduce agent autonomy in favor of turn-based chat.
- **Single-agent workflows are the floor, not the ceiling.** The platform exists to orchestrate teams of agents. Canvases, RBAC, and transport must be built for multi-agent cases even when the current user has only one agent.
- **No model lock-in.** Every LLM call routes through OpenRouter (or BYOK). Never hardcode an OpenAI or Anthropic endpoint. Never assume a specific model family's tool-use or context shape.
- **No runtime lock-in.** OpenClaw is the first runtime, not the only one. Features that only work with OpenClaw internals belong in the OpenClaw handler, not the platform core.

---

## The Flywheel

More builders means more agents. More agents means more businesses. More businesses means more demand for builders. The marketplace grows itself once both sides reach critical mass -- and the infrastructure underneath compounds with every runtime, benchmark, and workflow added to it.

---

## Core Value Proposition

Jarble eliminates the gap between having an AI agent idea and having it running in your business.

**Build. Deploy. Earn.**

---

## Rules for Development

1. Every feature should move toward the runtime-agnostic, two-sided marketplace vision, not away from it.
2. If a feature only serves one side (builders or businesses), it must clearly unblock the other side later.
3. Simplify ruthlessly -- if a user needs a tutorial to understand a flow, the flow is wrong.
4. OpenClaw is the reference runtime today. Build abstractions for additional runtimes only when a second runtime is actually being onboarded.
5. The platform should feel fast, minimal, and intentional -- not AI-generated.
6. When in doubt, reference this document.

---

*This document is maintained by the founding team. To propose changes, open a PR with your reasoning.*
