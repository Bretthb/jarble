import { describe, it, expect } from "vitest";
import {
  NAMESPACE,
  DEFAULT_IMAGE,
  RUNTIME_PORTS,
  CRD_GROUP,
  CRD_VERSION,
  CRD_PLURAL,
  LEGACY_CONTAINER_NAME,
  OPERATOR_CONTAINER_NAME,
  LEGACY_PVC_MOUNT,
  OPERATOR_PVC_MOUNT,
  getContainerName,
  getPvcMountPath,
  getContainerHome,
  podLabelSelector,
  RESOURCE_TIERS,
} from "./constants.js";
import type { ResourceTier } from "./constants.js";

// ── Exported constants ───────────────────────────────────────────────────────

describe("K8s constants", () => {
  it("NAMESPACE is jarble", () => {
    expect(NAMESPACE).toBe("jarble");
  });

  it("DEFAULT_IMAGE contains openclaw", () => {
    expect(DEFAULT_IMAGE).toContain("openclaw");
  });

  it("RUNTIME_PORTS has openclaw on 18789", () => {
    expect(RUNTIME_PORTS.openclaw).toBe(18789);
  });

  it("RUNTIME_PORTS has zeroclaw on 3000", () => {
    expect(RUNTIME_PORTS.zeroclaw).toBe(3000);
  });

  it("CRD constants are correct", () => {
    expect(CRD_GROUP).toBe("openclaw.rocks");
    expect(CRD_VERSION).toBe("v1alpha1");
    expect(CRD_PLURAL).toBe("openclawinstances");
  });

  it("dual-mode container name constants", () => {
    expect(LEGACY_CONTAINER_NAME).toBe("runtime");
    expect(OPERATOR_CONTAINER_NAME).toBe("openclaw");
  });

  it("dual-mode PVC mount constants", () => {
    expect(LEGACY_PVC_MOUNT).toBe("/data");
    expect(OPERATOR_PVC_MOUNT).toBe("/home/openclaw/.openclaw");
  });
});

// ── getContainerName ─────────────────────────────────────────────────────────

describe("getContainerName", () => {
  it("returns 'runtime' for legacy mode", () => {
    expect(getContainerName("legacy")).toBe("runtime");
  });

  it("returns 'openclaw' for operator mode", () => {
    expect(getContainerName("operator")).toBe("openclaw");
  });
});

// ── getPvcMountPath ──────────────────────────────────────────────────────────

describe("getPvcMountPath", () => {
  it("returns /data for legacy mode", () => {
    expect(getPvcMountPath("legacy")).toBe("/data");
  });

  it("returns /home/openclaw/.openclaw for operator mode", () => {
    expect(getPvcMountPath("operator")).toBe("/home/openclaw/.openclaw");
  });
});

// ── getContainerHome ─────────────────────────────────────────────────────────

describe("getContainerHome", () => {
  it("returns /data for legacy mode", () => {
    expect(getContainerHome("legacy")).toBe("/data");
  });

  it("returns /home/openclaw for operator mode", () => {
    expect(getContainerHome("operator")).toBe("/home/openclaw");
  });
});

// ── podLabelSelector ─────────────────────────────────────────────────────────

describe("podLabelSelector", () => {
  it("returns app=dep-{id} for legacy mode", () => {
    expect(podLabelSelector("abc123", "legacy")).toBe("app=dep-abc123");
  });

  it("returns app.kubernetes.io/instance=dep-{id} for operator mode", () => {
    expect(podLabelSelector("abc123", "operator")).toBe(
      "app.kubernetes.io/instance=dep-abc123"
    );
  });

  it("handles deployment IDs with special characters", () => {
    expect(podLabelSelector("r99hdxw7r9g8", "legacy")).toBe("app=dep-r99hdxw7r9g8");
  });
});

// ── RESOURCE_TIERS ──────────────────────────────────────────────────────────

describe("RESOURCE_TIERS", () => {
  const tierNames: ResourceTier[] = ["small", "medium", "large"];

  it("defines all three tiers (small, medium, large)", () => {
    expect(Object.keys(RESOURCE_TIERS)).toEqual(tierNames);
  });

  it.each(tierNames)("%s tier has cpuLimit, memoryMb, and storageMb", (tier) => {
    const t = RESOURCE_TIERS[tier];
    expect(t).toHaveProperty("cpuLimit");
    expect(t).toHaveProperty("memoryMb");
    expect(t).toHaveProperty("storageMb");
  });

  it.each(tierNames)("%s tier cpuLimit is a parseable numeric string", (tier) => {
    const cpu = RESOURCE_TIERS[tier].cpuLimit;
    expect(typeof cpu).toBe("string");
    const parsed = parseFloat(cpu);
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).not.toBeNaN();
  });

  it.each(tierNames)("%s tier memoryMb is a positive number", (tier) => {
    expect(RESOURCE_TIERS[tier].memoryMb).toBeGreaterThan(0);
    expect(Number.isInteger(RESOURCE_TIERS[tier].memoryMb)).toBe(true);
  });

  it.each(tierNames)("%s tier storageMb is a positive number", (tier) => {
    expect(RESOURCE_TIERS[tier].storageMb).toBeGreaterThan(0);
    expect(Number.isInteger(RESOURCE_TIERS[tier].storageMb)).toBe(true);
  });

  it("tiers are ordered: small < medium < large for cpuLimit", () => {
    const small = parseFloat(RESOURCE_TIERS.small.cpuLimit);
    const medium = parseFloat(RESOURCE_TIERS.medium.cpuLimit);
    const large = parseFloat(RESOURCE_TIERS.large.cpuLimit);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  it("tiers are ordered: small < medium < large for memoryMb", () => {
    expect(RESOURCE_TIERS.small.memoryMb).toBeLessThan(RESOURCE_TIERS.medium.memoryMb);
    expect(RESOURCE_TIERS.medium.memoryMb).toBeLessThan(RESOURCE_TIERS.large.memoryMb);
  });

  it("tiers are ordered: small < medium < large for storageMb", () => {
    expect(RESOURCE_TIERS.small.storageMb).toBeLessThan(RESOURCE_TIERS.medium.storageMb);
    expect(RESOURCE_TIERS.medium.storageMb).toBeLessThan(RESOURCE_TIERS.large.storageMb);
  });

  it("ResourceTier type matches the tier keys", () => {
    // Type-level check: assigning each valid key to ResourceTier compiles
    const s: ResourceTier = "small";
    const m: ResourceTier = "medium";
    const l: ResourceTier = "large";
    // Runtime check: the keys are usable as index
    expect(RESOURCE_TIERS[s]).toBeDefined();
    expect(RESOURCE_TIERS[m]).toBeDefined();
    expect(RESOURCE_TIERS[l]).toBeDefined();
  });
});
