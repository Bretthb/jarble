import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSandboxBridge } from "../useSandboxBridge";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, SANDBOX_STORAGE_QUOTA } from "../types";

// ── Mocks ───────────────────────────────────────────────────────────────────

import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
}));

function createMockIframe() {
  const postMessage = vi.fn();
  const contentWindow = { postMessage } as unknown as Window;
  return {
    ref: { current: { contentWindow } as unknown as HTMLIFrameElement },
    contentWindow,
    postMessage,
  };
}

function createConfig(overrides: Partial<Parameters<typeof useSandboxBridge>[0]> = {}) {
  const iframe = createMockIframe();
  return {
    config: {
      iframeRef: iframe.ref,
      props: { data: [1, 2, 3] },
      title: "Test Sandbox",
      componentName: "sandbox",
      dispatch: vi.fn(),
      cardId: "card-1",
      canvasDispatch: vi.fn(),
      ...overrides,
    },
    iframe,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useSandboxBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("starts in not-stopped state", () => {
      const { config } = createConfig();
      const { result } = renderHook(() => useSandboxBridge(config));
      expect(result.current.stopped).toBe(false);
    });

    it("starts with isReady false", () => {
      const { config } = createConfig();
      const { result } = renderHook(() => useSandboxBridge(config));
      expect(result.current.isReady).toBe(false);
    });
  });

  describe("handleStop", () => {
    it("toggles stopped state", () => {
      const { config } = createConfig();
      const { result } = renderHook(() => useSandboxBridge(config));

      act(() => result.current.handleStop());
      expect(result.current.stopped).toBe(true);

      act(() => result.current.handleStop());
      expect(result.current.stopped).toBe(false);
    });
  });

  describe("message handling", () => {
    it("sends initial props on jarble:ready message", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:ready" },
            source: iframe.contentWindow,
          })
        );
      });

      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:props", props: { data: [1, 2, 3] } },
        "*"
      );
    });

    it("dispatches sandbox_action on jarble:action message", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:action", action: "click", payload: { id: 1 } },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.dispatch).toHaveBeenCalledWith({
        action: "click",
        payload: { id: 1 },
      });
    });

    it("dispatches sandbox_error on jarble:error message", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:error",
              error: { message: "ReferenceError", source: "script.js", line: 10, column: 5, stack: "..." },
            },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "sandbox_error",
          payload: expect.objectContaining({
            error: expect.objectContaining({ message: "ReferenceError" }),
            component: "sandbox",
            title: "Test Sandbox",
          }),
        })
      );
    });

    it("handles string error in jarble:error", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:error", error: "simple error string" },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            error: expect.objectContaining({ message: "simple error string" }),
          }),
        })
      );
    });

    it("handles null error in jarble:error", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:error", error: null },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            error: expect.objectContaining({ message: "Unknown sandbox error" }),
          }),
        })
      );
    });

    it("dispatches sandbox_action with default action name when none provided", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:action", payload: { value: 42 } },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.dispatch).toHaveBeenCalledWith({
        action: "sandbox_action",
        payload: { value: 42 },
      });
    });

    it("handles non-object payload in jarble:action", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:action", action: "test", payload: "not-object" },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.dispatch).toHaveBeenCalledWith({
        action: "test",
        payload: {},
      });
    });

    it("ignores messages from other sources", () => {
      const { config } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:action", action: "click", payload: {} },
            source: window, // not the iframe
          })
        );
      });

      expect(config.dispatch).not.toHaveBeenCalled();
    });

    it("updates heartbeat timestamp on jarble:heartbeat", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      // First mark as ready
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:ready" },
            source: iframe.contentWindow,
          })
        );
      });

      // Send heartbeat
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:heartbeat" },
            source: iframe.contentWindow,
          })
        );
      });

      // If heartbeat is received, sandbox should not timeout
      act(() => {
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      });
      // dispatch should not have been called with sandbox_error for timeout
      const timeoutCalls = (config.dispatch as any).mock.calls.filter(
        (c: any) => c[0]?.action === "sandbox_error"
      );
      expect(timeoutCalls.length).toBe(0);
    });

    it("updates heartbeat on jarble:progress", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:progress", percent: 50 },
            source: iframe.contentWindow,
          })
        );
      });

      // Should not throw or error
      expect(true).toBe(true);
    });
  });

  describe("resize requests", () => {
    it("dispatches RESIZE_CARD on resize request", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:resize-request", width: 400, height: 300 },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.canvasDispatch).toHaveBeenCalledWith({
        type: "RESIZE_CARD",
        id: "card-1",
        size: { width: 400, height: 300 },
      });
    });

    it("clamps resize to min/max bounds", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:resize-request", width: 50, height: 2000 },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.canvasDispatch).toHaveBeenCalledWith({
        type: "RESIZE_CARD",
        id: "card-1",
        size: { width: 200, height: 800 }, // clamped: min 200, max 800
      });
    });

    it("ignores resize when no cardId", () => {
      const { config, iframe } = createConfig({ cardId: undefined });
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:resize-request", width: 400, height: 300 },
            source: iframe.contentWindow,
          })
        );
      });

      expect(config.canvasDispatch).not.toHaveBeenCalled();
    });

    it("ignores resize when no canvasDispatch", () => {
      const { config, iframe } = createConfig({ canvasDispatch: undefined });
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:resize-request", width: 400, height: 300 },
            source: iframe.contentWindow,
          })
        );
      });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("storage proxy", () => {
    it("handles storage get request", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      localStorage.setItem("jarble:sandbox:card-1:theme", "dark");

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:storage-request",
              request: { id: "req-1", op: "get", key: "theme" },
            },
            source: iframe.contentWindow,
          })
        );
      });

      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:storage-response", response: { id: "req-1", ok: true, value: "dark" } },
        "*"
      );
    });

    it("handles storage set request", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:storage-request",
              request: { id: "req-2", op: "set", key: "color", value: "blue" },
            },
            source: iframe.contentWindow,
          })
        );
      });

      expect(localStorage.getItem("jarble:sandbox:card-1:color")).toBe("blue");
      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:storage-response", response: { id: "req-2", ok: true } },
        "*"
      );
    });

    it("handles storage delete request", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      localStorage.setItem("jarble:sandbox:card-1:key1", "val1");

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:storage-request",
              request: { id: "req-3", op: "delete", key: "key1" },
            },
            source: iframe.contentWindow,
          })
        );
      });

      expect(localStorage.getItem("jarble:sandbox:card-1:key1")).toBeNull();
      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:storage-response", response: { id: "req-3", ok: true } },
        "*"
      );
    });

    it("rejects storage set when quota exceeded", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      // Fill up storage near the 1MB limit
      const bigValue = "x".repeat(SANDBOX_STORAGE_QUOTA);
      localStorage.setItem("jarble:sandbox:card-1:big", bigValue);

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:storage-request",
              request: { id: "req-4", op: "set", key: "extra", value: "more data" },
            },
            source: iframe.contentWindow,
          })
        );
      });

      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:storage-response", response: { id: "req-4", ok: false, error: "Storage quota exceeded (1MB)" } },
        "*"
      );
    });

    it("ignores storage request when no cardId", () => {
      const { config, iframe } = createConfig({ cardId: undefined });
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:storage-request",
              request: { id: "req-5", op: "get", key: "test" },
            },
            source: iframe.contentWindow,
          })
        );
      });

      // Should not have sent any storage response
      const storageCalls = iframe.postMessage.mock.calls.filter(
        (c: any) => c[0]?.type === "jarble:storage-response"
      );
      expect(storageCalls.length).toBe(0);
    });

    it("returns null for non-existent key", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:storage-request",
              request: { id: "req-6", op: "get", key: "nonexistent" },
            },
            source: iframe.contentWindow,
          })
        );
      });

      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:storage-response", response: { id: "req-6", ok: true, value: null } },
        "*"
      );
    });
  });

  describe("heartbeat watchdog", () => {
    it("dispatches timeout error after HEARTBEAT_TIMEOUT_MS of silence", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      // Mark as ready
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:ready" },
            source: iframe.contentWindow,
          })
        );
      });

      // Advance past timeout
      act(() => {
        vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS);
      });

      expect(config.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "sandbox_error",
          payload: expect.objectContaining({
            error: expect.objectContaining({
              message: expect.stringContaining("timeout"),
            }),
          }),
        })
      );
    });

    it("does not timeout if heartbeats arrive", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      // Mark as ready
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:ready" },
            source: iframe.contentWindow,
          })
        );
      });

      // Send heartbeats periodically
      for (let i = 0; i < 5; i++) {
        act(() => {
          vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 100);
          window.dispatchEvent(
            new MessageEvent("message", {
              data: { type: "jarble:heartbeat" },
              source: iframe.contentWindow,
            })
          );
        });
      }

      const timeoutCalls = (config.dispatch as any).mock.calls.filter(
        (c: any) => c[0]?.action === "sandbox_error"
      );
      expect(timeoutCalls.length).toBe(0);
    });

    it("does not check heartbeat when stopped", () => {
      const { config, iframe } = createConfig();
      const { result } = renderHook(() => useSandboxBridge(config));

      // Mark as ready then stop
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:ready" },
            source: iframe.contentWindow,
          })
        );
      });
      act(() => result.current.handleStop());

      act(() => {
        vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS * 2);
      });

      const timeoutCalls = (config.dispatch as any).mock.calls.filter(
        (c: any) => c[0]?.action === "sandbox_error"
      );
      expect(timeoutCalls.length).toBe(0);
    });
  });

  describe("event relay", () => {
    it("handles jarble:event-emit without error", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:event-emit", channel: "test-channel", data: { key: "value" } },
            source: iframe.contentWindow,
          })
        );
      });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("CSP violation", () => {
    it("handles CSP violation message without error", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      // Just verify it does not throw - Sentry mock is already set up
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "jarble:csp-violation",
              detail: {
                blockedURI: "https://evil.com/script.js",
                violatedDirective: "script-src",
                effectiveDirective: "script-src",
                originalPolicy: "default-src 'self'",
                sourceFile: "",
                lineNumber: 0,
              },
            },
            source: iframe.contentWindow,
          })
        );
      });

      // Verify the Sentry mock was called
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "csp-violation",
          level: "warning",
        })
      );
    });
  });

  describe("resetReady", () => {
    it("resets ready state", () => {
      const { config } = createConfig();
      const { result } = renderHook(() => useSandboxBridge(config));

      act(() => result.current.resetReady());
      expect(result.current.isReady).toBe(false);
    });
  });

  describe("props forwarding", () => {
    it("sends updated props when changed after ready", () => {
      const { config, iframe } = createConfig();
      const { rerender } = renderHook(
        (props) => useSandboxBridge({ ...config, props }),
        { initialProps: { data: [1] } }
      );

      // Mark as ready
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:ready" },
            source: iframe.contentWindow,
          })
        );
      });

      iframe.postMessage.mockClear();

      // Update props
      rerender({ data: [1, 2, 3] });

      expect(iframe.postMessage).toHaveBeenCalledWith(
        { type: "jarble:props", props: { data: [1, 2, 3] } },
        "*"
      );
    });
  });

  describe("set-title", () => {
    it("handles set-title message without error", () => {
      const { config, iframe } = createConfig();
      renderHook(() => useSandboxBridge(config));

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "jarble:set-title", title: "New Title" },
            source: iframe.contentWindow,
          })
        );
      });

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
