/**
 * Unit tests for the final two zero-coverage MCP tools:
 *   - `chat_with_bot` — proxy to the in-pod OpenClaw agent CLI
 *   - `delete_component` — remove a custom component from PVC
 *
 * Pinned contracts:
 *
 * **chat_with_bot** (proxy):
 *
 *   1. **Running-status precondition** — the tool MUST refuse
 *      if `ctx.deployment.status !== "running"`. The pod-side
 *      CLI can't be reached when the pod isn't up.
 *
 *   2. **JSON-parse fallback** — bot output may have leading
 *      noise (logger lines, etc.). The tool first tries
 *      `JSON.parse(output)`, then falls back to slicing from
 *      the first `{` and re-parsing. A regression that
 *      dropped the fallback would surface "non-JSON response"
 *      for any output the bot prefixed with a banner.
 *
 *   3. **UI block extraction** — when the bot emits jarble_ui
 *      fenced blocks, the tool returns structured `data.uiBlocks`
 *      so the frontend can render BotCanvas components. A
 *      regression that returned the raw markdown would emit
 *      the fence syntax in the chat bubble.
 *
 * **delete_component** (storage):
 *
 *   4. **Built-in protection** — refuses to delete any name
 *      in `BUILTIN_COMPONENTS`. A regression here would let
 *      a malicious bot delete `data_table` or `card` from
 *      its own PVC and break every other deployment that
 *      shared the same template registry.
 *
 *   5. **Name validation runs BEFORE the PVC delete** — same
 *      pattern as defineComponent. A regression that flipped
 *      the order would hit the K8s exec on every malformed
 *      name (path-traversal attempts, etc.) instead of
 *      short-circuiting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ────────────────────────────────────────────────────────────

const mockFindPodForDeployment = vi.fn();
const mockExecInPod = vi.fn();
const mockDeleteComponentFromPvc = vi.fn();
const mockExtractUIBlocks = vi.fn();
const mockValidateComponentName = vi.fn();

// vi.mock factories are hoisted above top-level const decls, so use
// vi.hoisted to define the BUILTIN_COMPONENTS set in the same hoisted
// phase. This way the mock factory below can reference it without
// hitting "Cannot access before initialization".
const hoisted = vi.hoisted(() => ({
  builtins: new Set<string>(["card", "data_table", "stat_grid", "image"]),
}));

vi.mock("../../../k8s/index.js", () => ({
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
  execInPod: (...args: any[]) => mockExecInPod(...args),
  deleteComponentFromPvc: (...args: any[]) => mockDeleteComponentFromPvc(...args),
}));

vi.mock("../../../utils/uiBlockParser.js", () => ({
  extractUIBlocks: (...args: any[]) => mockExtractUIBlocks(...args),
}));

vi.mock("../../../utils/componentResolver.js", () => ({
  validateComponentName: (...args: any[]) => mockValidateComponentName(...args),
  BUILTIN_COMPONENTS: hoisted.builtins,
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { chatWithBotTool } from "../../../mcp/tools/chatWithBot.js";
import { deleteComponentTool } from "../../../mcp/tools/deleteComponent.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindPodForDeployment.mockReset();
  mockExecInPod.mockReset();
  mockDeleteComponentFromPvc.mockReset();
  mockExtractUIBlocks.mockReset();
  mockValidateComponentName.mockReset();

  mockFindPodForDeployment.mockResolvedValue("dep-pod-1");
  mockExtractUIBlocks.mockReturnValue({ cleanText: "", uiBlocks: [] });
  mockValidateComponentName.mockReturnValue(null);
});

function ctx(overrides: Partial<any> = {}): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: {
      id: "dep-abc",
      name: "My Bot",
      status: "running",
      managedBy: "legacy",
      ...overrides,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// chat_with_bot
// ════════════════════════════════════════════════════════════════════════════

describe("chatWithBotTool — metadata", () => {
  it("registers under the name 'chat_with_bot'", () => {
    expect(chatWithBotTool.name).toBe("chat_with_bot");
  });

  it("declares 'message' as the only required parameter", () => {
    expect((chatWithBotTool.parameters as any).required).toEqual(["message"]);
  });

  it("does NOT declare a rendersComponent (UI blocks come back via data.uiBlocks)", () => {
    expect(chatWithBotTool.rendersComponent).toBeUndefined();
  });
});

describe("chatWithBotTool — preconditions", () => {
  it("rejects when message is missing", async () => {
    const r = await chatWithBotTool.execute({}, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("No message");
    expect(mockFindPodForDeployment).not.toHaveBeenCalled();
  });

  it("rejects when message is empty string", async () => {
    const r = await chatWithBotTool.execute({ message: "" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("No message");
  });

  it("rejects when deployment.status !== 'running'", async () => {
    for (const status of ["stopped", "creating", "failed", "initializing", "stopping"]) {
      vi.clearAllMocks();
      const r = await chatWithBotTool.execute(
        { message: "hi" },
        ctx({ status }),
      );
      expect(r.success).toBe(false);
      expect(r.message).toContain("not running");
      expect(mockFindPodForDeployment).not.toHaveBeenCalled();
    }
  });

  it("rejects when no pod is found (status running but K8s sees no pod)", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce(null);

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("No running pod");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });
});

describe("chatWithBotTool — CLI invocation", () => {
  it("calls the openclaw agent CLI with --json + --timeout 30 + session-id keyed on userId", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({ result: { payloads: [{ text: "hello back" }] } }),
    );

    await chatWithBotTool.execute({ message: "hello" }, ctx());

    const cliArgs = mockExecInPod.mock.calls[0][1] as string[];
    expect(cliArgs).toEqual([
      "npx", "openclaw", "agent",
      "--message", "hello",
      "--session-id", "jarble-web-user-1",
      "--json",
      "--timeout", "30",
    ]);
  });

  it("uses operator container name when managedBy='operator'", async () => {
    mockExecInPod.mockResolvedValueOnce('{"payloads":[{"text":"hi"}]}');

    await chatWithBotTool.execute({ message: "hi" }, ctx({ managedBy: "operator" }));

    expect(mockExecInPod.mock.calls[0][2]).toBe("openclaw");
  });
});

describe("chatWithBotTool — JSON parse fallback", () => {
  it("returns text from result.payloads when CLI emits clean JSON", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({ result: { payloads: [{ text: "Hello!" }] } }),
    );

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toBe("Hello!");
  });

  it("falls back to top-level payloads when result wrapper is absent (older CLI)", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({ payloads: [{ text: "Hello (legacy)" }] }),
    );

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toBe("Hello (legacy)");
  });

  it("strips leading non-JSON noise by slicing from first '{'", async () => {
    // Banner / log noise prefixed before the JSON payload.
    mockExecInPod.mockResolvedValueOnce(
      `[init] starting agent...\nBANNER\n{"payloads":[{"text":"clean"}]}`,
    );

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toBe("clean");
  });

  it("returns 'unparseable' when output has '{' but the slice still fails to parse", async () => {
    mockExecInPod.mockResolvedValueOnce(`prefix {not really json`);

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("unparseable");
  });

  it("returns 'non-JSON response' when output has no '{' at all", async () => {
    mockExecInPod.mockResolvedValueOnce("plain text response with no braces");

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("non-JSON");
  });

  it("returns 'empty response' when payloads is empty / whitespace", async () => {
    mockExecInPod.mockResolvedValueOnce(JSON.stringify({ payloads: [{ text: "  " }] }));

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("empty response");
  });

  it("joins multiple payloads with newlines", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({
        payloads: [
          { text: "line 1" },
          { text: "line 2" },
          { text: "line 3" },
        ],
      }),
    );

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toBe("line 1\nline 2\nline 3");
  });

  it("ignores payloads that have no `text` field (treats as empty string)", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({
        payloads: [{ text: "good" }, { other: "noise" }, { text: "also good" }],
      }),
    );

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("good");
    expect(r.message).toContain("also good");
  });
});

describe("chatWithBotTool — UI block extraction", () => {
  it("returns data.uiBlocks when extractUIBlocks finds fenced blocks", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({ payloads: [{ text: "raw with blocks" }] }),
    );
    mockExtractUIBlocks.mockReturnValueOnce({
      cleanText: "Here's a chart:",
      uiBlocks: [
        {
          id: "blk-1",
          component: "line_chart",
          props: { data: [1, 2, 3] },
          editable: true,
          fileId: undefined,
          saveMethod: undefined,
        },
      ],
    });

    const r = await chatWithBotTool.execute({ message: "show me a chart" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toBe("Here's a chart:");
    expect((r.data as any).uiBlocks).toHaveLength(1);
    expect((r.data as any).uiBlocks[0]).toMatchObject({
      blockId: "blk-1",
      component: "line_chart",
    });
  });

  it("uses 'rendered UI components' fallback message when cleanText is empty after extraction", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({ payloads: [{ text: "some text" }] }),
    );
    mockExtractUIBlocks.mockReturnValueOnce({
      cleanText: "",
      uiBlocks: [{ id: "b", component: "card", props: {}, editable: false }],
    });

    const r = await chatWithBotTool.execute({ message: "x" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("rendered UI components");
  });

  it("returns plain message (no data.uiBlocks) when extractor finds no blocks", async () => {
    mockExecInPod.mockResolvedValueOnce(
      JSON.stringify({ payloads: [{ text: "just text" }] }),
    );
    mockExtractUIBlocks.mockReturnValueOnce({ cleanText: "", uiBlocks: [] });

    const r = await chatWithBotTool.execute({ message: "x" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toBe("just text");
    expect((r.data as any)?.uiBlocks).toBeUndefined();
  });
});

describe("chatWithBotTool — exec error handling", () => {
  it("returns success=false when execInPod throws (NEVER throws)", async () => {
    mockExecInPod.mockRejectedValueOnce(new Error("CLI timeout"));

    const r = await chatWithBotTool.execute({ message: "hi" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Failed to reach the bot");
    expect(r.message).toContain("CLI timeout");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// delete_component
// ════════════════════════════════════════════════════════════════════════════

describe("deleteComponentTool — metadata", () => {
  it("registers under the name 'delete_component'", () => {
    expect(deleteComponentTool.name).toBe("delete_component");
  });

  it("declares 'name' as the only required parameter", () => {
    expect((deleteComponentTool.parameters as any).required).toEqual(["name"]);
  });
});

describe("deleteComponentTool — preconditions", () => {
  it("rejects when name is missing", async () => {
    const r = await deleteComponentTool.execute({}, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing required parameter");
    expect(mockDeleteComponentFromPvc).not.toHaveBeenCalled();
  });

  it("rejects when name is empty string", async () => {
    const r = await deleteComponentTool.execute({ name: "" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing required parameter");
  });
});

describe("deleteComponentTool — built-in protection", () => {
  it("refuses to delete each name in BUILTIN_COMPONENTS", async () => {
    for (const name of hoisted.builtins) {
      vi.clearAllMocks();
      const r = await deleteComponentTool.execute({ name }, ctx());
      expect(r.success).toBe(false);
      expect(r.message).toContain("Cannot delete built-in");
      expect(r.message).toContain(name);
      // Built-in check must run BEFORE name validation OR the PVC call.
      expect(mockValidateComponentName).not.toHaveBeenCalled();
      expect(mockDeleteComponentFromPvc).not.toHaveBeenCalled();
    }
  });
});

describe("deleteComponentTool — validation runs before PVC", () => {
  it("rejects on name validation error WITHOUT touching the PVC", async () => {
    mockValidateComponentName.mockReturnValueOnce("Name must be lowercase");

    const r = await deleteComponentTool.execute({ name: "BadName" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toBe("Name must be lowercase");
    expect(mockDeleteComponentFromPvc).not.toHaveBeenCalled();
  });
});

describe("deleteComponentTool — PVC delete", () => {
  it("returns success when deleteComponentFromPvc reports the file existed", async () => {
    mockDeleteComponentFromPvc.mockResolvedValueOnce(true);

    const r = await deleteComponentTool.execute({ name: "user_card" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("user_card");
    expect(r.message).toContain("deleted successfully");
  });

  it("returns 'not found' when deleteComponentFromPvc returns false", async () => {
    mockDeleteComponentFromPvc.mockResolvedValueOnce(false);

    const r = await deleteComponentTool.execute({ name: "ghost" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("not found");
  });

  it("forwards managedBy='operator' to deleteComponentFromPvc", async () => {
    mockDeleteComponentFromPvc.mockResolvedValueOnce(true);

    await deleteComponentTool.execute(
      { name: "x" },
      ctx({ managedBy: "operator" }),
    );

    expect(mockDeleteComponentFromPvc).toHaveBeenCalledWith("dep-abc", "x", "operator");
  });

  it("defaults managedBy='legacy' when not on the deployment row", async () => {
    mockDeleteComponentFromPvc.mockResolvedValueOnce(true);

    await deleteComponentTool.execute({ name: "x" }, ctx({ managedBy: undefined }));

    expect(mockDeleteComponentFromPvc).toHaveBeenCalledWith("dep-abc", "x", "legacy");
  });

  it("returns success=false on PVC delete error (NEVER throws)", async () => {
    mockDeleteComponentFromPvc.mockRejectedValueOnce(new Error("disk full"));

    const r = await deleteComponentTool.execute({ name: "x" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Failed to delete");
    expect(r.message).toContain("disk full");
  });

  it("handles non-Error rejection (string)", async () => {
    mockDeleteComponentFromPvc.mockRejectedValueOnce("string error");

    const r = await deleteComponentTool.execute({ name: "x" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("string error");
  });
});
