/**
 * Unit tests for the config-mutation MCP tool pair:
 * `update_system_prompt` and `update_llm_config`.
 *
 * Both tools share the same view-or-set shape: omit params to read,
 * pass any param to write. They differ in how the runtime reacts to
 * the mutation:
 *
 *   - update_system_prompt: file-only change. configSync writes
 *     soul.md without a pod restart.
 *   - update_llm_config (apiKey path): secret change. configSync
 *     does a full restart so the new key is picked up.
 *
 * Three contracts pinned:
 *
 *   1. **Read-on-empty-params** — no params returns current config
 *      and NEVER touches the DB. A regression that wrote on empty
 *      input would silently nullify the prompt or drop LLM config
 *      every time the bot read its own state.
 *
 *   2. **Encryption-before-store for apiKey** — `encryptApiKey`
 *      runs on the new key before insert. A regression that stored
 *      plaintext would put bot-tier API keys directly in the DB.
 *
 *   3. **configSync only fires when running** — same gate as the
 *      skill pair (PR #240). configSync against a stopped pod is
 *      noise and burns credentials on a dead target.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockEncryptApiKey = vi.fn();
const mockSafeFireAndForget = vi.fn();
const mockSyncConfigsToPvc = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    update: (...args: any[]) => {
      mockUpdate(...args);
      return { set: mockSet };
    },
  },
  tables: { deployments: { id: { name: "id" } } },
  dbDate: () => "2026-04-27T00:00:00Z",
}));

vi.mock("../../../utils/encryption.js", () => ({
  encryptApiKey: (...args: any[]) => mockEncryptApiKey(...args),
}));

vi.mock("../../../services/configSync.js", () => ({
  syncConfigsToPvc: (...args: any[]) => mockSyncConfigsToPvc(...args),
}));

vi.mock("../../../utils/safeAsync.js", () => ({
  safeFireAndForget: (...args: any[]) => mockSafeFireAndForget(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { updateSystemPromptTool } from "../../../mcp/tools/updateSystemPrompt.js";
import { updateLlmConfigTool } from "../../../mcp/tools/updateLlmConfig.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockUpdate.mockReset();
  mockSet.mockReset();
  mockUpdateWhere.mockReset();
  mockEncryptApiKey.mockReset();
  mockSafeFireAndForget.mockReset();
  mockSyncConfigsToPvc.mockReset();

  mockSet.mockReturnValue({ where: (...args: any[]) => { mockUpdateWhere(...args); return Promise.resolve(); } });
  mockEncryptApiKey.mockImplementation((key: string) => `enc:${key}`);
});

function ctx(overrides: Partial<any> = {}): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: {
      id: "dep-abc",
      name: "My Bot",
      status: "running",
      systemPrompt: "Default prompt",
      llmProvider: "openrouter",
      llmModel: "openrouter/auto",
      llmMode: "byok",
      ...overrides,
    },
  };
}

// ── update_system_prompt — metadata ─────────────────────────────────────────

describe("updateSystemPromptTool — metadata", () => {
  it("registers under the name 'update_system_prompt'", () => {
    expect(updateSystemPromptTool.name).toBe("update_system_prompt");
  });

  it("renders the show_system_prompt component", () => {
    expect(updateSystemPromptTool.rendersComponent).toBe("show_system_prompt");
  });

  it("declares no required parameters (read-or-write)", () => {
    expect((updateSystemPromptTool.parameters as any).required).toBeUndefined();
  });
});

// ── update_system_prompt — read mode ────────────────────────────────────────

describe("updateSystemPromptTool — read mode", () => {
  it("returns the current prompt when no `prompt` param is provided (no DB write)", async () => {
    const r = await updateSystemPromptTool.execute({}, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("Default prompt");
    expect((r.data as any).systemPrompt).toBe("Default prompt");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns '(not set)' when systemPrompt is null/empty", async () => {
    const r = await updateSystemPromptTool.execute({}, ctx({ systemPrompt: null }));

    expect(r.success).toBe(true);
    expect(r.message).toContain("(not set)");
    expect((r.data as any).systemPrompt).toBe("");
  });

  it("treats empty-string prompt as read-mode (the !newPrompt guard catches it)", async () => {
    const r = await updateSystemPromptTool.execute({ prompt: "" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("Default prompt");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── update_system_prompt — write mode ───────────────────────────────────────

describe("updateSystemPromptTool — write mode", () => {
  it("persists the new prompt and stamps updatedAt", async () => {
    const r = await updateSystemPromptTool.execute(
      { prompt: "You are a helpful pirate." },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect(r.message).toContain("updated successfully");
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.systemPrompt).toBe("You are a helpful pirate.");
    expect(setArg.updatedAt).toBe("2026-04-27T00:00:00Z");
  });

  it("triggers configSync when the deployment is RUNNING (file-only change, no restart)", async () => {
    await updateSystemPromptTool.execute(
      { prompt: "new" },
      ctx({ status: "running" }),
    );

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
    expect(mockSafeFireAndForget.mock.calls[0][1]).toMatchObject({
      operation: "syncConfigsToPvc",
      deploymentId: "dep-abc",
    });
  });

  it("does NOT trigger configSync when the deployment is STOPPED", async () => {
    await updateSystemPromptTool.execute(
      { prompt: "new" },
      ctx({ status: "stopped" }),
    );

    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });

  it("does NOT trigger configSync for any non-running status", async () => {
    for (const status of ["creating", "failed", "pending", "stopping", "initializing"]) {
      vi.clearAllMocks();
      mockSet.mockReturnValue({ where: (...args: any[]) => { mockUpdateWhere(...args); return Promise.resolve(); } });

      await updateSystemPromptTool.execute({ prompt: "x" }, ctx({ status }));
      expect(mockSafeFireAndForget).not.toHaveBeenCalled();
    }
  });
});

// ── update_llm_config — metadata ────────────────────────────────────────────

describe("updateLlmConfigTool — metadata", () => {
  it("registers under the name 'update_llm_config'", () => {
    expect(updateLlmConfigTool.name).toBe("update_llm_config");
  });

  it("renders the show_llm_config component", () => {
    expect(updateLlmConfigTool.rendersComponent).toBe("show_llm_config");
  });

  it("locks provider enum to openrouter/openai/anthropic/google", () => {
    const enumVals = (updateLlmConfigTool.parameters as any).properties.provider.enum;
    expect(enumVals).toEqual(["openrouter", "openai", "anthropic", "google"]);
  });
});

// ── update_llm_config — read mode ───────────────────────────────────────────

describe("updateLlmConfigTool — read mode", () => {
  it("returns current config when no params (no DB write)", async () => {
    const r = await updateLlmConfigTool.execute({}, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("openrouter");
    expect(r.message).toContain("openrouter/auto");
    expect(r.message).toContain("byok");
    expect((r.data as any).llmProvider).toBe("openrouter");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("falls back to 'none' for null provider/model in read view", async () => {
    const r = await updateLlmConfigTool.execute(
      {},
      ctx({ llmProvider: null, llmModel: null }),
    );

    expect(r.message).toContain("provider=none");
    expect(r.message).toContain("model=none");
  });
});

// ── update_llm_config — write mode ──────────────────────────────────────────

describe("updateLlmConfigTool — write mode", () => {
  it("updates provider only when only provider is supplied", async () => {
    await updateLlmConfigTool.execute({ provider: "anthropic" }, ctx());

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.llmProvider).toBe("anthropic");
    expect(setArg.llmModel).toBeUndefined();
    expect(setArg.llmApiKey).toBeUndefined();
    expect(setArg.updatedAt).toBe("2026-04-27T00:00:00Z");
    // encryptApiKey should NOT have been called.
    expect(mockEncryptApiKey).not.toHaveBeenCalled();
  });

  it("updates model only when only model is supplied", async () => {
    await updateLlmConfigTool.execute({ model: "claude-sonnet-4-20250514" }, ctx());

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.llmModel).toBe("claude-sonnet-4-20250514");
    expect(setArg.llmProvider).toBeUndefined();
  });

  it("ENCRYPTS the apiKey before storing — encryptApiKey called with raw key, ciphertext stored", async () => {
    await updateLlmConfigTool.execute({ apiKey: "sk-secret-key-1234" }, ctx());

    expect(mockEncryptApiKey).toHaveBeenCalledTimes(1);
    expect(mockEncryptApiKey).toHaveBeenCalledWith("sk-secret-key-1234");

    const setArg = mockSet.mock.calls[0][0];
    // The store receives whatever encryptApiKey returned — NOT the raw key
    // re-fetched from params. The test below uses an opaque-blob mock to
    // verify that the raw plaintext truly doesn't survive past the
    // encryptApiKey boundary.
    expect(setArg.llmApiKey).toBe("enc:sk-secret-key-1234");
  });

  it("real-encryption mock: encrypted ciphertext does NOT contain the plaintext secret", async () => {
    // Override the default mock to simulate real encryption (output unrelated to input).
    mockEncryptApiKey.mockReturnValueOnce("opaque-aes-gcm-blob-no-relation-to-plaintext");

    await updateLlmConfigTool.execute({ apiKey: "sk-secret-1234" }, ctx());

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.llmApiKey).toBe("opaque-aes-gcm-blob-no-relation-to-plaintext");
    expect(JSON.stringify(setArg)).not.toContain("sk-secret-1234");
  });

  it("updates all three fields when all are supplied", async () => {
    await updateLlmConfigTool.execute(
      { provider: "anthropic", model: "claude-opus-4", apiKey: "sk-ant-x" },
      ctx(),
    );

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.llmProvider).toBe("anthropic");
    expect(setArg.llmModel).toBe("claude-opus-4");
    expect(setArg.llmApiKey).toBe("enc:sk-ant-x");
  });

  it("returns a summary of changes in the message (provider → X, model → Y, API key updated)", async () => {
    const r = await updateLlmConfigTool.execute(
      { provider: "anthropic", model: "claude-sonnet-4", apiKey: "sk" },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect(r.message).toContain("provider → anthropic");
    expect(r.message).toContain("model → claude-sonnet-4");
    expect(r.message).toContain("API key updated");
    // apiKey present → message mentions restart.
    expect(r.message.toLowerCase()).toContain("restart");
  });

  it("DOES NOT mention restart when only provider/model change (no apiKey)", async () => {
    const r = await updateLlmConfigTool.execute({ model: "openrouter/auto" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("model →");
    // Restart text is gated on apiKey presence.
    expect(r.message.toLowerCase()).not.toContain("restart");
  });

  it("triggers configSync when running (any write)", async () => {
    await updateLlmConfigTool.execute(
      { model: "x" },
      ctx({ status: "running" }),
    );

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger configSync when stopped", async () => {
    await updateLlmConfigTool.execute(
      { model: "x" },
      ctx({ status: "stopped" }),
    );

    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });
});
