import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client.js", () => ({
  coreApi: {
    replaceNamespacedSecret: vi.fn(),
    readNamespacedSecret: vi.fn(),
  },
}));

import { coreApi } from "./client.js";
import { updateDeploymentSecret, readCurrentSecretData } from "./secrets.js";

const mockCoreApi = vi.mocked(coreApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockCoreApi.replaceNamespacedSecret.mockResolvedValue({} as any);
  delete process.env.JARBLE_API_URL;
  delete process.env.CONFIG_WEBHOOK_SECRET;
});

// ═══════════════════════════════════════════════════════════════════════
// updateDeploymentSecret
// ═══════════════════════════════════════════════════════════════════════
describe("updateDeploymentSecret", () => {
  it("calls replaceNamespacedSecret with correct name and namespace", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "my-bot", "openclaw", {});

    expect(mockCoreApi.replaceNamespacedSecret).toHaveBeenCalledWith(
      "secret-dep-1",
      "jarble",
      expect.objectContaining({
        metadata: { name: "secret-dep-1" },
      })
    );
  });

  it("includes base data entries", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "my-bot", "openclaw", {});

    const secretBody = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2];
    const data = secretBody.stringData!;
    expect(data.DEPLOYMENT_ID).toBe("dep-1");
    expect(data.USER_ID).toBe("user-1");
    expect(data.DEPLOYMENT_NAME).toBe("my-bot");
    expect(data.RUNTIME).toBe("openclaw");
    expect(data.TEMPLATE).toBe("personal"); // default
  });

  it("uses provided template", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {}, "business");

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    expect(data.TEMPLATE).toBe("business");
  });

  it("merges secretEntries with base data", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {
      OPENROUTER_API_KEY: "sk-xxx",
      LLM_PROVIDER: "openrouter",
    });

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    expect(data.OPENROUTER_API_KEY).toBe("sk-xxx");
    expect(data.LLM_PROVIDER).toBe("openrouter");
  });

  it("includes JARBLE_API_URL (defaults to internal cluster URL when env var unset)", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {});

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    // Prod code now always populates JARBLE_API_URL, preferring the internal
    // K8s service URL (pods can't reach the external HTTPS URL due to the
    // egress NetworkPolicy). The external URL is only used as a fallback if
    // JARBLE_INTERNAL_API_URL is not set.
    expect(data.JARBLE_API_URL).toBeDefined();
    expect(data.JARBLE_API_URL).toMatch(/svc\.cluster\.local|jarble\.ai/);
  });

  it("includes CONFIG_WEBHOOK_SECRET when set in env", async () => {
    process.env.CONFIG_WEBHOOK_SECRET = "secret123";
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {});

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    expect(data.CONFIG_WEBHOOK_SECRET).toBe("secret123");
  });

  it("preserves existing OPENCLAW_GATEWAY_TOKEN when not in secretEntries", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: {
        data: {
          OPENCLAW_GATEWAY_TOKEN: Buffer.from("existing-token").toString("base64"),
        },
      },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {});

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBe("existing-token");
  });

  it("uses provided OPENCLAW_GATEWAY_TOKEN if in secretEntries", async () => {
    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {
      OPENCLAW_GATEWAY_TOKEN: "new-token",
    });

    // Should not try to read existing secret when token is already provided
    expect(mockCoreApi.readNamespacedSecret).not.toHaveBeenCalled();

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    expect(data.OPENCLAW_GATEWAY_TOKEN).toBe("new-token");
  });

  it("proceeds without token when reading existing secret fails", async () => {
    mockCoreApi.readNamespacedSecret.mockRejectedValue(new Error("Not found"));

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {});

    // Should still call replace
    expect(mockCoreApi.replaceNamespacedSecret).toHaveBeenCalledTimes(1);
  });

  it("secretEntries override base data keys", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await updateDeploymentSecret("dep-1", "user-1", "bot", "openclaw", {
      DEPLOYMENT_NAME: "override-name",
    });

    const data = mockCoreApi.replaceNamespacedSecret.mock.calls[0][2].stringData!;
    // secretEntries spread after baseData, so it overrides
    expect(data.DEPLOYMENT_NAME).toBe("override-name");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// readCurrentSecretData
// ═══════════════════════════════════════════════════════════════════════
describe("readCurrentSecretData", () => {
  it("reads and base64 decodes secret data", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: {
        data: {
          API_KEY: Buffer.from("my-key").toString("base64"),
          USER_ID: Buffer.from("user-1").toString("base64"),
        },
      },
    } as any);

    const result = await readCurrentSecretData("dep-1");

    expect(result).toEqual({
      API_KEY: "my-key",
      USER_ID: "user-1",
    });
  });

  it("returns empty object when data is undefined", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: undefined },
    } as any);

    const result = await readCurrentSecretData("dep-1");
    expect(result).toEqual({});
  });

  it("returns null when secret not found", async () => {
    mockCoreApi.readNamespacedSecret.mockRejectedValue(new Error("404 Not Found"));

    const result = await readCurrentSecretData("dep-1");
    expect(result).toBeNull();
  });

  it("returns null on any read error", async () => {
    mockCoreApi.readNamespacedSecret.mockRejectedValue(new Error("Forbidden"));

    const result = await readCurrentSecretData("dep-1");
    expect(result).toBeNull();
  });

  it("reads from correct secret name and namespace", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    await readCurrentSecretData("my-dep-id");

    expect(mockCoreApi.readNamespacedSecret).toHaveBeenCalledWith("secret-my-dep-id", "jarble");
  });

  it("handles empty data object", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: { data: {} },
    } as any);

    const result = await readCurrentSecretData("dep-1");
    expect(result).toEqual({});
  });

  it("handles unicode values in base64", async () => {
    mockCoreApi.readNamespacedSecret.mockResolvedValue({
      body: {
        data: {
          PROMPT: Buffer.from("こんにちは").toString("base64"),
        },
      },
    } as any);

    const result = await readCurrentSecretData("dep-1");
    expect(result?.PROMPT).toBe("こんにちは");
  });
});
