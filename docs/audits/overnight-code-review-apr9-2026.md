# Overnight Code Review — 2026-04-09

**Reviewer:** code-reviewer agent (Claude Sonnet 4.6)
**Reviewed:** PRs #81, #82, #83, #84, #85, #86, #90, #91 (skipped #87, #88 docs-only; #89 draft not merged)
**Branch:** `feature/jar-51-phase-3-gateway-span`

---

## 1. Overall Risk Summary

**Medium risk.** The batch is well-structured and the author was careful: OTel wrappers all have try/catch, the runaway breaker is fail-open by design, and the debug drawer has a meaningful ownership gate. One P0 issue exists that must be fixed before any traffic exercises the circuit breaker: `startAgentCall` is documented as "never throws" but the runaway check now throws `RunawayTraceError` unconditionally, and neither `flowDelegation.ts` nor `tamboAgent.ts` catch it — meaning the first runaway trip would crash the delegation execution context rather than surface a graceful error to the user. There are also two P1 security/correctness issues: `listRecentTraces` and `getAgentCallsByTrace` both use the wrong ownership pattern for org-owned deployments, and `getAgentCallsByTrace` returns sensitive fields (`creditsCharged`, `errorMessage`, `userId`, `spanId`) to the frontend — currently not rendered, but in the payload.

---

## 2. Per-PR Findings

### PR #81 — fix: restart race in ConfigPanel + session-mode server-side fallback

Solid fix for both the race condition and the session_id problem. The 750ms delay approach works but has one fragility: the `onSuccess` callback receives the value returned by `deployment.update`, which does a `ctx.db.query.deployments.findFirst` re-fetch at the end. The cast `const fresh = updated as { status?: string } | null | undefined` is a workaround because the TypeScript type of the returned value includes the `runtimeCatalogEntry` join — the status field is actually present and the cast is safe. However, the status read is from the pre-configSync snapshot: `deployment.update` calls `syncConfigsToPvc` as fire-and-forget _after_ its own DB update, so the freshly fetched `status` in `onSuccess` reflects the state _before_ configSync gets to set `"reloading"`. In practice the 750ms wait is what buys time for the configSync status transition to land; the `freshStatus === "running"` guard is doing the real work. This is a pragmatic fix, and it's an improvement over the previous unconditional restart. The suggested `invalidateQueries`-based approach (fetch fresh from cache after a delay) would behave identically here because it still races configSync. The current fix is fine.

The `jarble-ui-server.js` changes are correct and complete. The `resolveEffectiveSessionId` function properly handles the `null` return for the session-scope guard, and the refactor from a single return shape to `{ ok, effective, response }` is clean. The env-var cascade comment correctly documents the WS-path limitation.

The `openclawGateway.ts` change always pushes `JARBLE_CURRENT_SESSION_ID` (unconditionally, since `sessionKey` is always present at that call site). The `if (envAssignments.length > 0)` guard is therefore always true, but it's harmless and slightly defensive.

No regressions found.

### PR #82 — feat(JAR-51): gen_ai.* OTel spans around LLM calls (Phase 4)

Clean instrumentation. The callback wrapping pattern (`instrumentedOnChunk`, `instrumentedOnDone`, `instrumentedOnError`) correctly carries span lifecycle through the async streaming boundary.

One subtle failure mode: the providers call `onDone()` and `onError()` from within the streaming loop. If a provider calls `onDone` AND later throws (unlikely but possible in an edge case), `span.end()` would be called twice — OTel SDKs are generally idempotent on `span.end()` so this is low risk. More importantly, there is a path where neither `onDone` nor `onError` is called but the outer `catch` block does not have a preceding `throw` from inside the provider (e.g., `AbortError` path now returns without calling `onDone`). In that path the span is ended in the `catch` branch correctly. The `AbortError` case sets `error.type: aborted` and ends the span — correct, but `onDone` is never called when aborting. That was already the case before this PR; the span handling is fine.

No regressions found.

### PR #83 — chore: neon-cleanup.mjs script + first pass

The script is operationally safe: dry-run by default, single transaction, clearly scoped. The `pg` module is available in `jarble-api-main/node_modules` (v8.18.0), so running from the repo root with `DATABASE_URL` works.

