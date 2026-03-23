import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetAccessTokenSilently = vi.fn().mockResolvedValue("test-token");

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mockGetAccessTokenSilently,
  }),
}));

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  API_URL: "http://localhost:3001",
}));

vi.mock("@/components/workspace/autoLayout", () => ({
  findOpenPosition: () => ({ x: 0, y: 0 }),
  getDefaultSize: () => ({ width: 400, height: 300 }),
  getContainerSize: () => ({ width: 1200, height: 800 }),
}));

vi.mock("@/components/ComponentCatalogProvider", () => ({
  useComponentCatalog: () => ({
    registerComponent: vi.fn(),
  }),
}));

// ── SSE Response Builder ────────────────────────────────────────────────────

function buildSSEStream(events: Array<{ type: string; [key: string]: any }>): ReadableStream {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
}

function mockFetchOk(events: Array<{ type: string; [key: string]: any }>) {
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

function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));
}

// Import after mocks
import { useCanvasChat } from "../useCanvasChat";
import type { CanvasState, CanvasAction } from "@/components/workspace/types";

function makeState(cards: any[] = []): CanvasState {
  return {
    cards,
    viewportOffset: { x: 0, y: 0 },
    zoom: 1,
    nextZIndex: 1,
    focusedCardId: null,
    mode: "dashboard" as const,
    fixAttempts: {},
    dashboardGroups: {},
    strokes: [],
    fullscreenPageId: null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useCanvasChat", () => {
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessTokenSilently.mockResolvedValue("test-token");
    dispatch = vi.fn();
    localStorage.clear();
    // Reset fetch to avoid leaking between tests
    (global as any).fetch = undefined;
    // Mock requestAnimationFrame for rAF-based text throttle
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("starts with empty messages", () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));
      expect(result.current.messages).toEqual([]);
    });

    it("starts not streaming", () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));
      expect(result.current.isStreaming).toBe(false);
    });

    it("starts with empty streaming text", () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));
      expect(result.current.streamingText).toBe("");
    });

    it("starts with empty streamingCardIds", () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));
      expect(result.current.streamingCardIds.size).toBe(0);
    });

    it("starts with null lastChatError", () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));
      expect(result.current.lastChatError).toBeNull();
    });
  });

  describe("sendMessage", () => {
    it("ignores empty messages", async () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("");
      });

      expect(global.fetch).toBeFalsy();
      expect(result.current.messages.length).toBe(0);
    });

    it("ignores whitespace-only messages", async () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("   ");
      });

      expect(result.current.messages.length).toBe(0);
    });

    it("adds user message immediately", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const userMsg = result.current.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe("Hello");
    });

    it("sends fetch request with auth token", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/tambo-agent",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("includes deploymentId in request body", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.deploymentId).toBe("dep-1");
    });

    it("prepends canvas state to message", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.messages[0].content).toContain("[CANVAS_STATE]");
      expect(body.messages[0].content).toContain("No cards on canvas.");
    });
  });

  describe("TEXT_MESSAGE_CONTENT events", () => {
    it("accumulates text from deltas", async () => {
      mockFetchOk([
        { type: "TEXT_MESSAGE_CONTENT", delta: "Hello " },
        { type: "TEXT_MESSAGE_CONTENT", delta: "world!" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Test");
      });

      const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
      expect(assistantMsg?.content).toBe("Hello world!");
    });
  });

  describe("TOOL_CALL events (UI blocks)", () => {
    it("creates canvas card from TOOL_CALL_START/ARGS/END", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "show_chart" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"type":"bar","data":[]}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-1" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Show chart");
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_CARD",
          card: expect.objectContaining({
            component: "chart",
            props: { type: "bar", data: [] },
          }),
        })
      );
    });

    it("strips show_ prefix from component name", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-2", toolCallName: "show_data_table" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-2", delta: '{"columns":[]}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-2" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Show table");
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_CARD",
          card: expect.objectContaining({ component: "data_table" }),
        })
      );
    });

    it("handles editable flag", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-3", toolCallName: "show_sandbox", editable: true },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-3", delta: '{"html":"<p>hi</p>"}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-3" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Edit");
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_CARD",
          card: expect.objectContaining({ editable: true }),
        })
      );
    });

    it("handles fileId and saveMethod", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "tc-4", toolCallName: "show_code_editor", fileId: "file-1", saveMethod: "mcp" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-4", delta: '{"code":"x=1"}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-4" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Edit file");
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_CARD",
          card: expect.objectContaining({ fileId: "file-1", saveMethod: "mcp" }),
        })
      );
    });
  });

  describe("CUSTOM events", () => {
    it("handles jarble.card.update", async () => {
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.card.update", value: { cardId: "card-1", props: { title: "Updated" }, merge: true } },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Update");
      });

      expect(dispatch).toHaveBeenCalledWith({
        type: "UPDATE_CARD_PROPS",
        id: "card-1",
        props: { title: "Updated" },
        merge: true,
        component: undefined,
      });
    });

    it("handles jarble.chat.error", async () => {
      const error = { code: "GATEWAY_TIMEOUT", message: "Bot not responding" };
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.chat.error", value: { error } },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      expect(result.current.lastChatError).toEqual(error);
    });

    it("handles jarble.dashboard.created", async () => {
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.dashboard.created", value: { dashboardId: "dash-1", title: "My Dashboard", cardIds: ["c1", "c2"] } },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Dashboard");
      });

      expect(dispatch).toHaveBeenCalledWith({
        type: "CREATE_DASHBOARD_GROUP",
        groupId: "dash-1",
        title: "My Dashboard",
        cardIds: ["c1", "c2"],
      });
    });
  });

  describe("error handling", () => {
    it("adds error message on HTTP error", async () => {
      mockFetchError(500, "Internal Server Error");
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const errorMsg = result.current.messages.find((m) => m.content.startsWith("Error:"));
      expect(errorMsg).toBeDefined();
    });

    it("adds fallback error on network failure", async () => {
      mockFetchNetworkError();
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      const errorMsg = result.current.messages.find((m) => m.content === "Something went wrong. Please try again.");
      expect(errorMsg).toBeDefined();
    });

    it("silently handles abort errors", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      global.fetch = vi.fn().mockRejectedValue(abortError);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });

      // Should not add an error message for abort
      const errorMsgs = result.current.messages.filter((m) => m.content.includes("went wrong"));
      expect(errorMsgs.length).toBe(0);
    });
  });

  describe("streaming state", () => {
    it("sets isStreaming true during fetch and false after", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Test");
      });

      expect(result.current.isStreaming).toBe(false);
    });

    it("clears streaming state on error", async () => {
      mockFetchNetworkError();
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Test");
      });

      expect(result.current.isStreaming).toBe(false);
    });
  });

  describe("orphan block cleanup", () => {
    it("cleans up pending blocks that never got TOOL_CALL_END", async () => {
      mockFetchOk([
        { type: "TOOL_CALL_START", toolCallId: "orphan-1", toolCallName: "show_chart" },
        // No TOOL_CALL_END — stream ends without completing the block
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Test");
      });

      // The orphaned block should NOT result in an ADD_CARD dispatch
      const addCardCalls = dispatch.mock.calls.filter((c: any) => c[0]?.type === "ADD_CARD");
      expect(addCardCalls.length).toBe(0);
    });
  });

  describe("UI marker stripping", () => {
    it("strips jarble_ui fenced blocks from displayed text", async () => {
      mockFetchOk([
        { type: "TEXT_MESSAGE_CONTENT", delta: "Here is a chart:\n```jarble_ui\n{\"type\":\"chart\"}\n```\nDone!" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Chart please");
      });

      const botMsg = result.current.messages.find((m) => m.role === "assistant");
      expect(botMsg?.content).not.toContain("jarble_ui");
      expect(botMsg?.content).toContain("Done!");
    });
  });

  describe("clearChatError", () => {
    it("clears the last chat error", async () => {
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.chat.error", value: { error: { code: "TEST", message: "Test error" } } },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Hello");
      });
      expect(result.current.lastChatError).not.toBeNull();

      act(() => {
        result.current.clearChatError();
      });
      expect(result.current.lastChatError).toBeNull();
    });
  });

  describe("chat history persistence", () => {
    it("loads chat history from localStorage", async () => {
      const history = {
        messages: [
          { id: "old-1", role: "user", content: "Old message", createdAt: Date.now() },
        ],
        savedAt: Date.now(),
      };
      localStorage.setItem("jarble-chat-dep-1", JSON.stringify(history));

      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe("Old message");
    });

    it("ignores expired chat history", () => {
      const history = {
        messages: [{ id: "old-1", role: "user", content: "Expired", createdAt: Date.now() }],
        savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
      };
      localStorage.setItem("jarble-chat-dep-1", JSON.stringify(history));

      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      expect(result.current.messages.length).toBe(0);
    });

    it("handles corrupted localStorage gracefully", () => {
      localStorage.setItem("jarble-chat-dep-1", "not-json");

      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      expect(result.current.messages.length).toBe(0);
    });
  });

  describe("selected card context", () => {
    it("prepends editing reference for selected card", async () => {
      mockFetchOk([{ type: "RUN_FINISHED" }]);
      const state = makeState([
        {
          id: "card-1",
          component: "chart",
          props: {},
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          zIndex: 0,
          minimized: false,
          createdAt: Date.now(),
          title: "Sales Chart",
          selected: true,
        },
      ]);
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Make it blue");
      });

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('[EDITING card-1 "Sales Chart"]');
      expect(dispatch).toHaveBeenCalledWith({ type: "DESELECT_CARD" });
    });
  });

  describe("RUN_STARTED event", () => {
    it("captures LLM provider and model", async () => {
      mockFetchOk([
        { type: "RUN_STARTED", llmProvider: "anthropic", llmModel: "claude-3" },
        { type: "TOOL_CALL_START", toolCallId: "tc-1", toolCallName: "show_card" },
        { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"title":"Test"}' },
        { type: "TOOL_CALL_END", toolCallId: "tc-1" },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Show card");
      });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_CARD",
          card: expect.objectContaining({
            llmProvider: "anthropic",
            llmModel: "claude-3",
          }),
        })
      );
    });
  });

  // ── Phase 2: Agent Call Events ────────────────────────────────────────────

  describe("CUSTOM agent call events", () => {
    it("starts with null activeAgentCall", () => {
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));
      expect(result.current.activeAgentCall).toBeNull();
    });

    it("clears activeAgentCall after stream completes (finally cleanup)", async () => {
      // activeAgentCall is set during streaming but cleaned up in the finally block
      // when the stream ends. This test verifies the full lifecycle.
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.agent.call.start", value: { serviceId: "svc-1", skillName: "summarize", agentName: "Summarizer" } },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Use agent");
      });

      // After streaming completes, activeAgentCall is cleaned up in the finally block
      expect(result.current.activeAgentCall).toBeNull();
    });

    it("clears activeAgentCall on jarble.agent.call.end event mid-stream", async () => {
      // When both start and end events are in the stream, end explicitly clears
      // the state (before the finally block also does cleanup).
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.agent.call.start", value: { serviceId: "svc-1", skillName: "summarize", agentName: "Summarizer" } },
        { type: "CUSTOM", name: "jarble.agent.call.end", value: { serviceId: "svc-1", skillName: "summarize", creditsCharged: 1, success: true } },
        { type: "TEXT_MESSAGE_CONTENT", delta: "Here is the summary." },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Use agent");
      });

      // activeAgentCall should be null (cleared by end event AND finally block)
      expect(result.current.activeAgentCall).toBeNull();
      // The text from after the agent call should still be present
      const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
      expect(assistantMsg?.content).toContain("Here is the summary.");
    });

    it("agent call events do not interfere with normal CUSTOM events", async () => {
      // Verify that agent call events coexist with other CUSTOM events
      mockFetchOk([
        { type: "CUSTOM", name: "jarble.agent.call.start", value: { serviceId: "svc-1", skillName: "summarize" } },
        { type: "CUSTOM", name: "jarble.card.update", value: { cardId: "card-1", props: { title: "Updated" }, merge: true } },
        { type: "CUSTOM", name: "jarble.agent.call.end", value: { serviceId: "svc-1", skillName: "summarize", creditsCharged: 1, success: true } },
        { type: "RUN_FINISHED" },
      ]);
      const state = makeState();
      const { result } = renderHook(() => useCanvasChat("dep-1", state, dispatch));

      await act(async () => {
        await result.current.sendMessage("Use agent and update");
      });

      // Card update should still be dispatched
      expect(dispatch).toHaveBeenCalledWith({
        type: "UPDATE_CARD_PROPS",
        id: "card-1",
        props: { title: "Updated" },
        merge: true,
        component: undefined,
      });
    });
  });
});
