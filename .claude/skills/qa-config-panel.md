---
description: "QA: Config Panel - Tests all configuration sections render and edit round-trip works. 10 tests, ~2 min."
---

Test the deployment Configuration panel via Playwright against dev.jarble.ai.

## Setup
Navigate to `https://jarble:JarbleDev2026!@dev.jarble.ai/d/z888fle0j33t` (t1's chat page).
Click the "Configuration" button in the toolbar.

## Tests

### T1: Panel opens
Click Configuration button. Verify panel appears with "Configuration" heading and "Quick actions & OpenClaw CLI" subtitle.
**PASS**: Panel renders with header.

### T2: Tabs present
Verify two tabs: "Config" (selected) and "OpenClaw CLI".
**PASS**: Both tabs visible.

### T3: Status section
Verify status indicator shows (e.g., "running") and provider name.
**PASS**: Status and provider text visible.

### T4: Lifecycle buttons
Verify Start, Restart, Stop buttons are present.
**PASS**: All 3 buttons in the grid.

### T5: Provider dropdown
Verify provider dropdown shows options: Anthropic, OpenAI, Google, OpenRouter.
**PASS**: Dropdown with 4 options.

### T6: Model dropdown
Verify model dropdown shows models for current provider (e.g., Claude Opus 4.6, Sonnet 4.6, etc.).
**PASS**: Model options present.

### T7: System prompt textarea
Verify system prompt textarea is present with placeholder text.
**PASS**: Textarea element found.

### T8: Memory scope selector
Verify memory scope dropdown with Global/Per-session/Off options and description text.
**PASS**: Dropdown with 3 options and explanatory text.

### T9: Credentials section
Scroll down. Verify "Credentials" heading exists with LLM API Key status indicator.
**PASS**: Credentials section renders with key status (Configured/Not set).

### T10: Delegation budget field
Verify delegation budget input with $/turn label.
**PASS**: Number input with currency label.

## Verification Method
Use `browser_snapshot` after opening the panel. Check accessibility tree for each element.
Take `browser_screenshot` for visual record.

## Report Format
```
=== QA RESULT: Config Panel ===
T1-T10: [PASS|FAIL]
SUMMARY: [X/10 passed]
STATUS: [PASS if T1-T9 all pass]
=== END RESULT ===
```
