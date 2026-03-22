import { describe, it, expect } from "vitest";
import {
  getEmbedUrl,
  isAllowedOrigin,
  detectProvider,
  domainMatch,
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

    it("converts Google Maps search query URL", () => {
      const result = getEmbedUrl("https://www.google.com/maps?q=Paris+France");
      expect(result).toContain("https://www.google.com/maps/embed/v1/search");
      expect(result).toContain(encodeURIComponent("Paris France"));
    });

    it("converts OpenStreetMap hash URL to embed", () => {
      const result = getEmbedUrl("https://www.openstreetmap.org/#map=15/51.5074/-0.1278");
      expect(result).toContain("https://www.openstreetmap.org/export/embed.html");
      expect(result).toContain("marker=51.5074,-0.1278");
    });

    it("converts YouTube live URL to embed", () => {
      const result = getEmbedUrl("https://www.youtube.com/live/abc123");
      expect(result).toBe("https://www.youtube.com/embed/abc123");
    });

    it("converts Twitch channel URL to embed", () => {
      const result = getEmbedUrl("https://www.twitch.tv/shroud");
      expect(result).toContain("https://player.twitch.tv/");
      expect(result).toContain("channel=shroud");
    });

    it("converts Twitch video URL to embed", () => {
      const result = getEmbedUrl("https://www.twitch.tv/videos/123456");
      expect(result).toContain("https://player.twitch.tv/");
      expect(result).toContain("video=123456");
    });

    it("passes through SoundCloud widget URLs", () => {
      const url = "https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/artist/track";
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

    it("rejects subdomain bypass attempts", () => {
      expect(isAllowedOrigin("https://evil-youtube.com/embed/abc")).toBe(false);
      expect(isAllowedOrigin("https://xcodepen.io/user/embed/abc")).toBe(false);
      expect(isAllowedOrigin("https://notspotify.com/embed/track/abc")).toBe(false);
    });

    it("allows resolved URLs from subdomain-spoofed input", () => {
      // getEmbedUrl hardcodes to real origins, so the result is always allowed
      const result = getEmbedUrl("https://evil-youtube.com/watch?v=abc");
      // evil-youtube.com won't match domainMatch, so getEmbedUrl returns null
      expect(result).toBeNull();
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

  // ── Domain Matching ─────────────────────────────────────────────────

  describe("domainMatch", () => {
    it("matches exact domain", () => {
      expect(domainMatch("youtube.com", "youtube.com")).toBe(true);
    });

    it("matches subdomain", () => {
      expect(domainMatch("www.youtube.com", "youtube.com")).toBe(true);
      expect(domainMatch("m.youtube.com", "youtube.com")).toBe(true);
    });

    it("rejects prefix-spoofed domains", () => {
      expect(domainMatch("evil-youtube.com", "youtube.com")).toBe(false);
      expect(domainMatch("notyoutube.com", "youtube.com")).toBe(false);
    });

    it("rejects partial matches for short domains", () => {
      expect(domainMatch("fax.com", "x.com")).toBe(false);
      expect(domainMatch("tax.com", "x.com")).toBe(false);
    });

    it("matches x.com exactly", () => {
      expect(domainMatch("x.com", "x.com")).toBe(true);
      expect(domainMatch("mobile.x.com", "x.com")).toBe(true);
    });
  });
});
