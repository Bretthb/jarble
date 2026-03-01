import type { ComponentManifestEntry } from "../types.js";

export const dividerEntry: ComponentManifestEntry = {
  name: "divider",
  description: "Visual separator with optional label",
  reference: "`{label?, variant?: \"solid\"|\"dashed\"|\"dotted\", spacing?: \"sm\"|\"md\"|\"lg\"}`",
  category: "display",
  layout: { defaultHint: "compact", defaultSize: { w: 300, h: 30 } },
  loading: "static",
  expensive: false,
  aliases: ["separator", "hr"],
  tags: ["separator", "divider", "visual"],
  builtin: true,
  renderOrder: 7,
};
