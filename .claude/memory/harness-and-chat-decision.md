---
name: harness-and-chat-decision
description: "2026-05-12 product decision — Jarble is an Agent Infrastructure Platform; the per-deployment agent process is an \"Agent Harness\" (renamed from \"Agent Runtime\"); Jarble's own canvas + chat UI is deprecated in favor of the harness's webchat."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3983bedf-6a8c-4b9b-b7b4-8b5b86f4c8ef
---

On 2026-05-12, tanner@jarble.ai made a product decision that should be treated as authoritative for all docs and new work:

1. **Jarble's official positioning is "Agent Infrastructure Platform"** (not "no-code chatbot builder", not just "infrastructure for AI agents").
2. **The per-deployment agent process is now called "Agent Harness"**, not "Agent Runtime", in all user-facing / architectural prose. **Code identifiers are intentionally preserved**: `RuntimeHandler` interface, `runtimes/handlers/` directory, `runtimeCatalog` table, `RUNTIME_EXTRA_STEPS`, `RUNTIME_CONFIG_TABS`. Don't rename those.
3. **OpenClaw is the only Agent Harness currently shipping.** The platform is harness-agnostic by design; ZeroClaw is in progress.
4. **Jarble no longer ships its own chat UI or canvas component library.** The per-deployment chat is the harness's own webchat (OpenClaw's webchat today). The repo still contains legacy canvas + chat code (`Jarble-mvp/components/canvas/`, `useCanvasChat.ts`, `AssistantUIChat.tsx`, `SimpleCanvasGrid.tsx`, `lib/assistantRuntime.ts`, the `render_ui` / `define_component` tools in `jarble-api-main/src/mcp/jarble-ui-server.js`). **That code is on a path to deletion. Do not extend it.**
5. The **orchestration canvas** in `Jarble-mvp/views/Deployments.tsx` (built on `@xyflow/react`, wires deployments into workflows) is **not** the deprecated canvas — it stays.
6. The **marketplace is planned, not shipped** (Phase 3 per ROADMAP.md). Stop describing marketplace browsing/installing/earning as a current feature.

**Why:** Cleaner positioning ("infrastructure, not chatbot tool"), removes the maintenance cost of a parallel chat/canvas surface, and forces harness-agnosticism by making the harness own the chat layer.

**How to apply:**

- When writing docs, use "Agent Harness" / "harness-agnostic" / "harness catalog" in narrative. Use the literal code identifiers in code blocks and file paths.
- Before scaffolding anything that touches `components/canvas/`, `useCanvasChat`, `AssistantUIChat`, `SimpleCanvasGrid`, or `jarble-ui-server.js`, stop and propose either (a) leaving the legacy code untouched, or (b) deleting it. Do not add features.
- The `canvas-component-builder` agent and `/new-component` skill are deprecated tombstones — do not invoke.
- See `PRODUCT.md` (rewritten 2026-05-12) and `CLAUDE.md` → "Naming and deprecations" section for the authoritative framing.

Related: [[infra-hosting]] — the Coolify/Kubero/Hetzner split is where the harness pods actually run.
