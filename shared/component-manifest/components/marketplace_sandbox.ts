import type { ComponentManifestEntry } from "../types.js";

export const marketplaceSandboxEntry: ComponentManifestEntry = {
  name: "marketplace_sandbox",
  description: "Double-iframe sandboxed container for marketplace (user-submitted) components. Provides an extra layer of isolation beyond the standard sandbox — inner iframe runs with opaque origin inside an outer about:blank iframe.",
  reference: "`{html, css?, js?, props?: {}, height?, title?, libraries?: string[], marketplaceId?: string}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 700, h: 600 } },
  loading: "dynamic",
  expensive: true,
  aliases: [],
  tags: ["sandbox", "marketplace", "iframe", "isolated", "custom", "user-submitted"],
  builtin: true,
  renderOrder: 10,
  promptGuidance: "Use marketplace_sandbox for user-submitted marketplace components that need extra isolation. Same props as sandbox but with double-iframe architecture. Prefer standard sandbox for built-in components.",
};
