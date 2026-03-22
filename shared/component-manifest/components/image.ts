import type { ComponentManifestEntry } from "../types.js";

export const imageEntry: ComponentManifestEntry = {
  name: "image",
  description: "Image with optional alt text and caption",
  reference: "`{src, alt?, caption?}`",
  category: "media",
  layout: { defaultHint: "third", defaultSize: { w: 360, h: 280 } },
  loading: "static",
  expensive: false,
  aliases: ["photo", "picture", "img"],
  tags: ["media", "image", "photo"],
  builtin: true,
  renderOrder: 8,
  promptGuidance: "Single image display. Use Unsplash URLs for visual topics. For multiple images, use image_gallery or carousel instead.",
};
