import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

// Capture calls to useExternalStoreRuntime to inspect args without actually running it
const mockUseExternalStoreRuntime = vi.fn().mockReturnValue("mock-runtime");

vi.mock("@assistant-ui/react", () => ({
  useExternalStoreRuntime: (...args: unknown[]) => mockUseExternalStoreRuntime(...args),
}));

import { useJarbleRuntime } from "../assistantRuntime";
import type { ChatMessage } from "@/hooks/useCanvasChat";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role ?? "user",
    content: overrides.content ?? "Hello",
    createdAt: overrides.createdAt ?? 1700000000000,
    ...overrides,
  };
}

const defaultOpts = () => ({
  messages: [] as ChatMessage[],
  streamingText: "",
  isStreaming: false,
  sendMessage: vi.fn(),
});

beforeEach(() => {
  mockUseExternalStoreRuntime.mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useJarbleRuntime", () => {
  describe("message conversion", () => {
    it("passes converted messages to useExternalStoreRuntime", () => {
      const msgs: ChatMessage[] = [
        makeMessage({ id: "m1", role: "user", content: "Hi" }),
        makeMessage({ id: "m2", role: "assistant", content: "Hello!" }),
      ];

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), messages: msgs }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      const converted = config.messages;

      expect(converted).toHaveLength(2);
      expect(converted[0].id).toBe("m1");
      expect(converted[1].id).toBe("m2");
    });

    it("deduplicates messages with the same ID", () => {
      const msgs: ChatMessage[] = [
        makeMessage({ id: "dup", content: "First" }),
        makeMessage({ id: "dup", content: "Second" }),
      ];

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), messages: msgs }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      // Should keep only the first occurrence
      expect(config.messages).toHaveLength(1);
      // Messages are ChatMessage objects; convertMessage is passed separately
      expect(config.messages[0].content).toBe("First");
    });

    it("appends a streaming message when streamingText is present", () => {
      renderHook(() =>
        useJarbleRuntime({
          ...defaultOpts(),
          messages: [makeMessage({ id: "m1" })],
          streamingText: "Typing...",
        }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.messages).toHaveLength(2);

      const streamMsg = config.messages[1];
      expect(streamMsg.id).toBe("streaming-in-progress");
      expect(streamMsg.role).toBe("assistant");
    });

    it("appends a streaming message when only streamingReasoning is present", () => {
      renderHook(() =>
        useJarbleRuntime({
          ...defaultOpts(),
          streamingReasoning: "Thinking...",
        }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.messages).toHaveLength(1);
      expect(config.messages[0].id).toBe("streaming-in-progress");
    });

    it("includes reasoning field when message has reasoning", () => {
      const msgs = [
        makeMessage({
          id: "r1",
          role: "assistant",
          content: "Answer",
          reasoning: "Let me think...",
        }),
      ];

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), messages: msgs }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      // Messages are raw ChatMessage objects passed to useExternalStoreRuntime
      // The convertMessage function is passed separately for runtime to call
      expect(config.messages[0].reasoning).toBe("Let me think...");
      expect(config.messages[0].content).toBe("Answer");

      // Verify convertMessage is passed
      expect(config.convertMessage).toBeDefined();
    });

    it("convertMessage uses displayText over content when available", () => {
      const msgs = [
        makeMessage({
          id: "d1",
          content: "raw content",
          displayText: "Friendly display",
        }),
      ];

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), messages: msgs }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      // Call convertMessage directly to test the conversion logic
      const converted = config.convertMessage(msgs[0]);
      const textPart = converted.content.find(
        (p: { type: string }) => p.type === "text",
      );
      expect(textPart.text).toBe("Friendly display");
    });

    it("convertMessage sets isActionRelay metadata for action relay messages", () => {
      const msgs = [
        makeMessage({
          id: "a1",
          isActionRelay: true,
          displayText: "User clicked button",
        }),
      ];

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), messages: msgs }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      const converted = config.convertMessage(msgs[0]);
      expect(converted.metadata?.custom?.isActionRelay).toBe(true);
    });
  });

  describe("streaming state", () => {
    it("passes isRunning: true when isStreaming is true", () => {
      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), isStreaming: true }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.isRunning).toBe(true);
    });

    it("passes isRunning: false when isStreaming is false", () => {
      renderHook(() => useJarbleRuntime(defaultOpts()));

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.isRunning).toBe(false);
    });
  });

  describe("onNew callback", () => {
    it("extracts text from content parts and calls sendMessage", async () => {
      const sendMessage = vi.fn();

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), sendMessage }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      await config.onNew({
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "World" },
        ],
      });

      expect(sendMessage).toHaveBeenCalledWith("Hello World");
    });

    it("does not call sendMessage for empty text", async () => {
      const sendMessage = vi.fn();

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), sendMessage }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      await config.onNew({ content: [{ type: "image", url: "..." }] });

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("onCancel callback", () => {
    it("calls stopGeneration when provided", async () => {
      const stopGeneration = vi.fn();

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), stopGeneration }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      await config.onCancel();

      expect(stopGeneration).toHaveBeenCalled();
    });
  });

  describe("onEdit callback", () => {
    it("calls editMessage with parentId and joined text", async () => {
      const editMessage = vi.fn();

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), editMessage }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      await config.onEdit({
        parentId: "msg-42",
        content: [{ type: "text", text: "Updated message" }],
      });

      expect(editMessage).toHaveBeenCalledWith("msg-42", "Updated message");
    });

    it("does not include onEdit when editMessage is not provided", () => {
      renderHook(() => useJarbleRuntime(defaultOpts()));

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.onEdit).toBeUndefined();
    });
  });

  describe("suggestions", () => {
    it("passes suggestions through to runtime config", () => {
      const suggestions = [{ prompt: "Tell me a joke" }];

      renderHook(() =>
        useJarbleRuntime({ ...defaultOpts(), suggestions }),
      );

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.suggestions).toEqual(suggestions);
    });

    it("defaults to empty suggestions array", () => {
      renderHook(() => useJarbleRuntime(defaultOpts()));

      const config = mockUseExternalStoreRuntime.mock.calls[0][0];
      expect(config.suggestions).toEqual([]);
    });
  });
});
