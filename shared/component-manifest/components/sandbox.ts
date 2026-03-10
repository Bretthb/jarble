import type { ComponentManifestEntry } from "../types.js";

/** Current sandbox bridge API version. */
export const SANDBOX_SDK_VERSION = "1.0";

export const sandboxEntry: ComponentManifestEntry = {
  name: "sandbox",
  description: "Sandboxed iframe for custom HTML/CSS/JS mini-apps — render anything. Use for charts, 3D, animations, gauges, maps, or any visualization not covered by built-in components.",
  reference: "`{html, css?, js?, moduleJs?, importMap?: {}, props?: {}, height?, title?, libraries?: string[], configSchema?: object}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 700, h: 600 } },
  loading: "dynamic",
  expensive: true,
  aliases: ["iframe", "canvas", "html"],
  tags: ["sandbox", "iframe", "html", "custom", "3d", "animation"],
  builtin: true,
  renderOrder: 10,
  promptGuidance: "CRITICAL: html=ONLY body HTML (divs etc), NEVER <script>/<style>/<html>/<head> tags. css=all styles. js=all JavaScript (runs AFTER libraries load). moduleJs=ES module JavaScript with import statements (runs as <script type=module>). importMap=maps bare specifiers to CDN URLs (e.g. {\"react\":\"https://esm.sh/react@18\"}). libraries=CDN URLs loaded dynamically. Use for: gauges, maps, scatter plots, heatmaps, 3D, animations, candlestick charts, word clouds, or ANY custom visualization. NEVER use code_editor for running JS -- use sandbox instead.",
};
