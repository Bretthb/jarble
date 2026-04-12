---
description: "QA: Agent Teams - Tests team topology creation, edge types, delegation, UI rendering, and edge cases. 8 tests, ~3 min."
---

Test the Agent Teams feature end-to-end against dev.jarble.ai.

## Auth Setup

1. Navigate Playwright to `https://jarble:JarbleDev2026!@dev.jarble.ai/dashboard`
2. Extract auth token via `browser_evaluate`:
   ```js
   () => { const k = Object.keys(localStorage).find(k => k.includes('api.jarble.ai') && !k.includes('@@user@@')); return k ? JSON.parse(localStorage.getItem(k))?.body?.access_token : null; }
   ```
3. If null, use password grant to `https://jarble-dev.us.auth0.com/oauth/token`
4. Store as `$TOKEN`

## Constants

- API: `https://api.jarble.ai`
- BOT_T1: `z888fle0j33t`, BOT_T2: `f30qkp1rzy1x`, BOT_T3: `99i1thbvf1c9`

## Tests

### T1: Create team topology via API
POST `/trpc/flows.create` with 3 nodes (t1 Manager, t2 Specialist, t3 Analyst) and 3 edges (delegates, collaborates, reports). Name: `QA-Test-BotTeam-{timestamp}`.
**PASS**: HTTP 200, flow ID returned. Save as `$FLOW_ID`.

### T2: Read back topology
GET `/trpc/flows.getById` with `$FLOW_ID`. Verify 3 nodes, 3 edges, correct edge types.
**PASS**: Definition matches what was sent.

### T3: Team membership
GET `/trpc/flows.listForDeployment` for BOT_T1. Verify the QA-Test flow appears.
**PASS**: Flow found in membership list.

### T4: Agent Teams UI rendering
Navigate to `/dashboard`, click Agent Teams tab. Verify the QA-Test flow appears in the sidebar. Click it. Take screenshot. Verify ReactFlow renders nodes.
**PASS**: 3 nodes visible in accessibility tree.

### T5: Set Active team
POST `/trpc/deployment.setActiveFlow` for BOT_T1 with `$FLOW_ID`. Verify 200.
Then GET the deployment and check `activeFlowId` matches.
**PASS**: activeFlowId set correctly.

### T6: Delegation fires through topology
POST `/api/flows/$FLOW_ID/chat` with message: "Delegate to your Specialist: reply with exactly QA-DELEGATION-OK"
Wait up to 60s for response. Check for delegation JSON block and specialist response.
**PASS**: Response contains delegation block with `"to"` field and specialist text.

### T7: canDelegate=false prevents delegation
Create a flow with entry node `canDelegate: false`. Chat with it requesting delegation.
Verify no delegation events fire (check for `jarble.flow.delegation.skipped` or no delegation JSON).
**PASS**: No delegation occurred despite edge existing.

### T8: Cleanup
DELETE all `QA-Test-*` flows created during this run (hard delete).
**PASS**: All deletions return 200.

## Report Format

```
=== QA RESULT: Bot Teams ===
TIMESTAMP: [ISO]
DURATION: [seconds]
T1 create-topology:      [PASS|FAIL]
T2 read-topology:        [PASS|FAIL]
T3 team-membership:      [PASS|FAIL]
T4 ui-rendering:         [PASS|FAIL]
T5 set-active:           [PASS|FAIL]
T6 delegation-fires:     [PASS|FAIL]
T7 canDelegate-false:    [PASS|FAIL|WARN]
T8 cleanup:              [PASS|FAIL]
SUMMARY: [X/8 passed]
STATUS: [PASS if T1-T6 all pass]
=== END RESULT ===
```

## Rules
- All flow names start with `QA-Test-` for safe identification
- Do NOT delete flows not created by this test
- Time limit: 3 minutes. Abort hanging tests at 60s
- See `.claude/rules/overnight-qa-policy.md` for mutation policy
