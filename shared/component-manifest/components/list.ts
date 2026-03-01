import type { ComponentManifestEntry } from "../types.js";

export const listEntry: ComponentManifestEntry = {
  name: "list",
  description: "Structured list with optional icons, descriptions, and badges",
  reference: "`{title?, items: [{text, description?, icon?, badge?, badgeVariant?}], ordered?}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 320, h: 260 } },
  loading: "static",
  expensive: false,
  aliases: ["items", "bullet_list"],
  splittable: { into: "card", propsKey: "items" },
  tags: ["list", "items", "enumeration"],
  builtin: true,
  renderOrder: 6,
  promptGuidance: "Use for inventories, feature lists, or any enumerated content with rich formatting.",
};
