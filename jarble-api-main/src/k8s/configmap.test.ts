import { describe, it, expect, vi } from "vitest";

// Mock K8s client to avoid KubeConfig initialization at import time
vi.mock("./client.js", () => ({
  coreApi: {},
}));

// Mock logger to avoid transitive env/db imports
vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { encodeConfigKey, decodeConfigKey } from "./configmap.js";

// ── encodeConfigKey (legacy mode) ────────────────────────────────────────────

describe("encodeConfigKey — legacy mode", () => {
  it("returns relative paths unchanged", () => {
    expect(encodeConfigKey("soul.md")).toBe("soul.md");
  });

  it("encodes nested relative paths with -- separators", () => {
    expect(encodeConfigKey("mcp/jarble-ui-server.js")).toBe("mcp--jarble-ui-server.js");
  });

  it("encodes absolute paths with abs- prefix and -- separators", () => {
    expect(encodeConfigKey("/data/.openclaw/openclaw.json")).toBe(
      "abs-data--.openclaw--openclaw.json"
    );
  });

  it("encodes deeply nested absolute paths", () => {
    expect(encodeConfigKey("/home/openclaw/.openclaw/.openclaw/workspace/SOUL.md")).toBe(
      "abs-home--openclaw--.openclaw--.openclaw--workspace--SOUL.md"
    );
  });

  it("handles root-level absolute path", () => {
    expect(encodeConfigKey("/config.toml")).toBe("abs-config.toml");
  });

  it("defaults to legacy mode when managedBy not specified", () => {
    // Default parameter is "legacy"
    expect(encodeConfigKey("/data/test.md")).toBe("abs-data--test.md");
  });
});

// ── encodeConfigKey (operator mode) ──────────────────────────────────────────

describe("encodeConfigKey — operator mode", () => {
  it("returns relative paths unchanged", () => {
    expect(encodeConfigKey("soul.md", "operator")).toBe("soul.md");
  });

  it("strips absolute paths to basename", () => {
    expect(encodeConfigKey("/data/.openclaw/openclaw.json", "operator")).toBe("openclaw.json");
  });

  it("strips deeply nested absolute paths to basename", () => {
    expect(
      encodeConfigKey("/home/openclaw/.openclaw/.openclaw/workspace/SOUL.md", "operator")
    ).toBe("SOUL.md");
  });

  it("handles root-level absolute path", () => {
    expect(encodeConfigKey("/config.toml", "operator")).toBe("config.toml");
  });

  it("keeps nested relative paths as-is in operator mode", () => {
    expect(encodeConfigKey("mcp/jarble-ui-server.js", "operator")).toBe(
      "mcp/jarble-ui-server.js"
    );
  });
});

// ── decodeConfigKey ──────────────────────────────────────────────────────────

describe("decodeConfigKey", () => {
  it("returns non-abs keys unchanged", () => {
    expect(decodeConfigKey("soul.md")).toBe("soul.md");
  });

  it("decodes abs- prefix back to absolute path", () => {
    expect(decodeConfigKey("abs-data--.openclaw--openclaw.json")).toBe(
      "/data/.openclaw/openclaw.json"
    );
  });

  it("decodes deeply nested abs- keys", () => {
    expect(
      decodeConfigKey("abs-home--openclaw--.openclaw--.openclaw--workspace--SOUL.md")
    ).toBe("/home/openclaw/.openclaw/.openclaw/workspace/SOUL.md");
  });

  it("decodes root-level abs- key", () => {
    expect(decodeConfigKey("abs-config.toml")).toBe("/config.toml");
  });

  it("decodes relative paths with -- back to /", () => {
    expect(decodeConfigKey("mcp--jarble-ui-server.js")).toBe("mcp/jarble-ui-server.js");
  });
});

// ── Round-trip encode → decode ───────────────────────────────────────────────

describe("encodeConfigKey → decodeConfigKey round-trip (legacy)", () => {
  const paths = [
    "soul.md",
    "openclaw.json",
    "mcp/jarble-ui-server.js",
    "/data/.openclaw/openclaw.json",
    "/data/.openclaw/.openclaw/workspace/SOUL.md",
    "/home/openclaw/.openclaw/openclaw.json",
    "/config.toml",
  ];

  for (const path of paths) {
    it(`round-trips "${path}"`, () => {
      // Note: relative paths round-trip exactly.
      // Absolute paths encode with abs- prefix + -- separators, which decode back.
      // BUT nested relative paths like "mcp/jarble-ui-server.js" contain "/"
      // and those don't get abs- prefix, so decodeConfigKey returns them as-is.
      const encoded = encodeConfigKey(path, "legacy");
      const decoded = decodeConfigKey(encoded);
      expect(decoded).toBe(path);
    });
  }
});
