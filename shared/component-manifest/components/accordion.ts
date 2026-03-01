import type { ComponentManifestEntry } from "../types.js";

export const accordionEntry: ComponentManifestEntry = {
  name: "accordion",
  description: "Collapsible sections with titles and content",
  reference: "`{items: [{title, content?, children?, defaultOpen?}], type?: \"single\"|\"multiple\"}`",
  category: "interactive",
  layout: { defaultHint: "half", defaultSize: { w: 400, h: 300 } },
  loading: "static",
  expensive: false,
  aliases: ["collapsible", "expandable"],
  tags: ["navigation", "collapsible", "faq"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Use for multi-step processes, FAQs, or content that benefits from progressive disclosure.",
};
