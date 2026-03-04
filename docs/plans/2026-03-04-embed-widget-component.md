# Embed/Widget Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `embed` canvas component that renders third-party widgets (Google Maps, TradingView, Spotify, CodePen, etc.) as direct iframes with an origin allowlist.

**Architecture:** Direct iframe rendering (same pattern as `CanvasVideo.tsx`) — no sandbox wrapper. Bot calls `show_embed` with a URL, component resolves it to an embeddable iframe URL from `TRUSTED_EMBED_ORIGINS`, renders `<iframe>` or shows "unsupported provider" fallback.

**Tech Stack:** React 19, Zod (v4 frontend / v3 API), Next.js dynamic imports, shared `@jarble/component-manifest`

---

### Task 1: Add TRUSTED_EMBED_ORIGINS to security.ts

**Files:**
- Modify: `shared/component-manifest/security.ts`
- Modify: `shared/component-manifest/index.ts` (add re-export)

**Step 1: Add the embed origins array to security.ts**

Open `shared/component-manifest/security.ts` and add after the existing `TRUSTED_CDN_ORIGINS` array:

```ts
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
```

**Step 2: Add re-export in index.ts**

In `shared/component-manifest/index.ts`, find the line:
```ts
export { TRUSTED_CDN_ORIGINS } from "./security.js";
```
Change it to:
```ts
export { TRUSTED_CDN_ORIGINS, TRUSTED_EMBED_ORIGINS } from "./security.js";
```

**Step 3: Commit**

```bash
git add shared/component-manifest/security.ts shared/component-manifest/index.ts
git commit -m "feat: add TRUSTED_EMBED_ORIGINS allowlist for embed component"
```

---

### Task 2: Create embed manifest entry and Zod schema

**Files:**
- Create: `shared/component-manifest/components/embed.ts`
- Modify: `shared/component-manifest/schemas/index.ts`
- Modify: `shared/component-manifest/index.ts`

**Step 1: Create the manifest entry**

Create `shared/component-manifest/components/embed.ts`:

```ts
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
```

**Step 2: Add the Zod schema to schemas/index.ts**

In `shared/component-manifest/schemas/index.ts`, add after the `videoSchema` definition (around line 253):

```ts
export const embedSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  height: z.number().optional(),
  provider: z.string().optional(),
});
```

Then add `embed: embedSchema,` to the `COMPONENT_SCHEMAS` record (after the `video: videoSchema,` line, around line 484):

```ts
  video: videoSchema,
  embed: embedSchema,
```

**Step 3: Register in the manifest index**

In `shared/component-manifest/index.ts`:

1. Add import after the `videoEntry` import (line 39):
```ts
import { embedEntry } from "./components/embed.js";
```

2. Add to `COMPONENT_MANIFEST` object after `video: videoEntry,` (line 90):
```ts
  embed: embedEntry,
```

3. Add `embedSchema` to the schema re-export block. Find the line with `videoSchema,` in the re-export and add `embedSchema,` after it:
```ts
  videoSchema,
  embedSchema,
```

**Step 4: Commit**

```bash
git add shared/component-manifest/components/embed.ts shared/component-manifest/schemas/index.ts shared/component-manifest/index.ts
git commit -m "feat: add embed component manifest entry and Zod schema"
```

---

### Task 3: Create CanvasEmbed.tsx React component

**Files:**
- Create: `Jarble-mvp/components/canvas/components/CanvasEmbed.tsx`

**Step 1: Create the component**

Create `Jarble-mvp/components/canvas/components/CanvasEmbed.tsx`:

