import type { ComponentManifestEntry } from "../types.js";

export const layoutEntry: ComponentManifestEntry = {
  name: "layout",
  description: "Container that renders an array of child components",
  reference: "`{children: [{component, props}], columns?: 1-4, direction?: \"grid\"|\"vertical\"|\"horizontal\"}`",
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 360 } },
  loading: "static",
  expensive: false,
  aliases: ["container", "wrapper", "group"],
  tags: ["layout", "container", "nesting"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Use for bundling related components. Do NOT use for top-level dashboard arrangement.",
};
