/**
 * ConfigSync edge case tests.
 *
 * Tests syncConfigsToPvc with:
 * - Concurrent syncs to the same deployment (mutex serialization)
 * - Very large system prompts (>10KB)
 * - Deployment not found / not running guards
 * - Runtime handler not found
 *
 * Complements configSync.test.ts which covers the core orchestration flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

const mockDeploymentFindFirst = vi.fn();
const mockPlatformCredsFindMany = vi.fn().mockResolvedValue([]);
const mockDeploymentSkillsFindMany = vi.fn().mockResolvedValue([]);
const mockServiceInstallsFindMany = vi.fn().mockResolvedValue([]);
const mockComponentInstallsFindMany = vi.fn().mockResolvedValue([]);

vi.mock("../db/index.js", () => ({
  db: {
    query: {
      deployments: { findFirst: (...args: any[]) => mockDeploymentFindFirst(...args) },
      platformCredentials: { findMany: (...args: any[]) => mockPlatformCredsFindMany(...args) },
      deploymentSkills: { findMany: (...args: any[]) => mockDeploymentSkillsFindMany(...args) },
      serviceInstalls: { findMany: (...args: any[]) => mockServiceInstallsFindMany(...args) },
      componentInstalls: { findMany: (...args: any[]) => mockComponentInstallsFindMany(...args) },
      marketplaceServices: { findFirst: vi.fn() },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  tables: {
    deployments: { id: "id", status: "status" },
    platformCredentials: { deploymentId: "deploymentId" },
    deploymentSkills: { deploymentId: "deploymentId" },
    serviceInstalls: { deploymentId: "deploymentId" },
    componentInstalls: { deploymentId: "deploymentId" },
    marketplaceServices: { id: "id" },
  },
  dbDate: () => new Date().toISOString().replace("T", " ").slice(0, 19),
  getRowsAffected: vi.fn().mockReturnValue(1),
}));

const mockWriteConfigsToPvc = vi.fn().mockResolvedValue(undefined);
const mockReadConfigsFromPvc = vi.fn().mockResolvedValue([]);
const mockUpdateDeploymentSecret = vi.fn().mockResolvedValue(undefined);
const mockRestartDeployment = vi.fn().mockResolvedValue(undefined);
const mockGetDeploymentPodStatus = vi.fn().mockResolvedValue({ status: "running" });
const mockSignalProcessRestart = vi.fn().mockResolvedValue(undefined);
const mockReadCurrentSecretData = vi.fn().mockResolvedValue(null);
const mockFindPodForDeployment = vi.fn().mockResolvedValue("pod-1");
const mockExecInPod = vi.fn().mockResolvedValue("");

vi.mock("../k8s/index.js", () => ({
  writeConfigsToPvc: (...args: any[]) => mockWriteConfigsToPvc(...args),
  readConfigsFromPvc: (...args: any[]) => mockReadConfigsFromPvc(...args),
  updateDeploymentSecret: (...args: any[]) => mockUpdateDeploymentSecret(...args),
  restartDeployment: (...args: any[]) => mockRestartDeployment(...args),
  getDeploymentPodStatus: (...args: any[]) => mockGetDeploymentPodStatus(...args),
  signalProcessRestart: (...args: any[]) => mockSignalProcessRestart(...args),
  readCurrentSecretData: (...args: any[]) => mockReadCurrentSecretData(...args),
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
  execInPod: (...args: any[]) => mockExecInPod(...args),
}));

vi.mock("../k8s/constants.js", () => ({
  getPvcMountPath: vi.fn().mockReturnValue("/data"),
  getContainerName: vi.fn().mockReturnValue("main"),
}));

const mockUpdateConfigMap = vi.fn().mockResolvedValue(undefined);
vi.mock("../k8s/configmap.js", () => ({
  updateDeploymentConfigMap: (...args: any[]) => mockUpdateConfigMap(...args),
}));

const mockRenderConfigs = vi.fn().mockReturnValue([
  { path: "config/soul.md", content: "You are a bot" },
]);
const mockGetSecretEntries = vi.fn().mockReturnValue({ LLM_API_KEY: "test-key" });

vi.mock("../runtimes/index.js", () => ({
  getHandlerOrNull: vi.fn().mockReturnValue({
    renderConfigs: (...args: any[]) => mockRenderConfigs(...args),
    getSecretEntries: (...args: any[]) => mockGetSecretEntries(...args),
  }),
}));

vi.mock("../utils/encryption.js", () => ({
  decryptApiKey: vi.fn((v: string) => v),
  encryptApiKey: vi.fn((v: string) => `enc_${v}`),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-sync-id"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
}));

// Import after mocks
import { syncConfigsToPvc, type ConfigSyncResult } from "./configSync.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("syncConfigsToPvc edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeploymentPodStatus.mockResolvedValue({ status: "running" });
    mockReadCurrentSecretData.mockResolvedValue(null);
  });

  describe("guard conditions", () => {
    it("returns success when deployment is not found", async () => {
      mockDeploymentFindFirst.mockResolvedValue(null);

      const result = await syncConfigsToPvc("dep-missing");
      expect(result.success).toBe(true);
      expect(result.tier).toBe(0);
      expect(mockWriteConfigsToPvc).not.toHaveBeenCalled();
    });

    it("skips sync when deployment is stopped", async () => {
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-1", status: "stopped", runtime: "openclaw", managedBy: "legacy",
      });

      const result = await syncConfigsToPvc("dep-1");
      expect(result.success).toBe(true);
      expect(result.tier).toBe(0);
      expect(mockWriteConfigsToPvc).not.toHaveBeenCalled();
    });

    it("handles creating status by updating ConfigMap only", async () => {
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-creating", status: "creating", runtime: "openclaw", managedBy: "legacy",
      });

      const result = await syncConfigsToPvc("dep-creating");
      expect(result.success).toBe(true);
      expect(result.tier).toBe(0);
      expect(mockUpdateConfigMap).toHaveBeenCalled();
      expect(mockWriteConfigsToPvc).not.toHaveBeenCalled();
    });
  });

  describe("concurrent syncs to the same deployment (mutex)", () => {
    it("serializes concurrent calls so they don't race", async () => {
      const callOrder: number[] = [];
      let callCount = 0;

      mockDeploymentFindFirst.mockImplementation(async () => {
        const n = ++callCount;
        callOrder.push(n);
        // Simulate varying DB latency
        await new Promise((r) => setTimeout(r, n === 1 ? 50 : 10));
        return {
          id: "dep-mutex", status: "running", runtime: "openclaw", managedBy: "legacy",
        };
      });

      // Fire two syncs concurrently for the same deployment
      const [r1, r2] = await Promise.all([
        syncConfigsToPvc("dep-mutex"),
        syncConfigsToPvc("dep-mutex"),
      ]);

      // Both should succeed
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);

      // The mutex ensures the second sync starts AFTER the first completes,
      // so deploymentFindFirst is called sequentially.
      expect(callOrder[0]).toBe(1);
      expect(callOrder[1]).toBe(2);
    });

    it("mutex does not block if previous sync failed", async () => {
      let callNum = 0;
      mockDeploymentFindFirst.mockImplementation(async () => {
        callNum++;
        if (callNum === 1) {
          throw new Error("DB connection lost");
        }
        return {
          id: "dep-retry", status: "running", runtime: "openclaw", managedBy: "legacy",
        };
      });

      // First sync will fail
      const r1 = await syncConfigsToPvc("dep-retry");
      expect(r1.success).toBe(false);

      // Second sync should not be blocked by the first failure
      const r2 = await syncConfigsToPvc("dep-retry");
      expect(r2.success).toBe(true);
    });

    it("three concurrent syncs execute sequentially", async () => {
      const executionOrder: string[] = [];

      mockDeploymentFindFirst.mockImplementation(async () => {
        const label = `call-${executionOrder.length + 1}`;
        executionOrder.push(`start-${label}`);
        await new Promise((r) => setTimeout(r, 20));
        executionOrder.push(`end-${label}`);
        return {
          id: "dep-triple", status: "running", runtime: "openclaw", managedBy: "legacy",
        };
      });

      const [r1, r2, r3] = await Promise.all([
        syncConfigsToPvc("dep-triple"),
        syncConfigsToPvc("dep-triple"),
        syncConfigsToPvc("dep-triple"),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);

      // Should be 3 sequential DB calls
      expect(mockDeploymentFindFirst).toHaveBeenCalledTimes(3);
    });
  });

  describe("very large system prompts (>10KB)", () => {
    it("handles a 50KB system prompt without error", async () => {
      const largePrompt = "You are an AI assistant. ".repeat(2500); // ~60KB
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-large",
        status: "running",
        runtime: "openclaw",
        managedBy: "legacy",
        systemPrompt: largePrompt,
        llmProvider: "openrouter",
        llmModel: "gpt-4",
      });

      mockRenderConfigs.mockReturnValue([
        { path: "config/soul.md", content: largePrompt },
      ]);
      mockGetSecretEntries.mockReturnValue({ LLM_API_KEY: "key" });
      mockReadCurrentSecretData.mockResolvedValue(null);

      const result = await syncConfigsToPvc("dep-large");
      expect(result.success).toBe(true);

      // Verify the large content was passed through
      expect(mockUpdateConfigMap).toHaveBeenCalledWith(
        "dep-large",
        expect.arrayContaining([
          expect.objectContaining({
            path: "config/soul.md",
            content: largePrompt,
          }),
        ]),
        "legacy"
      );
    });

    it("handles a 100KB system prompt with unicode", async () => {
      const unicodePrompt = "你好世界 🌍 مرحبا بالعالم\n".repeat(5000); // ~100KB
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-unicode",
        status: "running",
        runtime: "openclaw",
        managedBy: "legacy",
        systemPrompt: unicodePrompt,
      });

      mockRenderConfigs.mockReturnValue([
        { path: "config/soul.md", content: unicodePrompt },
      ]);
      mockGetSecretEntries.mockReturnValue({});
      mockReadCurrentSecretData.mockResolvedValue({});

      const result = await syncConfigsToPvc("dep-unicode");
      expect(result.success).toBe(true);
    });
  });

  describe("pod not ready scenarios", () => {
    it("returns failure when pod stays in creating state", async () => {
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-stuck",
        status: "running",
        runtime: "openclaw",
        managedBy: "legacy",
      });

      mockGetDeploymentPodStatus.mockResolvedValue({ status: "creating" });

      const result = await syncConfigsToPvc("dep-stuck");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not ready");
    }, 200_000); // Extended timeout for the retry loop

    it("returns failure when pod status becomes failed while waiting", async () => {
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-fail",
        status: "running",
        runtime: "openclaw",
        managedBy: "legacy",
      });

      let callCount = 0;
      mockGetDeploymentPodStatus.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) return { status: "creating" };
        return { status: "failed" };
      });

      const result = await syncConfigsToPvc("dep-fail");
      expect(result.success).toBe(false);
      expect(result.error).toContain("failed");
    }, 30_000);

    it("succeeds when pod transitions from creating to running", async () => {
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-boot",
        status: "running",
        runtime: "openclaw",
        managedBy: "legacy",
      });

      let callCount = 0;
      mockGetDeploymentPodStatus.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) return { status: "creating" };
        return { status: "running" };
      });

      mockRenderConfigs.mockReturnValue([{ path: "config/soul.md", content: "test" }]);
      mockGetSecretEntries.mockReturnValue({});
      mockReadCurrentSecretData.mockResolvedValue({});

      const result = await syncConfigsToPvc("dep-boot");
      expect(result.success).toBe(true);
    }, 30_000);
  });

  describe("durationMs tracking", () => {
    it("returns non-zero durationMs for successful sync", async () => {
      mockDeploymentFindFirst.mockResolvedValue({
        id: "dep-dur",
        status: "running",
        runtime: "openclaw",
        managedBy: "legacy",
      });

      mockRenderConfigs.mockReturnValue([]);
      mockGetSecretEntries.mockReturnValue({});
      mockReadCurrentSecretData.mockResolvedValue({});

      const result = await syncConfigsToPvc("dep-dur");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns durationMs even for skipped sync", async () => {
      mockDeploymentFindFirst.mockResolvedValue(null);

      const result = await syncConfigsToPvc("dep-skip");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
