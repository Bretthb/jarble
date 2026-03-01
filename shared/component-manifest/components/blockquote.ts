import type { ComponentManifestEntry } from "../types.js";

export const blockquoteEntry: ComponentManifestEntry = {
  name: "blockquote",
  description: "Styled quote block with attribution",
  reference: "`{text, attribution?, variant?: \"default\"|\"info\"|\"warning\"}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 360, h: 150 } },
  loading: "static",
  expensive: false,
  aliases: ["quote", "citation"],
  tags: ["text", "quote", "citation"],
  builtin: true,
  renderOrder: 7,
};
