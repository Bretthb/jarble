import type { ComponentManifestEntry } from "../types.js";

export const tagCloudEntry: ComponentManifestEntry = {
  name: "tag_cloud",
  description: "Collection of colored tags for categorization (antd)",
  reference: "`{tags: [{text, color?, size?: \"small\"|\"medium\"|\"large\"}], title?}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 360, h: 200 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["tags", "categories"],
  tags: ["tags", "categories", "labels"],
  builtin: true,
  renderOrder: 6,
};