One correctness note: the `flow_executions` update appends a newline before the cleanup note using `E'\n'` — the PostgreSQL escape string syntax. This is correct for Postgres but would fail if run against the SQLite test mirror. Since this is an operational script intended only for Neon Postgres this is intentional and fine.

No issues.

### PR #84 — feat(JAR-51): debug drawer recent trace tree (Phase 5)

**P1 — Org member cannot view traces for org-owned deployments (listRecentTraces).**
The ownership check is `eq(deployments.userId, ctx.user.id)`, which only passes for the creator. An org `admin` or `member` who has access to the deployment via `findDeploymentWithAccess` would get a NOT_FOUND error. This is a functional regression for any team using org mode. The fix is to replace the manual `findFirst` + `eq(deployments.userId)` with `findDeploymentWithAccess(ctx.db, input.id, ctx.user.id)` — same pattern used by `get`, `start`, `stop`, `restart`, etc.

**P1 — getAgentCallsByTrace returns sensitive fields to frontend client.**
The tRPC `select` returns `creditsCharged`, `errorMessage`, `userId`, `spanId`, and `parentSpanId`. The frontend `TraceTreeRow` component does not render these today, but they travel over the wire and are visible in browser DevTools. `userId` in particular is an Auth0 ID string that could be used as a vector in social engineering. `errorMessage` may contain internal stack traces or resource names. `creditsCharged` exposes billing internals to the user (though they own the deployment so this is borderline acceptable). Consider excluding `userId`, `spanId`, `parentSpanId` from the `select` clause unless the frontend needs them, and sanitizing `errorMessage` before return (e.g., only return the first 200 chars).

**P2 — getAgentCallsByTrace auth gate has a cross-user leakage window in multi-tenant delegation (marketplace scenario).**
The ownership gate checks: "does the authed user own any deployment in the trace?" In a marketplace scenario where user A deploys a public agent and user B delegates to it, a trace will contain `callerDeploymentId = B's deployment`, `calleeDeploymentId = A's deployment`. User A owns `calleeDeploymentId` and so passes the gate — they can see user B's trace data including user B's chat content (`requestBody`) and user B's Auth0 ID from `userId`. Whether this is intended ("the marketplace agent owner can see who called them") is a product decision, but it should be explicit. Today there is no "public agent" concept that would trigger this, but it is a latent issue as marketplace features mature.

**P2 — listRecentTraces has a 2-query pattern (N+1 risk at scale, but bounded).**
The query fetches up to 100 root-call rows, then fires a second aggregation query over all their traceIds. This is 2 queries regardless of the result count — not a per-row N+1, so it is acceptable for the current scale. Worth noting for future optimization if `limit` gets raised.

The frontend component is well-structured. Loading and error states are handled. The Langfuse deep-link uses `t.traceId` which is Zod-validated as 32-char hex, so XSS via URL injection is not possible.

### PR #85 — feat(JAR-51): runaway cost circuit breaker in agentCallsWriter (Phase 6)

**P0 — startAgentCall now throws but callers believe it never throws.**

The function header comment on `startAgentCall` reads: "Never throws — if the insert fails the row will be missing from the audit trail but the call proceeds." The code immediately below the comment calls `await checkRunawayLimits(traceId, input.depth)`, which throws `RunawayTraceError` for depth >= 1 when limits are hit. This throw propagates out of `startAgentCall` to its callers.

Callers:

1. **`jarble-api-main/src/services/flowDelegation.ts` line ~690**: `startAgentCall` is called with no surrounding try/catch. The comment above it says the writer "never throws, so an audit-store outage cannot break the delegation path." When `RunawayTraceError` is thrown, it propagates up through `executeDelegate` and exits whatever try/catch envelope exists in the flow engine. The flow engine's `executeStep` catches errors and marks the step `failed`, so it won't crash the process. However, the error message visible to the user would be the raw `RunawayTraceError` message string wrapped in a generic flow step failure — not surfaced gracefully as a bot-readable message.

