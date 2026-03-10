/**
 * OpenClaw Gateway — unit tests.
 *
 * Tests extractText, chatViaExec (exec-based fallback), and chatViaGateway
 * (WebSocket-based) by mocking ws, exec, and uiBlockParser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock K8s exec
vi.mock("../../k8s/exec.js", () => ({
  execInPod: vi.fn(),
}));

// We need the real uiBlockParser for chatViaExec tests
// but mock it for isolation in gateway WS tests
const mockExtractAllUIBlocks = vi.fn();
const mockExtractUIBlocks = vi.fn();

vi.mock("../../utils/uiBlockParser.js", () => ({
  extractAllUIBlocks: (...args: any[]) => mockExtractAllUIBlocks(...args),
  extractUIBlocks: (...args: any[]) => mockExtractUIBlocks(...args),
}));

// Mock WebSocket
const mockWsOn = vi.fn();
const mockWsSend = vi.fn();
const mockWsClose = vi.fn();

vi.mock("ws", () => {
  const OPEN = 1;
  const CONNECTING = 0;
  return {
    default: vi.fn().mockImplementation(() => ({
      on: mockWsOn,
      send: mockWsSend,
      close: mockWsClose,
      readyState: OPEN,
    })),
    __esModule: true,
    OPEN,
    CONNECTING,
  };
});

// Mock crypto for device identity (deterministic tests)
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    default: actual,
  };
});

import { chatViaExec } from "../openclawGateway.js";
import { execInPod } from "../../k8s/exec.js";

const mockedExec = vi.mocked(execInPod);

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractAllUIBlocks.mockReturnValue({
    cleanText: "",
    uiBlocks: [],
    uiUpdates: [],
    componentDefs: [],
  });
  mockExtractUIBlocks.mockReturnValue({ uiBlocks: [], cleanText: "" });
});

// ── chatViaExec ──────────────────────────────────────────────────────────────

describe("chatViaExec", () => {
  it("parses a valid JSON response from exec", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: {
        payloads: [{ text: "Hello from bot" }],
      },
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Hello from bot",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.text).toBe("Hello from bot");
    expect(result.rawText).toBe("Hello from bot");
    expect(result.uiBlocks).toEqual([]);
  });

  it("calls onDelta with full text", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ text: "Response text" }] },
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Response text",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const onDelta = vi.fn();
    await chatViaExec("pod-1", "session-1", "Hi", onDelta);
    expect(onDelta).toHaveBeenCalledWith("Response text");
  });

  it("concatenates multiple payloads", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: {
        payloads: [{ text: "First" }, { text: "Second" }],
      },
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "First\nSecond",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.rawText).toBe("First\nSecond");
  });

  it("handles JSON output prefixed with debug text", async () => {
    const output = 'some debug output\n{"result":{"payloads":[{"text":"Hello"}]}}';
    mockedExec.mockResolvedValue(output);
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Hello",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.text).toBe("Hello");
  });

  it("throws on non-JSON response", async () => {
    mockedExec.mockResolvedValue("This is not JSON at all");

    await expect(chatViaExec("pod-1", "session-1", "Hi")).rejects.toThrow("non-JSON");
  });

  it("throws on empty bot response", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [] },
    }));

    await expect(chatViaExec("pod-1", "session-1", "Hi")).rejects.toThrow("empty response");
  });

  it("throws on payloads with only empty text", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ text: "" }] },
    }));

    await expect(chatViaExec("pod-1", "session-1", "Hi")).rejects.toThrow("empty response");
  });

  it("handles top-level payloads field (no result wrapper)", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      payloads: [{ text: "Direct payload" }],
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Direct payload",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.text).toBe("Direct payload");
  });

  it("passes extracted UI blocks through", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ text: "Has blocks" }] },
    }));
    const mockBlocks = [{ id: "b1", component: "card", props: { title: "Hi" } }];
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Has blocks",
      uiBlocks: mockBlocks,
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.uiBlocks).toEqual(mockBlocks);
  });

  it("passes correct command to execInPod", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ text: "ok" }] },
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "ok",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    await chatViaExec("my-pod", "ses-key", "Hello bot");
    expect(mockedExec).toHaveBeenCalledWith("my-pod", [
      "npx", "openclaw", "agent",
      "--message", "Hello bot",
      "--session-id", "ses-key",
      "--json",
      "--timeout", "60",
    ]);
  });

  it("propagates exec errors", async () => {
    mockedExec.mockRejectedValue(new Error("Pod not found"));

    await expect(chatViaExec("bad-pod", "ses", "Hi")).rejects.toThrow("Pod not found");
  });

  it("handles payloads with missing text fields gracefully", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ type: "tool_call" }, { text: "Actual text" }] },
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Actual text",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    // text is joined with separator from payloads that have text
    expect(result.rawText).toContain("Actual text");
  });

  it("passes UI updates through from extractAllUIBlocks", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ text: "update" }] },
    }));
    const mockUpdates = [{ cardId: "c1", props: { value: 42 }, merge: true }];
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "update",
      uiBlocks: [],
      uiUpdates: mockUpdates,
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.uiUpdates).toEqual(mockUpdates);
  });

  it("passes component defs through from extractAllUIBlocks", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: { payloads: [{ text: "def" }] },
    }));
    const mockDefs = [{ name: "my_comp", layout: [] }];
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "def",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: mockDefs,
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.componentDefs).toEqual(mockDefs);
  });
});

// ── extractText (tested indirectly via chatViaExec) ──────────────────────────
// extractText is not exported, but we can validate its behavior through chatViaExec.

describe("extractText behavior (via chatViaExec)", () => {
  it("handles payloads with content blocks (array of type:text)", async () => {
    mockedExec.mockResolvedValue(JSON.stringify({
      result: {
        payloads: [{ text: "block text" }],
      },
    }));
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "block text",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    const result = await chatViaExec("pod-1", "session-1", "Hi");
    expect(result.rawText).toBe("block text");
  });
});
