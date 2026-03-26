---
description: "Run the agentic QA system locally using your Max subscription. Tests the live platform at dev.jarble.ai."
---

Run a local QA cycle against the live Jarble platform. This uses your Claude Max subscription (no API key cost).

Execute this command:
```bash
node scripts/nightly-qa/overnight-agent.mjs --cycles 1 --max-budget 15 --verbose
```

This will:
1. Health check dev.jarble.ai and api.jarble.ai
2. Fetch an auth token via password grant
3. Spawn the qa-orchestrator agent which reads git diff, generates test goals, and dispatches specialist agents (qa-explorer-ui, qa-api-tester, qa-chaos)
4. Collect results and update agent memory
5. Output a structured summary

The report will be saved to `scripts/nightly-qa/reports/` and a dashboard HTML will be generated.

If the user provides a focus area, add `--focus "<area>"` to the command.
