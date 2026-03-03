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
  "https://threejs.org",
  "https://d3js.org",
  "https://cdn.plot.ly",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
] as const;
