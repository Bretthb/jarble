/**
 * Centralized CDN allowlist for sandbox security.
 *
 * Used by:
 * - Frontend sandbox components (CSP meta tag construction)
 * - API uiBlockParser (server-side library URL validation)
 */

/**
 * Trusted CDN origins for sandbox library URLs.
 * Only scripts/styles/fonts from these origins are allowed in sandbox iframes.
 */
export const TRUSTED_CDN_ORIGINS: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://unpkg.com",
  "https://cdn.tailwindcss.com",
  "https://esm.sh",
  "https://esm.run",
  "https://threejs.org",
  "https://d3js.org",
  "https://cdn.plot.ly",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://s3.tradingview.com",
] as const;

/**
 * Trusted origins for embed/widget iframes.
 * Only iframes from these origins are rendered by the embed component.
 * Unknown origins show a "Provider not supported" fallback with a link.
 */
export const TRUSTED_EMBED_ORIGINS: readonly string[] = [
  // Maps
  "https://www.google.com",
  "https://maps.google.com",
  "https://www.openstreetmap.org",
  // Finance
  "https://s.tradingview.com",
  "https://www.tradingview.com",
  // Video (overlap with video component — embed handles share URLs)
  "https://www.youtube.com",
  "https://player.vimeo.com",
  "https://player.twitch.tv",
  "https://www.dailymotion.com",
  // Social
  "https://platform.twitter.com",
  "https://publish.twitter.com",
  "https://www.instagram.com",
  "https://www.facebook.com",
  "https://open.spotify.com",
  "https://w.soundcloud.com",
  // Dev
  "https://codepen.io",
  "https://codesandbox.io",
  "https://www.figma.com",
] as const;
