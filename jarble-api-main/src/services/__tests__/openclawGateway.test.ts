/**
 * OpenClaw Gateway - unit tests.
 *
 * Tests extractText, chatViaExec (exec-based fallback), and chatViaGateway
 * (WebSocket-based) by mocking ws, exec, and uiBlockParser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────

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

import { chatViaExec, chatViaHTTP } from "../openclawGateway.js";
import { execInPod } from "../../k8s/exec.js";
import {
  trace,
  propagation,
  context as otelContext,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";

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

// ── chatViaExec ──────────────────────────────────────────────────────────

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
    // The exec args begin with `env JARBLE_CURRENT_SESSION_ID=...` to
    // provide a server-side fallback for memory_scope=session. They
    // may also include TRACEPARENT when an OTel context is active (not
    // the case in this unit test because no tracer context is set up).
    expect(mockedExec).toHaveBeenCalledWith("my-pod", [
      "env", "JARBLE_CURRENT_SESSION_ID=ses-key",
      "npx", "openclaw", "agent",
      "--message", "Hello bot",
      "--session-id", "ses-key",
      "--thinking", "medium",
      "--json",
      "--timeout", "120",
    ], undefined, 150_000);
  });

  // JAR-51 Phase 2: when an OTel span is active on the calling context,
  // chatViaExec must inject `env TRACEPARENT=00-{trace}-{span}-{flags}`
  // into the kubectl exec command. This is the ONLY mechanism by which
  // the pod-side otel-bridge.cjs can attach its child spans to the
  // caller's trace — the exec spawn boundary has no other handoff. If
  // this test fails, the entire cross-pod correlation story is broken.
  //
  // Setup is non-trivial because openclawGateway itself opens a new
  // `jarble.delegation.exec` span via `tracer.startActiveSpan` before
  // injecting headers. Without a real TracerProvider the inner span is
  // a NonRecordingSpan with an invalid (zero) span context, and the
  // W3C propagator silently skips injection. We need all three:
  //
  //   1. AsyncHooksContextManager — otherwise startActiveSpan cannot
  //      actually set the span as active on the context, and
  //      `otelContext.active()` returns ROOT_CONTEXT (no span) — then
  //      propagation.inject sees no span and injects nothing.
  //   2. BasicTracerProvider — otherwise startActiveSpan returns a
  //      NonRecordingSpan with an invalid (zero) span context.
  //   3. W3CTraceContextPropagator — otherwise `propagation.inject` is
  //      a no-op NoopTextMapPropagator and leaves the carrier empty.
  it("injects TRACEPARENT env var when an OTel span is active in the calling context", async () => {
    const contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    otelContext.setGlobalContextManager(contextManager);
    const tracerProvider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    mockedExec.mockResolvedValue(
      JSON.stringify({ result: { payloads: [{ text: "ok" }] } }),
    );
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "ok",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
    });

    // Start a real root span on a tracer we own, capture its trace id,
    // and run chatViaExec inside its active context. The delegation
    // span openclawGateway creates inside chatViaExec will inherit our
    // trace id, and `propagation.inject` will populate the carrier with
    // a traceparent whose trace portion matches ours.
    const rootTracer = tracerProvider.getTracer("test-root");
    let capturedTraceId = "";
    await rootTracer.startActiveSpan("test.root", async (rootSpan) => {
      capturedTraceId = rootSpan.spanContext().traceId;
      try {
        await chatViaExec("pod-1", "session-1", "Hi");
      } finally {
        rootSpan.end();
      }
    });
    // Sanity: basic tracer produces valid 32-char hex trace ids.
    expect(capturedTraceId).toMatch(/^[a-f0-9]{32}$/);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    const callArgs = mockedExec.mock.calls[0];
    const execArgs = callArgs[1] as string[];
    // env prefix must be at index 0
    expect(execArgs[0]).toBe("env");
    // Find the TRACEPARENT=... token
    const traceparentToken = execArgs.find(
      (a: string) => typeof a === "string" && a.startsWith("TRACEPARENT="),
    );
    expect(traceparentToken).toBeDefined();
    // Must follow the W3C format: 00-{32 hex}-{16 hex}-{2 hex} AND
    // must carry the trace id from the root span we started, proving
    // the cross-context handoff is preserved end-to-end.
    expect(traceparentToken).toMatch(
      new RegExp(`^TRACEPARENT=00-${capturedTraceId}-[a-f0-9]{16}-0[01]$`),
    );
    // Session id must still be present after the traceparent
    expect(execArgs).toContain("JARBLE_CURRENT_SESSION_ID=session-1");

    // Tear down so subsequent tests don't see our delegate. Disable
    // the context manager first so it stops hooking into async_hooks,
    // then shutdown the provider with a timeout guard.
    contextManager.disable();
    otelContext.disable();
    trace.disable();
    await Promise.race([
      tracerProvider.shutdown(),
      new Promise((r) => setTimeout(r, 500)),
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

// ── extractText (tested indirectly via chatViaExec) ──────────────────────
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

// ── chatViaHTTP ────────────────────────────────────────────────────────────

/** Helper: build a ReadableStream from SSE data lines */
function buildSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Helper: build SSE text from an array of OpenAI-style chunk objects */
function sseLines(objs: object[]): string {
  return objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") + "data: [DONE]\n\n";
}