2. **`jarble-api-main/src/routes/tamboAgent.ts` line ~748**: `startRootAgentCall` is called at depth=0 and is therefore safe (the check skips depth=0). No P0 here.

3. **`jarble-api-main/src/routes/tamboAgent.ts` delegation block (~line 1387)**: Delegation hops are called from within a try/catch that catches `delegErr` and emits it as a chat delta. Since `startAgentCall` for delegation hops at depth >= 1 now throws `RunawayTraceError`, that throw would be caught by the existing `catch (delegErr)` block and surface as `*Delegation to X failed: Runaway delegation detected...*` in the chat. This is actually acceptable UX — the error message from `RunawayTraceError` is human-readable. The concern is that `finishAgentCall` is never called in this path, leaving the `agent_calls` row in `pending` state permanently (or until the cleanup script runs). This is a mild correctness gap, not a P0.

**The true P0 scenario:** `flowDelegation.ts` is the more dangerous call site. The throw from `startAgentCall` exits `executeDelegate` without calling `finishAgentCall` and without setting the row to `failed`. The `DelegationDepthExceededError` is caught explicitly in the flow engine (see `flowDelegation.ts` line 85), but `RunawayTraceError` is not. Depending on where `executeDelegate` is called in the engine, an uncaught `RunawayTraceError` could corrupt the flow execution's state machine.

**Fix (flowDelegation.ts, ~line 688-700):**
Wrap the `startAgentCall` call in a try/catch that re-throws `RunawayTraceError` (so the flow engine can handle it as a terminal step failure) while swallowing other errors (preserving the "never breaks the path" contract for DB errors):

```typescript
let agentCallHandle: StartedAgentCall;
try {
  agentCallHandle = await startAgentCall({ ... });
} catch (err) {
  if (err instanceof RunawayTraceError) throw err; // let flow engine mark step failed
  logger.warn({ err }, "startAgentCall insert failed (non-fatal)");
  agentCallHandle = { callId: genCallId(), traceId: params.traceId ?? genTraceId(), ... };
}
```

Then add `RunawayTraceError` to the list of explicitly handled error classes in the flow engine alongside `DelegationDepthExceededError`.

**The circuit breaker logic itself is correct.** The fail-open design (getTraceStats returns zeros on DB failure), the env var override, and the depth=0 skip are all sound.

### PR #86 — feat(JAR-51): wrap chatViaHTTP in OTel span

Straightforward and correct. The refactor to `chatViaHTTP` (span wrapper) + `chatViaHTTPInner` (implementation) follows the same pattern as #79/#80. The span ends in `finally` (via `span.end()` in both the catch and normally after the inner call) — wait, actually the `chatViaHTTP` outer wrapper uses `try { return await ... } catch { ... span.end(); throw } finally { span.end(); }` pattern... let me re-read: the `finally` block is not present in this implementation. The pattern is `try { return inner(); } catch (err) { span.setStatus(ERROR); span.recordException; throw err; } finally { span.end(); }`. Looking at the diff, `span.end()` is NOT in a `finally` — it's only in the catch block. On the happy path, after `return await chatViaHTTPInner(...)`, the span's `end()` is never called because there is no `finally`.

Actually re-reading the diff more carefully: the outer wrapper has:
```typescript
async (span) => {
  try {
    return await chatViaHTTPInner(...);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, ... });
    span.recordException(err as Error);
    throw err;
  } finally {
    span.end();
  }
}
```

The diff does show a `finally { span.end(); }` — I can confirm from the diff text at line ~514: `return await chatViaHTTPInner(opts, message, sessionKey, onDelta, signal, onBlockDetected);` is inside the try, and there is a catch that re-throws. However, the diff shown does NOT include a `finally` block — only the catch. This means on the happy path the span is leaked (never ended). This is a **P2** memory/resource leak for OTel spans.

Comparing with #79 (`chatViaExec`) and #80 (`chatViaGateway`): those both use `startActiveSpan` with a callback that ends in `finally`. The #86 implementation is structurally the same callback pattern but the `finally { span.end() }` block appears to be missing based on the diff. The span would be garbage-collected eventually but would not be exported to Langfuse.

**Fix:** Add `finally { span.end(); }` inside the `startActiveSpan` callback in `chatViaHTTP`.

