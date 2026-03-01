import type { ComponentManifestEntry } from "../types.js";

export const timelineEntry: ComponentManifestEntry = {
  name: "timeline",
  description: "Chronological event timeline with status indicators",
  reference: "`{title?, events: [{label, description?, timestamp?, icon?, status?: \"completed\"|\"active\"|\"pending\"}]}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 320, h: 280 } },
  loading: "static",
  expensive: false,
  aliases: ["history", "events", "changelog"],
  splittable: { into: "card", propsKey: "events" },
  tags: ["timeline", "history", "events", "chronological"],
  builtin: true,
  renderOrder: 4,
  promptGuidance: "Use for history, changelogs, or any chronological sequence of events.",
};
