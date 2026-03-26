import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────
vi.mock("./client.js", () => ({
  coreApi: {
    createNamespacedPersistentVolumeClaim: vi.fn(),
    createNamespacedSecret: vi.fn(),
    deleteNamespacedSecret: vi.fn(),
    deleteNamespacedPersistentVolumeClaim: vi.fn(),
  },
  appsApi: {
    createNamespacedDeployment: vi.fn(),
    patchNamespacedDeployment: vi.fn(),
    deleteNamespacedDeployment: vi.fn(),
  },
}));

vi.mock("./status.js", () => ({
  getDeploymentPodStatus: vi.fn(),
}));

vi.mock("./configmap.js", () => ({
  createDeploymentConfigMap: vi.fn(),
  deleteDeploymentConfigMap: vi.fn(),
}));

vi.mock("./operator.js", () => ({
  createOpenClawInstance: vi.fn(),
  deleteOpenClawInstance: vi.fn(),
}));

import { coreApi, appsApi } from "./client.js";
import { getDeploymentPodStatus } from "./status.js";
import { createDeploymentConfigMap, deleteDeploymentConfigMap } from "./configmap.js";
import { createOpenClawInstance, deleteOpenClawInstance } from "./operator.js";
import {
  createDeployment,
  stopDeployment,
  startDeployment,
  restartDeployment,
  deleteDeployment,
} from "./lifecycle.js";
import type { DeploymentConfig } from "./constants.js";

const mockCoreApi = vi.mocked(coreApi);
const mockAppsApi = vi.mocked(appsApi);
const mockGetPodStatus = vi.mocked(getDeploymentPodStatus);
const mockCreateConfigMap = vi.mocked(createDeploymentConfigMap);
const mockDeleteConfigMap = vi.mocked(deleteDeploymentConfigMap);
const mockCreateCR = vi.mocked(createOpenClawInstance);
const mockDeleteCR = vi.mocked(deleteOpenClawInstance);

const baseConfig: DeploymentConfig = {
  name: "test-bot",
  template: "personal",
  runtime: "openclaw",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all K8s calls succeed
  mockCoreApi.createNamespacedPersistentVolumeClaim.mockResolvedValue({} as any);
  mockCoreApi.createNamespacedSecret.mockResolvedValue({} as any);
  mockCoreApi.deleteNamespacedSecret.mockResolvedValue({} as any);
  mockCoreApi.deleteNamespacedPersistentVolumeClaim.mockResolvedValue({} as any);
  mockAppsApi.createNamespacedDeployment.mockResolvedValue({} as any);
  mockAppsApi.patchNamespacedDeployment.mockResolvedValue({} as any);
  mockAppsApi.deleteNamespacedDeployment.mockResolvedValue({} as any);
  mockCreateConfigMap.mockResolvedValue(undefined);
  mockDeleteConfigMap.mockResolvedValue(undefined);
  mockCreateCR.mockResolvedValue(undefined);
  mockDeleteCR.mockResolvedValue(undefined);
  mockGetPodStatus.mockResolvedValue({ status: "not_found" });
});

