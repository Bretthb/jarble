import type { ComponentManifestEntry } from "../types.js";

export const imageGalleryEntry: ComponentManifestEntry = {
  name: "image_gallery",
  description: "Grid of images with click-to-zoom modal",
  reference: "`{images: [{src, alt?, caption?}], title?, columns?}`",
  category: "media",
  layout: { defaultHint: "full-width", defaultSize: { w: 500, h: 400 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["gallery", "photo_grid"],
  tags: ["media", "images", "gallery", "photos"],
  builtin: true,
  renderOrder: 8,
};
