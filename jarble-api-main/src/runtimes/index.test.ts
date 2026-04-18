/**
 * Runtime registry conformance tests.
 *
 * Part of JAR-98 — formalizes the RuntimeHandler interface contract so
 * that adding a new runtime is a pure handler-file addition. This test
 * iterates every registered handler and verifies the runtime shape, not
 * just the compile-time TypeScript annotation.
 *
 * The goal is a smoke-level check that ensures:
 *   1. Every registered handler has the full RuntimeHandler surface.
 *   2. `renderConfigs`, `parseConfigs`, `getSecretEntries`, `validateCreate`
 *      can be invoked on a minimal input without crashing.
 *   3. The `getHandler` / `hasHandler` / `getHandlerOrNull` registry
 *      accessors behave correctly for known + unknown slugs.
 *
 * When a new runtime is added, all it has to do is register in index.ts
 * and these tests will automatically pick it up.
 */

import { describe, it, expect, vi } from "vitest";

// Mock node:fs before importing the registry — openclaw reads
// jarble-ui-server.js at module-load time.
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "// mock MCP server script"),
}));

// Mock env module — real module throws on missing DATABASE_URL / AUTH0_*
// at module load. Tests only exercise the handler methods, not envs.
vi.mock("../utils/env.js", () => ({
  env: {} as Record<string, string | undefined>,
}));

// Mock platformCredentials to avoid a circular import chain through
// configSync when the handler module loads.
vi.mock("../trpc/routers/platformCredentials.js", () => ({
  PLATFORM_CREDENTIAL_KEYS: {},
  PLATFORM_ENV_MAP: {},
}));

import {
  getHandler,
  getHandlerOrNull,
  hasHandler,
  listRegisteredRuntimes,
} from "./index.js";
import type { DeploymentFields } from "./types.js";

/**
 * A minimal DeploymentFields input satisfying the required fields.
 * Handlers should not crash on this (they may skip sections, but should
 * not throw).
 */
function minimalDeployment(runtime: string): DeploymentFields {
  return {
    id: "test-deployment",
    runtime,
    name: "Test Deployment",
    description: null,
    systemPrompt: null,
    llmMode: "managed",
    llmProvider: "openai",
    llmModel: null,
    llmApiKey: null,
  };
}

describe("Runtime registry", () => {
  const slugs = listRegisteredRuntimes();

  it("has at least one registered handler", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  it("openclaw is registered", () => {
    expect(hasHandler("openclaw")).toBe(true);
  });

  it.each(slugs)("'%s' handler has complete RuntimeHandler shape", (slug) => {
    const handler = getHandler(slug);
    // Core identity
    expect(handler.slug).toBe(slug);
    expect(typeof handler.name).toBe("string");
    expect(handler.name.length).toBeGreaterThan(0);

    // Capabilities — all four flags must be booleans
    expect(handler.capabilities).toBeDefined();
    expect(typeof handler.capabilities.needsLlm).toBe("boolean");
    expect(typeof handler.capabilities.hasPlatforms).toBe("boolean");
    expect(typeof handler.capabilities.hasSkills).toBe("boolean");
    expect(typeof handler.capabilities.hasSystemPrompt).toBe("boolean");

    // Config file specs — should be an array (may be empty for runtimes
    // that don't render any files, but the property must exist)
    expect(Array.isArray(handler.configFiles)).toBe(true);

    // Methods — all four required methods must be functions
    expect(typeof handler.renderConfigs).toBe("function");
    expect(typeof handler.parseConfigs).toBe("function");
    expect(typeof handler.getSecretEntries).toBe("function");
    expect(typeof handler.validateCreate).toBe("function");
  });

  it.each(slugs)("'%s' renderConfigs returns an array on minimal input", (slug) => {
    const handler = getHandler(slug);
    const result = handler.renderConfigs(minimalDeployment(slug));
    expect(Array.isArray(result)).toBe(true);
    // Each returned ConfigFile must have `path` + `content` strings
    for (const file of result) {
      expect(typeof file.path).toBe("string");
      expect(typeof file.content).toBe("string");
    }
  });

  it.each(slugs)("'%s' parseConfigs returns a ParsedDeploymentFields object", (slug) => {
    const handler = getHandler(slug);
    const result = handler.parseConfigs([]);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    // llmApiKey must NEVER be returned from parseConfigs (security invariant)
    expect(result).not.toHaveProperty("llmApiKey");
  });

  it.each(slugs)("'%s' getSecretEntries returns a string map", (slug) => {
    const handler = getHandler(slug);
    const result = handler.getSecretEntries(minimalDeployment(slug));
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    for (const [key, value] of Object.entries(result)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
    }
  });

  it.each(slugs)("'%s' validateCreate returns string or null", (slug) => {
    const handler = getHandler(slug);
    const result = handler.validateCreate(minimalDeployment(slug));
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("Registry accessors", () => {
  it("hasHandler returns true for every registered slug", () => {
    for (const slug of listRegisteredRuntimes()) {
      expect(hasHandler(slug)).toBe(true);
    }
  });

  it("hasHandler returns false for an unregistered slug", () => {
    expect(hasHandler("nonexistent-runtime-xyz-123")).toBe(false);
  });

  it("getHandlerOrNull returns null for an unregistered slug", () => {
    expect(getHandlerOrNull("nonexistent-runtime-xyz-123")).toBeNull();
  });

  it("getHandler throws for an unregistered slug", () => {
    expect(() => getHandler("nonexistent-runtime-xyz-123")).toThrow(
      /No runtime handler registered/,
    );
  });

  it("slug returned from listRegisteredRuntimes matches handler.slug", () => {
    for (const slug of listRegisteredRuntimes()) {
      const handler = getHandler(slug);
      expect(handler.slug).toBe(slug);
    }
  });
});
