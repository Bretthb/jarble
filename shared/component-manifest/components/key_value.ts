import type { ComponentManifestEntry } from "../types.js";

export const keyValueEntry: ComponentManifestEntry = {
  name: "key_value",
  description: "List of key-value pairs",
  reference: "`{title?, items: [{key, value}]}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 320, h: 220 } },
  loading: "static",
  expensive: false,
  aliases: ["properties", "details"],
  splittable: { into: "card", propsKey: "items" },
  tags: ["data", "key-value", "properties"],
  builtin: true,
  renderOrder: 6,
};