describe("chatViaHTTP", () => {
  const opts = { ip: "10.0.0.1", port: 3000, gatewayToken: "tok", sessionKey: "test-session" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams delta.content and calls onDelta", async () => {
    const sse = sseLines([
      { choices: [{ delta: { content: "Hello " } }] },
      { choices: [{ delta: { content: "world" } }] },
      { choices: [{ finish_reason: "stop" }] },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: buildSSEStream([sse]),
    });
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Hello world",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
      suggestions: [],
      designContext: null,
    });

    const onDelta = vi.fn();
    const result = await chatViaHTTP(opts, "hi", "ses-1", onDelta);

    expect(result.text).toBe("Hello world");
    expect(onDelta).toHaveBeenCalledWith("Hello ");
    expect(onDelta).toHaveBeenCalledWith("Hello world");
  });

  it("strips <think> tags from delta.content", async () => {
    const sse = sseLines([
      { choices: [{ delta: { content: "<think>internal reasoning</think>Visible text" } }] },
      { choices: [{ finish_reason: "stop" }] },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: buildSSEStream([sse]),
    });
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Visible text",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
      suggestions: [],
      designContext: null,
    });

    const result = await chatViaHTTP(opts, "hi", "ses-1");
    // fullText (rawText) should NOT contain <think> content
    expect(result.rawText).toBe("Visible text");
    expect(result.rawText).not.toContain("<think>");
  });

  it("strips multi-chunk <think> tags spanning deltas", async () => {
    const sse = sseLines([
      { choices: [{ delta: { content: "Before<think>start of thought" } }] },
      { choices: [{ delta: { content: " still thinking" } }] },
      { choices: [{ delta: { content: "</think>After" } }] },
      { choices: [{ finish_reason: "stop" }] },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: buildSSEStream([sse]),
    });
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "BeforeAfter",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
      suggestions: [],
      designContext: null,
    });

    const result = await chatViaHTTP(opts, "hi", "ses-1");
    expect(result.rawText).toBe("BeforeAfter");
  });

  it("accumulates tool_calls and flushes as jarble_ui blocks", async () => {
    const sse = sseLines([
      { choices: [{ delta: { content: "Here is a chart" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "render_ui", arguments: '{"component":"bar_chart",' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"props":{"data":[1,2,3]}}' } }] } }] },
      { choices: [{ finish_reason: "tool_calls" }] },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: buildSSEStream([sse]),
    });

    const fakeBlock = { id: "b1", component: "bar_chart", props: { data: [1, 2, 3] } };
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Here is a chart",
      uiBlocks: [fakeBlock],
      uiUpdates: [],
      componentDefs: [],
      suggestions: [],
      designContext: null,
    });

    const result = await chatViaHTTP(opts, "hi", "ses-1");
    // The fullText should contain the fenced jarble_ui block appended from tool calls
    expect(result.rawText).toContain("```jarble_ui");
    expect(result.rawText).toContain("bar_chart");
    // extractAllUIBlocks is called with the full text including fenced blocks
    expect(mockExtractAllUIBlocks).toHaveBeenCalled();
  });

  it("extracts token usage from final chunk", async () => {
    const sse = sseLines([
      { choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: buildSSEStream([sse]),
    });
    mockExtractAllUIBlocks.mockReturnValue({
      cleanText: "Hi",
      uiBlocks: [],
      uiUpdates: [],
      componentDefs: [],
      suggestions: [],
      designContext: null,
    });

    const result = await chatViaHTTP(opts, "hi", "ses-1");
    expect(result.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("throws on non-ok HTTP response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(chatViaHTTP(opts, "hi", "ses-1")).rejects.toThrow("HTTP chat completions failed: 500");
  });

  it("throws on empty response", async () => {
    const sse = sseLines([
      { choices: [{ finish_reason: "stop" }] },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: buildSSEStream([sse]),
    });

    await expect(chatViaHTTP(opts, "hi", "ses-1")).rejects.toThrow("empty response");
  });
});
