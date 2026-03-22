import type { ComponentManifestEntry } from "../types.js";

export const chartEntry: ComponentManifestEntry = {
  name: "chart",
  description: "Bar, line, pie, or area chart (Recharts)",
  reference: "`{type: \"bar\"|\"line\"|\"pie\"|\"area\", data: [{...}], dataKeys: string[], xAxisKey?, title?, colors?, stacked?, showLegend?, showGrid?}`",
  category: "chart",
  layout: { defaultHint: "half", defaultSize: { w: 460, h: 300 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["graph", "plot", "visualization"],
  tags: ["data", "visualization", "chart", "graph"],
  builtin: true,
  renderOrder: 5,
  promptGuidance: "AVOID — use sandbox instead for better results. Sandbox gives you Chart.js/D3 with full styling control. Only use this typed chart as a last resort for the simplest possible single chart.",
};
