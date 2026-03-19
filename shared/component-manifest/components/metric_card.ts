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
  promptGuidance: "ONLY for a standalone single KPI display. For dashboards or requests with charts+metrics together, use sandbox instead — build everything in one sandbox.",
};
