# Conversation-Scoped Agent Memory — Decision

**Status:** Decided
**Date:** 2026-04-08
**Branch:** `feature/memory-scoping`
**Initiative:** Conversation-Scoped Agent Memory

## Problem

QA reproduced a cross-session agent memory leak: a user told agent **t2** in a new
Team Chat session "my favorite color is blue", then the SAME agent recalled it in:

  (a) An older conversation in the same team flow.
  (b) t2's individual chat at `/d/[id]`.

The UI presents these sessions as completely isolated (separate conversation
panels, distinct thread history, distinct sessionKeys), but the agent's
long-term memory crosses the session boundary because memory is keyed
**per-pod**, not per-conversation.

## Where memory actually lives

There are three independent memory layers in a Jarble agent pod:

| Layer | Code | Storage | Scope today |
|---|---|---|---|
| OpenClaw native session history | `openclaw` runtime | OpenClaw workspace, keyed by `sessionKey` (`jarble-web-${userId}-${convId}` or `flow-${flowId}-${userId}-${convId}`) | **Per session** ✅ — already isolated |
| OpenClaw native `memory_search` tool | `openclaw` runtime (closed-source) | OpenClaw memory dir | **Per pod** ⚠ — leaks across sessions |
| Jarble MCP `store_memory` / `recall_memory` | `jarble-api-main/src/mcp/jarble-ui-server.js:4112-4762` | `JARBLE_MEMORY_DIR/store.json` (defaults `/data/memory/store.json`) | **Per pod** ⚠ — leaks across sessions |

The `JARBLE_MEMORY_DIR` env var is set in `runtimes/handlers/openclaw.ts:713`
and defaults to `/home/openclaw/.openclaw/memory`. Both memory layers store
state on the pod's PVC, with one global `store.json` per deployment. Neither
layer accepts a `sessionKey` or `conversationId`, and the agent's `soul.md`
prompt actively encourages cross-platform persistence:

> "Memory persists across Jarble dashboard, Telegram, Discord, WhatsApp, etc."
> — `jarble-ui-server.js:865-878`

So the leak is **real, intentional, and expected by the product** — but
**not disclosed** to the user, who reasonably assumes a fresh chat session is
a fresh slate.

## Options considered

### Option A — Force per-conversation memory scoping

Pipe `conversationId` into every memory write/read, partition `store.json`
per session, restrict the LLM to only see same-session memories.

**Pros**

- Strongest privacy default — what's said in one chat stays in that chat.
- Matches the UI's "isolated session" mental model.
- Removes the "WTF, how does it know that?" reaction users get today.

**Cons**