```tsx
"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { TRUSTED_EMBED_ORIGINS } from "@jarble/component-manifest";

export interface CanvasEmbedProps {
  url: string;
  title?: string;
  height?: number;
  provider?: string;
}

/** Check if a resolved embed URL's origin is in the allowlist. */
function isAllowedOrigin(embedUrl: string): boolean {
  try {
    const origin = new URL(embedUrl).origin;
    return TRUSTED_EMBED_ORIGINS.some((allowed) => origin === allowed);
  } catch {
    return false;
  }
}

/**
 * Convert a share/view URL into an embeddable iframe URL.
 * Returns the embed URL if recognized, or the original URL if it's already embeddable.
 */
function getEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);

    // ── Google Maps ────────────────────────────────────────────────────
    // google.com/maps/place/... or google.com/maps?q=...
    if (u.hostname.includes("google.com") && u.pathname.startsWith("/maps")) {
      // Already an embed URL
      if (u.pathname.includes("/embed")) return url;
      // Place URL → embed
      const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
      if (placeMatch) {
        return `https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3000!2d0!3d0!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0!2s${encodeURIComponent(placeMatch[1])}!5e0!3m2!1sen!2sus!4v1`;
      }
      // Search URL → embed with query
      const q = u.searchParams.get("q");
      if (q) {
        return `https://www.google.com/maps/embed/v1/search?key=&q=${encodeURIComponent(q)}`;
      }
      // Fallback: convert to embed
      return `https://www.google.com/maps/embed?${u.searchParams.toString()}`;
    }

    // ── OpenStreetMap ──────────────────────────────────────────────────
    if (u.hostname.includes("openstreetmap.org")) {
      if (u.pathname.includes("/export/embed")) return url;
      // Convert view URL to embed
      const bbox = u.hash.match(/map=\d+\/([-\d.]+)\/([-\d.]+)/);
      if (bbox) {
        const lat = bbox[1];
        const lon = bbox[2];
        return `https://www.openstreetmap.org/export/embed.html?bbox=${Number(lon) - 0.01},${Number(lat) - 0.01},${Number(lon) + 0.01},${Number(lat) + 0.01}&layer=mapnik&marker=${lat},${lon}`;
      }
      return url;
    }

    // ── TradingView ───────────────────────────────────────────────────
    if (u.hostname.includes("tradingview.com")) {
      return url; // TradingView widget URLs are already embeddable
    }

    // ── YouTube ───────────────────────────────────────────────────────
    if (u.hostname.includes("youtube.com") || u.hostname === "youtu.be") {
      let videoId: string | null = null;
      if (u.hostname === "youtu.be") {
        videoId = u.pathname.slice(1);
      } else if (u.pathname.startsWith("/embed/")) {
        return url;
      } else if (u.pathname.startsWith("/live/")) {
        videoId = u.pathname.split("/")[2];
      } else {
        videoId = u.searchParams.get("v");
      }
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
      }
    }

    // ── Vimeo ─────────────────────────────────────────────────────────
    if (u.hostname.includes("vimeo.com")) {
      if (u.hostname === "player.vimeo.com") return url;
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) {
        return `https://player.vimeo.com/video/${id}`;
      }
    }

    // ── Twitch ────────────────────────────────────────────────────────
    if (u.hostname.includes("twitch.tv")) {
      if (u.hostname === "player.twitch.tv") return url;
      const parts = u.pathname.split("/").filter(Boolean);
      const parent = typeof window !== "undefined" ? window.location.hostname : "localhost";
      if (parts[0] === "videos" && parts[1]) {
        return `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}`;
      }
      if (parts[0]) {
        return `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}`;
      }
    }

    // ── Dailymotion ───────────────────────────────────────────────────
    if (u.hostname.includes("dailymotion.com")) {
      if (u.pathname.includes("/embed/")) return url;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "video" && parts[1]) {
        return `https://www.dailymotion.com/embed/video/${parts[1]}`;
      }
    }

    // ── Twitter/X ─────────────────────────────────────────────────────
    if (u.hostname.includes("twitter.com") || u.hostname.includes("x.com")) {
      if (u.hostname === "platform.twitter.com") return url;
      // Extract tweet ID from /user/status/ID
      const statusMatch = u.pathname.match(/\/status\/(\d+)/);
      if (statusMatch) {
        return `https://platform.twitter.com/embed/Tweet.html?id=${statusMatch[1]}`;
      }
    }

    // ── Instagram ─────────────────────────────────────────────────────
    if (u.hostname.includes("instagram.com")) {
      // /p/CODE/ or /reel/CODE/
      const postMatch = u.pathname.match(/\/(p|reel)\/([^/]+)/);
      if (postMatch) {
        return `https://www.instagram.com/${postMatch[1]}/${postMatch[2]}/embed/`;
      }
    }

    // ── Facebook ──────────────────────────────────────────────────────
    if (u.hostname.includes("facebook.com")) {
      if (u.pathname.includes("/plugins/")) return url;
      return `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true&width=500`;
    }

    // ── Spotify ───────────────────────────────────────────────────────
    if (u.hostname.includes("spotify.com")) {
      // open.spotify.com/track/ID → open.spotify.com/embed/track/ID
      if (u.pathname.startsWith("/embed/")) return url;
      return `https://open.spotify.com/embed${u.pathname}`;
    }

    // ── SoundCloud ────────────────────────────────────────────────────
    if (u.hostname.includes("soundcloud.com")) {
      if (u.hostname === "w.soundcloud.com") return url;
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`;
    }

    // ── CodePen ───────────────────────────────────────────────────────
    if (u.hostname.includes("codepen.io")) {
      // codepen.io/user/pen/ID → codepen.io/user/embed/ID
      return url.replace(/\/pen\//, "/embed/");
    }

    // ── CodeSandbox ───────────────────────────────────────────────────
    if (u.hostname.includes("codesandbox.io")) {
      if (u.pathname.startsWith("/embed/")) return url;
      // codesandbox.io/s/ID → codesandbox.io/embed/ID
      return url.replace(/\/s\//, "/embed/");
    }

    // ── Figma ─────────────────────────────────────────────────────────
    if (u.hostname.includes("figma.com")) {
      if (u.pathname.startsWith("/embed")) return url;
      return `https://www.figma.com/embed?embed_host=jarble&url=${encodeURIComponent(url)}`;
    }
  } catch {
    // Invalid URL
  }

  return null;
}

