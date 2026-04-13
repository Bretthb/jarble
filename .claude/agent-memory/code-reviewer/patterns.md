---
name: Recurring code review patterns
description: Patterns that recur across Jarble codebase reviews and deserve consistent flagging
type: feedback
---

## Patterns to flag in every review

**Credit ledger operations must be in a DB transaction.**
`marketplaceHub.ts` balance-check → debit → HTTP call → record is not atomic. Any new credit-affecting code must use `db.transaction()` to prevent double-debit under concurrent requests.
**Why:** Two concurrent callers can both pass balance check before either debit lands.
**How to apply:** Flag any code that reads a balance and then writes a debit/credit in separate awaits.

**New env vars must go in `env.ts` Zod schema.**
`JARBLE_API_URL`, `API_BASE_URL`, `DEFAULT_POD_IMAGE`, `POD_PROXY_URL` bypass `env.ts`. Any new env var accessed via bare `process.env.X` instead of `env.X` is unvalidated and untyped.
**Why:** Silent fallback to wrong defaults causes prod failures that don't show up locally.
**How to apply:** Flag every `process.env.X` that isn't in `env.ts`.

**New REST routes need ownership checks AND JWT verification.**
Many route files (tamboAgent, knowledge, canvasFiles, files, diagnose) inline their own auth. They don't always match each other's pattern. Flag any new route that calls `verifyToken` without also checking `deployment.userId === user.id`.

**Test DB drift: new tables must be added to `testDb.ts`.**
After any schema addition, `src/__tests__/helpers/testDb.ts` must get the corresponding `CREATE TABLE` statement. As of Mar 2026, ~19 tables from Track B/C features are missing.
**Why:** Tests that touch missing tables fail with "no such table", silently hiding coverage gaps.

**`as any` in DB inserts is expected (schema union type issue).**
The `as any` casts on `.values({...} as any)` in insert calls are a known Drizzle limitation from the three-database schema union. Do not flag these as type safety issues unless the cast is on business logic, not schema types.

**MCP server changes are high-risk.**
`jarble-ui-server.js` is 7,110 lines of CJS with no module boundaries. Any change to tool dispatch or the `executeTool` switch can silently break other tools. Treat all MCP server PRs as requiring extra scrutiny.

**New REST route auth MUST use `getUserFromRequest()` from `helpers/auth.ts`, NOT `req.auth`.**
`req.auth` is NEVER populated in this project (no `express-oauth2-jwt-bearer` installed). Any route that reads `req.auth?.payload?.sub` will always get `null`, making auth silently unenforced.
**Why:** Confirmed in A2A gateway review Apr 2026 — `resolveAuth()` in `a2aGateway.ts` built a broken auth helper from scratch. Correct pattern: `import { getUserFromRequest } from "../helpers/auth.js"`.
**How to apply:** Block any PR where a new route handler reads `req.auth` — it will always be undefined.

**Budget / rate checks on delegations must not rely on `traceId` being present.**
The `traceId` field on `executeDelegation` params is optional and is NOT passed from `flowChat.ts` or from recursive sub-delegation. Any enforcement logic gated on `params.traceId` will silently skip for flow-chat delegations.
**Why:** Confirmed in Cost Phase 4 review Apr 2026 — budget check skips silently for entire flowChat.ts code path.

**`DelegationTraceEntry` does not store `uiBlocks` — predicates about block production must track `uiBlockCount` explicitly.**
When adding logic gated on "did this delegation produce UI blocks?", `DelegationTraceEntry` has no `uiBlocks` field by design (kept server-side only). The `uiBlockCount` is available in the `delegation.end` SSE event payload (line ~624) but must be explicitly added to the trace struct to be used in downstream logic.
**Why:** Compose feature (70858b4 Apr 2026) fired the compose instruction on all successful delegations, not only those that produced blocks.
**How to apply:** Any condition checking `d.uiBlocks` on a trace entry is a bug. Add `uiBlockCount: number` to the entry and gate on that instead.

**`withSessionLock` in flowChat.ts is defined but never wraps the actual exec calls.**
The helper was ported from `tamboAgent.ts` but the two `chatViaExec` calls in `flowChat.ts` (entry bot turn ~line 485 and synthesis turn ~line 763) are called directly, not wrapped. The session lock is dead code in this file.
**Why:** Confirmed Apr 2026. Concurrent requests to the same flow session can still race and corrupt OpenClaw session history.
**How to apply:** Flag any file that defines a session-lock helper but where the lock is never acquired.

**`flowEngine.ts:executeDeploymentViaDelegation` does not pass `traceId` to `executeDelegation`.**
The budget check in `executeDelegation` is gated on `params.sourceDeploymentId && params.traceId`. The flow DAG execution path sets `sourceDeploymentId` but omits `traceId`, so per-deployment budget caps are silently skipped for nodes executed via the flow engine.
**Why:** Confirmed Apr 2026. The traceId thread-through was overlooked when the delegation path was added to the flow engine.

