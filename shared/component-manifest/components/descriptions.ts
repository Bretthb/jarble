import type { ComponentManifestEntry } from "../types.js";

export const descriptionsEntry: ComponentManifestEntry = {
  name: "descriptions",
  description: "Key-value description list (Ant Design). Props: title (optional), items (array of {label, value, span?}), columns (optional), bordered (optional boolean).",
  reference: "`{title?, items: [{label, value, span?}], columns?, bordered?}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 320, h: 220 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["description_list", "detail"],
  splittable: { into: "card", propsKey: "items" },
  tags: ["data", "descriptions", "key-value", "details"],
  builtin: true,
  renderOrder: 4,
};
