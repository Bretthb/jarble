import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetAccessTokenSilently = vi.fn().mockResolvedValue("test-token");

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mockGetAccessTokenSilently,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  API_URL: "http://localhost:3001",
}));

// Polyfill crypto.randomUUID for jsdom
let uuidCounter = 0;
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...globalThis.crypto,
      randomUUID: () => `uuid-${++uuidCounter}`,
    },
  });
}

// ── SSE Helpers ─────────────────────────────────────────────────────────────

function buildSSEStream(events: Array<Record<string, any>>): ReadableStream {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
}

function mockFetchOk(events: Array<Record<string, any>>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    body: buildSSEStream(events),
    text: () => Promise.resolve(""),
  });
}

function mockFetchError(status: number, text: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  });
}

import { useDirectChat } from "../useDirectChat";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useDirectChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessTokenSilently.mockResolvedValue("test-token");
    uuidCounter = 0;
    (global as any).fetch = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("starts with empty messages", () => {
      const { result } = renderHook(() => useDirectChat("dep-1"));
      expect(result.current.messages).toEqual([]);
    });

    it("starts not streaming", () => {
      const { result } = renderHook(() => useDirectChat("dep-1"));
      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe("sendMessage", () => {
    it("ignores empty messages", async () => {
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("");
      });

      expect(result.current.messages.length).toBe(0);
    });

    it("adds user and assistant messages immediately", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.messages.length).toBe(2);
      expect(result.current.messages[0].role).toBe("user");
      expect(result.current.messages[0].content).toBe("Hello");
      expect(result.current.messages[1].role).toBe("assistant");
    });

    it("sends correct request", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/tambo-agent",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        })
      );
    });

    it("includes deploymentId in body", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.deploymentId).toBe("dep-1");
    });

    it("includes message history in body", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.messages.length).toBeGreaterThan(0);
      expect(body.messages[body.messages.length - 1].content).toBe("Hello");
    });
  });

  describe("TEXT_MESSAGE_CONTENT events", () => {
    it("accumulates text deltas", async () => {
      mockFetchOk([
        { type: "TEXT_MESSAGE_CONTENT", delta: "Hi " },
        { type: "TEXT_MESSAGE_CONTENT", delta: "there!" },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.content).toBe("Hi there!");
    });
  });

  describe("TOOL_CALL events (UI blocks)", () => {
    it("creates UI blocks from tool calls", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "show_chart" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"type":"bar"}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-1" },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Show chart");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.uiBlocks?.length).toBe(1);
      expect(assistant?.uiBlocks?.[0].component).toBe("chart");
      expect(assistant?.uiBlocks?.[0].props).toEqual({ type: "bar" });
    });

    it("strips show_ prefix from component name", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-2", toolCallName: "show_data_table" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-2", delta: '{}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-2" },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Table");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.uiBlocks?.[0].component).toBe("data_table");
    });

    it("handles editable flag", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-3", toolCallName: "show_sandbox", editable: true },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-3", delta: '{"html":"<p>hi</p>"}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-3" },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Edit");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.uiBlocks?.[0].editable).toBe(true);
    });
  });

  describe("CUSTOM card update events", () => {
    it("handles jarble.card.update with merge", async () => {
      mockFetchOk([
        // First create a card
        { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "show_card" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"title":"Old"}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-1" },
        // Then update it
        { type: "CUSTOM", name: "jarble.card.update", value: { cardId: "card-tc-1", props: { title: "New" }, merge: true } },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Card");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      const updatedBlock = assistant?.uiBlocks?.find((b) => b.id === "card-tc-1");
      expect(updatedBlock?.props.title).toBe("New");
    });
  });

  describe("error handling", () => {
    it("shows error text on HTTP failure", async () => {
      mockFetchError(500, "Server crashed");
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.content).toContain("Error: Server crashed");
    });

    it("shows fallback error on network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network down"));
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.content).toBe("Something went wrong. Please try again.");
    });

    it("handles abort without error", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      global.fetch = vi.fn().mockRejectedValue(abortError);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Should not have modified the assistant message with error text
      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.content).toBe("");
    });
  });

  describe("streaming state", () => {
    it("resets isStreaming after completion", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Test");
      });

      expect(result.current.isStreaming).toBe(false);
    });

    it("resets isStreaming after error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("fail"));
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Test");
      });

      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe("clearMessages", () => {
    it("clears all messages", async () => {
      mockFetchOk([
        { type: "TEXT_MESSAGE_CONTENT", delta: "Hello" },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });
      expect(result.current.messages.length).toBeGreaterThan(0);

      act(() => {
        result.current.clearMessages();
      });
      expect(result.current.messages.length).toBe(0);
    });
  });

  describe("displayText support", () => {
    it("includes displayText and isActionRelay when provided", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("[UI_ACTION] click button-1", "Clicked button");
      });

      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg?.displayText).toBe("Clicked button");
      expect(userMsg?.isActionRelay).toBe(true);
    });
  });

  describe("UI marker stripping", () => {
    it("strips jarble_ui blocks from content on block end", async () => {
      mockFetchOk([
        { type: "TEXT_MESSAGE_CONTENT", delta: "Here:\n```jarble_ui\n{}\n```\nDone" },
        { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "show_card" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-1" },
        { type: "RUN_FINISHED" },
      ]);
      const { result } = renderHook(() => useDirectChat("dep-1"));

      await act(async () => {
        await result.current.sendMessage("Chart");
      });

      const assistant = result.current.messages.find((m) => m.role === "assistant");
      expect(assistant?.content).not.toContain("jarble_ui");
    });
  });
});
