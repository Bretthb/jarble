import { describe, it, expect, vi } from "vitest";

// nodeManager.ts pulls in ./client.js (which constructs a K8s client) and
// ../db/index.js (which throws unless DATABASE_URL is set). Both are
// irrelevant to pickServerType — stub them out so the module imports cleanly
// in a test environment that has neither a kubeconfig nor a DATABASE_URL.
vi.mock("./client.js", () => ({
  coreApi: {},
  appsApi: {},
}));
vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.pg.js", () => ({
  managedNodes: {},
}));

import {
  pickServerType,
  SERVER_TYPES,
  LONGHORN_DISK_OVERHEAD_GB,
} from "./nodeManager.js";

// ── SERVER_TYPES table shape ────────────────────────────────────────────────

describe("SERVER_TYPES table", () => {
  it("contains all 5 expected Hetzner CPX tiers", () => {
    expect(SERVER_TYPES.map((t) => t.name)).toEqual([
      "cpx11",
      "cpx21",
      "cpx31",
      "cpx41",
      "cpx51",
    ]);
  });

  it("every tier exposes diskGb AND usableLonghornGb", () => {
    for (const t of SERVER_TYPES) {
      expect(t.diskGb).toBeGreaterThan(0);
      expect(t.usableLonghornGb).toBeGreaterThan(0);
      expect(t.usableLonghornGb).toBe(t.diskGb - LONGHORN_DISK_OVERHEAD_GB);
    }
  });

  it("usableLonghornGb is monotonically increasing across tiers", () => {
    for (let i = 1; i < SERVER_TYPES.length; i++) {
      expect(SERVER_TYPES[i].usableLonghornGb).toBeGreaterThan(
        SERVER_TYPES[i - 1].usableLonghornGb,
      );
    }
  });

  it("LONGHORN_DISK_OVERHEAD_GB is the documented 11 GiB", () => {
    expect(LONGHORN_DISK_OVERHEAD_GB).toBe(11);
  });

  it("cpx11 usable disk is below 30 GiB (the original bug repro)", () => {
    // The user's 30 GiB PVC ended up on a cpx11 with ~29 GiB usable.
    // This test pins the constant so we never silently regress that value.
    const cpx11 = SERVER_TYPES.find((t) => t.name === "cpx11");
    expect(cpx11).toBeDefined();
    expect(cpx11!.usableLonghornGb).toBeLessThan(30);
  });
});

// ── pickServerType: PVC dimension drives the pick ───────────────────────────

describe("pickServerType — PVC dimension", () => {
  it("a 30 GiB PVC + 1 vCPU + 1 GiB RAM bumps tier from cpx11 → cpx21", () => {
    // Without the PVC check, CPU+RAM alone would pick cpx11.
    // The 30 GiB PVC must force at least cpx21 (80 GiB root, ~69 GiB usable).
    const picked = pickServerType(1, 1, 30);
    expect(picked.name).toBe("cpx21");
  });

  it("a 200 GiB PVC + 1 vCPU + 1 GiB RAM picks cpx41", () => {
    // cpx31 has 160 GiB root, ~149 GiB usable — too small.
    // cpx41 has 240 GiB root, ~229 GiB usable — fits.
    const picked = pickServerType(1, 1, 200);
    expect(picked.name).toBe("cpx41");
  });

  it("a 1000 GiB PVC throws (exceeds even cpx51)", () => {
    // Defense in depth: Layer A should reject this at the router boundary,
    // but the autoscaler must also refuse to silently provision a doomed VPS.
    expect(() => pickServerType(1, 1, 1000)).toThrow(
      /No Hetzner server type fits/,
    );
  });

  it("a 5 GiB PVC + 1 vCPU + 1 GiB RAM still picks cpx11 (small bot stays cheap)", () => {
    // Tiny PVC must NOT bump the tier — cpx11 is the cheapest tier and a
    // 5 GiB PVC fits comfortably in its ~29 GiB usable disk.
    const picked = pickServerType(1, 1, 5);
    expect(picked.name).toBe("cpx11");
  });

  it("PVC defaults to 20 GiB when not provided", () => {
    // 20 GiB fits in cpx11's ~29 GiB usable, so a 1/1/<undefined> bot lands on cpx11.
    const picked = pickServerType(1, 1);
    expect(picked.name).toBe("cpx11");
  });

  it("a PVC exactly equal to usableLonghornGb is allowed", () => {
    // Boundary check: requestedPvcGb <= usableLonghornGb (inclusive).
    const cpx11 = SERVER_TYPES.find((t) => t.name === "cpx11")!;
    const picked = pickServerType(1, 1, cpx11.usableLonghornGb);
    expect(picked.name).toBe("cpx11");
  });

  it("a PVC one GiB over the cpx11 ceiling escalates to cpx21", () => {
    const cpx11 = SERVER_TYPES.find((t) => t.name === "cpx11")!;
    const picked = pickServerType(1, 1, cpx11.usableLonghornGb + 1);
    expect(picked.name).toBe("cpx21");
  });
});

// ── pickServerType: CPU/RAM dimension still works ──────────────────────────

describe("pickServerType — CPU/RAM dimension (existing behavior)", () => {
  it("a 4 vCPU + 6 GiB RAM bot picks cpx31 (the 4-core tier)", () => {
    const picked = pickServerType(4, 6, 20);
    // 4 + 0.5 headroom = 4.5; cpx31 has 4 cores → too small. Should pick cpx41.
    // But CPX series goes 2,3,4,8,16 — so 4 vCPU needs cpx41.
    expect(picked.name).toBe("cpx41");
  });

  it("a 1.5 vCPU + 1.5 GiB RAM bot picks cpx11", () => {
    // 1.5 + 0.5 headroom = 2.0 → cpx11 (2 cores) just fits.
    const picked = pickServerType(1.5, 1.5, 10);
    expect(picked.name).toBe("cpx11");
  });
});

// ── pickServerType: tierOverride validation ────────────────────────────────

describe("pickServerType — tierOverride", () => {
  it("an explicit cpx31 override is honored when the PVC fits", () => {
    const picked = pickServerType(1, 1, 50, "cpx31");
    expect(picked.name).toBe("cpx31");
  });

  it("an explicit cpx11 override that does NOT fit a 30 GiB PVC throws", () => {
    expect(() => pickServerType(1, 1, 30, "cpx11")).toThrow(
      /only has \d+ GiB usable for Longhorn/,
    );
  });

  it("an unknown tier override throws with the list of valid tiers", () => {
    expect(() => pickServerType(1, 1, 10, "cpx99")).toThrow(
      /Unknown Hetzner server type override "cpx99"/,
    );
  });

  it("override does not check CPU/RAM headroom (caller's responsibility)", () => {
    // If the user explicitly picks cpx11, we trust them on CPU/RAM —
    // we only enforce the disk fit because that's the silent-failure mode.
    const picked = pickServerType(8, 16, 5, "cpx11");
    expect(picked.name).toBe("cpx11");
  });
});
