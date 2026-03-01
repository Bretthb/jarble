import type { ComponentManifestEntry } from "../types.js";

export const progressEntry: ComponentManifestEntry = {
  name: "progress",
  description: "Progress bar with label and percentage",
  reference: "`{label?, value: 0-100, variant?: \"default\"|\"success\"|\"warning\"|\"error\"}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 280, h: 90 } },
  loading: "static",
  expensive: false,
  aliases: ["progress_bar", "loading"],
  tags: ["progress", "percentage", "status"],
  builtin: true,
  renderOrder: 3,
};
