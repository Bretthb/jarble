import type { ComponentManifestEntry } from "../types.js";

export const treeEntry: ComponentManifestEntry = {
  name: "tree",
  description: "Expandable tree hierarchy",
  reference: "`{data: [{title, key, children?}], title?, defaultExpandAll?}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 360, h: 300 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["hierarchy", "tree_view", "file_tree"],
  tags: ["data", "tree", "hierarchy", "nested"],
  builtin: true,
  renderOrder: 6,
};