**`tamboAgent.ts` sanitizes to `sanitizedText` but several downstream code paths still use original `lastUserText`.**
After the tag-stripping sanitization, `generateReasoning()`, the delegation `conversationHistory`, session title, and the empty-message guard all reference `lastUserText` (unsanitized). The actual message to the pod uses `sanitizedText`, so the critical path is covered. The rest are lower-risk but inconsistent.
**Why:** Sanitization was added incrementally (9c750b5 Apr 2026) and not backfilled to all callsites.
**How to apply:** When reviewing tamboAgent changes, check all uses of `lastUserText` below the sanitization block.

**flowChat.ts delegation sessionId does not include user.id — cross-user session collision is possible.**
`flow-${flowId}-${tool.targetNodeId}-${conversationId || threadId}` — `threadId` is client-supplied and unauthenticated. Two different authenticated users sending the same `threadId` to the same flow will share an OpenClaw specialist session. The entry bot session (line 471) correctly includes `user.id`; the delegation sessions do not.
**Why:** Session continuity feature (928950d Apr 2026) focused on same-user replay, missed multi-user isolation.
**How to apply:** Flag any delegation sessionId that uses a client-supplied field (threadId, conversationId) without also incorporating user.id.

**`buildDelegationTools` can emit two tools for the same target when a node has both a `delegates` edge AND a `collaborates` edge to the same peer.**
The collaborates-edge filter added in d4bbff4 runs first; then the delegates-edge filter also matches. The collision suffix logic catches this (emitting `delegate_to_X` and `delegate_to_X_2`) but the LLM now sees two seemingly-different tools for the same bot, which is confusing.
**Why:** The deduplication step checks for name collision, not for targetDeploymentId/targetNodeId collision.
**How to apply:** After building the delegateEdges list, deduplicate on targetNodeId before building tools.

**Module-level cache in React component files causes cross-user data bleed in Next.js.**
`deploymentNameCache` (a module-level `Map`) in `DebugTracePanel.tsx` persists across the server's lifetime. In a Next.js SSR context, all users share the same module instance — so deployment names fetched for user A can be served to user B. Deployment names are low-sensitivity, but this pattern is wrong: caches that hold user-specific data must be per-request or client-only. In this case the component only renders client-side (it's inside a client component), so the immediate risk is low, but the pattern must not be copied to SSR contexts.
**Why:** Confirmed Apr 2026 debug-trace PR review.
**How to apply:** Flag any module-level `Map` or `Set` that stores data returned from a `useQuery` call. Cache should live in component state or React Query's own cache.

**Deactivate-then-insert for "single active" invariants is not atomic without a transaction.**
`createAnnouncement` in `admin.ts` does `UPDATE SET active=false` then `INSERT` in two separate awaits. A concurrent admin request can see two active rows in the gap. Since the announcements table is low-concurrency admin-only, the risk is acceptable, but new code that applies this pattern to high-concurrency tables (e.g., subscriptions, billing) must wrap in `db.transaction()`.
**Why:** Confirmed Apr 2026 admin announcements PR review.
**How to apply:** Flag two-await deactivate+insert sequences outside a transaction when the table is accessed by concurrent callers.

**`delegationResult.uiBlocks` forwarded as TOOL_CALL events without going through `resolveUIBlocks()`.**
In `tamboAgent.ts`, blocks from `executeDelegation` are forwarded directly as `TOOL_CALL_START/ARGS/END` events. The canonical path for self-produced blocks calls `resolveUIBlocks()` first (line ~1842) which resolves custom component definitions from PVC. Delegated blocks bypass this — custom components defined on the callee's pod will render on the entry bot's canvas without their definition. Built-in components are unaffected.
**Why:** Confirmed Apr 2026 canvas forwarding PR review.
**How to apply:** Any place that emits a TOOL_CALL event with `block.props` should call `resolveUIBlocks()` on the block first, or document that only built-in components are expected.

**`stripControlTags` in ConversationHistoryPanel.tsx uses a single regex with mismatched open/close groups for `FLOW SYSTEM INSTRUCTIONS`.**
The opening alternation is `FLOW SYSTEM INSTRUCTIONS[^\]]*` (allows suffix like `— AUTHORITATIVE`) but the closing alternation is `FLOW SYSTEM INSTRUCTIONS` (no suffix). Because the closing tag in practice is `[/FLOW SYSTEM INSTRUCTIONS]` (no suffix), this actually works correctly. But it's fragile: if a closing tag were ever emitted with a suffix, the regex would fail to strip it.
**Why:** Opening tag is `[FLOW SYSTEM INSTRUCTIONS — AUTHORITATIVE]`; closing is `[/FLOW SYSTEM INSTRUCTIONS]`.
**How to apply:** No current bug, but note for reviewers: both the opening and closing alternation groups must be kept in sync if the tag format changes.