/** Detect provider name from URL for display purposes. */
function detectProvider(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes("google.com") && url.includes("/maps")) return "Google Maps";
    if (hostname.includes("openstreetmap.org")) return "OpenStreetMap";
    if (hostname.includes("tradingview.com")) return "TradingView";
    if (hostname.includes("youtube.com") || hostname === "youtu.be") return "YouTube";
    if (hostname.includes("vimeo.com")) return "Vimeo";
    if (hostname.includes("twitch.tv")) return "Twitch";
    if (hostname.includes("dailymotion.com")) return "Dailymotion";
    if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "X (Twitter)";
    if (hostname.includes("instagram.com")) return "Instagram";
    if (hostname.includes("facebook.com")) return "Facebook";
    if (hostname.includes("spotify.com")) return "Spotify";
    if (hostname.includes("soundcloud.com")) return "SoundCloud";
    if (hostname.includes("codepen.io")) return "CodePen";
    if (hostname.includes("codesandbox.io")) return "CodeSandbox";
    if (hostname.includes("figma.com")) return "Figma";
    return hostname;
  } catch {
    return "Unknown";
  }
}

function CanvasEmbedInner({ url, title, height, provider }: CanvasEmbedProps) {
  const embedUrl = useMemo(() => getEmbedUrl(url), [url]);
  const resolvedProvider = provider || detectProvider(url);
  const allowed = useMemo(() => embedUrl ? isAllowedOrigin(embedUrl) : false, [embedUrl]);

  // Unsupported provider fallback
  if (!embedUrl || !allowed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center justify-center gap-3 p-6 h-full text-center"
        role="region"
        aria-label={`Embed: ${title || resolvedProvider}`}
      >
        <ExternalLink className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {resolvedProvider} embed
        </p>
        <p className="text-xs text-muted-foreground-subtle">
          This provider is not in the embed allowlist.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline hover:text-primary/80"
        >
          Open in new tab
        </a>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col p-3 h-full min-h-0"
      role="region"
      aria-label={`Embed: ${title || resolvedProvider}`}
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-2 shrink-0">{title}</h3>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-lg bg-muted">
        <iframe
          src={embedUrl}
          title={title || `${resolvedProvider} embed`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; geolocation"
          allowFullScreen
          style={{
            width: "100%",
            height: height ? `${height}px` : "100%",
            border: "none",
          }}
        />
      </div>
    </motion.div>
  );
}

export default memo(CanvasEmbedInner);

// Export for testing
export { getEmbedUrl, isAllowedOrigin, detectProvider };
```

**Step 2: Commit**

```bash
git add Jarble-mvp/components/canvas/components/CanvasEmbed.tsx
git commit -m "feat: add CanvasEmbed component with URL resolution and origin allowlist"
```

---

### Task 4: Register embed in the frontend registry

**Files:**
- Modify: `Jarble-mvp/components/canvas/registry.ts`

**Step 1: Add the schema import**

In `Jarble-mvp/components/canvas/registry.ts`, find the import block from `@jarble/component-manifest` (line 17-59). Add `embedSchema` after `videoSchema`:

```ts
  videoSchema,
  embedSchema,
```

Also add it to the re-export block (after `videoSchema,` around line 82):

```ts
  videoSchema,
  embedSchema,
```

**Step 2: Add the dynamic import**

Find the lazy-loaded section (around line 142). Add after the `CanvasVideo` import:

```ts
const CanvasEmbed = dynamic(() => import("./components/CanvasEmbed"), { ssr: false });
```

**Step 3: Add to CANVAS_COMPONENTS record**

After the `video` entry (around line 198), add:

```ts
  embed: { component: CanvasEmbed, propsSchema: embedSchema },
```

**Step 4: Commit**

```bash
git add Jarble-mvp/components/canvas/registry.ts
git commit -m "feat: register embed component in canvas registry"
```

---

### Task 5: Add autoFix name aliases for embed

**Files:**
- Modify: `Jarble-mvp/lib/autoFixProps.ts`

**Step 1: Add name aliases to COMPONENT_NAME_MAP**

In `Jarble-mvp/lib/autoFixProps.ts`, find the `COMPONENT_NAME_MAP` object (starts at line 37). Add these entries at the end, before the closing `}`:

```ts
  // Embed aliases
  widget: "embed",
  iframe: "embed",
  web_embed: "embed",
  Widget: "embed",
  Embed: "embed",
  WebEmbed: "embed",
