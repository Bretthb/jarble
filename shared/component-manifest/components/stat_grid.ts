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
  promptGuidance: "ONLY for a standalone metrics display with no charts. For dashboards or analytics requests, use sandbox instead — build KPIs + charts together in one sandbox.",
};
