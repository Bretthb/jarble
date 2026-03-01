import type { ComponentManifestEntry } from "../types.js";

export const tabsEntry: ComponentManifestEntry = {
  name: "tabs",
  description: "Tabbed content panels with optional nested child components",
  reference: "`{tabs: [{label, content?, children?: [{component, props}]}], defaultTab?}`",
  category: "interactive",
  layout: { defaultHint: "half", defaultSize: { w: 400, h: 300 } },
  loading: "static",
  expensive: false,
  aliases: ["tab_panel", "tabbed"],
  splittable: { into: "card", propsKey: "tabs" },
  tags: ["navigation", "tabs", "content"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Use for categorized content. Good for multi-topic responses.",
};
