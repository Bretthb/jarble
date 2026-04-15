import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks for K8s + db so nodeManager imports cleanly ──────────────────────
// pickServerType needs none of these at runtime, but checkScaleDown exercises
// coreApi.listNamespacedPod, appsApi.listNamespacedDeployment, db.select/update
// and the deprovisionNode path (patchNode/deleteNode + hetznerRequest via fetch).

const hoisted = vi.hoisted(() => {
  const state = {
    readyNodesResult: [] as any[],
  };
  return {
    state,
    mockCoreApi: {
      listNamespacedPod: vi.fn(),
      patchNode: vi.fn(),
      deleteNode: vi.fn(),
    },
    mockAppsApi: {
      listNamespacedDeployment: vi.fn(),
    },
    mockUpdateWhere: vi.fn().mockResolvedValue({}),
  };
});
const { mockCoreApi, mockAppsApi, mockUpdateWhere, state: mockState } = hoisted;

vi.mock("./client.js", () => ({
  coreApi: hoisted.mockCoreApi,
  appsApi: hoisted.mockAppsApi,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(hoisted.state.readyNodesResult),
      }),
    }),
    update: () => ({
      set: () => ({
        where: hoisted.mockUpdateWhere,
      }),
    }),
  },
}));
vi.mock("../db/schema.pg.js", () => ({
  managedNodes: {
    status: "status-col",
    id: "id-col",
  },
}));
// drizzle-orm helpers return opaque sentinels — we never inspect them.
vi.mock("drizzle-orm", () => ({
  eq: (...args: any[]) => ({ _eq: args }),
  and: (...args: any[]) => ({ _and: args }),
  inArray: (...args: any[]) => ({ _in: args }),
  lt: (...args: any[]) => ({ _lt: args }),
}));

import {
  pickServerType,
  SERVER_TYPES,
  LONGHORN_DISK_OVERHEAD_GB,
  checkScaleDown,
} from "./nodeManager.js";

// ── SERVER_TYPES table shape ────────────────────────────────────────────────

