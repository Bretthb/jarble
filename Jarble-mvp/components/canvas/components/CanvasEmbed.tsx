"use client";

import { memo, useMemo } from "react";
import { FadeIn } from "../FadeIn";
import { ExternalLink } from "lucide-react";
import { TRUSTED_EMBED_ORIGINS } from "@jarble/component-manifest";

export interface CanvasEmbedProps {
  url: string;
  title?: string;
  height?: number;
  provider?: string;
}

/** Exact domain match — prevents subdomain bypasses like evil-youtube.com. */
function domainMatch(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
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
    if (domainMatch(u.hostname, "google.com") && u.pathname.startsWith("/maps")) {
      if (u.pathname.includes("/embed")) return url;
      const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
      if (placeMatch) {
        return `https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3000!2d0!3d0!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0!2s${encodeURIComponent(placeMatch[1])}!5e0!3m2!1sen!2sus!4v1`;
      }
      const q = u.searchParams.get("q");
      if (q) {
        return `https://www.google.com/maps/embed/v1/search?key=&q=${encodeURIComponent(q)}`;
      }
      return `https://www.google.com/maps/embed?${u.searchParams.toString()}`;
    }

    // ── OpenStreetMap ──────────────────────────────────────────────────
    if (domainMatch(u.hostname, "openstreetmap.org")) {
      if (u.pathname.includes("/export/embed")) return url;
      const bbox = u.hash.match(/map=\d+\/([-\d.]+)\/([-\d.]+)/);
      if (bbox) {
        const lat = bbox[1];
        const lon = bbox[2];
        return `https://www.openstreetmap.org/export/embed.html?bbox=${Number(lon) - 0.01},${Number(lat) - 0.01},${Number(lon) + 0.01},${Number(lat) + 0.01}&layer=mapnik&marker=${lat},${lon}`;
      }
      return url;
    }

    // ── TradingView ───────────────────────────────────────────────────
    if (domainMatch(u.hostname, "tradingview.com")) {
      return url;
    }

    // ── YouTube ───────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "youtube.com") || u.hostname === "youtu.be") {
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
    if (domainMatch(u.hostname, "vimeo.com")) {
      if (u.hostname === "player.vimeo.com") return url;
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) {
        return `https://player.vimeo.com/video/${id}`;
      }
    }

    // ── Twitch ────────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "twitch.tv")) {
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
    if (domainMatch(u.hostname, "dailymotion.com")) {
      if (u.pathname.includes("/embed/")) return url;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "video" && parts[1]) {
        return `https://www.dailymotion.com/embed/video/${parts[1]}`;
      }
    }

    // ── Twitter/X ─────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "twitter.com") || domainMatch(u.hostname, "x.com")) {
      if (u.hostname === "platform.twitter.com") return url;
      const statusMatch = u.pathname.match(/\/status\/(\d+)/);
      if (statusMatch) {
        return `https://platform.twitter.com/embed/Tweet.html?id=${statusMatch[1]}`;
      }
    }

    // ── Instagram ─────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "instagram.com")) {
      const postMatch = u.pathname.match(/\/(p|reel)\/([^/]+)/);
      if (postMatch) {
        return `https://www.instagram.com/${postMatch[1]}/${postMatch[2]}/embed/`;
      }
    }

    // ── Facebook ──────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "facebook.com")) {
      if (u.pathname.includes("/plugins/")) return url;
      return `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true&width=500`;
    }

    // ── Spotify ───────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "spotify.com")) {
      if (u.pathname.startsWith("/embed/")) return url;
      return `https://open.spotify.com/embed${u.pathname}`;
    }

    // ── SoundCloud ────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "soundcloud.com")) {
      if (u.hostname === "w.soundcloud.com") return url;
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`;
    }

    // ── CodePen ───────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "codepen.io")) {
      return url.replace(/\/pen\//, "/embed/");
    }

    // ── CodeSandbox ───────────────────────────────────────────────────
    if (domainMatch(u.hostname, "codesandbox.io")) {
      if (u.pathname.startsWith("/embed/")) return url;
      return url.replace(/\/s\//, "/embed/");
    }

    // ── Figma ─────────────────────────────────────────────────────────
    if (domainMatch(u.hostname, "figma.com")) {
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
    if (domainMatch(hostname, "google.com") && url.includes("/maps")) return "Google Maps";
    if (domainMatch(hostname, "openstreetmap.org")) return "OpenStreetMap";
    if (domainMatch(hostname, "tradingview.com")) return "TradingView";
    if (domainMatch(hostname, "youtube.com") || hostname === "youtu.be") return "YouTube";
    if (domainMatch(hostname, "vimeo.com")) return "Vimeo";
    if (domainMatch(hostname, "twitch.tv")) return "Twitch";
    if (domainMatch(hostname, "dailymotion.com")) return "Dailymotion";
    if (domainMatch(hostname, "twitter.com") || domainMatch(hostname, "x.com")) return "X (Twitter)";
    if (domainMatch(hostname, "instagram.com")) return "Instagram";
    if (domainMatch(hostname, "facebook.com")) return "Facebook";
    if (domainMatch(hostname, "spotify.com")) return "Spotify";
    if (domainMatch(hostname, "soundcloud.com")) return "SoundCloud";
    if (domainMatch(hostname, "codepen.io")) return "CodePen";
    if (domainMatch(hostname, "codesandbox.io")) return "CodeSandbox";
    if (domainMatch(hostname, "figma.com")) return "Figma";
    return hostname;
  } catch {
    return "Unknown";
  }
}

function CanvasEmbedInner({ url, title, height, provider }: CanvasEmbedProps) {
  const embedUrl = useMemo(() => getEmbedUrl(url), [url]);
  const resolvedProvider = provider || detectProvider(url);
  const allowed = useMemo(() => embedUrl ? isAllowedOrigin(embedUrl) : false, [embedUrl]);

  if (!embedUrl || !allowed) {
    return (
      <FadeIn
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
      </FadeIn>
    );
  }

  return (
    <FadeIn
      className="flex flex-col p-3 h-full min-h-0"
      role="region"
      aria-label={`Embed: ${title || resolvedProvider}`}
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-2 shrink-0">{title}</h3>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-lg bg-muted">
        {/* allow-same-origin is required for third-party embeds (Google Maps, TradingView, etc.)
            that need cookie/storage access. Safe here because content is from TRUSTED_EMBED_ORIGINS
            (not our domain). Do NOT add allow-same-origin to CanvasSandbox — different threat model. */}
        <iframe
          src={embedUrl}
          title={title || `${resolvedProvider} embed`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; geolocation"
          allowFullScreen
          style={{
            width: "100%",
            height: height ? `${height}px` : "100%",
            border: "none",
          }}
        />
      </div>
    </FadeIn>
  );
}

export default memo(CanvasEmbedInner);

// Export for testing
export { getEmbedUrl, isAllowedOrigin, detectProvider, domainMatch };
