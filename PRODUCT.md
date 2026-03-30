# Jarble -- Product Vision

**Last updated:** March 29, 2026

This is the single source of truth for what Jarble is, how it works, and where it is going. Every feature, PR, and design decision should align with this document. If something contradicts this, this document wins.

---

## What Jarble Is

Jarble is an **infrastructure platform for AI agents**.

Not a tool. Not an app store. Not a chatbot builder. Infrastructure.

The platform has two sides:

- **Builders** use Jarble to create, host, and monetize agents
- **Businesses** use Jarble to discover, deploy, and run agents in the tools their teams already use

The **marketplace** is where both sides connect. The **infrastructure** is what makes everything run.

---

## How It Works

### User Model

Everyone signs up as an individual first, the same way GitHub works. Individuals can create or join unlimited organizations.

There are no "business accounts" vs "builder accounts." An individual can build agents AND deploy them for their company. Organizations group people and agents together.

### Builder Workflow

1. Pick a runtime (OpenClaw is the only supported runtime right now)
2. Write a system prompt
3. Add MCP connections (tools the agent can use)
4. Install skills and components from the marketplace
5. Publish to the marketplace
6. Earn on every deployment

Any agent can be forked, customized, and republished.

### Business Workflow

1. Browse the marketplace by workflow category
2. Deploy in one click
3. Agent runs inside the tools the team already uses
4. Never have to change how the team works

### Guided Onboarding

Jarble is not a consulting or services business. The go-to-market motion is **guided onboarding** -- a white-glove deployment experience that is still a product motion, not a people-for-hire motion.

When businesses join Jarble, the team:
1. Helps them identify the right agents for their workflows
2. Connects them to builders in the marketplace if a custom agent is needed
3. Walks them through go-live

After that, the platform runs itself.

---

## The Flywheel

More builders means more agents. More agents means more businesses. More businesses means more demand for builders.

The marketplace grows itself once both sides reach critical mass.

---

## The Moat

The moat is not any single agent. The moat is the **infrastructure every agent runs on**.

Jarble is not tied to any single model, runtime, or platform. As the number of agents and runtimes grows, Jarble's position strengthens.

---

## What Jarble Is NOT

- **Not a consulting firm.** Guided onboarding is a product motion, not billable hours.
- **Not a chatbot builder.** Agents are autonomous workers, not chat widgets.
- **Not a single-agent tool.** The platform supports teams of agents that orchestrate together.
- **Not model-dependent.** Model-agnostic by design. OpenRouter handles routing. No lock-in to OpenAI, Anthropic, or anyone else.
- **Not a feature of someone else's platform.** Jarble is the infrastructure layer, not a plugin.

---

## Core Value Proposition

Jarble eliminates the gap between having an AI agent idea and having it running in your business.

**Build. Deploy. Earn.**

---

## Technical Architecture (Current)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui |
| API | Express + tRPC |
| Database | Drizzle ORM, PostgreSQL (Neon) |
| Auth | Auth0 (Google OAuth), RBAC |
| Payments | Stripe (subscriptions, webhooks) |
| Infrastructure | Hetzner Cloud, Terraform, K3s, Longhorn, Traefik |
| LLM Routing | OpenRouter (OpenAI, Anthropic, Google) |
| Agent Runtime | OpenClaw (only supported runtime for now) |
| MCP | Custom stdio MCP server for UI rendering and agent tooling |
| Chat | @assistant-ui/react, SSE streaming |

### Key Architectural Decisions

- **OpenClaw is the only supported runtime right now.** Other runtimes will be added as the platform matures.
- **OpenRouter handles model routing.** Included credits per plan tier, BYOK supported.
- **Individual-first user model.** Organizations are containers, not gatekeepers.
- **Kubernetes (K3s) for agent isolation.** Each deployment gets its own pod.

---

## Platform Vision (Long-Term)

The long-term vision is the infrastructure layer the agent economy runs on. As the ecosystem of agents, runtimes, models, and tools fragments, Jarble becomes the connective tissue that makes it all work together.

Phase 1 (now): Guided onboarding, hands-on deployment experience, learning what the platform needs to automate.

Phase 2 (6-12 months): Onboarding workflows get encoded into repeatable platform features. Less hand-holding, more self-serve.

Phase 3 (12-24 months): Full platform and marketplace. Businesses self-serve. Builders publish and earn. Jarble takes a cut. The flywheel runs on its own.

---

## Rules for Development

1. Every feature should move toward the two-sided marketplace, not away from it
2. If a feature only serves one side (builders or businesses), it must clearly unblock the other side later
3. Simplify ruthlessly -- if a user needs a tutorial to understand a flow, the flow is wrong
4. OpenClaw is the only runtime for now -- do not build abstractions for runtimes that do not exist yet
5. The platform should feel fast, minimal, and intentional -- not AI-generated
6. When in doubt, reference this document

---

*This document is maintained by the founding team. To propose changes, open a PR with your reasoning.*
