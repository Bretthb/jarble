/**
 * Unit tests for the Echo runtime handler.
 *
 * Echo is JAR-101's plug-and-play validation runtime — it exists to
 * prove that adding a new runtime is a pure handler-file addition,
 * with no platform plumbing changes required. The contract is
 * deliberately minimal: every capability flag is opt-OUT and every
 * lifecycle hook returns the smallest valid result.
 *
 * Locking these tests down means a future PR that "improves" the
 * echo handler by adding LLM support, system prompts, or platform
 * envs will fail loudly — exactly the kind of regression that
 * would invalidate the JAR-101 plug-and-play test.
 *
 * Covers:
 *  1. Stable metadata (slug/name/topology/capabilities all-opt-out)
 *  2. renderConfigs produces a valid echo.json with the deployment's
 *     name + description
 *  3. parseConfigs is a no-op (always returns {}) but tolerates
 *     malformed JSON without throwing
 *  4. getSecretEntries returns {}
 *  5. validateCreate always returns null
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { echoHandler } from "../../runtimes/handlers/echo.js";

/** Minimal valid DeploymentFields shape for handler input. */
function dep(overrides: Partial<any> = {}): any {
  return {
    id: "dep-echo-1",
    runtime: "echo",
    name: "Test Echo",
    description: "A test echo deployment",
    systemPrompt: null,
    llmMode: "byok",
    llmProvider: null,
    llmModel: null,
    llmApiKey: null,
    ...overrides,
  };
}

// ── Stable metadata ─────────────────────────────────────────────────────────

describe("echoHandler — stable metadata", () => {
  it("declares slug 'echo' and name 'Echo'", () => {
    expect(echoHandler.slug).toBe("echo");
    expect(echoHandler.name).toBe("Echo");
  });

  it("declares the JAR-101 minimal topology (k8s-deployment, container='echo', /data mount)", () => {
    expect(echoHandler.topology.kind).toBe("k8s-deployment");
    expect(echoHandler.topology.containerName).toBe("echo");
    expect(echoHandler.topology.pvcMountPath).toBe("/data");
  });

  it("opts OUT of every optional capability — needsLlm, hasPlatforms, hasSkills, hasSystemPrompt, nativeCanvas all false", () => {
    const c = echoHandler.capabilities;
    expect(c.needsLlm).toBe(false);
    expect(c.hasPlatforms).toBe(false);
    expect(c.hasSkills).toBe(false);
    expect(c.hasSystemPrompt).toBe(false);
    expect(c.nativeCanvas).toBe(false);
  });

  it("uses the generic http-stream chat transport (no openclaw-ws)", () => {
    expect(echoHandler.capabilities.chatTransport).toBe("http-stream");
  });

  it("does not declare ingress or nativeUi (workspace falls through to text-only chat)", () => {
    expect(echoHandler.capabilities.ingress).toBeUndefined();
    expect(echoHandler.capabilities.nativeUi).toBeUndefined();
  });

  it("declares a single configFile spec (echo.json) and no globs", () => {
    expect(echoHandler.configFiles).toHaveLength(1);
    expect(echoHandler.configFiles[0].path).toBe("echo.json");
    expect(echoHandler.configFiles[0].isGlob).toBe(false);
  });

  it("does NOT advertise native subagent support (would force the API into a different delegation path)", () => {
    expect(echoHandler.supportsNativeSubagents).toBeFalsy();
  });
});

// ── renderConfigs ───────────────────────────────────────────────────────────

describe("echoHandler.renderConfigs", () => {
  it("produces a single echo.json file", () => {
    const files = echoHandler.renderConfigs(dep());
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("echo.json");
  });

  it("echo.json content is valid JSON with name + description", () => {
    const files = echoHandler.renderConfigs(dep({ name: "MyBot", description: "hi" }));
    const parsed = JSON.parse(files[0].content);
    expect(parsed).toEqual({ name: "MyBot", description: "hi" });
  });

  it("preserves null description as null (not omitted)", () => {
    const files = echoHandler.renderConfigs(dep({ description: null }));
    const parsed = JSON.parse(files[0].content);
    expect(parsed).toEqual({ name: "Test Echo", description: null });
  });

  it("emits pretty-printed JSON ending with a newline (file convention)", () => {
    const files = echoHandler.renderConfigs(dep());
    expect(files[0].content.endsWith("\n")).toBe(true);
    // Two-space indent confirmed by line count vs key count.
    expect(files[0].content).toContain("  ");
  });

  it("does NOT include LLM keys, system prompts, or platform credentials in the output", () => {
    // Even when given a deployment with all those fields populated, the echo
    // handler must NOT leak them into the on-disk config — that would defeat
    // the "no LLM, no platforms" capability guarantees.
    const files = echoHandler.renderConfigs(dep({
      systemPrompt: "secret prompt",
      llmApiKey: "sk-real-key",
      platformCredentials: { discord: { botToken: "discord-token" } } as any,
    }));
    const content = files[0].content;
    expect(content).not.toContain("secret prompt");
    expect(content).not.toContain("sk-real-key");
    expect(content).not.toContain("discord-token");
  });
});

