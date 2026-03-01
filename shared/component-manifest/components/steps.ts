import type { ComponentManifestEntry } from "../types.js";

export const stepsEntry: ComponentManifestEntry = {
  name: "steps",
  description: "Step-by-step progress indicator (Ant Design)",
  reference: "`{current, items: [{title, description?, icon?}], direction?: \"vertical\"|\"horizontal\"}`",
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 460, h: 120 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["wizard", "stepper", "process"],
  tags: ["progress", "steps", "wizard", "process"],
  builtin: true,
  renderOrder: 4,
  promptGuidance: "Use for process/wizard steps with current progress indicator.",
};
