# Deep Agent Teams QA — 2026-04-08

**Agent**: `deeper-teams` (qa-explorer-ui via Playwright)
**URL**: https://dev.jarble.ai
**Team tested**: Team 2 (t2 → delegates → t1), entry t2
**Agents available**: only t1 and t2 (no 3rd agent created to respect cost cap)
**Deployment IDs**: t2 = `f30qkp1rzy1x`, t1 = `z888fle0j33t`

## TL;DR

The 2-agent delegation path is solid. 3+ agent scaling wasn't exercised due to cost cap. The two biggest findings are architectural, not quick-fix bugs:

1. **Team chat has NO canvas rendering layer at all.** Delegated specialists that emit `jarble_ui` blocks get text-rendered because the team chat view doesn't have a canvas surface.
2. **Agent memory leaks across "isolated" UI sessions.** Same agent remembers user profile across: different team sessions, individual /d/[id] chat, different conversations. UI session isolation is cosmetic only.

## Scenario Results

### Scenario 1 — Delegation chain (A→B→C) — NOT TESTED
Only 2 running agents exist. Creating a 3rd was skipped per cost cap. 2-agent chain already verified in prior sweeps.

### Scenario 2 — Parallel delegation (fan-out) — NOT TESTED
Same reason.

### Scenario 3 — Delegate to stopped agent — **PASS with caveats**
- Stopped t1 via dashboard, asked team chat: "Delegate to t1: say ping"
- Clean error: `*Delegation to delegate_to_t1 failed: Delegation target "t1" is not running (status: stopped)*`
- No hang, no 500, no crash

**Caveats:**
- Coordinator (t2) does NOT continue reasoning after the failed tool call to produce a user-friendly message. User sees only the raw italicized error string.
- Error is NOT persisted to stored conversation history (disappears on chat reopen).
- **Bug — stale status in team canvas**: while t1 was Stopped on the dashboard, the Agent Teams canvas still showed t1's node as "Running". Node-status badges don't subscribe to live deployment state.

### Scenario 4 — Coordinator refuses over-delegation — **PASS**
- Sent "Just say hi"
- t2 responded directly: "Hi! 👋 What can I help you with?"
- Telemetry footer: `Entry bot answered directly (1 team tool available, none used)` — excellent UX
- Works exactly as desired

### Scenario 5 — Multi-turn context through delegation — **PASS**
- Turn 1: "Ask t1 to remember the number 42" → t2 delegated, t1: "Got it — 42 is saved"
- Turn 2: "Ask t1 what number I told them" → t2 delegated, t1: "42"
- Context preserved across two separate delegation calls

### Scenario 6 — Delegate + canvas component — **PARTIAL FAIL (major UX gap)**
- Sent: "Ask t1 to render a bar_chart Q1-Q4: 50,75,90,120"
- Delegation happened, t1 responded with an **ASCII art bar chart**, not a canvas component
- DOM inspection of team chat confirmed:
  - `document.querySelectorAll('iframe').length === 0`
  - No `[role="grid"]`
  - No `Canvas*` components in the tree
- By contrast, the individual `/d/f30qkp1rzy1x` (t2) chat DOES have a canvas with 3 rendered cards (table, bar chart, pie chart iframes)
- Agent explicitly said "text-rendered for webchat" — the team-mode system prompt suppresses UI blocks
- **F5/reload canvas persistence: NOT APPLICABLE — no canvas exists to reload**

### Scenario 7 — Session picker + team chat — **MIXED**
- Opened session dropdown, created New conversation, named "Team Chat"
- Sent "remember my favorite color is blue" → t2 confirmed
- Switched back to QA-Renamed-Session → **UI isolation works**: old session's 40+ messages reload, no leak of blue message into display
- **Bug — misleading "close chat" button**: button next to session picker looks like "+" / "new session" glyph but actually closes the chat panel entirely. Triggered accidentally twice.
- **Bug — live vs persisted rendering divergence**: live chat shows delegation as collapsed "**t1:** [result]" summary. On close + reopen, same messages show raw `jarble_delegate {...}` fenced block plus raw tool result. Synthesized summary is ephemeral UI state, not persisted.
- **Bug — error messages not persisted**: The stopped-agent error from Scenario 3 was visible immediately after sending, but vanished after chat close + reopen.

