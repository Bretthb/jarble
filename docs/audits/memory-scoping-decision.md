# Conversation-Scoped Bot Memory — Decision

**Status:** Decided (Phase 1) · Wiring follow-up (Phase 2, 2026-04-11)
**Date:** 2026-04-08 (initial), 2026-04-11 (Phase 2)
**Branch:** `feature/memory-scoping`
**Initiative:** Conversation-Scoped Bot Memory

## Problem

QA reproduced a cross-session bot memory leak: a user told bot **t2** in a new
Team Chat session "my favorite color is blue", then the SAME bot recalled it in:

  (a) An older conversation in the same team flow.
  (b) t2's individual chat at `/d/[id]`.

The UI presents these sessions as completely isolated (separate conversation
panels, distinct thread history, distinct sessionKeys), but the bot's
long-term memory crosses the session boundary because memory is keyed
**per-pod**, not per-conversation.

## Where memory actually lives

There are three independent memory layers in a Jarble bot pod:

| Layer | Code | Storage | Scope today |
|---|---|---|---|
| OpenClaw native session history | `openclaw` runtime | OpenClaw workspace, keyed by `sessionKey` (`jarble-web-${userId}-${convId}` or `flow-${flowId}-${userId}-${convId}`) | **Per session** ✅ — already isolated |
| OpenClaw native `memory_search` tool | `openclaw` runtime (closed-source) | OpenClaw memory dir | **Per pod** ⚠ — leaks across sessions |
| Jarble MCP `store_memory` / `recall_memory` | `jarble-api-main/src/mcp/jarble-ui-server.js:4112-4762` | `JARBLE_MEMORY_DIR/store.json` (defaults `/data/memory/store.json`) | **Per pod** ⚠ — leaks across sessions |

The `JARBLE_MEMORY_DIR` env var is set in `runtimes/handlers/openclaw.ts:713`
and defaults to `/home/openclaw/.openclaw/memory`. Both memory layers store
state on the pod's PVC, with one global `store.json` per deployment. Neither
layer accepts a `sessionKey` or `conversationId`, and the bot's `soul.md`
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
- **Specialist delegation in Bot Teams legitimately needs shared context.**
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
     platforms. The bot's prompt continues to advertise the memory tools.
   - `session` — bot is instructed to scope memories per `[SESSION_ID]`,
     and the Jarble MCP store partitions `store.json` by session key. The
     bot's prompt is rewritten to forbid cross-session recall.
   - `off` — memory tools are removed from the prompt entirely, the MCP
     memory tools no-op.
2. The current `[CANVAS_STATE]` block already injected at message time gets
   a `Memory: <mode>` line (and a `Session: <id>` line for `session` mode)
   so the bot's per-turn prompt is the source of truth.
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
  as "everything the bot saves about you", and "session" mode is documented
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
Bot Teams. Half-fixing it on the Jarble MCP layer alone would be worse than
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

## Phase 2 — wiring follow-up (2026-04-11)

After the Phase 1 PR landed, a re-audit on `feature/memory-scoping` found
that the helpers, schema column, MCP partition logic and banner component
all existed, **but several pieces were not actually wired into the
production code paths**. The QA-reproduced leak (Scenario 10 in
`docs/audits/deep-bot-teams-qa.md`) reproduced in **team chat**, not the
individual `/d/[id]` chat — and team chat had no banner at all. Specifically:

| Gap | Status before this PR | Why it matters |
|---|---|---|
| `Jarble-mvp/views/Deployments.tsx` team chat panel does not render `<MemoryDisclosureBanner>` | Banner only on `/d/[id]/page.tsx` | The QA leak reproduced in the team chat surface, where there was zero disclosure. Users in Bot Teams could not tell that the bot's memory was global. |
| `jarble-api-main/src/utils/memoryScope.ts` helpers never imported by production code | Only imported by their own test file | The shared `renderMemoryPromptSection` / `renderMemoryStateLine` / `injectMemoryStateLine` were dead code; `openclaw.ts` had its own inline soul.md prompt rendering, and no chat route injected the per-turn `[CANVAS_STATE]` memory line. |
| `jarble-api-main/src/routes/tamboAgent.ts` does not inject `[CANVAS_STATE]` memory line | Sanitization stripped any client-supplied `[CANVAS_STATE]` block, no replacement injected | The bot received no per-turn signal about which mode it was running in. Even in `session` mode the bot had no idea what session id to pass to memory tool calls on the WS path. |
| `jarble-api-main/src/routes/flowChat.ts` does not inject `[CANVAS_STATE]` memory line | Same as tamboAgent | Team chat (the surface where the leak reproduced) had even less per-turn signal than direct chat. |
| `openclaw.ts` soul.md memory section is hand-rolled inline | Inline string concatenation in `renderConfigs` | Wording drifts from the test-locked helper, so a regression in the helper wouldn't surface in CI. |

