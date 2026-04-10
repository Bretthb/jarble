---
description: "QA: API Keys - Tests key update, auto-restart, provider detection, and key validation. 7 tests, ~2 min."
---

Test API key management and auto-restart behavior against dev.jarble.ai.

## Auth Setup
Same as `/qa-bot-teams`.

## Constants
- API: `https://api.jarble.ai`
- TEST_BOT: `z888fle0j33t` (t1)

## Tests

### T1: Read current key state
GET deployment by ID. Record current `llmProvider`, `llmMode`, and `hasKey` (boolean from llmApiKey presence).
**PASS**: Deployment data returned with key fields.

### T2: Update API key triggers auto-restart
POST `/trpc/deployment.update` with a new `llmApiKey` value (use the existing valid key).
Wait 5s. GET deployment status.
**PASS**: Status changes from "running" to "creating"/"restarting" within 5s, confirming auto-restart fired.

### T3: Pod comes back running
Wait 30s after T2. GET deployment status again.
**PASS**: Status is "running" (pod restarted successfully with new key).

### T4: Config panel shows key status
Navigate to `/d/z888fle0j33t`. Open Configuration panel. Scroll to Credentials section.
**PASS**: "LLM API Key" shows "Configured" (green text).

### T5: Update API Key button works
Click "Update API Key" in the Credentials section. Verify input field appears.
**PASS**: Password input and Save/Cancel buttons render.

### T6: Provider change triggers restart
POST `/trpc/deployment.update` with `llmProvider: "openai"`. Wait 5s. Check status.
Then revert: POST with `llmProvider: "anthropic"`. Wait for recovery.
**PASS**: Status changes after provider update (auto-restart fires).

### T7: Key validation edge case
POST `/trpc/deployment.update` with `llmApiKey: ""` (empty string).
**PASS**: API rejects with 400 (not 500). Error message mentions "API key is required".

## Report Format
```
=== QA RESULT: API Keys ===
T1-T7: [PASS|FAIL]
SUMMARY: [X/7 passed]
STATUS: [PASS if T1-T4 all pass]
=== END RESULT ===
```

## Notes
- T2-T3 modify bot state (restart). The bot will be briefly unavailable.
- T6 changes provider temporarily. Always revert to anthropic at the end.
- Do NOT change the actual API key to an invalid one - just test the mechanism.
