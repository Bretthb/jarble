import type { ComponentManifestEntry } from "../types.js";

export const embedEntry: ComponentManifestEntry = {
  name: "embed",
  description: "Third-party widget embed — renders Google Maps, TradingView, Spotify, CodePen, Figma, social posts, and more as interactive iframes",
  reference: "`{url, title?, height?, provider?}`",
  category: "media",
  layout: { defaultHint: "full-width", defaultSize: { w: 600, h: 450 } },
  loading: "dynamic",
  expensive: false,
  aliases: ["widget", "iframe", "web_embed"],
  tags: ["embed", "widget", "iframe", "maps", "social", "finance"],
  builtin: true,
  renderOrder: 8,
  promptGuidance:
    "Use for embedding third-party widgets: Google Maps, TradingView charts, Spotify players, CodePen/CodeSandbox, Figma designs, tweets, Instagram posts. Just pass the URL. Supports: google.com/maps, tradingview.com, youtube.com, vimeo.com, twitter.com/x.com, instagram.com, spotify.com, soundcloud.com, codepen.io, codesandbox.io, figma.com, openstreetmap.org. For video playback with controls, prefer the video component instead.",
};
