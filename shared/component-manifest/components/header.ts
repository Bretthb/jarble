import type { ComponentManifestEntry } from "../types.js";

export const headerEntry: ComponentManifestEntry = {
  name: "header",
  description: "Section heading with optional subtitle and divider",
  reference: "`{title, subtitle?, level?: 1|2|3, divider?}`",
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 360, h: 70 } },
  loading: "static",
  expensive: false,
  aliases: ["heading", "title", "section_header"],
  tags: ["heading", "title", "section"],
  builtin: true,
  renderOrder: 1,
  promptGuidance: "Always emit first if present. Use for dashboard/section titles.",
};
