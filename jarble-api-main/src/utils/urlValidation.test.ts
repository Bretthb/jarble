import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateExternalUrl } from "./urlValidation.js";

describe("validateExternalUrl", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // ── Valid external URLs ──────────────────────────────────────────────────

  describe("allows valid external URLs", () => {
    it("allows HTTPS URLs to public domains", () => {
      expect(validateExternalUrl("https://api.example.com/skills/weather")).toBe(true);
    });

    it("allows HTTPS URLs with ports", () => {
      expect(validateExternalUrl("https://api.example.com:8443/health")).toBe(true);
    });

    it("allows HTTPS URLs with paths and query strings", () => {
      expect(validateExternalUrl("https://creator.service.io/v1/skills/lookup?version=2")).toBe(true);
    });

    it("allows HTTP in non-production mode", () => {
      process.env.NODE_ENV = "development";
      expect(validateExternalUrl("http://api.example.com/skills/test", { requireHttps: false })).toBe(true);
    });

    it("allows public IPv4 addresses", () => {
      expect(validateExternalUrl("https://93.184.216.34/api")).toBe(true);
    });
  });

  // ── Private IPv4 ranges ──────────────────────────────────────────────────

  describe("blocks private IPv4 ranges (RFC 1918)", () => {
    it("blocks 10.0.0.0/8", () => {
      expect(validateExternalUrl("https://10.0.0.1/api")).toBe(false);
      expect(validateExternalUrl("https://10.255.255.255/api")).toBe(false);
    });

    it("blocks 172.16.0.0/12", () => {
      expect(validateExternalUrl("https://172.16.0.1/api")).toBe(false);
      expect(validateExternalUrl("https://172.31.255.255/api")).toBe(false);
    });

    it("allows 172.32.0.0 (outside /12 range)", () => {
      expect(validateExternalUrl("https://172.32.0.1/api")).toBe(true);
    });

    it("blocks 192.168.0.0/16", () => {
      expect(validateExternalUrl("https://192.168.0.1/api")).toBe(false);
      expect(validateExternalUrl("https://192.168.255.255/api")).toBe(false);
    });
  });

  // ── Loopback ─────────────────────────────────────────────────────────────

  describe("blocks loopback addresses", () => {
    it("blocks 127.0.0.1", () => {
      expect(validateExternalUrl("https://127.0.0.1/api")).toBe(false);
    });

    it("blocks 127.x.x.x range", () => {
      expect(validateExternalUrl("https://127.0.0.2/api")).toBe(false);
      expect(validateExternalUrl("https://127.255.255.255/api")).toBe(false);
    });

    it("blocks localhost hostname", () => {
      expect(validateExternalUrl("https://localhost/api")).toBe(false);
      expect(validateExternalUrl("https://localhost:3000/api")).toBe(false);
    });
  });

  // ── Cloud metadata ───────────────────────────────────────────────────────

  describe("blocks cloud metadata endpoints", () => {
    it("blocks AWS metadata (169.254.169.254)", () => {
      expect(validateExternalUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    });

    it("blocks GCP metadata hostname", () => {
      expect(validateExternalUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
    });

    it("blocks entire 169.254.0.0/16 link-local range", () => {
      expect(validateExternalUrl("https://169.254.0.1/api")).toBe(false);
      expect(validateExternalUrl("https://169.254.255.255/api")).toBe(false);
    });
  });

  // ── IPv6 ─────────────────────────────────────────────────────────────────

  describe("blocks private IPv6 addresses", () => {
    it("blocks ::1 (loopback)", () => {
      expect(validateExternalUrl("https://[::1]/api")).toBe(false);
    });

    it("blocks fc00::/7 (unique local)", () => {
      expect(validateExternalUrl("https://[fc00::1]/api")).toBe(false);
      expect(validateExternalUrl("https://[fd00::1]/api")).toBe(false);
    });

    it("blocks fe80::/10 (link-local)", () => {
      expect(validateExternalUrl("https://[fe80::1]/api")).toBe(false);
    });
  });

  // ── Blocked schemes ──────────────────────────────────────────────────────

  describe("blocks dangerous schemes", () => {
    it("blocks file:// URLs", () => {
      expect(validateExternalUrl("file:///etc/passwd")).toBe(false);
    });

    it("blocks ftp:// URLs", () => {
      expect(validateExternalUrl("ftp://evil.com/file")).toBe(false);
    });

    it("blocks data: URLs", () => {
      expect(validateExternalUrl("data:text/html,<h1>hi</h1>")).toBe(false);
    });

    it("blocks javascript: URLs", () => {
      expect(validateExternalUrl("javascript:alert(1)")).toBe(false);
    });

    it("blocks gopher: URLs", () => {
      expect(validateExternalUrl("gopher://evil.com/")).toBe(false);
    });
  });

  // ── HTTPS requirement ────────────────────────────────────────────────────

  describe("HTTPS enforcement", () => {
    it("blocks HTTP in production", () => {
      process.env.NODE_ENV = "production";
      expect(validateExternalUrl("http://api.example.com/api")).toBe(false);
    });

    it("allows HTTP when requireHttps is explicitly false", () => {
      process.env.NODE_ENV = "production";
      expect(validateExternalUrl("http://api.example.com/api", { requireHttps: false })).toBe(true);
    });

    it("allows HTTP in development by default", () => {
      process.env.NODE_ENV = "development";
      expect(validateExternalUrl("http://api.example.com/api")).toBe(true);
    });
  });

  // ── Malformed URLs ───────────────────────────────────────────────────────

  describe("rejects malformed URLs", () => {
    it("rejects empty string", () => {
      expect(validateExternalUrl("")).toBe(false);
    });

    it("rejects non-URL strings", () => {
      expect(validateExternalUrl("not a url")).toBe(false);
    });

    it("rejects URLs without protocol", () => {
      expect(validateExternalUrl("api.example.com/skills")).toBe(false);
    });
  });

  // ── Internal hostnames ───────────────────────────────────────────────────

  describe("blocks internal hostnames", () => {
    it("blocks .internal domains", () => {
      expect(validateExternalUrl("https://service.internal/api")).toBe(false);
    });

    it("blocks .local domains", () => {
      expect(validateExternalUrl("https://myservice.local/api")).toBe(false);
    });

    it("blocks metadata.internal", () => {
      expect(validateExternalUrl("https://metadata.internal/api")).toBe(false);
    });
  });

  // ── Additional reserved ranges ───────────────────────────────────────────

  describe("blocks additional reserved ranges", () => {
    it("blocks 0.0.0.0/8", () => {
      expect(validateExternalUrl("https://0.0.0.0/api")).toBe(false);
      expect(validateExternalUrl("https://0.0.0.1/api")).toBe(false);
    });

    it("blocks 100.64.0.0/10 (carrier-grade NAT)", () => {
      expect(validateExternalUrl("https://100.64.0.1/api")).toBe(false);
      expect(validateExternalUrl("https://100.127.255.255/api")).toBe(false);
    });

    it("allows 100.128.0.0 (outside CGNAT range)", () => {
      expect(validateExternalUrl("https://100.128.0.1/api")).toBe(true);
    });
  });
});