### Scenario 8 — Cross-session isolation — **PARTIAL FAIL**
Could not test distinct users (single account). Cross-tab same-user shows agent's profile memory is global across all sessions/tabs/modes (see Scenario 10).

### Scenario 9 — Rapid / concurrent delegation — **UI-PREVENTED**
- Send button becomes disabled while assistant is "Thinking..."
- Input field also blocks new input
- UI enforces strict stop-and-wait semantics. Safe, but users cannot pipeline questions.

### Scenario 10 — Team chat vs individual chat overlap — **FAIL (agent memory is globally shared)**
**Setup**: In new "Team Chat" session, told team "remember my favorite color is blue" → t2 confirmed and saved to "your profile"

**Test 1 — same agent, different session**: Switched to OLD QA-Renamed-Session (zero mention of blue in its 40-message history). Asked "what is my favorite color" → **t2 replied "your favorite color is blue!"**

**Test 2 — same agent, different surface**: Opened t2's individual chat at `/d/f30qkp1rzy1x` (separate chat interface, its own conversation history, its own canvas cards). Asked "what is my favorite color" → **t2 replied "Your favorite color is blue 💙"**

**Conclusion**: t2 has a **persistent user-scoped profile / long-term memory** shared across every surface this user touches. May be by design, but contradicts the mental model the UI presents (sessions appear isolated; team chat vs individual chat appear distinct).

**Product implication**: If a user tells an agent sensitive info in one session/team, it will resurface in any other session/team/individual chat with the same agent. No per-session memory scoping.

## Priority bugs / findings

### P0 — blocking
None. Platform is functional for 2-agent teams.

### P1 — significant
1. **Team chat has no canvas rendering.** Massive feature gap vs individual chat. Either team chat should embed the canvas, or product should make limitation explicit in UI.
2. **Agent memory leaks across all UI session boundaries.** Either document this behavior or scope memory to conversations.
3. **Stale deployment status in Agent Teams canvas.** Node card shows "Running" when agent is stopped. Status doesn't subscribe to live deployment state.
4. **Error states not persisted in conversation history.** Users see error live, reload, error is gone — might think delegation succeeded.

### P2 — medium
5. Misleading "close chat" button next to session picker.
6. Live vs persisted conversation rendering divergence.
7. Coordinator does not wrap tool errors in a user-facing apology/retry message.
8. No rapid-fire queue (stop-and-wait semantics).
9. t1 restart latency ≥90s with no visible progress indicator.

### P3 — minor
10. `/deployments` flakiness on first load (3-5s race condition).

## What is NOT verified for N>2
- Delegation chain depth limit / `MAX_DELEGATION_DEPTH` enforcement
- Fan-out / parallel delegation semantics
- Cycle protection
- Orchestration timeline UI for multi-hop chains (if one exists, it's hidden)

## Cleanup status
- **t1**: was stopped for Scenario 3, restarted. Was still "Starting" at end of run.
- **New "Team Chat" session** in Team 2: created for Scenario 10, NOT deleted (delete permission revoked mid-run). Can be cleaned manually.
- **Team 2 structure**: UNCHANGED.
- **No new deployments created.**

## Alignment with fractal vision audit

This report aligns closely with the fractal gap audit (`docs/audits/fractal-vision-gap-audit.md`):

- **Scenario 6 finding** confirms Piece 5 (canvas attribution) is currently blocked at a deeper level — team chat has no canvas layer, so attribution is moot until a canvas is added to that view.
- **Scenario 10 finding** (agent memory leak) is not covered in the fractal audit but is a related architectural gap around session scoping.
- **Scenarios 1-2 NOT TESTED** leaves the fractal audit's Piece 1 (N-level recursion) unverified at runtime — the code clearly shows recursion is not implemented, and no test was able to exercise it.
