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
} from "./constants.js";

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
