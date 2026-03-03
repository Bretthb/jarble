import type { ComponentManifestEntry } from "../types.js";

export const toolEntry: ComponentManifestEntry = {
  name: "tool",
  description: "Function/tool call visualization with inputs, status, and outputs",
  reference: '`{name, status: "running"|"complete"|"error", description?, inputs?, output?, error?, duration?}`',
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 140 } },
  loading: "static",
  expensive: false,
  aliases: ["function_call", "tool_call", "tool_use"],
  tags: ["ai", "tool", "function", "api"],
  builtin: true,
  renderOrder: 2,
  promptGuidance: "Use to show tool/function calls and their results. Inputs and outputs render as formatted JSON.",
};