### Phase 2 scope (this PR)

This PR closes the wiring gaps without revisiting the A-vs-B decision:

1. **Team chat banner** — Render `<MemoryDisclosureBanner>` immediately
   below the team-chat panel header in `Deployments.tsx`. Picks the
   loudest scope across all deployments referenced by the active flow
   so that *if any bot in the team is `global`*, the user sees the loud
   amber banner. This is the privacy-safe aggregation: a team is only
   as private as its leakiest member.
2. **`renderMemoryPromptSection` wired into `openclaw.ts`** — Replace the
   inline soul.md rendering with a call to the helper, so the prompt
   wording is exactly what the tests lock down.
3. **`injectMemoryStateLine` wired into both chat routes** — Both
   `tamboAgent.ts` (`/api/tambo-agent`) and `flowChat.ts`
   (`/api/flows/:flowId/chat`) now prepend a `[CANVAS_STATE]` block to
   the message that goes to the pod, with `Memory: <mode>` and (in
   session mode) `Session: <id>` lines. The bot now sees the scope and
   session id on every turn, regardless of whether the chat path is
   exec, HTTP, or WS gateway.
4. **`normalizeMemoryScope` wired into both routes and the handler** —
   Stale rows from before the column existed and any unexpected DB value
   fall back to the privacy-loaded `global` default rather than crashing.
5. **Tests** — New tests cover the helper integration into both chat
   routes (memory line injection for each scope) and a smoke test on
   the openclaw handler's soul.md output that asserts it goes through
   the helper. The team-chat banner gets a small aggregation-helper test
   so the "loudest scope wins" rule is locked down.

### What this PR does NOT do (still out of scope)

- **WS gateway env-var injection.** The `chatViaGateway` (WS) path still
  cannot inject `JARBLE_CURRENT_SESSION_ID` per call because the MCP
  server child process inherits its env at pod boot, not per request.
  Phase 2 mitigates this at the prompt layer by injecting `Session: <id>`
  into every `[CANVAS_STATE]` block, so the bot can pass `scope_id`
  voluntarily on memory tool calls. Honest, hard enforcement requires a
  runtime change and is tracked as a follow-up.
- **Disabling OpenClaw native `memory_search` / `memory_get`.** The
  closed runtime tools still bypass Jarble's scope. The soul.md prompt
  (via the helper) tells the bot to prefer Jarble's tools and never
  recall cross-session in `session` mode, but it is prompt-level
  guidance, not enforcement. Follow-up: explore `tools.deny` in
  `openclaw.json` once we can confirm it doesn't break in-flight bots.
- **Schema default flip from `global` → `session`.** Keeping `global`
  preserves the cross-platform memory feature for existing deployments.
  Privacy-conscious users get the loud disclosure banner plus a one-click
  toggle in the deployment Configuration panel.

### Why we still picked Option B (re-validated for Phase 2)

The temptation in Phase 2 was to flip the default to `session` and call
that "Option A done right". Re-reading the original cons list, three of
them are still valid:

1. **OpenClaw's native memory layer is closed-source and per-pod.** A
   `session` default would silently miss that layer, leaving users with a
   false sense of isolation. Disclosure-first is more honest.
2. **Specialist delegation in Bot Teams legitimately shares context** —
   if every delegation hop gets a fresh memory pool, the orchestrator
   has to re-explain the user every hand-off. The product wants a way
   to scope, not a hard isolation default.
3. **Cross-platform memory is an advertised feature** of the platform
   (`PRODUCT.md`, marketing copy, the global-mode soul.md prompt). Pulling
   it out from under deployments without notice would break shipped
   bots.

Phase 2's wiring fix gets us the disclosure that was originally promised
plus the per-turn prompt signal, without changing the default.
