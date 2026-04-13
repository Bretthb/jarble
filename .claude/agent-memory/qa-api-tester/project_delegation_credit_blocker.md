---
name: Delegation system credit balance blocker
description: The ops@jarble.ai account has insufficient Anthropic API credits — delegation fires correctly but LLM calls fail, so end-to-end delegation cannot be fully verified
type: project
---

The bot teams delegation framework is structurally correct and working at the API layer, but the ops@jarble.ai account has a zero/negative credit balance on Anthropic. As a result:

- Flow chat endpoints return `"LLM request rejected: Your credit balance is too low to access the Anthropic API."`
- Flow execute endpoints charge 1 credit per node but the bot response is the credit error string
- Delegation tools ARE built and present (`jarble.flow.delegation.skipped` event fires with correct tool names)
- The `tool_call_not_emitted` reason means the LLM never got to produce output before the credit error hit

**Why:** The jarble-dev environment's agent credits bill to Anthropic directly. The test account has no balance.

**How to apply:** When testing delegation end-to-end (actual bot-to-bot message passing), do not use flow chat or flow execute — those require LLM credits. Instead verify delegation at the structural level: check that `jarble.flow.delegation.skipped` fires with the correct `availableTools` array reflecting the edge topology, which confirms the delegation wiring is correct.
