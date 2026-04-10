---
description: "Run ALL QA feature skills in sequence. Reports a consolidated PASS/FAIL summary across 7 features (~53 tests)."
---

Run all QA feature skills in sequence against dev.jarble.ai. Track results and produce a consolidated report.

## Execution Order

Run these skills one at a time, in this order (fastest/safest first):

1. `/qa-config-panel` (browser, ~2 min, no side effects)
2. `/qa-api-keys` (API, ~2 min, restarts bot temporarily)
3. `/qa-memory-scope` (API + browser, ~2 min, modifies t3 config then restores)
4. `/qa-components` (browser + chat, ~3 min, sends chat messages)
5. `/qa-bot-teams` (API + browser, ~3 min, creates/deletes flows)
6. `/qa-delegation` (API, ~5 min, creates flows, tests delegation chains)
7. `/qa-bridge` (API + chat, ~3 min, creates platform state then cleans up)

## Between Skills

After each skill completes, record:
- Skill name
- Duration (seconds)
- Test count: passed / failed / warned / skipped
- Any FAIL details (test ID + brief reason)

If a skill FAILs, **continue to the next skill** (do not abort the run).

## Final Report

After all skills complete, output:

```
=== QA-ALL SUMMARY ===
TIMESTAMP: [ISO date]
TOTAL DURATION: [mm:ss]
ENVIRONMENT: dev.jarble.ai

| Feature        | Tests | Pass | Fail | Warn | Duration |
|----------------|-------|------|------|------|----------|
| config-panel   |  10   |      |      |      |          |
| api-keys       |   7   |      |      |      |          |
| memory-scope   |   8   |      |      |      |          |
| components     |   6   |      |      |      |          |
| bot-teams      |   8   |      |      |      |          |
| delegation     |   9   |      |      |      |          |
| bridge         |   5   |      |      |      |          |
| TOTAL          |  53   |      |      |      |          |

OVERALL: [X/7 features fully passed]

FAILURES:
  - [feature]: T[#] [test name] - [brief reason]

WARNINGS:
  - [feature]: T[#] [test name] - [brief reason]

=== END QA-ALL ===
```

## Rules
- Total time budget: 20 minutes
- If any individual skill hangs for >5 min, abort it and mark all remaining tests as TIMEOUT
- Always run cleanup steps even if tests fail
- This skill is safe to run repeatedly (all test data is prefixed QA-Test- and cleaned up)
