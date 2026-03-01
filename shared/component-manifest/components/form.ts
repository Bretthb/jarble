import type { ComponentManifestEntry } from "../types.js";

export const formEntry: ComponentManifestEntry = {
  name: "form",
  description: "Input form with text, email, textarea, select, checkbox, number fields — dispatches UI_ACTION on submit",
  reference: "`{title?, fields: [{name, label, type: \"text\"|\"email\"|\"textarea\"|\"select\"|\"checkbox\"|\"number\", placeholder?, required?, options?, defaultValue?}], submitLabel?}`",
  category: "interactive",
  layout: { defaultHint: "half", defaultSize: { w: 360, h: 320 } },
  loading: "static",
  expensive: false,
  aliases: ["input", "survey"],
  tags: ["interactive", "form", "input", "data_entry"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Use for user input collection. Dispatches UI_ACTION on submit.",
};
