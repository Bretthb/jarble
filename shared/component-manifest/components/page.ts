import type { ComponentManifestEntry } from "../types.js";

export const pageEntry: ComponentManifestEntry = {
  name: "page",
  description: "Full-screen multi-component page layout (dashboard, kanban, CRM, settings, etc.)",
  reference: "`{type: \"dashboard\"|\"settings\"|\"kanban\"|\"crm\"|\"landing\"|\"data_explorer\"|\"form_wizard\", title: string, sections: Record<string, Component[]>, navigation?: {tabs?: string[]}}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 800, h: 600 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["dashboard", "fullscreen", "app"],
  tags: ["page", "layout", "dashboard", "fullscreen"],
  builtin: true,
  renderOrder: 0,
  promptGuidance: "Use for complex multi-section layouts like dashboards, settings panels, kanban boards. Opens in fullscreen overlay. Can be ungrouped back to individual cards.",
};
