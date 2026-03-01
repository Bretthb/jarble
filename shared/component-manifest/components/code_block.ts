import type { ComponentManifestEntry } from "../types.js";

export const codeBlockEntry: ComponentManifestEntry = {
  name: "code_block",
  description: "Syntax-highlighted code snippet",
  reference: "`{code, language?, title?}`",
  category: "display",
  layout: { defaultHint: "half", defaultSize: { w: 400, h: 240 } },
  loading: "static",
  expensive: false,
  aliases: ["code", "snippet"],
  tags: ["code", "syntax", "programming"],
  builtin: true,
  renderOrder: 7,
  promptGuidance: "Use for displaying code. For editable code, use code_editor instead.",
};
