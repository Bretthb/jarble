import type { ComponentManifestEntry } from "../types.js";

export const dataTableEntry: ComponentManifestEntry = {
  name: "data_table",
  description: "Table with column headers and data rows",
  reference: "`{title?, columns: string[], rows: (string|number|boolean|null)[][]}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 460, h: 300 } },
  loading: "static",
  expensive: false,
  aliases: ["table", "grid"],
  splittable: { into: "data_table", propsKey: "rows" },
  tags: ["data", "tabular", "rows", "columns"],
  builtin: true,
  renderOrder: 6,
  promptGuidance: "Use for structured tabular data ONLY. Use full-width hint for tables with 6+ columns.",
};
