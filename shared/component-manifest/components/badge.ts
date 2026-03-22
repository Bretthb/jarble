import type { ComponentManifestEntry } from "../types.js";

export const badgeEntry: ComponentManifestEntry = {
  name: "badge",
  description: "Small label/tag with variant styling",
  reference: "`{text, variant?: \"default\"|\"secondary\"|\"destructive\"|\"outline\"|\"success\"|\"warning\"|\"info\", icon?}`",
  category: "display",
  layout: { defaultHint: "compact", defaultSize: { w: 180, h: 50 } },
  loading: "static",
  expensive: false,
  aliases: ["tag", "chip", "label"],
  tags: ["status", "label", "indicator"],
  builtin: true,
  renderOrder: 3,
  promptGuidance: "Small status label or tag. Use for status indicators, categories, or inline labels. Variants: default, secondary, destructive, outline, success, warning, info.",
};
