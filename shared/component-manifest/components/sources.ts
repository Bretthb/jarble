import type { ComponentManifestEntry } from "../types.js";

export const sourcesEntry: ComponentManifestEntry = {
  name: "sources",
  description: "Citation and reference list with expandable snippets",
  reference: '`{items: [{title, url?, snippet?, icon?, relevance?}], title?}`',
  category: "display",
  layout: { defaultHint: "compact", defaultSize: { w: 320, h: 180 } },
  loading: "static",
  expensive: false,
  aliases: ["citations", "references"],
  tags: ["ai", "sources", "citations", "references"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Use to show sources, citations, or references. Each item has a title and optional URL, snippet, icon.",
};
