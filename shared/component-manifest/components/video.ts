import type { ComponentManifestEntry } from "../types.js";

export const videoEntry: ComponentManifestEntry = {
  name: "video",
  description: "Video/livestream player — supports YouTube, Twitch, Vimeo, SoundCloud, Dailymotion, direct URLs. Use for livestreams (NASA ISS, Twitch channels, YouTube Live).",
  reference: "`{url, title?, controls?: true, loop?: false, muted?: false}`",
  category: "media",
  layout: { defaultHint: "half", defaultSize: { w: 560, h: 420 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["player", "stream", "livestream"],
  tags: ["media", "video", "streaming", "youtube"],
  builtin: true,
  renderOrder: 8,
  promptGuidance: "Supports YouTube, Twitch, Vimeo, SoundCloud, Dailymotion, direct MP4/HLS URLs. Use for livestreams. Just pass the URL.",
};
