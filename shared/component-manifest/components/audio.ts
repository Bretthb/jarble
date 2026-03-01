import type { ComponentManifestEntry } from "../types.js";

export const audioEntry: ComponentManifestEntry = {
  name: "audio",
  description: "HTML5 audio player with controls",
  reference: "`{src, title?, autoplay?}`",
  category: "media",
  layout: { defaultHint: "third", defaultSize: { w: 320, h: 100 } },
  loading: "static",
  expensive: false,
  aliases: ["music", "sound", "mp3"],
  tags: ["media", "audio", "music", "sound"],
  builtin: true,
  renderOrder: 8,
};
