import type { ComponentManifestEntry } from "../types.js";

export const spreadsheetEntry: ComponentManifestEntry = {
  name: "spreadsheet",
  description: "Editable Excel-like spreadsheet grid",
  reference: "`{data?: [{...}], title?, height?}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 500 } },
  loading: "dynamic",
  expensive: true,
  aliases: ["excel", "sheet"],
  tags: ["data", "spreadsheet", "editable", "grid"],
  builtin: true,
  renderOrder: 10,
};