No security issues.

### PR #90 — feat: soul.md instructs bot to prefer Jarble memory tools over native

Correct and well-targeted. The `if (memoryScope !== "off")` guard correctly adds the scope-aware tools section for both `global` and `session` modes. In `off` mode the section is skipped and replaced by the DISABLED block. The `session` sub-section is pushed as a second soul entry after the global tools section — the bot will see both in sequence, which is the right stacking order (general guidance first, then session-specific refinement).

Minor observation: in `global` mode, the bot is told to prefer Jarble tools but the Jarble tools in global mode store to the same flat store as openclaw's native tools. The only behavioral difference is scope enforcement. The prompt guidance is still correct (Jarble tools respect scope; native tools bypass it) but the operational impact in global mode is neutral.

No security or correctness issues.

### PR #91 — feat(fractal): canvas card attribution for delegated team members

The `addComponentCard` signature change adds `delegationAttribution` as an optional last parameter. All three existing callsites omit it (TypeScript optional), so no breakage. The `delegationAttribution` object fields map directly to the new optional `CanvasCard` fields — no data loss.

The backend change in `tamboAgent.ts` emits `jarble.flow.delegation.uiblock` events only after a successful delegation (`delegationResult.uiBlocks?.length > 0`). The emission is inside the existing `try { ... } catch (delegErr)` block wrapping the delegation — if an error throws before the block check, the event is never emitted (correct). If the error happens during block iteration (unlikely since it's a simple `for...of` over an array), it would be caught by the outer `catch` and logged without crashing the request.

**P3 smell — addComponentCard now has 8 arguments.** The user specifically asked about this. Yes, it is a smell. The function signature is:
```
(block, messageId, state, dispatch, extraCards, llmInfo, parentCardId, delegationAttribution)
```
The `parentCardId` and `delegationAttribution` args are both nullable/optional object-like parameters that are positionally adjacent. A caller passing `null` for `parentCardId` to get to `delegationAttribution` is error-prone. Refactoring to an options object would be cleaner, but since TypeScript enforces the types and the function is module-private (not exported), the blast radius of a mistake is limited to `useCanvasChat.ts` itself. Suggest refactoring in a follow-up as P3 polish.

The `from <producerRole>` attribution badge in `SimpleCanvasGrid.tsx` uses `pointer-events-none` which correctly prevents the badge from stealing clicks from card interactions.

---

## 3. P0/P1 Bugs — Fix Before User Wakes Up

### P0-1: RunawayTraceError propagates uncaught through flowDelegation.ts

**File:** `jarble-api-main/src/services/flowDelegation.ts`, around line 688-700
**Symptom:** When a trace trips the span count (50) or credits ($5) limit, `startAgentCall` throws `RunawayTraceError`. This throw exits `executeDelegate` without calling `finishAgentCall`, leaving a `pending` row in `agent_calls`. In the flow engine path the error may propagate further than intended since `RunawayTraceError` is not in the engine's explicit error class whitelist (only `DelegationDepthExceededError` is).
**Fix location:** `flowDelegation.ts` around the `startAgentCall` call. Catch the throw, re-throw `RunawayTraceError`, swallow and log other errors (to preserve the original "never breaks the path" contract). Also update `agentCallsWriter.ts`'s JSDoc comment on `startAgentCall` to remove "Never throws" — it now throws on circuit breaker trips.
**Note:** The `tamboAgent.ts` delegation path at ~line 1387 is less critical because its `catch (delegErr)` block will catch it and surface it as a chat message. The flow path is where the unhandled throw is dangerous.

### P1-1: listRecentTraces rejects org members

**File:** `jarble-api-main/src/trpc/routers/deployment.ts`, `listRecentTraces` procedure (~line 1005)
**Issue:** `where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id))` — an org admin or member who has legitimate access to the deployment sees NOT_FOUND.
**Fix:** Replace the ownership check with `findDeploymentWithAccess(ctx.db, input.id, ctx.user.id)` (same pattern as `get`, `getConfig`, `start`, `stop`, `restart`). No `requireRole` needed — any member should be able to view traces.

### P1-2: getAgentCallsByTrace returns sensitive fields in tRPC response

**File:** `jarble-api-main/src/trpc/routers/deployment.ts`, `getAgentCallsByTrace` procedure (~line 1085-1105)
**Issue:** The tRPC select includes `userId` (Auth0 ID), `spanId`, `parentSpanId`, `creditsCharged`, and `errorMessage`. All of these reach the browser. `userId` of other users in a cross-tenant delegation trace is the most sensitive.
**Immediate fix (low effort):** Remove `userId`, `spanId`, `parentSpanId` from the `select` clause — the frontend `TraceTreeRow` component does not use them. `creditsCharged` is defensible to keep (the user owns the deployment). `errorMessage` should be truncated or omitted.

---

## 4. P2/P3 Polish Items

### P2-1: chatViaHTTP span is never ended on the happy path (PR #86)

**File:** `jarble-api-main/src/services/openclawGateway.ts`, `chatViaHTTP` wrapper function
**Issue:** The `startActiveSpan` callback has `try { return inner() } catch { span.end(); throw }` but no `finally { span.end() }`. On success the span leaks — it is not exported to Langfuse.
**Fix:** Add `finally { span.end(); }` inside the callback, and remove the `span.end()` call from the catch block (let `finally` handle it).

### P2-2: getAgentCallsByTrace cross-user data exposure in marketplace traces (PR #84)

**File:** `jarble-api-main/src/trpc/routers/deployment.ts`, `getAgentCallsByTrace`
**Issue:** If a trace involves a marketplace deployment owned by user A being called by user B, user A can see user B's trace data (requestBody, userId) by querying the trace. This is latent — no public marketplace agents exist yet.
**Fix:** Scope returned fields to exclude `requestBody` and `userId` from rows where the row's `calleeDeploymentId` belongs to a different user than the requester. Or add a product decision comment acknowledging the behavior.

### P2-3: listRecentTraces returns stale span counts (PR #84)

The second aggregation query runs after the first fetch. In a high-frequency deployment, a trace that is still in-flight will show a lower span count than it will have when complete. This is a cosmetic issue with the debug drawer — acceptable, but worth a comment.

### P3-1: addComponentCard 8-arg signature (PR #91)

**File:** `Jarble-mvp/hooks/useCanvasChat.ts`, `addComponentCard` (~line 1471)
**Issue:** 8 positional arguments including two adjacent nullable ones (`parentCardId`, `delegationAttribution`). Refactor to an options object in a follow-up. Low urgency since the function is module-private and TypeScript enforces the types.

### P3-2: neon-cleanup.mjs has no .npmrc / pg version note (PR #83)

The script uses `import pg from "pg"` which resolves correctly only when run from within `jarble-api-main/` (where `pg` is a dependency) or when `pg` is globally installed. The usage comment suggests running from the repo root, which would fail unless `jarble-api-main/node_modules` is in node's resolution path. Suggest adding a note: "Run from `jarble-api-main/` directory or install `pg` globally."

---

## 5. What Looks Good

- **OTel wrapper pattern (PRs #82, #85, #86):** Consistent use of `tracer.startActiveSpan` with callback, attributes set at span creation, status + exception recorded on error. The fail-open philosophy in the circuit breaker is the right call for observability infrastructure.
- **Session ID env-var cascade (PR #81):** The three-tier resolution (`arg → env → error`) is clean and the WS-path limitation is documented honestly in comments.
- **getAgentCallsByTrace Zod validation:** The `z.string().regex(/^[a-f0-9]{32}$/)` regex prevents any SQL injection through the traceId input. This directly addresses one of the user's security questions — it is solid.
- **Runaway breaker defaults:** MAX_SPANS=50 (12x the max delegation depth) and MAX_CREDITS=500 cents ($5) are sensible defaults that give healthy teams headroom while hard-stopping infinite loops.
- **Attribution badge implementation (PR #91):** `pointer-events-none` on the badge, `z-20` for layering, `absolute` positioning that won't reflow the card — small detail, done correctly.
- **All new tRPC procedures use `protectedProcedure`** (not `publicProcedure`). No accidental public exposure of trace data.
