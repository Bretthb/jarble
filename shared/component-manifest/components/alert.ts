import type { ComponentManifestEntry } from "../types.js";

export const alertEntry: ComponentManifestEntry = {
  name: "alert",
  description: "Notification banner (info, success, warning, error)",
  reference: "`{title?, message, variant: \"info\"|\"success\"|\"warning\"|\"error\"}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 340, h: 100 } },
  loading: "static",
  expensive: false,
  aliases: ["notification", "notice", "warning"],
  tags: ["status", "notification", "message"],
  builtin: true,
  renderOrder: 3,
  promptGuidance: "Use for status messages, warnings, and notices.",
};
