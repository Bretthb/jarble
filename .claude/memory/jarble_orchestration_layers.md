---
name: Jarble is an orchestrator of orchestrators
description: Jarble's strategic position - the platform orchestrates between OpenClaw runtimes which are themselves orchestrators of LLMs/tools/skills/subagents
type: project
---

The user described Jarble's value clearly: "the orchestration is a big part of orchestrating essentially between orchestrators".

There are two layers of orchestration in the system:

1. **Inner orchestration (per-bot)** — OpenClaw runtime running inside each bot pod. It orchestrates the LLM + MCP tools + skills + subagents + persistent memory + chat sessions for ONE deployment. Each bot is itself a small orchestrator. Configurable per-deployment (system prompt, tools, model, skills).

2. **Outer orchestration (cross-bot)** — Jarble's flow engine + flowChat router. This orchestrates BETWEEN bots. The Bot Teams feature is the visible surface: a coordinator bot delegates to specialist bots via the `jarble_delegate` fenced-block contract, and the FlowEngine walks DAGs of bots in topological order with cycles, HITL, subflows, and template variables.

**Why this matters:**
- The moat is the OUTER layer. OpenClaw is open-source-ish and each bot is replaceable. The infrastructure that lets one bot delegate to another, schedule cron jobs, manage shared state, and visualize the flow IS the platform.
- Features that scale BOTH layers are highest leverage. Cron jobs are a perfect example - they need to work at the deployment level (one bot runs on a schedule) AND at the subagent level (a tool call inside a bot is scheduled).
- Auth, billing, isolation, and credit accounting all live at the OUTER layer. The bot runtimes don't know about Stripe or Auth0.

**How to apply:** When evaluating a feature request, ask: "does this add value at the outer layer (cross-bot orchestration), the inner layer (per-bot capability), or both?" Both-layer features are the most valuable. Inner-only features can usually be done by any OpenClaw user without Jarble. Outer-only features ARE the platform.
