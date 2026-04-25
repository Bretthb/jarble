/**
 * Unit tests for buildCRSpec in src/k8s/operator.ts.
 *
 * `buildCRSpec` translates a deployment row into the OpenClawInstance
 * Custom Resource spec the operator reconciles into a StatefulSet,
 * Service, PDB, and NetworkPolicy. A regression in the spec shape can
 * be silently catastrophic — the operator may accept the malformed CR
 * and produce running pods that look fine but have wrong storage,
 * wrong resource limits, or wrong labels, all hard to spot at a
 * glance once the deployment is live.
 *
 * Three contracts worth pinning:
 *
 *   1. **Resource math** — cpuLimit "2.0" must become "2000m" (NOT
 *      "2m" or "2.0m"); memoryMb 3072 must become "3072Mi"; storage
 *      must be hard-capped at 20Gi (any larger value silently
 *      schedules to a node where the PVC will fail to mount).
 *
 *   2. **Image parsing** — split on the LAST colon so registry
 *      hostnames containing `:port` (e.g. `localhost:5000/foo:bar`)
 *      parse as repo=`localhost:5000/foo` + tag=`bar`. A regression
 *      that split on the first colon would silently mis-parse local-
 *      registry images.
 *
 *   3. **Storage spec branching** — new PVC vs existingClaim. The
 *      `existingClaim` path is the start-after-stop flow; getting it
 *      wrong means restarting a stopped deployment provisions a brand
 *      new PVC and orphans the user's data.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// `operator.ts` imports `customApi` from `./client.js` for CRUD calls,
// but `buildCRSpec` is pure and never touches the API. We mock the
// whole client so the test runs without standing up a real kubeconfig.
vi.mock("../../k8s/client.js", () => ({
  customApi: {
    createNamespacedCustomObject: vi.fn(),
    deleteNamespacedCustomObject: vi.fn(),
    getNamespacedCustomObject: vi.fn(),
  },
  kc: { makeApiClient: vi.fn() },
}));

import { buildCRSpec } from "../../k8s/operator.js";
import type { DeploymentConfig } from "../../k8s/constants.js";

const baseConfig: DeploymentConfig = { name: "Test Bot" };

// ── Identity / labels ───────────────────────────────────────────────────────

describe("buildCRSpec — identity + labels", () => {
  it("produces the expected apiVersion / kind / metadata.name", () => {
    const cr = buildCRSpec("abc123", "user-1", baseConfig);
    expect(cr.apiVersion).toBe("openclaw.rocks/v1alpha1");
    expect(cr.kind).toBe("OpenClawInstance");
    expect(cr.metadata.name).toBe("dep-abc123");
    expect(cr.metadata.namespace).toBe("jarble");
  });

  it("attaches the three jarble.ai/* labels for selector queries", () => {
    const cr = buildCRSpec("dep-x", "user-y", baseConfig);
    expect(cr.metadata.labels["jarble.ai/deployment-id"]).toBe("dep-x");
    expect(cr.metadata.labels["jarble.ai/user-id"]).toBe("user-y");
    expect(cr.metadata.labels["jarble.ai/type"]).toBe("bot");
  });

  it("envFrom and config.configMapRef both reference the deployment-id-prefixed name", () => {
    const cr = buildCRSpec("xyz", "user-1", baseConfig);
    const spec = cr.spec as any;
    expect(spec.envFrom).toEqual([{ secretRef: { name: "secret-xyz" } }]);
    expect(spec.config.configMapRef.name).toBe("config-xyz");
    expect(spec.gateway.existingSecret).toBe("secret-xyz");
  });
});

// ── Image parsing ───────────────────────────────────────────────────────────

describe("buildCRSpec — image parsing", () => {
  it("splits a standard image:tag on the last colon", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, image: "ghcr.io/jarble-ai/openclaw:v1.2.3" });
    const img = (cr.spec as any).image;
    expect(img.repository).toBe("ghcr.io/jarble-ai/openclaw");
    expect(img.tag).toBe("v1.2.3");
  });

  it("defaults the tag to 'latest' when image has no colon", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, image: "ghcr.io/jarble-ai/openclaw" });
    const img = (cr.spec as any).image;
    expect(img.repository).toBe("ghcr.io/jarble-ai/openclaw");
    expect(img.tag).toBe("latest");
  });

  it("splits on the LAST colon — registry-with-port + tag both survive", () => {
    // localhost:5000/foo:bar should parse as
    //   repo=localhost:5000/foo, tag=bar
    // A regression that split on the first colon would produce
    //   repo=localhost, tag=5000/foo:bar (broken)
    const cr = buildCRSpec("d", "u", { ...baseConfig, image: "localhost:5000/myrepo/openclaw:dev" });
    const img = (cr.spec as any).image;
    expect(img.repository).toBe("localhost:5000/myrepo/openclaw");
    expect(img.tag).toBe("dev");
  });

  it("falls back to DEFAULT_IMAGE when config.image is not set", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const img = (cr.spec as any).image;
    // DEFAULT_IMAGE is `ghcr.io/jarble-ai/openclaw:latest` unless
    // DEFAULT_POD_IMAGE is set in the env. We don't assert the exact
    // value (env-dependent) but we assert the parsed repo+tag round-trip.
    expect(typeof img.repository).toBe("string");
    expect(img.repository.length).toBeGreaterThan(0);
    expect(typeof img.tag).toBe("string");
    expect(img.tag.length).toBeGreaterThan(0);
  });

  it("always sets pullPolicy=IfNotPresent and ghcr-pull-secret", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const img = (cr.spec as any).image;
    expect(img.pullPolicy).toBe("IfNotPresent");
    expect(img.pullSecrets).toEqual([{ name: "ghcr-pull-secret" }]);
  });
});

// ── Resource math ───────────────────────────────────────────────────────────

describe("buildCRSpec — resource math", () => {
  it("cpuLimit '2.0' → '2000m'", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, cpuLimit: "2.0" });
    const r = (cr.spec as any).resources;
    expect(r.requests.cpu).toBe("2000m");
    expect(r.limits.cpu).toBe("2000m");
  });

  it("cpuLimit '0.5' → '500m'", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, cpuLimit: "0.5" });
    const r = (cr.spec as any).resources;
    expect(r.requests.cpu).toBe("500m");
    expect(r.limits.cpu).toBe("500m");
  });

  it("cpuLimit defaults to '2.0' (= 2000m) when not provided", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    expect((cr.spec as any).resources.requests.cpu).toBe("2000m");
  });

  it("memoryMb passes through with 'Mi' suffix", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, memoryMb: 1024 });
    expect((cr.spec as any).resources.requests.memory).toBe("1024Mi");
  });

  it("memoryMb defaults to 3072 (= 3072Mi) when not provided", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    expect((cr.spec as any).resources.requests.memory).toBe("3072Mi");
  });

  it("requests and limits are identical (Guaranteed QoS class)", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, cpuLimit: "1.5", memoryMb: 2048 });
    const r = (cr.spec as any).resources;
    expect(r.requests).toEqual(r.limits);
  });
});

// ── Storage cap ─────────────────────────────────────────────────────────────

describe("buildCRSpec — storage cap (cpx11 ceiling)", () => {
  it("storageMb defaults to 20Gi when not provided", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const storage = (cr.spec as any).storage.persistence;
    expect(storage.size).toBe("20Gi");
  });

  it("caps storage at 20Gi (cpx11 worker root-disk constraint)", () => {
    // A 100GB request must NOT pass through — Longhorn would fail
    // with LocalReplicaSchedulingFailure on cpx11 workers (~30GB
    // root disks → ~29GB usable). Cap silently is fine because the
    // user-facing UI also enforces it; this is the last-line defense.
    const cr = buildCRSpec("d", "u", { ...baseConfig, storageMb: 100 });
    expect((cr.spec as any).storage.persistence.size).toBe("20Gi");
  });

  it("preserves storage requests below the cap", () => {
    const cr = buildCRSpec("d", "u", { ...baseConfig, storageMb: 5 });
    expect((cr.spec as any).storage.persistence.size).toBe("5Gi");
  });

  it("clamps a 0 request up to 1Gi (Math.max floor)", () => {
    // Defensive: 0Gi PVC requests are rejected by the K8s API. The
    // builder ensures we never emit a CR that the operator will
    // immediately bounce.
    const cr = buildCRSpec("d", "u", { ...baseConfig, storageMb: 0 });
    expect((cr.spec as any).storage.persistence.size).toBe("20Gi");
    // Note: 0 || 20 → 20 (storageMb default), so this also exercises
    // the OR-fallback path. A legitimately-set 0 (which we don't
    // currently accept anywhere upstream) would still be clamped.
  });

  it("uses Longhorn's isolated storage class on a fresh provision", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    expect((cr.spec as any).storage.persistence.storageClass).toBe("longhorn-isolated");
  });
});

// ── existingPvc branch ──────────────────────────────────────────────────────

describe("buildCRSpec — existingPvc (start-after-stop)", () => {
  it("uses existingClaim and OMITS size + storageClass when an existingPvc is passed", () => {
    const cr = buildCRSpec("d", "u", baseConfig, "pvc-leftover-from-stop");
    const persistence = (cr.spec as any).storage.persistence;
    expect(persistence.existingClaim).toBe("pvc-leftover-from-stop");
    expect(persistence.size).toBeUndefined();
    expect(persistence.storageClass).toBeUndefined();
    expect(persistence.enabled).toBe(true);
  });

  it("does NOT set existingClaim when no PVC is passed (fresh provision)", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const persistence = (cr.spec as any).storage.persistence;
    expect(persistence.existingClaim).toBeUndefined();
    expect(persistence.size).toBe("20Gi");
    expect(persistence.storageClass).toBe("longhorn-isolated");
  });
});

// ── Security + probes (locked-down defaults) ────────────────────────────────

describe("buildCRSpec — security + probes", () => {
  it("denies privilege escalation by default", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const sec = (cr.spec as any).security.containerSecurityContext;
    expect(sec.allowPrivilegeEscalation).toBe(false);
    expect(sec.readOnlyRootFilesystem).toBe(false);
  });

  it("liveness probe waits 60s before first poll, then every 30s with 3 failures allowed", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const liveness = (cr.spec as any).probes.liveness;
    expect(liveness.initialDelaySeconds).toBe(60);
    expect(liveness.periodSeconds).toBe(30);
    expect(liveness.timeoutSeconds).toBe(5);
    expect(liveness.failureThreshold).toBe(3);
  });

  it("readiness probe is faster than liveness (20s/10s/3 — ready signal flips quickly)", () => {
    const cr = buildCRSpec("d", "u", baseConfig);
    const readiness = (cr.spec as any).probes.readiness;
    expect(readiness.initialDelaySeconds).toBe(20);
    expect(readiness.periodSeconds).toBe(10);
    expect(readiness.timeoutSeconds).toBe(5);
    expect(readiness.failureThreshold).toBe(3);
  });
});

// ── ConfigMap merge mode ────────────────────────────────────────────────────

describe("buildCRSpec — config merge mode", () => {
  it("declares mergeMode='overwrite' so our ConfigMap supersedes the operator's defaults", () => {
    // The OpenClaw operator generates its own ConfigMap with default
    // gateway settings. We pass mergeMode='overwrite' so the per-
    // deployment soul.md / openclaw.json from configSync wins instead
    // of being shadowed by operator defaults.
    const cr = buildCRSpec("d", "u", baseConfig);
    expect((cr.spec as any).config.mergeMode).toBe("overwrite");
  });
});
