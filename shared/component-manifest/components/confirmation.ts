import type { ComponentManifestEntry } from "../types.js";

export const confirmationEntry: ComponentManifestEntry = {
  name: "confirmation",
  description: "Action confirmation card with approve/reject buttons for sensitive operations",
  reference: "`{title, description, severity: \"info\"|\"warning\"|\"danger\", actions: [{id, label}], confirmationId, timeout?, metadata?}`",
  category: "interactive",
  layout: { defaultHint: "half", defaultSize: { w: 400, h: 200 } },
  loading: "static",
  expensive: false,
  aliases: ["confirm", "approval"],
  tags: ["confirmation", "approval", "action", "interactive"],
  builtin: true,
  renderOrder: 1,
  promptGuidance: "Human-in-the-loop confirmation for sensitive actions. Use confirm_action MCP tool to create these — do NOT render directly via jarble_ui. Shows approve/reject buttons, returns user choice via CONFIRMATION_RESPONSE.",
};
