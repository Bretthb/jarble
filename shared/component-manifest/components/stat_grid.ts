import type { ComponentManifestEntry } from "../types.js";

export const statGridEntry: ComponentManifestEntry = {
  name: "stat_grid",
  description: "Grid of metric cards with labels, values, and optional change indicators",
  reference: "`{stats: [{label, value, change?, icon?}]}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 400, h: 200 } },
  loading: "static",
  expensive: false,
  aliases: ["metrics", "kpi_grid"],
  splittable: { into: "metric_card", propsKey: "stats" },
  tags: ["metrics", "kpi", "statistics", "numbers"],
  builtin: true,
  renderOrder: 2,
  promptGuidance: "Compact grid of 5+ metrics. For 1-4 metrics, use individual metric_card components instead.",
};
