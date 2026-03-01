import type { ComponentManifestEntry } from "../types.js";

export const cardEntry: ComponentManifestEntry = {
  name: "card",
  description: "Simple card with title, subtitle, and body text",
  reference: "`{title?, subtitle?, body?}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 300, h: 180 } },
  loading: "static",
  expensive: false,
  aliases: ["panel", "box"],
  tags: ["content", "text", "markdown"],
  builtin: true,
  renderOrder: 7,
  promptGuidance: "Body supports markdown. Use for narrative content, guides, explanations.",
};
