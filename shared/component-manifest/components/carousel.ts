import type { ComponentManifestEntry } from "../types.js";

export const carouselEntry: ComponentManifestEntry = {
  name: "carousel",
  description: "Swipeable slide carousel with navigation",
  reference: "`{items: [{title?, description?, image?}], autoplay?}`",
  category: "media",
  layout: { defaultHint: "half", defaultSize: { w: 460, h: 320 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["slider", "slideshow"],
  tags: ["media", "carousel", "slides", "gallery"],
  builtin: true,
  renderOrder: 8,
};
