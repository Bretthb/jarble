import type { ComponentManifestEntry } from "../types.js";

export const resultEntry: ComponentManifestEntry = {
  name: "result",
  description: "Status result page with icon (Ant Design)",
  reference: "`{status: \"success\"|\"error\"|\"info\"|\"warning\", title, subtitle?}`",
  category: "display",
  layout: { defaultHint: "third", defaultSize: { w: 360, h: 240 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["outcome", "status_page"],
  tags: ["status", "result", "outcome"],
  builtin: true,
  renderOrder: 3,
};