- **Breaks the cross-platform memory feature on purpose.** Web → Telegram and
  flow-orchestrator → specialist hand-offs all stop sharing context. Soul.md
  and the system prompt actively advertise this feature ("cross-platform
  memory" is mentioned in 4 places).
- **We don't control all the memory layers.** OpenClaw's native `memory_search`
  is part of the closed runtime, doesn't accept a session key, and per the
  `qa-bot-teams-2026-04-07` audit OpenClaw "ignores all configured MCP
  servers" — we can't reach into the runtime to scope it.
- **Specialist delegation in Agent Teams legitimately needs shared context.**
  The orchestrator passes a task to a specialist; if the specialist can't see
  global memory, every delegation has to re-explain who the user is.
- A "scope by session" enforcement that only covers the Jarble MCP layer
  would be a half-fix — OpenClaw native memory keeps leaking.
- Larger implementation surface; touches the MCP server, the runtime handler,
  the chat route, the flow chat route, the delegation path, and potentially
  the runtime image entrypoint.

### Option B — Disclose user-scoped memory + per-deployment opt-in scoping

Treat the existing behavior as a feature, but make it **unmissable**:

1. New `memoryScope` field on the deployment with three modes:
   - `global` (default) — current behavior, persists across sessions and
     platforms. The agent's prompt continues to advertise the memory tools.
   - `session` — agent is instructed to scope memories per `[SESSION_ID]`,
     and the Jarble MCP store partitions `store.json` by session key. The
     agent's prompt is rewritten to forbid cross-session recall.
   - `off` — memory tools are removed from the prompt entirely, the MCP
     memory tools no-op.
2. The current `[CANVAS_STATE]` block already injected at message time gets
   a `Memory: <mode>` line (and a `Session: <id>` line for `session` mode)
   so the agent's per-turn prompt is the source of truth.
3. The `JARBLE_MEMORY_SCOPE` env var is wired into the pod via
   `getSecretEntries()` so the MCP server actually enforces the partition
   when invoked.
4. **An unmissable banner at the top of every chat session** ("Memory: ON
   across all your conversations · Manage") that links to the deployment
   config. Hidden behind a tooltip is **not** acceptable here.
5. The deployment configuration sidebar (`ConfigPanel.tsx`) gets a Memory
   section with a 3-way toggle, a one-line explainer, and a "Reset memory"
   action.

**Pros**

- Doesn't break the cross-platform memory feature for users who want it.
- Surfaces the existing behavior — fixes the surprise, which is the actual
  bug per the QA report.
- Gives privacy-conscious users a real opt-in (the `session` and `off` modes
  do something).
- Implementation lands cleanly in the layers we own — the MCP server, the
  runtime handler prompt rendering, one new tRPC mutation, one frontend
  banner, one config toggle.
- Doesn't pretend we control OpenClaw's native memory layer. We can't, and
  the disclosure is honest about the boundary: "global" mode is documented
  as "everything the agent saves about you", and "session" mode is documented
  as "Jarble-managed memory only — the underlying runtime may still recall
  things across sessions".

**Cons**

- The `session` mode is best-effort: it controls the Jarble MCP layer and
  the prompt, but OpenClaw's native `memory_search` is still per-pod. The
  banner copy and decision doc explicitly call this out so users aren't
  misled.
- More moving parts than just hiding the feature (DB column, prompt
  rendering, banner, toggle, MCP partition).

## Decision

**Ship Option B.**

The bug isn't that memory persists — that's the feature. The bug is that
the UI lies to the user about it. Disclosure-first matches both the product
stance ("memory persists across platforms") and the user's privacy
expectations (give them a real switch to flip).

A pure Option A "scope everything by conversationId" can't be implemented
honestly without modifying OpenClaw's closed runtime, would gut a feature
the product promotes, and would silently break specialist delegation in
Agent Teams. Half-fixing it on the Jarble MCP layer alone would be worse than
the current behavior because users would believe scoping was working when
it isn't.

## Implementation plan (this PR)

| Layer | File | Change |
|---|---|---|
| Schema | `jarble-api-main/src/db/schema.pg.ts` | Add `memory_scope varchar(20) DEFAULT 'global' NOT NULL` to `deployments`. |
| Schema | `jarble-api-main/src/__tests__/helpers/testSchema.sqlite.ts` | Mirror the column for tests. |
| Migration | `jarble-api-main/drizzle-pg/0008_memory_scope.sql` | `ALTER TABLE deployments ADD COLUMN memory_scope...`. |
| Runtime handler | `jarble-api-main/src/runtimes/handlers/openclaw.ts` | `renderConfigs()` appends a Memory section to soul.md per scope; `getSecretEntries()` exports `JARBLE_MEMORY_SCOPE`. |
| MCP server | `jarble-api-main/src/mcp/jarble-ui-server.js` | `loadMemoryStore`/`saveMemoryStore` honor `JARBLE_MEMORY_SCOPE` and an optional `scope_id` arg, partitioning `store.<sha>.json` for `session` mode and no-op'ing for `off`. |
| Chat route | `jarble-api-main/src/routes/tamboAgent.ts` | Inject `Memory: <mode>` and `Session: <id>` into the existing `[CANVAS_STATE]` block. |
| tRPC | `jarble-api-main/src/trpc/routers/deployment.ts` | Accept `memoryScope` in the `create` and `update` inputs (Zod enum). |
| Frontend banner | `Jarble-mvp/components/chat/MemoryDisclosureBanner.tsx` | NEW. Always-visible strip at the top of the chat panel. |
| Frontend chat host | `Jarble-mvp/app/d/[id]/page.tsx` | Render `<MemoryDisclosureBanner>` immediately above `<KeyedChatPanel>`. |
| Frontend config | `Jarble-mvp/components/workspace/ConfigPanel.tsx` | Add a Memory section with a 3-mode select + Save. |
| Tests | `jarble-api-main/src/runtimes/handlers/openclaw.test.ts` + new test for the MCP store partition | Cover `renderConfigs` outputs and store partition behavior. |

## Out of scope (follow-ups)

- A "Reset memory" button that wipes the pod's memory store. Easy to add but
  better as a follow-up since it touches the pod-exec MCP proxy.
- Surfacing stored memories in the UI ("Memory inventory"). Lots of design
  work, not part of the leak fix.
- Coordinating with OpenClaw upstream on a `--memory-scope=session` flag so
  the native `memory_search` can also be scoped honestly.