```

**Step 2: Commit**

```bash
git add Jarble-mvp/lib/autoFixProps.ts
git commit -m "feat: add embed name aliases to autoFixProps"
```

---

### Task 6: Write tests for CanvasEmbed URL resolution

**Files:**
- Create: `Jarble-mvp/components/canvas/__tests__/canvasEmbed.test.ts`

**Step 1: Create the test file**

Create `Jarble-mvp/components/canvas/__tests__/canvasEmbed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  getEmbedUrl,
  isAllowedOrigin,
  detectProvider,
} from "../components/CanvasEmbed";

describe("CanvasEmbed", () => {
  // ── URL Resolution ─────────────────────────────────────────────────

  describe("getEmbedUrl", () => {
    it("converts YouTube watch URL to embed", () => {
      const result = getEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(result).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("passes through YouTube embed URLs unchanged", () => {
      const url = "https://www.youtube.com/embed/dQw4w9WgXcQ";
      expect(getEmbedUrl(url)).toBe(url);
    });

    it("converts youtu.be short URL", () => {
      const result = getEmbedUrl("https://youtu.be/dQw4w9WgXcQ");
      expect(result).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    });

    it("converts Vimeo URL to embed", () => {
      const result = getEmbedUrl("https://vimeo.com/123456789");
      expect(result).toBe("https://player.vimeo.com/video/123456789");
    });

    it("passes through Vimeo player URLs", () => {
      const url = "https://player.vimeo.com/video/123456789";
      expect(getEmbedUrl(url)).toBe(url);
    });

    it("converts Spotify track URL to embed", () => {
      const result = getEmbedUrl("https://open.spotify.com/track/abc123");
      expect(result).toBe("https://open.spotify.com/embed/track/abc123");
    });

    it("passes through Spotify embed URLs", () => {
      const url = "https://open.spotify.com/embed/track/abc123";
      expect(getEmbedUrl(url)).toBe(url);
    });

    it("converts CodePen pen URL to embed", () => {
      const result = getEmbedUrl("https://codepen.io/user/pen/abc123");
      expect(result).toBe("https://codepen.io/user/embed/abc123");
    });

    it("converts CodeSandbox URL to embed", () => {
      const result = getEmbedUrl("https://codesandbox.io/s/abc123");
      expect(result).toBe("https://codesandbox.io/embed/abc123");
    });

    it("converts Figma URL to embed", () => {
      const result = getEmbedUrl("https://www.figma.com/file/abc123");
      expect(result).toContain("https://www.figma.com/embed");
      expect(result).toContain(encodeURIComponent("https://www.figma.com/file/abc123"));
    });

    it("converts Twitter status URL to embed", () => {
      const result = getEmbedUrl("https://twitter.com/user/status/123456789");
      expect(result).toBe("https://platform.twitter.com/embed/Tweet.html?id=123456789");
    });

    it("converts X.com status URL to embed", () => {
      const result = getEmbedUrl("https://x.com/user/status/123456789");
      expect(result).toBe("https://platform.twitter.com/embed/Tweet.html?id=123456789");
    });

    it("converts Instagram post URL to embed", () => {
      const result = getEmbedUrl("https://www.instagram.com/p/abc123/");
      expect(result).toBe("https://www.instagram.com/p/abc123/embed/");
    });

    it("converts Instagram reel URL to embed", () => {
      const result = getEmbedUrl("https://www.instagram.com/reel/abc123/");
      expect(result).toBe("https://www.instagram.com/reel/abc123/embed/");
    });

    it("converts Facebook post URL to embed", () => {
      const result = getEmbedUrl("https://www.facebook.com/user/posts/123");
      expect(result).toContain("https://www.facebook.com/plugins/post.php");
    });

    it("converts Dailymotion URL to embed", () => {
      const result = getEmbedUrl("https://www.dailymotion.com/video/x8abc");
      expect(result).toBe("https://www.dailymotion.com/embed/video/x8abc");
    });

    it("passes through TradingView URLs unchanged", () => {
      const url = "https://s.tradingview.com/widgetembed/?symbol=AAPL";
      expect(getEmbedUrl(url)).toBe(url);
    });

    it("converts SoundCloud URL to embed", () => {
      const result = getEmbedUrl("https://soundcloud.com/artist/track");
      expect(result).toContain("https://w.soundcloud.com/player/");
      expect(result).toContain(encodeURIComponent("https://soundcloud.com/artist/track"));
    });

    it("returns null for unknown URLs", () => {
      expect(getEmbedUrl("https://example.com/page")).toBeNull();
    });

    it("returns null for invalid URLs", () => {
      expect(getEmbedUrl("not a url")).toBeNull();
    });

    it("handles Google Maps place URL", () => {
      const result = getEmbedUrl("https://www.google.com/maps/place/Statue+of+Liberty");
      expect(result).toContain("https://www.google.com/maps/embed");
    });

    it("passes through Google Maps embed URLs", () => {
      const url = "https://www.google.com/maps/embed?pb=!1m14";
      expect(getEmbedUrl(url)).toBe(url);
    });
  });

  // ── Origin Allowlist ───────────────────────────────────────────────

  describe("isAllowedOrigin", () => {
    it("allows YouTube embed URLs", () => {
      expect(isAllowedOrigin("https://www.youtube.com/embed/abc")).toBe(true);
    });

    it("allows Spotify embed URLs", () => {
      expect(isAllowedOrigin("https://open.spotify.com/embed/track/abc")).toBe(true);
    });

    it("allows Google Maps embed URLs", () => {
      expect(isAllowedOrigin("https://www.google.com/maps/embed?pb=abc")).toBe(true);
    });

    it("allows CodePen embed URLs", () => {
      expect(isAllowedOrigin("https://codepen.io/user/embed/abc")).toBe(true);
    });

    it("rejects unknown origins", () => {
      expect(isAllowedOrigin("https://evil.com/embed")).toBe(false);
    });

    it("rejects invalid URLs", () => {
      expect(isAllowedOrigin("not a url")).toBe(false);
    });
  });

  // ── Provider Detection ─────────────────────────────────────────────

  describe("detectProvider", () => {
    it("detects Google Maps", () => {
      expect(detectProvider("https://www.google.com/maps/place/NYC")).toBe("Google Maps");
    });

    it("detects YouTube", () => {
      expect(detectProvider("https://www.youtube.com/watch?v=abc")).toBe("YouTube");
    });

    it("detects Spotify", () => {
      expect(detectProvider("https://open.spotify.com/track/abc")).toBe("Spotify");
    });

    it("detects Twitter", () => {
      expect(detectProvider("https://twitter.com/user/status/123")).toBe("X (Twitter)");
    });

    it("detects X.com as Twitter", () => {
      expect(detectProvider("https://x.com/user/status/123")).toBe("X (Twitter)");
    });

    it("returns hostname for unknown providers", () => {
      expect(detectProvider("https://example.com/page")).toBe("example.com");
    });
  });
});
```

**Step 2: Run the tests**

Run: `cd Jarble-mvp && npx vitest run components/canvas/__tests__/canvasEmbed.test.ts`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add Jarble-mvp/components/canvas/__tests__/canvasEmbed.test.ts
git commit -m "test: add URL resolution, origin allowlist, and provider detection tests for embed"
```

---

### Task 7: Add autoFix tests for embed aliases

**Files:**
- Modify: `Jarble-mvp/lib/__tests__/autoFixProps.test.ts`

**Step 1: Add embed alias tests**

At the end of the file (before the final `});`), add:

```ts
  // ── Embed Aliases ──────────────────────────────────────────────────

  describe("embed aliases", () => {
    it('normalizes "widget" to "embed"', () => {
      const result = autoFixProps("widget", { url: "https://example.com" });
      expect(result.component).toBe("embed");
    });

    it('normalizes "iframe" to "embed"', () => {
      const result = autoFixProps("iframe", { url: "https://example.com" });
      expect(result.component).toBe("embed");
    });

    it('normalizes "Embed" (PascalCase) to "embed"', () => {
      const result = autoFixProps("Embed", { url: "https://example.com" });
      expect(result.component).toBe("embed");
    });

    it('normalizes "web_embed" to "embed"', () => {
      const result = autoFixProps("web_embed", { url: "https://example.com" });
      expect(result.component).toBe("embed");
    });

    it('leaves "embed" unchanged', () => {
      const result = autoFixProps("embed", { url: "https://example.com" });
      expect(result.component).toBe("embed");
      const nameRepairs = result.repairs.filter((r) => r.field === "component");
      expect(nameRepairs).toHaveLength(0);
    });
  });
```

**Step 2: Run the tests**

Run: `cd Jarble-mvp && npx vitest run lib/__tests__/autoFixProps.test.ts`

Expected: All tests pass (previous 54 + 5 new = 59).

**Step 3: Commit**

```bash
git add Jarble-mvp/lib/__tests__/autoFixProps.test.ts
git commit -m "test: add autoFix tests for embed name aliases"
```

---

### Task 8: Regenerate component-data.json and run full test suite

**Files:**
- Modify: `shared/component-manifest/generated/component-data.json` (regenerated)

**Step 1: Regenerate the component manifest JSON**

The MCP server uses generated JSON. Regenerate from the API directory (which uses Zod v3):

Run: `cd jarble-api-main && npx tsx ../scripts/generate-mcp-manifest.ts`

Verify the output includes an `embed` entry:

Run: `grep -c '"embed"' ../shared/component-manifest/generated/component-data.json`

Expected: At least 1 match.

**Step 2: Run the full frontend test suite**

Run: `cd Jarble-mvp && npx vitest run`

Expected: All tests pass (previous 227 + 5 autoFix + ~25 embed URL = ~257 tests).

**Step 3: Run the full API test suite**

Run: `cd jarble-api-main && npx vitest run`

Expected: All 453 tests pass (no API changes were made).

**Step 4: Run TypeScript type-checks**

Run: `cd Jarble-mvp && npm run check`

Expected: No type errors.

**Step 5: Commit**

```bash
git add shared/component-manifest/generated/component-data.json
git commit -m "chore: regenerate component-data.json with embed component"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add TRUSTED_EMBED_ORIGINS allowlist | `security.ts`, `index.ts` |
| 2 | Create manifest entry + Zod schema | `embed.ts`, `schemas/index.ts`, `index.ts` |
| 3 | Create CanvasEmbed.tsx component | `CanvasEmbed.tsx` |
| 4 | Register in frontend registry | `registry.ts` |
| 5 | Add autoFix name aliases | `autoFixProps.ts` |
| 6 | Write URL resolution + allowlist tests | `canvasEmbed.test.ts` |
| 7 | Write autoFix alias tests | `autoFixProps.test.ts` |
| 8 | Regenerate manifest JSON + full test run | `component-data.json` |
