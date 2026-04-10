---
description: "QA: Bridge - Tests Jarble-OpenClaw bridge MCP tools: register-agent, store-secret, list-team, log-action. 5 tests, ~3 min."
---

Test the Jarble-OpenClaw Bridge platform MCP tools end-to-end against dev.jarble.ai. These tools let bots register their actions on the platform.

## Auth Setup
Same as `/qa-bot-teams`.

## Constants
- API: `https://api.jarble.ai`
- BOT_T1: `z888fle0j33t`

## Tests

### T1: platform_list_team
Send chat to t1: "Use the platform_list_team tool to show me your team members"
**PASS**: Response includes team member names or "not on any teams" if no active flow.

### T2: platform_log_action
Send chat to t1: "Use the platform_log_action tool to log an action called QA-Test-Action with details 'bridge test'"
Then check Debug Traces panel or `deployment.listRecentTraces` for a `bot_action` entry.
**PASS**: Action appears in traces with `skillName: "QA-Test-Action"`.

### T3: platform_register_agent
Send chat to t1: "Use the platform_register_agent tool to register a subagent with name 'QA Test Agent', slug 'qa-test-agent', description 'QA bridge test'"
Then check Subagents panel or query the deployment for subagents.
**PASS**: Subagent appears in the deployment's subagents list.

### T4: platform_store_secret
Send chat to t1: "Use the platform_store_secret tool to store a credential with key QA_TEST_KEY and value test-value-123"
Then check Config panel credentials section or `deployment.getEnvVarMap`.
**PASS**: Secret appears in the env var map with source "agent".

### T5: Cleanup
- Delete the QA Test Agent subagent via API
- Delete the QA_TEST_KEY secret via API
**PASS**: Both cleanup calls succeed.

## Report Format
```
=== QA RESULT: Bridge ===
T1-T5: [PASS|FAIL]
SUMMARY: [X/5 passed]
STATUS: [PASS if T1-T4 all pass]
=== END RESULT ===
```

## Notes
- These tests send real chat messages to bots, which costs credits
- The bot must have the new MCP server deployed (with platform_* tools)
- If bot doesn't recognize the tool, report FAIL with note "bridge not deployed"
