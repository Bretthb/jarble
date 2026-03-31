/**
 * Tests verifying shell injection vectors are properly escaped in writeConfigsToPvc.
 *
 * Uses the REAL escapeShellValue function (from exec.ts) to verify that crafted
 * file paths and directory names cannot break out of single-quoted shell strings.
 * Mocks execInPod and the K8s client to capture the generated shell script.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock client.js before imports
vi.mock("./client.js", () => ({
  coreApi: {
    listNamespacedPod: vi.fn(),
  },
  execClient: { exec: vi.fn() },
}));

// Mock exec.js but keep the REAL escapeShellValue
vi.mock("./exec.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./exec.js")>();
  return {
    execInPod: vi.fn(),
    findPodForDeployment: vi.fn(),
    escapeShellValue: original.escapeShellValue,
  };
});

vi.mock("archiver", () => {
  const { EventEmitter } = require("events");
  return {
    default: vi.fn(() => {
      const emitter = new EventEmitter();
      (emitter as any).append = vi.fn();
      (emitter as any).finalize = vi.fn(() => {
        const buf = Buffer.from("ZIPDATA");
        emitter.emit("data", buf);
        emitter.emit("end");
      });
      return emitter;
    }),
  };
});

import { coreApi } from "./client.js";
import { execInPod } from "./exec.js";
import { writeConfigsToPvc } from "./config.js";

const mockCoreApi = vi.mocked(coreApi);
const mockExecInPod = vi.mocked(execInPod);

function makePodListResponse(pods: Array<{ name: string; phase?: string; ready?: boolean }>) {
  return {
    body: {
      items: pods.map((p) => ({
        metadata: { name: p.name },
        status: {
          phase: p.phase ?? "Running",
          containerStatuses: [{ name: "runtime", ready: p.ready ?? true }],
        },
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
  mockExecInPod.mockResolvedValue("");
});

// ═══════════════════════════════════════════════════════════════════════
// Shell Escape: injection vectors in writeConfigsToPvc
// ═══════════════════════════════════════════════════════════════════════
describe("writeConfigsToPvc shell escape", () => {
  it("file paths with single quotes are escaped in the generated script", async () => {
    await writeConfigsToPvc("dep-1", [
      { path: "it's a file.json", content: "{}" },
    ]);

    expect(mockExecInPod).toHaveBeenCalledTimes(1);
    const script = mockExecInPod.mock.calls[0][1][2];

    // The single quote in the file path must be escaped as '\'' inside the single-quoted string.
    // The raw unescaped path "it's a file.json" should NOT appear as a literal inside quotes.
    // Instead, the escaped form it'\''s should be present.
    expect(script).toContain("it'\\''s a file.json");
    // Verify the UNescaped form (single quote inside single-quoted string) is NOT present.
    // The unescaped form would be: 'it's a file.json' - which would break the shell.
    expect(script).not.toContain("'it's a file.json'");
  });

  it("file paths with backticks don't cause command substitution", async () => {
    await writeConfigsToPvc("dep-1", [
      { path: "file`whoami`.json", content: "data" },
    ]);

    const script = mockExecInPod.mock.calls[0][1][2];

    // Inside single quotes, backticks are literal - they should appear as-is
    // The key check: the path is wrapped in single quotes so backticks are inert.
    // Verify the path appears inside single-quoted context
    expect(script).toContain("'");
    expect(script).toContain("file`whoami`.json");
    // The backtick path must be inside single quotes to be safe
    expect(script).toMatch(/'[^']*file`whoami`\.json[^']*'/);
  });

  it("file paths with $() are safely escaped", async () => {
    await writeConfigsToPvc("dep-1", [
      { path: "$(rm -rf /).json", content: "x" },
    ]);

    const script = mockExecInPod.mock.calls[0][1][2];

    // $() inside single quotes is literal, not executed.
    // Verify the dangerous string is contained within single quotes.
    expect(script).toContain("$(rm -rf /).json");
    // Must appear within single-quoted context
    expect(script).toMatch(/'[^']*\$\(rm -rf \/\)\.json[^']*'/);
  });

  it("clearDirs with injection characters are properly quoted", async () => {
    await writeConfigsToPvc("dep-1", [], "legacy", [
      "skills'; rm -rf / #",
    ]);

    const script = mockExecInPod.mock.calls[0][1][2];

    // The single quote in the clearDir path must be escaped.
    // The injected command "; rm -rf / #" must NOT be executable.
    expect(script).toContain("rm -rf '");
    // The escaping should break out the single quote: skills'\''
    expect(script).toContain("skills'\\''");
    // The rest of the injection payload must stay inside quotes
    expect(script).toContain("; rm -rf / #");
  });

  it("normal paths work without issues", async () => {
    await writeConfigsToPvc("dep-1", [
      { path: "soul.md", content: "Be helpful" },
      { path: "skills/search.json", content: '{"name":"search"}' },
    ]);

    expect(mockExecInPod).toHaveBeenCalledTimes(1);
    const script = mockExecInPod.mock.calls[0][1][2];

    // Verify basic structure: mkdir + base64 writes
    expect(script).toContain("mkdir -p");
    expect(script).toContain("/data/config");
    expect(script).toContain("/data/config/skills");
    expect(script).toContain("base64 -d");

    // Verify content is base64-encoded
    const b64Soul = Buffer.from("Be helpful").toString("base64");
    const b64Skills = Buffer.from('{"name":"search"}').toString("base64");
    expect(script).toContain(b64Soul);
    expect(script).toContain(b64Skills);
  });
});
