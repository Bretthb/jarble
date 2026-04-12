---
description: "QA: Memory Scope - Tests global/session/off modes, banner verification, and enforcement. 8 tests, ~2 min."
---

Test memory scope modes end-to-end against dev.jarble.ai. Uses t3 (99i1thbvf1c9) as the test agent.

## Auth Setup
Same as `/qa-bot-teams`.

## Constants
- API: `https://api.jarble.ai`
- TEST_BOT: `99i1thbvf1c9` (t3)

## Tests

### T1: Set global mode
POST `/trpc/deployment.update` with `memoryScope: "global"`. Verify 200.
**PASS**: Update succeeds.

### T2: Verify global banner
Navigate to `/d/99i1thbvf1c9`. Check for memory disclosure banner text containing "remembers things across every chat".
**PASS**: Banner shows global wording.

### T3: Set session mode
POST `/trpc/deployment.update` with `memoryScope: "session"`. Wait 5s for restart.
**PASS**: Update succeeds.

### T4: Verify session banner
Navigate to `/d/99i1thbvf1c9`. Check for banner containing "scoped to this chat" or "best-effort".
**PASS**: Banner shows session wording.

### T5: Set off mode
POST `/trpc/deployment.update` with `memoryScope: "off"`. Wait 5s for restart.
**PASS**: Update succeeds.

### T6: Verify off banner
Navigate to `/d/99i1thbvf1c9`. Check for banner containing "memory is off" or "will not remember".
**PASS**: Banner shows off wording.

### T7: Verify off enforcement
Send message: "Remember that my favorite color is blue"
Check response - agent should say memory is disabled/unavailable.
**PASS**: Agent acknowledges memory is off (doesn't pretend to remember).

### T8: Restore original state
POST `/trpc/deployment.update` with `memoryScope: "global"` (restore default).
**PASS**: Update succeeds.

## Report Format
```
=== QA RESULT: Memory Scope ===
T1-T8: [PASS|FAIL]
SUMMARY: [X/8 passed]
STATUS: [PASS if T1-T7 all pass]
=== END RESULT ===
```
