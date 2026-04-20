/**
 * Chat adapter registry tests (JAR-121).
 */

import { describe, it, expect, vi } from "vitest";

// Mock node:fs before importing the registry — openclaw reads
// jarble-ui-server.js at module-load time.
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "// mock MCP server script"),
}));

// Mock env module.
vi.mock("../../utils/env.js", () => ({
  env: {} as Record<string, string | undefined>,
}));

// Mock platformCredentials to avoid a circular import chain.
vi.mock("../../trpc/routers/platformCredentials.js", () => ({
  PLATFORM_CREDENTIAL_KEYS: {},
  PLATFORM_ENV_MAP: {},
}));

import { getChatAdapter, listTransports } from "./index.js";

describe("chat adapter registry", () => {
  it("lists the canonical set of transports", () => {
    const transports = listTransports();
    expect(transports).toContain("openclaw-ws");
    expect(transports).toContain("http-stream");
    expect(transports).toContain("none");
  });

  it("resolves openclaw → the openclaw adapter", () => {
    const adapter = getChatAdapter("openclaw");
    expect(adapter).not.toBeNull();
    expect(adapter?.transport).toBe("openclaw-ws");
    expect(adapter?.canHandle("openclaw")).toBe(true);
  });

  it("resolves zeroclaw → the http-stream adapter", () => {
    const adapter = getChatAdapter("zeroclaw");
    expect(adapter).not.toBeNull();
    expect(adapter?.transport).toBe("http-stream");
  });

  it("returns null for an unknown runtime slug", () => {
    expect(getChatAdapter("nonexistent-runtime-xyz-123")).toBeNull();
  });
});
