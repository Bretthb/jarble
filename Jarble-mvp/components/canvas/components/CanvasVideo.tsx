"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";

// Fallback for direct file URLs (mp4, webm, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactPlayer: any = dynamic(() => import("react-player"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded bg-muted" />,
});

export interface CanvasVideoProps {
  url: string;
  title?: string;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
}

/** Extract a direct iframe embed URL from common video platforms. Returns null if not a known platform. */
function getEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);

    // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/live/ID, youtube.com/embed/ID
    if (u.hostname.includes("youtube.com") || u.hostname === "youtu.be") {
      let videoId: string | null = null;
      if (u.hostname === "youtu.be") {
        videoId = u.pathname.slice(1);
      } else if (u.pathname.startsWith("/embed/")) {
        return url; // Already an embed URL
      } else if (u.pathname.startsWith("/live/")) {
        videoId = u.pathname.split("/")[2];
      } else {
        videoId = u.searchParams.get("v");
      }
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}?autoplay=1&modestbranding=1`;
      }
    }

    // Twitch: twitch.tv/CHANNEL or twitch.tv/videos/ID
    if (u.hostname.includes("twitch.tv")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "videos" && parts[1]) {
        return `https://player.twitch.tv/?video=${parts[1]}&parent=${typeof window !== "undefined" ? window.location.hostname : "localhost"}&autoplay=true`;
      }
      if (parts[0] && parts[0] !== "videos") {
        return `https://player.twitch.tv/?channel=${parts[0]}&parent=${typeof window !== "undefined" ? window.location.hostname : "localhost"}&autoplay=true`;
      }
    }

    // Vimeo: vimeo.com/ID
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) {
        return `https://player.vimeo.com/video/${id}?autoplay=1`;
      }
    }

    // Dailymotion: dailymotion.com/video/ID
    if (u.hostname.includes("dailymotion.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "video" && parts[1]) {
        return `https://www.dailymotion.com/embed/video/${parts[1]}?autoplay=1`;
      }
    }

    // TradingView: s.tradingview.com or tradingview-widget.com embed URLs — pass through as-is
    if (u.hostname.includes("tradingview.com") || u.hostname.includes("tradingview-widget.com")) {
      return url;
    }
  } catch {
    // Invalid URL — fall through to ReactPlayer
  }
  return null;
}

function CanvasVideoInner({
  url,
  title,
  controls = true,
  loop = false,
  muted = false,
}: CanvasVideoProps) {
  const embedUrl = useMemo(() => getEmbedUrl(url), [url]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col p-4 h-full min-h-0"
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-2 shrink-0">{title}</h3>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-lg bg-black">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={title || "Video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <ReactPlayer
            url={url}
            controls={controls}
            loop={loop}
            muted={muted}
            width="100%"
            height="100%"
          />
        )}
      </div>
    </motion.div>
  );
}

export default memo(CanvasVideoInner);
