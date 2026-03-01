import type { ComponentManifestEntry } from "../types.js";

export const mapEntry: ComponentManifestEntry = {
  name: "map",
  description: "Interactive Leaflet map with markers",
  reference: "`{center: [lat, lng], zoom?, markers?: [{lat, lng, label?}], title?}`",
  category: "specialized",
  layout: { defaultHint: "full-width", defaultSize: { w: 560, h: 460 } },
  loading: "dynamic",
  expensive: true,
  aliases: ["leaflet", "location"],
  tags: ["map", "location", "geography", "markers"],
  builtin: true,
  renderOrder: 10,
};
