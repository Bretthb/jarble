---
description: "QA: Delegation - Tests all 3 edge types, depth limits, cycle detection, error sanitization, and context scope. 9 tests, ~5 min."
---

Test the delegation system end-to-end against dev.jarble.ai.

## Auth Setup
Same as `/qa-bot-teams` - extract token from browser or password grant.

## Constants
- API: `https://api.jarble.ai`
- BOT_T1: `z888fle0j33t`, BOT_T2: `f30qkp1rzy1x`, BOT_T3: `99i1thbvf1c9`

## Tests

### T1: Delegates edge (one-way)
Create 2-node flow: t1→t2 with "delegates" edge. Chat via flow endpoint asking t1 to delegate to t2.
**PASS**: Response contains delegation JSON with `"to": "t2"` and t2's response.

### T2: Collaborates edge (bidirectional)
Create 2-node flow: t1↔t2 with "collaborates" edge. Set t1 as entry. Chat asking t1 to delegate to t2.
Then set t2 as entry. Chat asking t2 to delegate to t1.
**PASS**: Both directions work.

### T3: Reports edge (manager delegates down)
Create 2-node flow: t3 reports to t1 (t3→t1 reports edge). Set t1 as entry (manager).
Chat asking t1 to delegate down to t3 (worker).
**PASS**: t1 can delegate to t3 via the reports edge.

### T4: Parallel delegation (fan-out)
Create flow: t1→t2 delegates AND t1→t3 delegates. Chat asking t1 to delegate to BOTH.
**PASS**: At least 1 delegation fires. WARN if only 1 of 2 fires (prompting issue, not platform bug).

### T5: canDelegate=false blocks tools
Create flow with t1 (canDelegate=false) → t2. Verify `buildDelegationTools` returns empty.
Chat with the flow - verify no delegation events in SSE.
**PASS**: `jarble.flow.delegation.skipped` with `availableToolCount: 0`.

### T6: Error sanitization
Create flow t1→t2 where t2's pod is deliberately stopped. Chat to trigger delegation.
Verify the error message shown to user does NOT contain exec commands, env vars, or session IDs.
**PASS**: Error message is user-friendly (no `kubectl exec`, no `TRACEPARENT=`).

### T7: Delegation with different context scopes
Create flow with `contextScope: "task"` vs `"full"`. Send same message through both.
Verify "task" scope sends only the task text, "full" scope includes conversation history.
**PASS**: Different context scopes produce different delegation payloads.

### T8: Non-existent deployment in edge target
Create flow with a node pointing to `fake-deployment-id`. Try to execute.
**PASS**: Graceful error (not 500 crash). Either flow creation rejects it or execution returns an error.

### T9: Cleanup
Delete all `QA-Test-*` flows. Restart any stopped bots.
**PASS**: All cleanup succeeds.

## Report Format
```
=== QA RESULT: Delegation ===
TIMESTAMP: [ISO]
DURATION: [seconds]
T1-T9: [PASS|FAIL|WARN]
SUMMARY: [X/9 passed]
STATUS: [PASS if T1-T3 all pass]
=== END RESULT ===
```

## Rules
- Time limit: 5 min. Individual test timeout: 90s (except T6 which gets 30s since we expect failure).
- T4 is WARN-eligible (parallel delegation depends on LLM behavior, not platform code).
