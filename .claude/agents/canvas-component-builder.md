---
name: canvas-component-builder
description: "DEPRECATED. Jarble no longer ships its own canvas components or a Jarble-built rich web chat UI. Each Agent Harness (OpenClaw today) provides its own webchat. Do not invoke this agent."
model: opus
color: gray
memory: project
status: deprecated
---

# Canvas Component Builder — DEPRECATED

This agent describes a workflow that is no longer part of the product. Jarble is an **Agent Infrastructure Platform**: the per-deployment chat UI is served by the Agent Harness itself (OpenClaw's webchat for the currently-shipping harness). Jarble does not ship its own canvas component library or chat UI.

## Why this file still exists

The repo still contains canvas-related code (`Jarble-mvp/components/canvas/`, `useCanvasChat`, `AssistantUIChat`, `SimpleCanvasGrid`, and the `render_ui` / `define_component` tools in `jarble-ui-server.js`). That code is being phased out. Until it is fully removed, this agent definition is kept as a tombstone so links and tooling references do not break.

## What to do instead

- For changes inside the Agent Harness's own webchat UI (e.g. OpenClaw's chat), file an upstream issue against the harness — that surface is not owned by Jarble.
- For per-deployment configuration of the harness (system prompt, model, MCP, messaging platforms), use the **runtime-handler** agent.
- For platform-level UI work that Jarble does own (onboarding wizard, dashboard, deployment configuration sidebar, flow canvas for orchestration), edit those files directly — they are not "canvas components" in the deprecated sense.

If you need to remove the legacy canvas code entirely, open a Linear ticket scoped to that deletion and link to this file as the source of the policy decision.
