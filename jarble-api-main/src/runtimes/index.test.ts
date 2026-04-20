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

    // JAR-119 Phase 2 — new capability flags must all be declared.
    expect(typeof handler.capabilities.nativeCanvas).toBe("boolean");
    expect(["hot", "restart", "recreate"]).toContain(
      handler.capabilities.modelSwitch,
    );
    if (handler.capabilities.canvasProtocol !== undefined) {
      expect(typeof handler.capabilities.canvasProtocol).toBe("string");
    }

    // JAR-120 Phase 3 — ingress descriptor (optional) must have valid shape.
    if (handler.capabilities.ingress !== undefined) {
      expect(typeof handler.capabilities.ingress.port).toBe("number");
      expect(handler.capabilities.ingress.port).toBeGreaterThan(0);
      expect(["gateway-token", "bearer-header", "none"]).toContain(
        handler.capabilities.ingress.authStrategy,
      );
    }

    // JAR-120 Phase 3 — topology descriptor is required.
    expect(handler.topology).toBeDefined();
    expect(["k8s-deployment", "operator-crd"]).toContain(handler.topology.kind);
    expect(typeof handler.topology.containerName).toBe("string");
    expect(handler.topology.containerName.length).toBeGreaterThan(0);
    expect(typeof handler.topology.pvcMountPath).toBe("string");
    expect(handler.topology.pvcMountPath.startsWith("/")).toBe(true);
    if (handler.topology.kind === "operator-crd") {
      expect(typeof handler.topology.operatorGroupVersion).toBe("string");
    }

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

  // JAR-118 — PVC layout contract. See src/runtimes/pvc-layout.md.
  // Handlers may not write to reserved prefixes. secrets/* belongs to the K8s
  // Secret mount; memory/* is runtime-writable only and a boot-time write
  // would race against the running process.
  const FORBIDDEN_PREFIXES = ["secrets/", "memory/", "/data/secrets/", "/data/memory/"];

  it.each(slugs)(
    "'%s' renderConfigs does not write to reserved prefixes (secrets/, memory/)",
    (slug) => {
      const handler = getHandler(slug);
      const result = handler.renderConfigs(minimalDeployment(slug));
      for (const file of result) {
        for (const forbidden of FORBIDDEN_PREFIXES) {
          expect(
            file.path.startsWith(forbidden),
            `handler ${slug} renderConfigs returned a path in reserved prefix ${forbidden}: ${file.path}`,
          ).toBe(false);
        }
      }
    },
  );

  // Negative case — proves the lint above actually fires on a bad handler.
  // A real handler that returned `secrets/my-token.json` would violate the
  // PVC contract; this mock verifies the assertion catches it.
  it("reserved-prefix lint catches a bogus handler writing to secrets/", () => {
    const bogusFiles = [
      { path: "configs/ok.json", content: "{}" },
      { path: "secrets/leak.json", content: "oops" },
    ];
    const violations = bogusFiles.filter((f) =>
      FORBIDDEN_PREFIXES.some((prefix) => f.path.startsWith(prefix)),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe("secrets/leak.json");
  });

  it("reserved-prefix lint catches a bogus handler writing to memory/", () => {
    const bogusFiles = [{ path: "memory/store.json", content: "{}" }];
    const violations = bogusFiles.filter((f) =>
      FORBIDDEN_PREFIXES.some((prefix) => f.path.startsWith(prefix)),
    );
    expect(violations).toHaveLength(1);
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

  // JAR-119 Phase 2 — optional getProbes hook.
  it.each(slugs)("'%s' getProbes (if defined) returns a probe object", (slug) => {
    const handler = getHandler(slug);
    if (!handler.getProbes) return; // optional — default /healthz probes apply
    const result = handler.getProbes({ port: 18789 });
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    // At least one probe must be returned; each probe must have exactly
    // one of httpGet / exec / tcpSocket.
    const probes = [result.liveness, result.readiness, result.startup].filter(
      (p) => p !== undefined,
    );
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      const hasExactlyOneAction =
        [probe.httpGet, probe.exec, probe.tcpSocket].filter(Boolean).length === 1;
      expect(hasExactlyOneAction).toBe(true);
    }
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
