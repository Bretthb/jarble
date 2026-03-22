import type { ComponentManifestEntry } from "../types.js";

export const sandpackSandboxEntry: ComponentManifestEntry = {
  name: "sandpack_sandbox",
  description: "Full npm sandbox for complex multi-file components (React, Three.js, etc.). Use for React apps with state, multi-file projects, or packages with complex dependency trees.",
  reference: "`{files: {'/App.tsx': code}, dependencies?: {pkg: version}, template?: 'react-ts', title?, height?, entryFile?}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 700, h: 600 } },
  loading: "dynamic",
  expensive: true,
  aliases: ["sandpack", "npm_sandbox", "project_sandbox"],
  tags: ["sandbox", "npm", "react", "multi-file"],
  builtin: true,
  renderOrder: 10,
  promptGuidance: "Use for complex components needing multiple files or npm packages not in the default import map. For simple single-file sandboxes, prefer the regular sandbox component.",
};
