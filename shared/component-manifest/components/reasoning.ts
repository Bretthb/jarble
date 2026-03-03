import type { ComponentManifestEntry } from "../types.js";

export const reasoningEntry: ComponentManifestEntry = {
  name: "reasoning",
  description: "Collapsible AI thinking/chain-of-thought block with optional step-by-step breakdown",
  reference: '`{title?, content, collapsed?, duration?, steps?: [{label, description?, status?}]}`',
  category: "display",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 120 } },
  loading: "static",
  expensive: false,
  aliases: ["thinking", "chain_of_thought", "cot"],
  tags: ["ai", "reasoning", "thinking", "chain-of-thought"],
  builtin: true,
  renderOrder: 1,
  promptGuidance: "Use to show AI reasoning or thinking process. Content supports markdown. Steps show a stepper with complete/active/pending states.",
};
