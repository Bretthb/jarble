/**
 * Unit tests for the file-tools MCP trio: list_files, read_file,
 * write_file.
 *
 * The three tools share the same security boundary — they each
 * validate that paths stay under the PVC mount, reject `..`
 * traversal, and use exec-into-pod for the actual I/O. They
 * differ in what's blocked, what bounds the size, and which
 * exec primitive is used.
 *
 * Three contracts pinned:
 *
 *   1. **Path-traversal defense** — `..` is rejected on EVERY
 *      tool. The pvcMount-prefix check + `..` rejection is the
 *      sandbox boundary; a regression that loosened either lets
 *      the bot read or write arbitrary host files.
 *
 *   2. **Per-tool blocklists** — list_files blocks `runtime/
 *      node_modules` + `.npm` (read-noise reduction); write_file
 *      blocks 13 platform-managed paths (`.initialized`, `runtime`,
 *      `config/`, `.openclaw`, `.openclaw.pid`, `soul.md`, etc.).
 *      A regression that let the bot write `config/soul.md`
 *      directly would race with `configSync` and corrupt the
 *      pod's bootstrapped state.
 *
 *   3. **Size bounds** — read_file rejects files > 1 MB after a
 *      `stat` probe; write_file rejects content > 1 MB before
 *      any exec. Without these, a malicious or buggy bot could
 *      exhaust API memory streaming a large file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindPodForDeployment = vi.fn();
const mockExecInPod = vi.fn();
const mockExecInPodWithStdin = vi.fn();

vi.mock("../../../k8s/index.js", () => ({
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
  execInPod: (...args: any[]) => mockExecInPod(...args),
  execInPodWithStdin: (...args: any[]) => mockExecInPodWithStdin(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { listFilesTool } from "../../../mcp/tools/listFiles.js";
import { readFileTool } from "../../../mcp/tools/readFile.js";
import { writeFileTool } from "../../../mcp/tools/writeFile.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindPodForDeployment.mockReset();
  mockExecInPod.mockReset();
  mockExecInPodWithStdin.mockReset();

  // Default: pod found, named "dep-pod-1".
  mockFindPodForDeployment.mockResolvedValue("dep-pod-1");
});

function ctx(managedBy: any = "legacy"): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: { id: "dep-abc", name: "My Bot", managedBy },
  };
}

// ── Shared metadata ────────────────────────────────────────────────────────

describe("file-trio — metadata", () => {
  it("list_files declares optional 'path' (default = PVC root)", () => {
    const params = listFilesTool.parameters as any;
    expect(params.required).toBeUndefined();
    expect(params.properties.path).toBeDefined();
  });

  it("read_file declares 'path' as required", () => {
    expect((readFileTool.parameters as any).required).toEqual(["path"]);
  });

  it("write_file declares 'path' AND 'content' as required", () => {
    expect((writeFileTool.parameters as any).required).toEqual(["path", "content"]);
  });
});

// ── Path-traversal defense — applied to all three ─────────────────────────

describe("file-trio — path-traversal defense", () => {
  const tools = [
    { tool: listFilesTool, name: "list_files", needsContent: false },
    { tool: readFileTool, name: "read_file", needsContent: false },
    { tool: writeFileTool, name: "write_file", needsContent: true },
  ];

  it.each(tools)("$name rejects '..' anywhere in the path", async ({ tool, needsContent }) => {
    const params: any = { path: "/data/notes/../../../etc/passwd" };
    if (needsContent) params.content = "x";

    const r = await tool.execute(params, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("traversal");
    // Must NOT touch the pod.
    expect(mockExecInPod).not.toHaveBeenCalled();
    expect(mockExecInPodWithStdin).not.toHaveBeenCalled();
  });

  it.each(tools)("$name rejects paths NOT under the PVC mount", async ({ tool, needsContent }) => {
    const params: any = { path: "/etc/passwd" };
    if (needsContent) params.content = "x";

    const r = await tool.execute(params, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("/data/");
    expect(mockExecInPod).not.toHaveBeenCalled();
    expect(mockExecInPodWithStdin).not.toHaveBeenCalled();
  });

  it.each(tools)("$name rejects lookalike-prefix '/data2/...'", async ({ tool, needsContent }) => {
    // /data2/x looks like it starts with /data but is NOT under it.
    // The check is `path.startsWith("/data/")` — must include the trailing slash.
    const params: any = { path: "/data2/file" };
    if (needsContent) params.content = "x";

    const r = await tool.execute(params, ctx());
    expect(r.success).toBe(false);
  });
});

// ── list_files ──────────────────────────────────────────────────────────────

describe("listFilesTool", () => {
  it("registers under the name 'list_files'", () => {
    expect(listFilesTool.name).toBe("list_files");
  });

  it("defaults path to the PVC mount root when not provided", async () => {
    mockExecInPod.mockResolvedValueOnce("total 4\ndrwxr-xr-x 2 root root\n");

    await listFilesTool.execute({}, ctx());

    const args = mockExecInPod.mock.calls[0];
    expect(args[1]).toEqual(["ls", "-la", "--time-style=iso", "/data/"]);
    expect(args[2]).toBe("runtime"); // legacy container name
  });

  it("blocks runtime/node_modules to keep listings clean", async () => {
    const r = await listFilesTool.execute({ path: "/data/runtime/node_modules" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("not allowed");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("blocks .npm cache directory", async () => {
    const r = await listFilesTool.execute({ path: "/data/.npm" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("not allowed");
  });

  it("blocks subdirectories of blocked paths (`/data/.npm/foo`)", async () => {
    const r = await listFilesTool.execute({ path: "/data/.npm/cache/123" }, ctx());
    expect(r.success).toBe(false);
  });

  it("returns 'no running pod' when findPodForDeployment returns null", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce(null);

    const r = await listFilesTool.execute({ path: "/data/notes" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("No running pod");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("uses operator container name when managedBy is 'operator'", async () => {
    mockExecInPod.mockResolvedValueOnce("");

    await listFilesTool.execute(
      { path: "/home/openclaw/.openclaw/notes" },
      ctx("operator"),
    );

    const args = mockExecInPod.mock.calls[0];
    expect(args[2]).toBe("openclaw"); // operator container name
  });

  it("returns the listing on success and includes path in data", async () => {
    mockExecInPod.mockResolvedValueOnce("a.txt\nb.txt\n");

    const r = await listFilesTool.execute({ path: "/data/notes" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("a.txt");
    expect((r.data as any).path).toBe("/data/notes");
    expect((r.data as any).listing).toContain("a.txt");
  });

  it("returns success=false on exec error (NEVER throws)", async () => {
    mockExecInPod.mockRejectedValueOnce(new Error("ENOENT"));

    const r = await listFilesTool.execute({ path: "/data/missing" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Could not list files");
    expect(r.message).toContain("ENOENT");
  });
});

// ── read_file ───────────────────────────────────────────────────────────────

describe("readFileTool", () => {
  it("registers under the name 'read_file'", () => {
    expect(readFileTool.name).toBe("read_file");
  });

  it("rejects when path is missing", async () => {
    const r = await readFileTool.execute({}, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("No path provided");
  });

  it("performs a stat probe BEFORE reading content (size guard)", async () => {
    mockExecInPod
      .mockResolvedValueOnce("100\n") // stat
      .mockResolvedValueOnce("hello"); // cat

    await readFileTool.execute({ path: "/data/notes.txt" }, ctx());

    expect(mockExecInPod).toHaveBeenCalledTimes(2);
    expect(mockExecInPod.mock.calls[0][1]).toEqual(["stat", "-c", "%s", "/data/notes.txt"]);
    expect(mockExecInPod.mock.calls[1][1]).toEqual(["cat", "/data/notes.txt"]);
  });

  it("rejects files > 1 MB AFTER stat — without reading content", async () => {
    mockExecInPod.mockResolvedValueOnce(`${2 * 1024 * 1024}\n`); // 2 MB

    const r = await readFileTool.execute({ path: "/data/big.bin" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("too large");
    expect(r.message).toContain("1 MB");
    // Only stat ran — the cat that would burn 2 MB of memory was skipped.
    expect(mockExecInPod).toHaveBeenCalledTimes(1);
  });

  it("rejects when stat returns non-numeric (defensive)", async () => {
    mockExecInPod.mockResolvedValueOnce("not-a-number\n");

    const r = await readFileTool.execute({ path: "/data/notes.txt" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Could not determine file size");
    expect(mockExecInPod).toHaveBeenCalledTimes(1);
  });

  it("returns content + size + path on success", async () => {
    mockExecInPod
      .mockResolvedValueOnce("42\n")
      .mockResolvedValueOnce("hello world");

    const r = await readFileTool.execute({ path: "/data/notes.txt" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("hello world");
    expect((r.data as any)).toEqual({ path: "/data/notes.txt", content: "hello world", size: 42 });
  });

  it("returns success=false on exec error (NEVER throws)", async () => {
    mockExecInPod.mockRejectedValueOnce(new Error("permission denied"));

    const r = await readFileTool.execute({ path: "/data/locked.txt" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Could not read");
    expect(r.message).toContain("permission denied");
  });

  it("returns 'no running pod' when findPodForDeployment returns null", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce(null);

    const r = await readFileTool.execute({ path: "/data/notes.txt" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("No running pod");
  });
});

// ── write_file ──────────────────────────────────────────────────────────────

describe("writeFileTool", () => {
  it("registers under the name 'write_file'", () => {
    expect(writeFileTool.name).toBe("write_file");
  });

  it("rejects when path is missing", async () => {
    const r = await writeFileTool.execute({ content: "x" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("No path");
  });

  it("rejects when content is missing", async () => {
    const r = await writeFileTool.execute({ path: "/data/x" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("No content");
  });

  it("accepts an empty-string content (intentional clear)", async () => {
    mockExecInPodWithStdin.mockResolvedValueOnce(undefined);

    const r = await writeFileTool.execute(
      { path: "/data/notes.txt", content: "" },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect((r.data as any).bytesWritten).toBe(0);
  });

  it("blocks writes to .initialized (would re-trigger the bootstrap on next pod start)", async () => {
    const r = await writeFileTool.execute(
      { path: "/data/.initialized", content: "x" },
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(r.message).toContain("not allowed");
    expect(mockExecInPodWithStdin).not.toHaveBeenCalled();
  });

  it("blocks writes to config/soul.md (configSync owns this — bot must not race)", async () => {
    const r = await writeFileTool.execute(
      { path: "/data/config/soul.md", content: "evil prompt" },
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(r.message).toContain("not allowed");
  });

  it("blocks writes to ALL 13 known protected paths", async () => {
    const blocked = [
      "/data/.initialized",
      "/data/runtime",
      "/data/.npm",
      "/data/config/mcp",
      "/data/config/soul.md",
      "/data/config/openclaw.json",
      "/data/config/service-tools.json",
      "/data/config/platform-skills.json",
      "/data/config/skills",
      "/data/config/.env",
      "/data/.openclaw",
      "/data/.openclaw.pid",
      "/data/.reload",
      "/data/soul.md",
      "/data/openclaw.json",
    ];

    for (const path of blocked) {
      vi.clearAllMocks();
      mockFindPodForDeployment.mockResolvedValue("dep-pod-1");
      const r = await writeFileTool.execute({ path, content: "x" }, ctx());
      expect(r.success).toBe(false);
      expect(r.message).toContain("not allowed");
      expect(mockExecInPodWithStdin).not.toHaveBeenCalled();
    }
  });

  it("blocks writes to subdirectories of protected paths (`config/skills/x.json`)", async () => {
    const r = await writeFileTool.execute(
      { path: "/data/config/skills/my-skill.json", content: "x" },
      ctx(),
    );
    expect(r.success).toBe(false);
  });

  it("rejects content > 1 MB BEFORE any exec", async () => {
    const huge = "x".repeat(2 * 1024 * 1024);
    const r = await writeFileTool.execute(
      { path: "/data/big.bin", content: huge },
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(r.message).toContain("too large");
    expect(mockFindPodForDeployment).not.toHaveBeenCalled();
    expect(mockExecInPodWithStdin).not.toHaveBeenCalled();
  });

  it("escapes single quotes in the path before passing to sh -c (shell-injection defense)", async () => {
    mockExecInPodWithStdin.mockResolvedValueOnce(undefined);

    await writeFileTool.execute(
      { path: "/data/o'malley.txt", content: "x" },
      ctx(),
    );

    const args = mockExecInPodWithStdin.mock.calls[0];
    const shellCmd = args[1] as string[];
    // The shell command should contain the escaped form, not the raw apostrophe.
    expect(shellCmd[2]).toBe("cat > '/data/o'\\''malley.txt'");
  });

  it("calls execInPodWithStdin (NOT execInPod) so the content arrives via stdin not args", async () => {
    mockExecInPodWithStdin.mockResolvedValueOnce(undefined);

    await writeFileTool.execute(
      { path: "/data/notes.txt", content: "stdin-payload" },
      ctx(),
    );

    expect(mockExecInPodWithStdin).toHaveBeenCalledTimes(1);
    expect(mockExecInPod).not.toHaveBeenCalled();
    // stdin content is the third arg.
    expect(mockExecInPodWithStdin.mock.calls[0][2]).toBe("stdin-payload");
  });

  it("returns success with byte count on success", async () => {
    mockExecInPodWithStdin.mockResolvedValueOnce(undefined);

    const r = await writeFileTool.execute(
      { path: "/data/notes.txt", content: "hello" },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect(r.message).toContain("5 bytes");
    expect((r.data as any).bytesWritten).toBe(5);
  });

  it("returns success=false on exec error (NEVER throws)", async () => {
    mockExecInPodWithStdin.mockRejectedValueOnce(new Error("disk full"));

    const r = await writeFileTool.execute(
      { path: "/data/notes.txt", content: "x" },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Could not write");
    expect(r.message).toContain("disk full");
  });
});
