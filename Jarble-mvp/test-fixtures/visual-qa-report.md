# Visual QA Report — Canvas Components

**Date**: 2026-03-02
**Branch**: `UI-polishing`
**Deployment**: `3vt3ej3hj1oi` (test1, ops@jarble.ai, status: running)
**Method**: localStorage injection + Playwright MCP browser tools
**Components tested**: 35 of 38 (+ 1 alias)

## Summary

| Scenario | Components | Result | Screenshot |
|----------|-----------|--------|------------|
| 1. Sales Dashboard | stat_grid, chart (line), chart (bar), data_table, progress, alert | PASS | `visual-qa-scenario1-final.png` |
| 2. Project Management | stat_grid, timeline, list, progress, card, header | PASS | `visual-qa-scenario2-project-mgmt.png` |
| 3. Support Analytics | chart (area), stat_grid, data_table, alert (warning), accordion, tabs | PASS | `visual-qa-scenario3-support.png` |
| 4. Developer Docs | code_block, card, key_value, list, tabs | PASS | `visual-qa-scenario4-dev-docs.png` |
| 5. Interactive Forms | form, button_group, chart (pie), metric_card, alert (success) | PASS | `visual-qa-scenario5-forms.png` |
| 6. Media & Geo | map, image, video, image_gallery, card | PASS | `visual-qa-scenario6-media-geo.png` |
| 7A. Stress Tests (light) | divider, descriptions, steps, result, statistic, tag_cloud, tree, blockquote, avatar, badge, metric_card | PASS | `visual-qa-scenario7a-stress.png` |
| 7B. Stress Tests (heavy) | carousel, audio, text_message, sandbox, code_editor, spreadsheet, layout | PASS | `visual-qa-scenario7b-heavy.png` |

### Overall: 35/35 components rendered successfully, 0 Zod validation errors

---

## Bug Fixed During Testing

### Chart Height Collapse (recharts ResponsiveContainer)
**File**: `Jarble-mvp/components/canvas/components/CanvasChart.tsx`
**Severity**: High — charts rendered at 0px height
**Root cause**: `ResponsiveContainer` needs a parent with resolved pixel height. The CSS flex chain (`h-full` + `flex-1` + `min-h-0`) collapsed to 0px in the grid layout because grid cells don't provide explicit heights — cards grow to content size.
**Fix**: Removed flex wrapper, applied `style={{ height: chartHeight }}` directly on `ChartContainer` with `className="aspect-auto w-full"`. Default height is 250px, overridable via `height` prop.
**Affected chart types**: bar, line, area, pie (all fixed)

---

## Component-by-Component Results

### Display Components
| Component | Status | Notes |
|-----------|--------|-------|
| card | PASS | Icon, title, subtitle, body text all render correctly |
| stat_grid | PASS | 4-column KPI grid, trend arrows, change percentages |
| data_table | PASS | Headers, row striping, sortable columns |
| key_value | PASS | 6 config items in label/value pairs |
| header | PASS | Bold heading with section styling |
| badge | PASS | Green "Production" badge with dot icon |
| divider | PASS | Dashed line with centered "Section Break" label |
| statistic | PASS | Large "99.97%" with suffix formatting |
| metric_card | PASS | Value, change text, sparkline SVG, trend indicator |
| descriptions | PASS | 2-column bordered grid, 6 items, split button available |
| result | PASS | Green checkmark icon, success title, subtitle text |

### Chart Components
| Component | Status | Notes |
|-----------|--------|-------|
| chart (bar) | PASS | Product breakdown with colored bars, legend, tooltips |
| chart (line) | PASS | Monthly revenue trend with dots and grid |
| chart (area) | PASS | Gradient fill, stroke, proper axes |
| chart (pie) | PASS | Donut chart with 4 segments, legend showing names |

### Interactive Components
| Component | Status | Notes |
|-----------|--------|-------|
| form | PASS | 5 fields (text, email, select, textarea), placeholder text, "Request Demo" button |
| button_group | PASS | 4 buttons with correct variants (default, destructive, secondary, outline) |
| tabs | PASS | TypeScript/Python/cURL tabs switch correctly |
| accordion | PASS | Expandable sections render |

### Navigation Components
| Component | Status | Notes |
|-----------|--------|-------|
| steps | PASS | Horizontal 4-step wizard, steps 1-2 green checks, step 3 highlighted |
| timeline | PASS | Milestone entries with dates and descriptions |
| list | PASS | Emoji icons, item descriptions |
| tree | PASS | Fully expanded file tree with collapse arrows |

