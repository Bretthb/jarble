import type { ComponentManifestEntry } from "../types.js";

export const metricCardEntry: ComponentManifestEntry = {
  name: "metric_card",
  description: "Single metric display with optional sparkline chart",
  reference: "`{label, value, change?, changeLabel?, icon?, sparkline?: number[]}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 260, h: 140 } },
  loading: "static",
  expensive: false,
  aliases: ["kpi", "metric", "stat"],
  tags: ["metrics", "kpi", "number", "trend"],
  builtin: true,
  renderOrder: 2,
  promptGuidance: "Single KPI with trend. Use 1-4 individual metric_cards for small metric sets. For 5+, use stat_grid.",
};