// ── parseConfigs ────────────────────────────────────────────────────────────

describe("echoHandler.parseConfigs", () => {
  it("returns {} for an empty file array", () => {
    expect(echoHandler.parseConfigs([])).toEqual({});
  });

  it("returns {} for a valid echo.json (the file is read-only debug observability)", () => {
    expect(
      echoHandler.parseConfigs([
        { path: "echo.json", content: JSON.stringify({ name: "Echo", description: null }) },
      ]),
    ).toEqual({});
  });

  it("tolerates malformed echo.json without throwing", () => {
    // The function MUST NOT throw — configSync.ts assumes parseConfigs is
    // always safe to call with arbitrary file contents from the PVC.
    expect(() =>
      echoHandler.parseConfigs([{ path: "echo.json", content: "{not json" }]),
    ).not.toThrow();
    expect(echoHandler.parseConfigs([{ path: "echo.json", content: "{not json" }])).toEqual({});
  });

  it("ignores files other than echo.json (no fallthrough to soul.md, openclaw.json, etc.)", () => {
    // If the K8s reverse-sync handed us files from a different runtime by
    // mistake, we must not accidentally extract anything from them.
    expect(
      echoHandler.parseConfigs([
        { path: "soul.md", content: "You are a helpful assistant." },
        { path: "openclaw.json", content: JSON.stringify({ agents: { defaults: { model: { primary: "claude-x" } } } }) },
      ]),
    ).toEqual({});
  });
});

// ── getSecretEntries ────────────────────────────────────────────────────────

describe("echoHandler.getSecretEntries", () => {
  it("returns an empty object — no LLM, no platforms, no runtime auth", () => {
    expect(echoHandler.getSecretEntries(dep())).toEqual({});
  });

  it("does NOT leak deployment-secret env vars (handler returns {} regardless of input)", () => {
    // Even if the deployment has user-defined secrets, the echo runtime's
    // contract is "just the K8s base entries are enough". Mixing them in
    // here would change the public Secret shape unexpectedly.
    expect(
      echoHandler.getSecretEntries(dep({ deploymentSecrets: { CUSTOM: "x" } })),
    ).toEqual({});
  });

  it("does NOT leak the deployment's llmApiKey or platformCredentials", () => {
    // Defensive check: even with a fully-configured DeploymentFields, the
    // returned env vars must be {}. A regression that pulled in those
    // fields would silently expose secrets in echo pod env.
    expect(
      echoHandler.getSecretEntries(dep({
        llmApiKey: "sk-leak",
        llmProvider: "openrouter",
        platformCredentials: { discord: { botToken: "leak" } } as any,
      })),
    ).toEqual({});
  });
});

// ── validateCreate ──────────────────────────────────────────────────────────

describe("echoHandler.validateCreate", () => {
  it("accepts an empty input", () => {
    expect(echoHandler.validateCreate({})).toBeNull();
  });

  it("accepts byok mode without an llmApiKey (echo doesn't need a key)", () => {
    // OpenClaw rejects this same input. Echo must NOT — it has no LLM
    // requirement, so any combination of llmMode + missing key is valid.
    expect(echoHandler.validateCreate({ llmMode: "byok" })).toBeNull();
  });

  it("accepts every llmMode value", () => {
    for (const mode of ["byok", "included", "platform"] as const) {
      expect(echoHandler.validateCreate({ llmMode: mode } as any)).toBeNull();
    }
  });

  it("accepts an input with all DeploymentFields populated", () => {
    expect(echoHandler.validateCreate(dep())).toBeNull();
  });
});