describe("SERVER_TYPES table", () => {
  it("contains the expected Hetzner CPX tiers (minimum cpx31 for Open WebUI sidecar)", () => {
    // cpx11 (2 vCPU / 2 GB) and cpx21 (3 vCPU / 4 GB) were removed because the
    // Open WebUI sidecar (~500MB RAM) does not fit alongside OpenClaw below cpx31.
    expect(SERVER_TYPES.map((t) => t.name)).toEqual([
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

  it("cpx31 (minimum tier) usable disk is well above 100 GiB", () => {
    const cpx31 = SERVER_TYPES.find((t) => t.name === "cpx31");
    expect(cpx31).toBeDefined();
    expect(cpx31!.usableLonghornGb).toBeGreaterThan(100);
  });
});

// ── pickServerType: PVC dimension drives the pick ───────────────────────────

describe("pickServerType — PVC dimension", () => {
  it("a 30 GiB PVC + 1 vCPU + 1 GiB RAM picks cpx31 (minimum tier)", () => {
    const picked = pickServerType(1, 1, 30);
    expect(picked.name).toBe("cpx31");
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

  it("a 5 GiB PVC + 1 vCPU + 1 GiB RAM picks cpx31 (minimum tier)", () => {
    const picked = pickServerType(1, 1, 5);
    expect(picked.name).toBe("cpx31");
  });

  it("PVC defaults to 20 GiB when not provided", () => {
    const picked = pickServerType(1, 1);
    expect(picked.name).toBe("cpx31");
  });

  it("a PVC exactly equal to cpx31 usableLonghornGb is allowed", () => {
    const cpx31 = SERVER_TYPES.find((t) => t.name === "cpx31")!;
    const picked = pickServerType(1, 1, cpx31.usableLonghornGb);
    expect(picked.name).toBe("cpx31");
  });

  it("a PVC one GiB over cpx31 ceiling escalates to cpx41", () => {
    const cpx31 = SERVER_TYPES.find((t) => t.name === "cpx31")!;
    const picked = pickServerType(1, 1, cpx31.usableLonghornGb + 1);
    expect(picked.name).toBe("cpx41");
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

  it("a 1.5 vCPU + 1.5 GiB RAM bot picks cpx31 (minimum tier after cpx11/cpx21 removal)", () => {
    // Since cpx11 (2 vCPU / 2 GB) and cpx21 (3 vCPU / 4 GB) were removed,
    // the smallest available tier is cpx31 — any bot lands there.
    const picked = pickServerType(1.5, 1.5, 10);
    expect(picked.name).toBe("cpx31");
  });
});

// ── pickServerType: tierOverride validation ────────────────────────────────

describe("pickServerType — tierOverride", () => {
  it("an explicit cpx31 override is honored when the PVC fits", () => {
    const picked = pickServerType(1, 1, 50, "cpx31");
    expect(picked.name).toBe("cpx31");
  });

  it("an explicit cpx31 override that does NOT fit a 200 GiB PVC throws", () => {
    // cpx31 has 160 GiB root, ~149 GiB usable after Longhorn overhead.
    // A 200 GiB PVC cannot fit — prod should throw rather than silently
    // provision a doomed VPS. (Was cpx11+30GiB before cpx11/cpx21 removal.)
    expect(() => pickServerType(1, 1, 200, "cpx31")).toThrow(
      /only has \d+ GiB usable for Longhorn/,
    );
  });

  it("an unknown tier override throws with the list of valid tiers", () => {
    expect(() => pickServerType(1, 1, 10, "cpx99")).toThrow(
      /Unknown Hetzner server type override "cpx99"/,
    );
  });

  it("override does not check CPU/RAM headroom (caller's responsibility)", () => {
    // If the user explicitly picks cpx31, we trust them on CPU/RAM —
    // we only enforce the disk fit because that's the silent-failure mode.
    // (Previously tested with cpx11 before cpx11/cpx21 were removed.)
    const picked = pickServerType(32, 64, 5, "cpx31");
    expect(picked.name).toBe("cpx31");
  });
});

// ── checkScaleDown (Wave 4 Layer F) ─────────────────────────────────────────
//
// checkScaleDown is a fire-and-forget on-demand scale-down check invoked after
// events that free up Hetzner workers (deployment delete, orphan cleanup). It
// must:
//   1. No-op when AUTOSCALE_ENABLED != "true"
//   2. Short-circuit when there are zero ready managed nodes
//   3. Respect SCALE_DOWN_GRACE_MS (5 min) so freshly-provisioned nodes are safe
//   4. Leave nodes alone if any bot K8s Deployment targets them (stopped bots
//      keep their VPS so restart is instant)
//   5. Leave nodes alone if any bare pod is scheduled on them
//   6. Swallow ALL errors — callers use `.catch(() => {})` semantics

describe("checkScaleDown", () => {
  // Capture fetch calls so we can assert on Hetzner DELETE invocations without
  // hitting the real API. hetznerRequest() uses global fetch.
  let fetchMock: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };

  const TEN_MIN_AGO = new Date(Date.now() - 10 * 60 * 1000);
  const ONE_MIN_AGO = new Date(Date.now() - 60 * 1000);

  function makeNode(overrides: Partial<Record<string, any>> = {}) {
    return {
      id: "node-id-1",
      nodeName: "jarble-auto-abc123",
      hetznerServerId: 111,
      hetznerVolumeId: 0, // skip volume delete path to keep tests fast
      readyAt: TEN_MIN_AGO,
      monthlyCostCents: 499,
      ...overrides,
    };
  }

  beforeEach(() => {
    process.env.AUTOSCALE_ENABLED = "true";
    process.env.HETZNER_API_TOKEN = "test-token";

    mockState.readyNodesResult = [];

    mockCoreApi.listNamespacedPod.mockReset();
    mockCoreApi.patchNode.mockReset();
    mockCoreApi.deleteNode.mockReset();
    mockAppsApi.listNamespacedDeployment.mockReset();
    mockUpdateWhere.mockReset().mockResolvedValue({});

    mockCoreApi.listNamespacedPod.mockResolvedValue({ body: { items: [] } });
    mockAppsApi.listNamespacedDeployment.mockResolvedValue({
      body: { items: [] },
    });
    mockCoreApi.patchNode.mockResolvedValue({});
    mockCoreApi.deleteNode.mockResolvedValue({});

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => "",
      json: async () => ({}),
    });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // Helper: count Hetzner DELETE /servers/* calls in fetchMock
  const hetznerServerDeletes = () =>
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/servers/") &&
        init?.method === "DELETE",
    );

  // Wait for deprovisionNode (fire-and-forget via `void`) to flush through
  // its microtask queue. deprovisionNode awaits several promises before calling
  // hetznerRequest, and it includes a 5s setTimeout ONLY for volume deletes —
  // we avoid that path by keeping hetznerVolumeId = 0.
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it("1. no-op when autoscaling disabled", async () => {
    delete process.env.AUTOSCALE_ENABLED;

    await checkScaleDown();

    expect(mockCoreApi.listNamespacedPod).not.toHaveBeenCalled();
    expect(mockAppsApi.listNamespacedDeployment).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("1b. no-op when AUTOSCALE_ENABLED='false' (must be exactly 'true')", async () => {
    process.env.AUTOSCALE_ENABLED = "false";
    await checkScaleDown();
    expect(mockCoreApi.listNamespacedPod).not.toHaveBeenCalled();
  });

  it("2. short-circuits when no ready managed nodes exist", async () => {
    mockState.readyNodesResult = [];

    await checkScaleDown();
    await flush();

    // Pod list fetch always happens first (before scaleDownEmptyNodes).
    expect(mockCoreApi.listNamespacedPod).toHaveBeenCalledTimes(1);
    // But the deployment list must NOT be fetched when no ready nodes exist.
    expect(mockAppsApi.listNamespacedDeployment).not.toHaveBeenCalled();
    expect(hetznerServerDeletes()).toHaveLength(0);
  });

  it("3. deprovisions an empty ready node past the grace period", async () => {
    mockState.readyNodesResult = [makeNode({ readyAt: TEN_MIN_AGO })];

    await checkScaleDown();
    await flush();

    expect(mockCoreApi.patchNode).toHaveBeenCalledTimes(1);
    expect(mockCoreApi.patchNode.mock.calls[0][0]).toBe("jarble-auto-abc123");
    expect(mockCoreApi.deleteNode).toHaveBeenCalledWith("jarble-auto-abc123");

    const deletes = hetznerServerDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toContain("/servers/111");
  });

  it("4. does NOT deprovision a node still inside the grace period", async () => {
    mockState.readyNodesResult = [makeNode({ readyAt: ONE_MIN_AGO })];

    await checkScaleDown();
    await flush();

    expect(mockCoreApi.patchNode).not.toHaveBeenCalled();
    expect(mockCoreApi.deleteNode).not.toHaveBeenCalled();
    expect(hetznerServerDeletes()).toHaveLength(0);
  });

  it("5. does NOT deprovision a node when a bot Deployment has nodeSelector targeting it", async () => {
    mockState.readyNodesResult = [makeNode()];
    mockAppsApi.listNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            spec: {
              template: {
                spec: {
                  nodeSelector: {
                    "kubernetes.io/hostname": "jarble-auto-abc123",
                  },
                },
              },
            },
          },
        ],
      },
    });

    await checkScaleDown();
    await flush();

    expect(mockCoreApi.patchNode).not.toHaveBeenCalled();
    expect(hetznerServerDeletes()).toHaveLength(0);
  });

  it("6. does NOT deprovision a node when a bare pod is scheduled on it", async () => {
    mockState.readyNodesResult = [makeNode()];
    mockCoreApi.listNamespacedPod.mockResolvedValue({
      body: {
        items: [{ spec: { nodeName: "jarble-auto-abc123" } }],
      },
    });

    await checkScaleDown();
    await flush();

    expect(mockCoreApi.patchNode).not.toHaveBeenCalled();
    expect(hetznerServerDeletes()).toHaveLength(0);
  });

  it("7. swallows errors when the K8s API throws (fire-and-forget safety)", async () => {
    mockCoreApi.listNamespacedPod.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.1.10:6443"),
    );

    // Must NOT throw — callers rely on this for fire-and-forget safety.
    await expect(checkScaleDown()).resolves.toBeUndefined();

    expect(hetznerServerDeletes()).toHaveLength(0);
  });

  it("8. deprovisions only empty nodes when mixed with in-use nodes", async () => {
    const nodeA = makeNode({
      id: "node-a",
      nodeName: "jarble-auto-aaa",
      hetznerServerId: 100,
    });
    const nodeB = makeNode({
      id: "node-b",
      nodeName: "jarble-auto-bbb",
      hetznerServerId: 200,
    });
    mockState.readyNodesResult = [nodeA, nodeB];

    // Only node A has a bot Deployment referencing it — node B is empty.
    mockAppsApi.listNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            spec: {
              template: {
                spec: {
                  nodeSelector: { "kubernetes.io/hostname": "jarble-auto-aaa" },
                },
              },
            },
          },
        ],
      },
    });

    await checkScaleDown();
    await flush();

    const deletes = hetznerServerDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toContain("/servers/200");
    expect(deletes.some(([url]) => (url as string).includes("/servers/100"))).toBe(
      false,
    );
  });
});