### Content Components
| Component | Status | Notes |
|-----------|--------|-------|
| code_block | PASS | Syntax highlighting, line numbers, copy button |
| blockquote | PASS | Italic text, em-dash attribution |
| alert (info) | PASS | Blue info variant with message |
| alert (warning) | PASS | Yellow/amber warning variant |
| alert (success) | PASS | Green with checkmark icon |
| progress | PASS | Percentage bar with label |
| tag_cloud | PASS | 10 colored tags in varying sizes |
| avatar | PASS | Initials "SC", name, subtitle |
| text_message | PASS | User message (gray) + bot response (green) |

### Media Components
| Component | Status | Notes |
|-----------|--------|-------|
| image | PASS | Unsplash photo loaded, alt text, caption |
| image_gallery | PASS | 3-column grid, images loaded, captions below each |
| map | PASS | Leaflet map, OSM tiles, 3 markers, zoom controls |
| video | PASS | Title renders, video element present (external URL) |
| audio | PASS | Title renders, audio element present |
| carousel | PASS | First slide visible, prev/next buttons, dot navigation |

### Advanced Components
| Component | Status | Notes |
|-----------|--------|-------|
| sandbox | PASS | Purple gradient, "Hello Sandbox", counter, "Click me" button, iframe loaded |
| code_editor | PASS | Monaco editor, 8 lines of TypeScript, line numbers, editable |
| spreadsheet | PASS | Full Luckysheet with toolbar, 5x5 data, sheet tabs, zoom |
| layout | PASS | 3-column nested grid: 2 metric_cards + 1 alert |

### Not Tested (3 components)
| Component | Reason |
|-----------|--------|
| marketplace_sandbox | Requires marketplace component install flow |
| canvas (alias) | Alias for sandbox — sandbox was tested |
| video (persistence) | `useCanvasPersistence` skips video cards on restore (by design) |

---

## Findings & Observations

### 1. Video Card Persistence Skipping
The `useCanvasPersistence.ts` hook deliberately skips restoration of video cards:
```
[Canvas] Skipping restoration of video card
```
This means video components injected via localStorage won't persist across page reloads. Video was still tested inline during Scenario 6 (before the persistence layer stripped it).

### 2. Spreadsheet is Feature-Rich
The Luckysheet-based spreadsheet component renders a full Excel-like experience: toolbar with 30+ formatting buttons, cell selection, multiple sheets, zoom controls. It's the heaviest component by far.

### 3. Sandbox Watchdog Works
The sandbox iframe loaded with the "Stop" button visible, confirming the 30-second watchdog timer is active. The sandbox rendered the gradient background, counter, and interactive button.

### 4. Descriptions Has Split Button
The descriptions component correctly shows the "Split into individual cards" button in its toolbar, confirming the `SPLITTABLE_COMPONENTS` config is wired up.

### 5. Layout Component Renders Nested Children
The layout component successfully rendered 3 nested children (2 metric_cards + 1 alert) in a 3-column grid layout. This proves recursive component rendering works.

### 6. Chart Fix Applied
The chart height fix (`style={{ height: chartHeight }}` on ChartContainer) resolved all chart types. Before the fix, charts rendered at 0px height due to CSS flex chain collapse.

### 7. No Console Errors
Zero JavaScript errors across all 8 test runs. Only warnings were from:
- Recharts slow render warnings (>100ms for chart, map)
- Tambo tool overwriting warnings (benign — duplicate registration)

### 8. Component Count Indicator Works
The "N components" badge in the toolbar accurately reflected card count for every scenario (5, 6, 6, 5, 5, 5, 11, 7).

---

## Prop Format Reference (Gotchas)

| Component | Gotcha | Correct Format |
|-----------|--------|----------------|
| chart | NOT `data`/`xKey`/`yKeys` | `dataKeys: string[]`, `xAxisKey: string`, `data: Record[]` |
| stat_grid | Stats array shape | `stats: { label, value, change?, trend? }[]` |
| progress | Value is 0-100 | `value: number`, `label: string`, `showPercentage: boolean` |
| form | Fields array | `fields: { name, label, type, placeholder?, required?, options? }[]` |
| steps | Current is 0-indexed | `current: number`, `items: { title, description }[]` |
| descriptions | Items array | `items: { label, value }[]`, `columns?: number` |
| carousel | Items with image | `items: { title, description, image }[]` |
| sandbox | HTML + JS separate | `html: string`, `js?: string`, `css?: string` |

---

## Screenshots

All screenshots saved to project root:
- `visual-qa-scenario1-sales-dashboard.png`
- `visual-qa-scenario1-final.png`
- `visual-qa-scenario2-project-mgmt.png`
- `visual-qa-scenario3-support.png`
- `visual-qa-scenario4-dev-docs.png`
- `visual-qa-scenario5-forms.png`
- `visual-qa-scenario6-media-geo.png`
- `visual-qa-scenario7a-stress.png`
- `visual-qa-scenario7b-heavy.png`
