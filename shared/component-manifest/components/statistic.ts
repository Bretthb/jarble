import type { ComponentManifestEntry } from "../types.js";

export const statisticEntry: ComponentManifestEntry = {
  name: "statistic",
  description: "Large number display with optional countdown (antd)",
  reference: "`{value, title?, prefix?, suffix?, precision?, isCountdown?, countdownTarget?}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 240, h: 120 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["number", "counter"],
  tags: ["number", "statistic", "countdown", "kpi"],
  builtin: true,
  renderOrder: 3,
};
