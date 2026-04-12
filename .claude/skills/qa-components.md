---
description: "QA: Components - Tests rendering of stat_grid, data_table, chart, sandbox with edge case props. 6 tests, ~3 min."
---

Test canvas component rendering end-to-end against dev.jarble.ai using Playwright.

## Auth Setup
Navigate Playwright to `https://jarble:JarbleDev2026!@dev.jarble.ai/d/z888fle0j33t` (t1's chat page).

## Tests

### T1: stat_grid with icons and change indicators
Send: "Render a stat_grid with: Revenue $12,345 (icon: dollar-sign, change: +12%), Users 1,234 (icon: users, change: +5%), Orders 567 (icon: shopping-cart, change: -3%), Rating 4.8 (icon: star, change: +0.2)"
Wait 40s. Check canvas grid for `stat_grid` component.
**PASS**: stat_grid renders with 4 items. Icons show as SVG images (not plain text). Change badges visible.

### T2: data_table with realistic data
Send: "Create a data_table of 5 employees with columns: Name, Role, Department, Salary, Start Date"
Wait 40s. Check canvas for `data_table` component.
**PASS**: Table renders with 5 rows and column headers. Row count indicator shows "5 rows".

### T3: chart rendering
Send: "Show a bar chart of monthly revenue: Jan 45k, Feb 52k, Mar 48k, Apr 61k, May 55k, Jun 70k"
Wait 40s. Check canvas for chart component.
**PASS**: Chart component appears on canvas (any chart type acceptable).

### T4: sandbox interactive component
Send: "Create a sandbox with an interactive counter: a number display and +/- buttons"
Wait 40s. Check canvas for sandbox iframe.
**PASS**: Sandbox renders with an iframe element.

### T5: Edge case - numeric change value (previously crashed)
Send: "Render a stat_grid with: metric1 value=100 change=5, metric2 value=200 change=-3"
Wait 30s. Check canvas.
**PASS**: stat_grid renders without "r.startsWith is not a function" crash. Change values display as strings.

### T6: Edge case - missing optional props
Send: "Render a stat_grid with just two items: active=42, idle=8. No icons, no changes."
Wait 30s. Check canvas.
**PASS**: stat_grid renders with 2 items. No crash from missing icon/change props.

## Verification Method
After each message:
1. Wait for streaming to complete (send button re-enables)
2. Take `browser_snapshot` - check for component in the grid (gridcell, table, list elements)
3. Take `browser_screenshot` for visual record
4. Check console for errors (any `TypeError` or `Error boundary` = FAIL)

## Report Format
```
=== QA RESULT: Components ===
TIMESTAMP: [ISO]
DURATION: [seconds]
T1 stat-grid-icons:    [PASS|FAIL]
T2 data-table:         [PASS|FAIL]
T3 chart:              [PASS|FAIL]
T4 sandbox:            [PASS|FAIL]
T5 numeric-change:     [PASS|FAIL]
T6 missing-props:      [PASS|FAIL]
SUMMARY: [X/6 passed]
STATUS: [PASS if T1-T4 all pass]
=== END RESULT ===
```

## Rules
- Use t1 for all tests (or whichever agent has credits)
- Start a new conversation for each test to avoid canvas carryover
- Time limit: 3 min total. Individual test: 45s max wait.
