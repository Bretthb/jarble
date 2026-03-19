import type { ComponentManifestEntry } from "../types.js";

export const buttonGroupEntry: ComponentManifestEntry = {
  name: "button_group",
  description: "Row of action buttons that dispatch UI_ACTION callbacks on click",
  reference: "`{buttons: [{id, label, variant?: \"default\"|\"secondary\"|\"destructive\"|\"outline\", icon?, disabled?}]}`",
  category: "interactive",
  layout: { defaultHint: "third", defaultSize: { w: 300, h: 70 } },
  loading: "static",
  expensive: false,
  aliases: ["actions", "buttons"],
  tags: ["interactive", "buttons", "actions"],
  builtin: true,
  renderOrder: 9,
  promptGuidance: "Row of clickable action buttons. Each click dispatches a UI_ACTION event with the button's id. Use for option selection, quick actions, or navigation.",
};