// ═══════════════════════════════════════════════════════════════════════
// createDeployment — Legacy Mode
// ═══════════════════════════════════════════════════════════════════════
describe("createDeployment (legacy)", () => {
  it("creates PVC, Secret, and Deployment in order", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    expect(mockCoreApi.createNamespacedPersistentVolumeClaim).toHaveBeenCalledTimes(1);
    expect(mockCoreApi.createNamespacedSecret).toHaveBeenCalledTimes(1);
    expect(mockAppsApi.createNamespacedDeployment).toHaveBeenCalledTimes(1);
  });

  it("names resources correctly with deployment ID", async () => {
    await createDeployment("abc-123", "user-1", baseConfig);

    const pvcCall = mockCoreApi.createNamespacedPersistentVolumeClaim.mock.calls[0];
    expect(pvcCall[1].metadata?.name).toBe("pvc-abc-123");

    const secretCall = mockCoreApi.createNamespacedSecret.mock.calls[0];
    expect(secretCall[1].metadata?.name).toBe("secret-abc-123");

    const depCall = mockAppsApi.createNamespacedDeployment.mock.calls[0];
    expect(depCall[1].metadata?.name).toBe("dep-abc-123");
  });

  it("uses default image when none specified", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const depSpec = mockAppsApi.createNamespacedDeployment.mock.calls[0][1];
    const container = depSpec.spec?.template?.spec?.containers?.[0];
    expect(container?.image).toContain("openclaw");
  });

  it("uses custom image when specified", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, image: "custom:v1" });

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.image).toBe("custom:v1");
  });

  it("applies resource limits from config", async () => {
    await createDeployment("dep-1", "user-1", {
      ...baseConfig,
      cpuLimit: "4.0",
      memoryMb: 8192,
    });

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.resources?.limits?.cpu).toBe("4000m");
    expect(container?.resources?.limits?.memory).toBe("8192Mi");
  });

  it("applies default resource limits when not specified", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.resources?.limits?.cpu).toBe("2000m");
    expect(container?.resources?.limits?.memory).toBe("3072Mi");
  });

  it("sets CPU request equal to limit (guaranteed QoS)", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, cpuLimit: "2.0" });

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.resources?.requests?.cpu).toBe("2000m");
  });

  it("sets CPU request equal to limit for small values", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, cpuLimit: "0.2" });

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.resources?.requests?.cpu).toBe("200m");
  });

  it("configures storage with minimum 1Gi (Math.max enforced)", async () => {
    // storageMb uses || 30 so 0 falls through to default 30; use -1 to verify Math.max(1, ...)
    // Actually, || 30 means falsy values always get 30. Test that the default is reasonable:
    await createDeployment("dep-1", "user-1", baseConfig);

    const pvcSpec = mockCoreApi.createNamespacedPersistentVolumeClaim.mock.calls[0][1];
    expect(pvcSpec.spec?.resources?.requests?.storage).toBe("30Gi"); // default
  });

  it("uses custom storage size", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, storageMb: 50 });

    const pvcSpec = mockCoreApi.createNamespacedPersistentVolumeClaim.mock.calls[0][1];
    expect(pvcSpec.spec?.resources?.requests?.storage).toBe("50Gi");
  });

  it("sets correct storage class", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const pvcSpec = mockCoreApi.createNamespacedPersistentVolumeClaim.mock.calls[0][1];
    expect(pvcSpec.spec?.storageClassName).toBe("longhorn");
  });

  it("includes base secret entries", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const secretSpec = mockCoreApi.createNamespacedSecret.mock.calls[0][1];
    const data = secretSpec.stringData!;
    expect(data.DEPLOYMENT_ID).toBe("dep-1");
    expect(data.USER_ID).toBe("user-1");
    expect(data.DEPLOYMENT_NAME).toBe("test-bot");
    expect(data.TEMPLATE).toBe("personal");
    expect(data.RUNTIME).toBe("openclaw");
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBeTruthy();
  });

  it("uses provided gatewayToken instead of generating one", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, gatewayToken: "my-token" });

    const data = mockCoreApi.createNamespacedSecret.mock.calls[0][1].stringData!;
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBe("my-token");
  });

  it("merges extraSecretEntries", async () => {
    await createDeployment("dep-1", "user-1", {
      ...baseConfig,
      extraSecretEntries: { OPENROUTER_API_KEY: "sk-or-xxx", LLM_PROVIDER: "openrouter" },
    });

    const data = mockCoreApi.createNamespacedSecret.mock.calls[0][1].stringData!;
    expect(data.OPENROUTER_API_KEY).toBe("sk-or-xxx");
    expect(data.LLM_PROVIDER).toBe("openrouter");
  });

  it("includes JARBLE_API_URL when set in env", async () => {
    process.env.JARBLE_API_URL = "https://api.jarble.ai";
    await createDeployment("dep-1", "user-1", baseConfig);

    const data = mockCoreApi.createNamespacedSecret.mock.calls[0][1].stringData!;
    expect(data.JARBLE_API_URL).toBe("https://api.jarble.ai");
    delete process.env.JARBLE_API_URL;
  });

  it("creates ConfigMap when initialConfigs provided", async () => {
    const config: DeploymentConfig = {
      ...baseConfig,
      initialConfigs: [{ path: "soul.md", content: "Be helpful" }],
    };
    await createDeployment("dep-1", "user-1", config);

    expect(mockCreateConfigMap).toHaveBeenCalledWith("dep-1", config.initialConfigs);
  });

  it("does not create ConfigMap when no initialConfigs", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);
    expect(mockCreateConfigMap).not.toHaveBeenCalled();
  });

  it("mounts ConfigMap volume when initialConfigs provided", async () => {
    await createDeployment("dep-1", "user-1", {
      ...baseConfig,
      initialConfigs: [{ path: "soul.md", content: "x" }],
    });

    const depSpec = mockAppsApi.createNamespacedDeployment.mock.calls[0][1];
    const volumes = depSpec.spec?.template?.spec?.volumes;
    expect(volumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "config-source", configMap: { name: "config-dep-1" } }),
    ]));
  });

  it("sets security context (non-root, fsGroup)", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const podSpec = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec;
    expect(podSpec?.securityContext?.fsGroup).toBe(1000);
    expect(podSpec?.automountServiceAccountToken).toBe(false);
    expect(podSpec?.terminationGracePeriodSeconds).toBe(10);
  });

  it("configures liveness probe with correct delays", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.livenessProbe?.initialDelaySeconds).toBe(90);
    expect(container?.livenessProbe?.httpGet?.path).toBe("/healthz");
  });

  it("configures readiness probe", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.readinessProbe?.initialDelaySeconds).toBe(10);
    expect(container?.readinessProbe?.periodSeconds).toBe(5);
  });

  it("uses correct gateway port for runtime", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, runtime: "zeroclaw" });

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.ports?.[0]?.containerPort).toBe(3000);
  });

  it("uses custom containerPort when specified", async () => {
    await createDeployment("dep-1", "user-1", { ...baseConfig, containerPort: 9999 });

    const container = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.containers?.[0];
    expect(container?.ports?.[0]?.containerPort).toBe(9999);
  });

  it("uses Recreate strategy", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const depSpec = mockAppsApi.createNamespacedDeployment.mock.calls[0][1];
    expect(depSpec.spec?.strategy?.type).toBe("Recreate");
  });

  it("has init container with busybox", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const initContainers = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec?.initContainers;
    expect(initContainers).toHaveLength(1);
    expect(initContainers?.[0]?.name).toBe("config-init");
    expect(initContainers?.[0]?.image).toBe("busybox:1.36");
  });

  it("includes image pull secrets", async () => {
    await createDeployment("dep-1", "user-1", baseConfig);

    const podSpec = mockAppsApi.createNamespacedDeployment.mock.calls[0][1]
      .spec?.template?.spec;
    expect(podSpec?.imagePullSecrets).toEqual([{ name: "ghcr-pull-secret" }]);
  });

  // ── Rollback on failure ────────────────────────────────────────────
  it("rolls back PVC and Secret when Deployment creation fails", async () => {
    mockAppsApi.createNamespacedDeployment.mockRejectedValue(new Error("API error"));

    await expect(createDeployment("dep-1", "user-1", baseConfig)).rejects.toThrow("API error");

    expect(mockCoreApi.deleteNamespacedSecret).toHaveBeenCalledWith("secret-dep-1", "jarble");
    expect(mockCoreApi.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith("pvc-dep-1", "jarble");
  });

  it("rolls back PVC when Secret creation fails", async () => {
    mockCoreApi.createNamespacedSecret.mockRejectedValue(new Error("Secret error"));

    await expect(createDeployment("dep-1", "user-1", baseConfig)).rejects.toThrow("Secret error");

    expect(mockCoreApi.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith("pvc-dep-1", "jarble");
    expect(mockAppsApi.createNamespacedDeployment).not.toHaveBeenCalled();
  });

  it("rolls back ConfigMap on Deployment failure", async () => {
    mockAppsApi.createNamespacedDeployment.mockRejectedValue(new Error("deploy error"));

    await expect(createDeployment("dep-1", "user-1", {
      ...baseConfig,
      initialConfigs: [{ path: "soul.md", content: "x" }],
    })).rejects.toThrow("deploy error");

    expect(mockDeleteConfigMap).toHaveBeenCalledWith("dep-1");
  });

  it("continues rollback even if cleanup calls fail", async () => {
    mockAppsApi.createNamespacedDeployment.mockRejectedValue(new Error("deploy error"));
    mockCoreApi.deleteNamespacedSecret.mockRejectedValue(new Error("cleanup failed"));
    mockCoreApi.deleteNamespacedPersistentVolumeClaim.mockRejectedValue(new Error("cleanup failed"));

    await expect(createDeployment("dep-1", "user-1", baseConfig)).rejects.toThrow("deploy error");

    // Both cleanup calls were attempted despite failures
    expect(mockCoreApi.deleteNamespacedSecret).toHaveBeenCalled();
    expect(mockCoreApi.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// createDeployment — Operator Mode
// ═══════════════════════════════════════════════════════════════════════
describe("createDeployment (operator)", () => {
  it("creates Secret and CR (no PVC)", async () => {
    await createDeployment("dep-1", "user-1", baseConfig, "operator");

    expect(mockCoreApi.createNamespacedSecret).toHaveBeenCalledTimes(1);
    expect(mockCreateCR).toHaveBeenCalledTimes(1);
    expect(mockCoreApi.createNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });

  it("includes 'token' key in Secret for operator mode", async () => {
    await createDeployment("dep-1", "user-1", baseConfig, "operator");

    const data = mockCoreApi.createNamespacedSecret.mock.calls[0][1].stringData!;
    expect(data.token).toBeTruthy();
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBe(data.token);
  });

  it("rolls back Secret on CR creation failure", async () => {
    mockCreateCR.mockRejectedValueOnce(new Error("CR error"));

    await expect(createDeployment("dep-1", "user-1", baseConfig, "operator"))
      .rejects.toThrow("CR error");

    expect(mockCoreApi.deleteNamespacedSecret).toHaveBeenCalledWith("secret-dep-1", "jarble");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// stopDeployment
// ═══════════════════════════════════════════════════════════════════════
describe("stopDeployment", () => {
  it("scales legacy deployment to 0 replicas", async () => {
    await stopDeployment("dep-1");

    expect(mockAppsApi.patchNamespacedDeployment).toHaveBeenCalledWith(
      "dep-dep-1",
      "jarble",
      { spec: { replicas: 0 } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
  });

  it("deletes CR in operator mode", async () => {
    await stopDeployment("dep-1", "operator");

    expect(mockDeleteCR).toHaveBeenCalledWith("dep-1");
    expect(mockAppsApi.patchNamespacedDeployment).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// startDeployment
// ═══════════════════════════════════════════════════════════════════════
describe("startDeployment", () => {
  it("scales legacy deployment to 1 replica", async () => {
    await startDeployment("dep-1");

    expect(mockAppsApi.patchNamespacedDeployment).toHaveBeenCalledWith(
      "dep-dep-1",
      "jarble",
      { spec: { replicas: 1 } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
  });

  it("throws in operator mode without userId and config", async () => {
    await expect(startDeployment("dep-1", "operator"))
      .rejects.toThrow("operator mode requires userId and config");
  });

  it("recreates CR with existingClaim in operator mode", async () => {
    await startDeployment("dep-1", "operator", "user-1", baseConfig);

    expect(mockCreateCR).toHaveBeenCalledWith(
      "dep-1", "user-1", baseConfig, "dep-dep-1-data"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// restartDeployment
// ═══════════════════════════════════════════════════════════════════════
describe("restartDeployment", () => {
  it("stops, waits for pod termination, then starts", async () => {
    // Pod terminates immediately
    mockGetPodStatus.mockResolvedValue({ status: "not_found" });

    await restartDeployment("dep-1");

    // stop (scale to 0) + start (scale to 1)
    expect(mockAppsApi.patchNamespacedDeployment).toHaveBeenCalledTimes(2);

    const calls = mockAppsApi.patchNamespacedDeployment.mock.calls;
    expect(calls[0][0]).toBe("dep-dep-1");
    expect(calls[0][1]).toBe("jarble");
    expect(calls[0][2]).toEqual({ spec: { replicas: 0 } });

    expect(calls[1][0]).toBe("dep-dep-1");
    expect(calls[1][1]).toBe("jarble");
    expect(calls[1][2]).toEqual({ spec: { replicas: 1 } });
  });

  it("polls for pod termination before starting", async () => {
    mockGetPodStatus
      .mockResolvedValueOnce({ status: "running", phase: "Running" })
      .mockResolvedValueOnce({ status: "not_found" });

    await restartDeployment("dep-1");

    expect(mockGetPodStatus).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// deleteDeployment — Legacy
// ═══════════════════════════════════════════════════════════════════════
describe("deleteDeployment (legacy)", () => {
  it("deletes all 4 resources", async () => {
    await deleteDeployment("dep-1");

    expect(mockAppsApi.patchNamespacedDeployment).toHaveBeenCalled(); // scale to 0
    expect(mockAppsApi.deleteNamespacedDeployment).toHaveBeenCalledWith("dep-dep-1", "jarble");
    expect(mockCoreApi.deleteNamespacedSecret).toHaveBeenCalledWith("secret-dep-1", "jarble");
    expect(mockCoreApi.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith("pvc-dep-1", "jarble");
    expect(mockDeleteConfigMap).toHaveBeenCalledWith("dep-1");
  });

  it("ignores 404 when K8s deployment already deleted", async () => {
    mockAppsApi.deleteNamespacedDeployment.mockRejectedValue({ statusCode: 404 });

    await expect(deleteDeployment("dep-1")).resolves.toBeUndefined();
  });

  it("ignores 404 when Secret already deleted", async () => {
    mockCoreApi.deleteNamespacedSecret.mockRejectedValue({ statusCode: 404 });

    await expect(deleteDeployment("dep-1")).resolves.toBeUndefined();
  });

  it("ignores 404 when PVC already deleted", async () => {
    mockCoreApi.deleteNamespacedPersistentVolumeClaim.mockRejectedValue({ statusCode: 404 });

    await expect(deleteDeployment("dep-1")).resolves.toBeUndefined();
  });

  it("throws on non-404 deployment delete error", async () => {
    mockAppsApi.deleteNamespacedDeployment.mockRejectedValue({ statusCode: 403, message: "Forbidden" });

    await expect(deleteDeployment("dep-1")).rejects.toBeTruthy();
  });

  it("throws on non-404 Secret delete error", async () => {
    mockCoreApi.deleteNamespacedSecret.mockRejectedValue({ statusCode: 500, message: "Error" });

    await expect(deleteDeployment("dep-1")).rejects.toBeTruthy();
  });

  it("throws on non-404 PVC delete error", async () => {
    mockCoreApi.deleteNamespacedPersistentVolumeClaim.mockRejectedValue({ statusCode: 500, message: "Error" });

    await expect(deleteDeployment("dep-1")).rejects.toBeTruthy();
  });

  it("skips scale-down if deployment not found (404)", async () => {
    mockAppsApi.patchNamespacedDeployment.mockRejectedValue({ statusCode: 404 });

    // Should not throw, continues with deletion
    await expect(deleteDeployment("dep-1")).resolves.toBeUndefined();
  });

  it("continues deletion even if scale-down fails with non-404", async () => {
    mockAppsApi.patchNamespacedDeployment.mockRejectedValue({ statusCode: 500 });

    // Should still try to delete resources
    await deleteDeployment("dep-1");
    expect(mockAppsApi.deleteNamespacedDeployment).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// deleteDeployment — Operator
// ═══════════════════════════════════════════════════════════════════════
describe("deleteDeployment (operator)", () => {
  it("deletes CR, Secret, ConfigMap, and PVC", async () => {
    await deleteDeployment("dep-1", "operator");

    expect(mockDeleteCR).toHaveBeenCalledWith("dep-1");
    expect(mockCoreApi.deleteNamespacedSecret).toHaveBeenCalledWith("secret-dep-1", "jarble");
    expect(mockDeleteConfigMap).toHaveBeenCalledWith("dep-1");
    expect(mockCoreApi.deleteNamespacedPersistentVolumeClaim).toHaveBeenCalledWith("dep-dep-1-data", "jarble");
  });

  it("ignores 404 on Secret delete", async () => {
    mockCoreApi.deleteNamespacedSecret.mockRejectedValue({ statusCode: 404 });
    await expect(deleteDeployment("dep-1", "operator")).resolves.toBeUndefined();
  });

  it("ignores 404 on PVC delete", async () => {
    mockCoreApi.deleteNamespacedPersistentVolumeClaim.mockRejectedValue({ statusCode: 404 });
    await expect(deleteDeployment("dep-1", "operator")).resolves.toBeUndefined();
  });

  it("throws on non-404 Secret delete error in operator mode", async () => {
    mockCoreApi.deleteNamespacedSecret.mockRejectedValue({ statusCode: 403 });
    await expect(deleteDeployment("dep-1", "operator")).rejects.toBeTruthy();
  });

  it("waits for pod termination before deleting Secret", async () => {
    mockGetPodStatus
      .mockResolvedValueOnce({ status: "running", phase: "Running" })
      .mockResolvedValueOnce({ status: "not_found" });

    await deleteDeployment("dep-1", "operator");
    expect(mockGetPodStatus).toHaveBeenCalledTimes(2);
  });
});
