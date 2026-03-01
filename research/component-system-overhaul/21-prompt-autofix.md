# Prompt Optimization & AutoFix Prop Repair — Design Document

**Date**: 2026-02-28
**Agent**: prompt-optimizer
**Status**: Complete

---

## Part 1: Prompt Optimization

### Current Token Budget (~3,470 tokens)

| Section | Tokens | Action |
|---------|--------|--------|
| Platform Awareness | ~125 | KEEP |
| Real Data Policy | ~134 | KEEP |
| Jarble UI intro + block types | ~105 | KEEP |
| Design Principles | ~287 | KEEP |
| Dashboard Rendering Order | ~249 | KEEP |
| Layout Hints | ~524 | TRIM (~240 tokens saved) |
| Rendering/Updating/Defining | ~427 | KEEP |
| Interactive Actions | ~44 | KEEP |
| Error Recovery | ~231 | KEEP |
| **Component Quick Reference** | **~1,078** | **TRIM (~638 tokens saved)** |
| Sandbox/Editable/Browser/Memory | ~266 | KEEP |

### Trimmed Approach

**Keep top 10 inline**: chart, data_table, card, metric_card, stat_grid, list, alert, code_block, layout, sandbox

**Remove 26 from inline** (bot calls `component_reference` MCP tool for these): tabs, accordion, form, button_group, timeline, progress, badge, header, divider, key_value, image, image_gallery, carousel, spreadsheet, steps, result, statistic, descriptions, tag_cloud, tree, blockquote, text_message, avatar, audio, video, code_editor

**Layout Hints**: Replace 10-line "Match component to content" guide with 1-line directive.

### Savings

| Change | Tokens Saved |
|--------|-------------|
| Quick Reference: 36 → 10 | ~638 |
| Layout Hints trimming | ~240 |
| **Total per message** | **~878 (25%)** |

At 1,000 msgs/day: ~$78/month saved.

---

## Part 2: AutoFix Prop Repair

### Pipeline

New file: `Jarble-mvp/lib/autoFixProps.ts` (~250-300 lines)

Runs BEFORE Zod `safeParse()` in `CanvasRenderer.tsx`.

### 20 Repair Rules

**Type Coercion (3 rules)**: coerce-number-to-string, coerce-string-to-number, coerce-boolean-strings

**Enum Normalization (3 rules)**: enum-variant-alias (danger→error), chart-type-alias (doughnut→pie), size-enum-alias (small→sm)

**Missing Defaults (3 rules)**: alert-default-variant (→info), steps-default-current (→0), chart-default-xAxisKey (infer from data)

**Structural Fixes (3 rules)**: unwrap-nested-props, wrap-single-to-array, rows-object-to-array

**Field Aliases (4 rules)**: content→body, description→message, name→label, data→items

**Data Normalization (4 rules)**: chart-data-normalize, sparkline-normalize, progress-percent-strip, tree-add-missing-keys

### Component Name Map (30+ aliases)

Casing variants: `DataTable`→`data_table`, `MetricCard`→`metric_card`, etc.
Semantic aliases: `table`→`data_table`, `graph`→`chart`, `kpi`→`metric_card`, etc.

### Guardrails

1. Never invents data — only transforms existing values
2. Never removes fields
3. All repairs logged (dev: console, prod: Sentry breadcrumb)
4. Ambiguous cases skipped
5. If rule fires >50% → fix the prompt instead
