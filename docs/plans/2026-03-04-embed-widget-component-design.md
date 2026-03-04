# Embed/Widget Component Design

## Goal

Add an `embed` canvas component that renders third-party widgets (Google Maps, TradingView, Spotify, CodePen, etc.) as direct iframes, giving the bot the ability to show real interactive widgets instead of approximating them with sandbox HTML.

## Architecture

Direct iframe rendering (same pattern as `CanvasVideo.tsx`) with an origin allowlist. The bot calls `show_embed` with a URL, and the component resolves it to an embeddable iframe URL. No sandbox wrapper needed — the iframe itself provides isolation.

## Tech Stack

- React component with `useMemo` URL resolution
- Shared `TRUSTED_EMBED_ORIGINS` allowlist in `security.ts`
- Zod schema in `@jarble/component-manifest`
- MCP `show_embed` tool auto-generated from manifest

---

## Supported Providers (14 at launch)

| Category | Provider | Embed URL Pattern |
|----------|----------|-------------------|
| Maps | Google Maps | `google.com/maps/embed/v1/place?key=...&q=...` |
| Maps | OpenStreetMap | `openstreetmap.org/export/embed.html?bbox=...` |
| Finance | TradingView | `s.tradingview.com/widgetembed/` (pass-through) |
| Video | YouTube | `youtube.com/embed/{id}` |
| Video | Vimeo | `player.vimeo.com/video/{id}` |
| Video | Twitch | `player.twitch.tv/?channel={ch}` |
| Video | Dailymotion | `dailymotion.com/embed/video/{id}` |
| Social | Twitter/X | `platform.twitter.com/embed/Tweet.html?id=...` |
| Social | Spotify | `open.spotify.com/embed/...` |
| Social | SoundCloud | `w.soundcloud.com/player/?url=...` |
| Social | Instagram | `instagram.com/p/{id}/embed/` |
| Social | Facebook | `facebook.com/plugins/post.php?href=...` |
| Dev | CodePen | `codepen.io/{user}/embed/{id}` |
| Dev | CodeSandbox | `codesandbox.io/embed/{id}` |
| Dev | Figma | `figma.com/embed?embed_host=jarble&url=...` |

## Props Schema

```ts
z.object({
  url: z.string(),           // Required: URL to embed
  title: z.string().optional(),
  height: z.number().optional(), // Default: 450
  provider: z.string().optional(), // Auto-detected from URL
})
```

## Security Model

### Origin Allowlist

```ts
export const TRUSTED_EMBED_ORIGINS: readonly string[] = [
  "https://www.google.com",
  "https://maps.google.com",
  "https://www.openstreetmap.org",
  "https://s.tradingview.com",
  "https://www.tradingview.com",
  "https://www.youtube.com",
  "https://player.vimeo.com",
  "https://player.twitch.tv",
  "https://www.dailymotion.com",
  "https://platform.twitter.com",
  "https://www.instagram.com",
  "https://www.facebook.com",
  "https://open.spotify.com",
  "https://w.soundcloud.com",
  "https://codepen.io",
  "https://codesandbox.io",
  "https://www.figma.com",
];
```

The component checks `new URL(embedUrl).origin` against this list before rendering. Unknown origins show a "Provider not supported" card with the raw URL as a clickable link.

### iframe Sandbox Attributes

```html
<iframe
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; geolocation"
/>
```

`allow-same-origin` is required for embeds that need cookie/storage access (Google Maps, TradingView). Safe because content is from third-party origins, not our domain.

## URL Resolution

Each provider has a `getEmbedUrl(url)` function that converts share/view URLs to embed URLs:

- `google.com/maps/place/...` → `google.com/maps/embed?pb=...`
- `twitter.com/user/status/123` → `platform.twitter.com/embed/Tweet.html?id=123`
- `open.spotify.com/track/...` → `open.spotify.com/embed/track/...`
- `codepen.io/user/pen/id` → `codepen.io/user/embed/id`
- Already-embeddable URLs pass through unchanged

## AutoFix Rules

- **Name aliases**: `"widget"` → `"embed"`, `"iframe"` → `"embed"`, `"web_embed"` → `"embed"`
- **URL cleanup**: Strip tracking params, normalize domains

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `shared/component-manifest/security.ts` | Modify | Add `TRUSTED_EMBED_ORIGINS` |
| `shared/component-manifest/components/embed.ts` | Create | Manifest entry |
| `shared/component-manifest/schemas/index.ts` | Modify | Add `embedSchema` |
| `shared/component-manifest/index.ts` | Modify | Register in manifest |
| `Jarble-mvp/components/canvas/components/CanvasEmbed.tsx` | Create | React component |
| `Jarble-mvp/components/canvas/registry.ts` | Modify | Register component |
| `Jarble-mvp/lib/autoFixProps.ts` | Modify | Name aliases + URL rules |
| `shared/component-manifest/derive/promptText.ts` | Modify | Add to prompt guidance |
| Tests | Create | URL resolution, allowlist, autoFix |
| `component-data.json` | Regenerate | MCP tool generation |

## What This Doesn't Include (YAGNI)

- No oEmbed protocol resolution (Phase 2 if needed)
- No Composio API data fetching (separate feature)
- No custom embed builder UI
- No embed caching or proxying
- No server-side URL validation (frontend-only allowlist check)
