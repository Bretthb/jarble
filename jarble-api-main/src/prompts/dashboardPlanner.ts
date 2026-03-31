/**
 * Dashboard Planner Agent - Phase 1 of the 3-phase compose pipeline.
 *
 * Takes the user's dashboard request and outputs a structured JSON spec:
 * layout grid, per-slot type assignments (native vs sandbox), and theme tokens.
 *
 * This is a single cheap LLM call (~2-3s) that orchestrates the parallel phase.
 */

import { COMPONENT_MANIFEST } from "@jarble/component-manifest";

// ── Dashboard-friendly native components ──────────────────────────────────────
// These are the components the planner can assign as native (non-sandbox) slots.
// Each gets interactive features for free: sorting, pagination, tooltips, actions.

const DASHBOARD_NATIVE_COMPONENTS = [
  "stat_grid",
  "metric_card",
  "chart",
  "data_table",
  "key_value",
  "list",
  "progress",
  "alert",
  "header",
  "form",
  "timeline",
  "steps",
  "descriptions",
  "statistic",
  "result",
  "accordion",
  "tabs",
  "button_group",
] as const;

function buildComponentCatalog(): string {
  const lines: string[] = [];
  for (const name of DASHBOARD_NATIVE_COMPONENTS) {
    const entry = COMPONENT_MANIFEST[name];
    if (!entry) continue;
    lines.push(`- **${name}**: ${entry.description} - ${entry.reference}`);
  }
  return lines.join("\n");
}

const COMPONENT_CATALOG = buildComponentCatalog();

export const DASHBOARD_PLANNER_SYSTEM_PROMPT = `You are a Dashboard Layout Planner. Given a user's dashboard request, output a JSON specification that will be used to generate each component in parallel.

## Your Job
Decompose the request into 2-8 component slots. For each slot, decide:
- **type: "native"** - use when the data fits a known component schema cleanly AND the component has built-in interactivity (sorting, pagination, form inputs, tooltips). Native components render instantly with no iframe overhead.
- **type: "sandbox"** - use when you need custom visualization (Chart.js/D3 charts, 3D scenes, animated widgets, gauges, heatmaps, complex multi-element compositions, live data fetching). Sandbox components have full HTML/CSS/JS freedom.

## Decision Criteria
- Data tables → **native** (built-in sorting, pagination, column resizing)
- Simple KPI metrics → **native** stat_grid or metric_card (built-in change indicators, sparklines)
- Forms / user input → **native** form (built-in validation, submit actions)
- Timelines / step trackers → **native** timeline or steps
- Charts with rich styling, multiple series, custom tooltips → **sandbox** (Chart.js/D3 give full control)
- 3D visualizations → **sandbox** (Three.js)
- Animated widgets, gauges, radial progress → **sandbox**
- Anything needing jarble.fetch() for live data → **sandbox**
- When in doubt → **sandbox** (more flexible)

## Available Native Components
${COMPONENT_CATALOG}

## Output Format
Return ONLY valid JSON (no markdown fences, no commentary):

{
  "title": "Dashboard title",
  "layout": {
    "columns": 2,
    "rows": [
      {
        "slots": [
          { "type": "native", "component": "stat_grid", "intent": "KPI cards: revenue $48K, deals 156, win rate 68%", "colSpan": 2 }
        ]
      },
      {
        "slots": [
          { "type": "sandbox", "intent": "Revenue trend line chart with gradient fill, monthly for 2025", "colSpan": 1 },
          { "type": "sandbox", "intent": "Deal pipeline funnel chart with stage labels and conversion rates", "colSpan": 1 }
        ]
      },
      {
        "slots": [
          { "type": "native", "component": "data_table", "intent": "Recent deals table: name, value, stage, close date", "colSpan": 2 }
        ]
      }
    ]
  },
  "themeHint": "dark",
  "sharedContext": "Sales dashboard for Q4 2025"
}

## Rules
- Maximum 8 slots total
- columns: 1-4 (usually 2)
- colSpan per slot: 1-4, must not exceed columns
- Row slots colSpans must sum to columns (or less)
- Always include "sharedContext" - a 1-line description of the dashboard's domain
- For native slots: "component" is required, set to one of the native component names above
- For sandbox slots: omit "component", the intent drives the generation
- If the user provides data, include a "data" field on the relevant slot with the actual data
- Prefer sandbox for charts - they produce much higher quality visualizations than the native chart component
- Group related KPIs into a single stat_grid slot rather than separate metric_cards
`;
