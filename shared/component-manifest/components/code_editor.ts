import type { ComponentManifestEntry } from "../types.js";

export const codeEditorEntry: ComponentManifestEntry = {
  name: "code_editor",
  description: "Monaco code editor with syntax highlighting",
  reference: "`{code, language?, title?, readOnly?, height?}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 500 } },
  loading: "dynamic",
  expensive: true,
  aliases: ["editor", "ide"],
  tags: ["code", "editor", "programming", "monaco"],
  builtin: true,
  renderOrder: 10,
  promptGuidance: "Use for editable code. For display-only code, use code_block instead.",
};
