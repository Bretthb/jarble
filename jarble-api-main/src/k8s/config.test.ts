import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock client.js before imports
vi.mock("./client.js", () => ({
  coreApi: {
    listNamespacedPod: vi.fn(),
  },
  execClient: { exec: vi.fn() },
}));

vi.mock("./exec.js", () => ({
  execInPod: vi.fn(),
  findPodForDeployment: vi.fn(),
  escapeShellValue: vi.fn((v: string) => v.replace(/'/g, "'\\''")),
}));

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
import { execInPod, findPodForDeployment } from "./exec.js";
import { writeConfigsToPvc, readConfigsFromPvc, exportDeploymentConfigs, signalProcessRestart } from "./config.js";

const mockCoreApi = vi.mocked(coreApi);
const mockExecInPod = vi.mocked(execInPod);
const mockFindPod = vi.mocked(findPodForDeployment);

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
});

// ═══════════════════════════════════════════════════════════════════════
// writeConfigsToPvc
// ═══════════════════════════════════════════════════════════════════════
describe("writeConfigsToPvc", () => {
  it("returns early when files and clearDirs are both empty", async () => {
    await writeConfigsToPvc("dep-1", []);
    expect(mockCoreApi.listNamespacedPod).not.toHaveBeenCalled();
  });

  it("finds the pod for the deployment", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [{ path: "soul.md", content: "hello" }]);

    expect(mockCoreApi.listNamespacedPod).toHaveBeenCalledWith(
      "jarble",
      undefined, undefined, undefined, undefined,
      "app=dep-dep-1"
    );
  });

  it("throws when no pods are found", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([]) as any);

    await expect(writeConfigsToPvc("dep-1", [{ path: "soul.md", content: "x" }]))
      .rejects.toThrow("No pods found for deployment dep-1");
  });

  it("throws when pod has no name", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue({
      body: { items: [{ metadata: {}, status: { phase: "Running" } }] },
    } as any);

    await expect(writeConfigsToPvc("dep-1", [{ path: "a.txt", content: "x" }]))
      .rejects.toThrow("Pod has no name");
  });

  it("writes files via a single batched exec call", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [
      { path: "soul.md", content: "Be helpful" },
      { path: "openclaw.json", content: '{"key":"val"}' },
    ]);

    expect(mockExecInPod).toHaveBeenCalledTimes(1);
    const [podName, cmd, container] = mockExecInPod.mock.calls[0];
    expect(podName).toBe("pod-1");
    expect(cmd[0]).toBe("sh");
    expect(cmd[1]).toBe("-c");
    expect(container).toBe("runtime");
  });

  it("base64 encodes file content in the shell script", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    const content = "Hello, World!";
    await writeConfigsToPvc("dep-1", [{ path: "test.txt", content }]);

    const script = mockExecInPod.mock.calls[0][1][2];
    const expectedB64 = Buffer.from(content).toString("base64");
    expect(script).toContain(expectedB64);
    expect(script).toContain("base64 -d");
  });

  it("creates mkdir -p for all unique directories", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [
      { path: "soul.md", content: "a" },
      { path: "skills/search.json", content: "b" },
    ]);

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain("mkdir -p");
    expect(script).toContain("/data/config");
    expect(script).toContain("/data/config/skills");
  });

  it("handles clearDirs by adding rm -rf commands", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [], "legacy", ["skills"]);

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain("rm -rf '/data/config/skills'");
  });

  it("handles clearDirs with absolute paths", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [], "legacy", ["/custom/path"]);

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain("rm -rf '/custom/path'");
  });

  it("handles files with absolute paths", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [{ path: "/data/.openclaw/openclaw.json", content: "{}" }]);

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain("/data/.openclaw/openclaw.json");
  });

  it("uses operator label selector and container name in operator mode", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-op" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [{ path: "soul.md", content: "x" }], "operator");

    expect(mockCoreApi.listNamespacedPod).toHaveBeenCalledWith(
      "jarble",
      undefined, undefined, undefined, undefined,
      "app.kubernetes.io/instance=dep-dep-1"
    );
    expect(mockExecInPod).toHaveBeenCalledWith("pod-op", expect.any(Array), "openclaw");
  });

  it("uses operator PVC mount path", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-op" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [{ path: "soul.md", content: "x" }], "operator");

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain("/home/openclaw/.openclaw/config");
  });

  it("handles special characters in file content via base64 encoding", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    const content = "Hello 'world' \"with\" $pecial & <chars>";
    await writeConfigsToPvc("dep-1", [{ path: "test.md", content }]);

    const script = mockExecInPod.mock.calls[0][1][2];
    const expectedB64 = Buffer.from(content).toString("base64");
    expect(script).toContain(expectedB64);
  });

  it("handles unicode content via base64 encoding", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    const content = "こんにちは世界 🌍";
    await writeConfigsToPvc("dep-1", [{ path: "test.md", content }]);

    const script = mockExecInPod.mock.calls[0][1][2];
    const expectedB64 = Buffer.from(content).toString("base64");
    expect(script).toContain(expectedB64);
  });

  it("propagates exec errors", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockRejectedValue(new Error("exec failed: exit code 1"));

    await expect(writeConfigsToPvc("dep-1", [{ path: "a.txt", content: "x" }]))
      .rejects.toThrow("exec failed");
  });

  it("chains all script parts with && for atomic execution", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [{ path: "a.txt", content: "x" }], "legacy", ["skills"]);

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain(" && ");
    // rm -rf && mkdir -p && echo base64
    const parts = script.split(" && ");
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("handles multiple clearDirs", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await writeConfigsToPvc("dep-1", [], "legacy", ["skills", "components"]);

    const script = mockExecInPod.mock.calls[0][1][2];
    expect(script).toContain("rm -rf '/data/config/skills'");
    expect(script).toContain("rm -rf '/data/config/components'");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// readConfigsFromPvc
// ═══════════════════════════════════════════════════════════════════════
describe("readConfigsFromPvc", () => {
  it("throws when no pods found", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([]) as any);

    await expect(readConfigsFromPvc("dep-1", [{ path: "soul.md", description: "", isGlob: false }]))
      .rejects.toThrow("No pods found");
  });

  it("throws when pod is not ready", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1", phase: "Pending", ready: false }]) as any
    );

    await expect(readConfigsFromPvc("dep-1", [{ path: "soul.md", description: "", isGlob: false }]))
      .rejects.toThrow("not ready");
  });

  it("reads a single config file", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("Be helpful");

    const files = await readConfigsFromPvc("dep-1", [
      { path: "soul.md", description: "System prompt", isGlob: false },
    ]);

    expect(files).toEqual([{ path: "soul.md", content: "Be helpful" }]);
    expect(mockExecInPod).toHaveBeenCalledWith("pod-1", ["cat", "/data/config/soul.md"], "runtime");
  });

  it("reads glob spec files", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod
      .mockResolvedValueOnce("/data/config/skills/search.json\n/data/config/skills/weather.json")
      .mockResolvedValueOnce('{"name":"search"}')
      .mockResolvedValueOnce('{"name":"weather"}');

    const files = await readConfigsFromPvc("dep-1", [
      { path: "skills/*", description: "Skills", isGlob: true },
    ]);

    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("skills/search.json");
    expect(files[1].path).toBe("skills/weather.json");
  });

  it("skips missing config files gracefully", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockRejectedValue(new Error("No such file"));

    const files = await readConfigsFromPvc("dep-1", [
      { path: "missing.md", description: "", isGlob: false },
    ]);

    expect(files).toEqual([]);
  });

  it("skips missing glob directories gracefully", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockRejectedValue(new Error("No such directory"));

    const files = await readConfigsFromPvc("dep-1", [
      { path: "nonexistent/*", description: "", isGlob: true },
    ]);

    expect(files).toEqual([]);
  });

  it("skips unreadable files in glob results", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod
      .mockResolvedValueOnce("/data/config/skills/good.json\n/data/config/skills/bad.json")
      .mockResolvedValueOnce('{"ok":true}')
      .mockRejectedValueOnce(new Error("Permission denied"));

    const files = await readConfigsFromPvc("dep-1", [
      { path: "skills/*", description: "", isGlob: true },
    ]);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("skills/good.json");
  });

  it("uses operator container and mount path", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-op" }]) as any);
    mockExecInPod.mockResolvedValue("content");

    await readConfigsFromPvc("dep-1", [
      { path: "soul.md", description: "", isGlob: false },
    ], "operator");

    expect(mockExecInPod).toHaveBeenCalledWith(
      "pod-op",
      ["cat", "/home/openclaw/.openclaw/config/soul.md"],
      "openclaw"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// exportDeploymentConfigs
// ═══════════════════════════════════════════════════════════════════════
describe("exportDeploymentConfigs", () => {
  it("throws when no pods found", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([]) as any);
    await expect(exportDeploymentConfigs("dep-1")).rejects.toThrow("No pods found");
  });

  it("throws when pod is not running", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1", phase: "Pending", ready: false }]) as any
    );
    await expect(exportDeploymentConfigs("dep-1")).rejects.toThrow("not running");
  });

  it("throws when no config files found", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod.mockResolvedValue("");

    await expect(exportDeploymentConfigs("dep-1")).rejects.toThrow("No config files found");
  });

  it("returns a base64-encoded zip with correct filename", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod
      .mockResolvedValueOnce("/data/config/soul.md")
      .mockResolvedValueOnce("Be helpful");

    const result = await exportDeploymentConfigs("dep-1");

    expect(result.filename).toBe("config-dep-1.zip");
    expect(result.data).toBeTruthy();
    // data is base64
    expect(() => Buffer.from(result.data, "base64")).not.toThrow();
  });

  it("throws when all files are unreadable", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(makePodListResponse([{ name: "pod-1" }]) as any);
    mockExecInPod
      .mockResolvedValueOnce("/data/config/soul.md")
      .mockRejectedValueOnce(new Error("Permission denied"));

    await expect(exportDeploymentConfigs("dep-1")).rejects.toThrow("All config files were unreadable");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// signalProcessRestart
// ═══════════════════════════════════════════════════════════════════════
describe("signalProcessRestart", () => {
  it("returns false in operator mode", async () => {
    const result = await signalProcessRestart("dep-1", {}, "operator");
    expect(result).toBe(false);
    expect(mockFindPod).not.toHaveBeenCalled();
  });

  it("returns false when no running pod found", async () => {
    mockFindPod.mockResolvedValue(null);
    const result = await signalProcessRestart("dep-1", { FOO: "bar" });
    expect(result).toBe(false);
  });

  it("returns false when PID file does not exist", async () => {
    mockFindPod.mockResolvedValue("pod-1");
    mockExecInPod.mockRejectedValueOnce(new Error("No such file"));

    const result = await signalProcessRestart("dep-1", { FOO: "bar" });
    expect(result).toBe(false);
  });

  it("returns false when PID file contains invalid content", async () => {
    mockFindPod.mockResolvedValue("pod-1");
    mockExecInPod.mockResolvedValueOnce("not-a-number");

    const result = await signalProcessRestart("dep-1", { FOO: "bar" });
    expect(result).toBe(false);
  });

  it("returns false when PID file is empty", async () => {
    mockFindPod.mockResolvedValue("pod-1");
    mockExecInPod.mockResolvedValueOnce("");

    const result = await signalProcessRestart("dep-1", { FOO: "bar" });
    expect(result).toBe(false);
  });

  it("writes env file, touches .reload marker, and kills process", async () => {
    mockFindPod.mockResolvedValue("pod-1");
    mockExecInPod
      .mockResolvedValueOnce("42\n")  // cat PID
      .mockResolvedValueOnce("")      // write .env
      .mockResolvedValueOnce("")      // touch .reload
      .mockResolvedValueOnce("");     // kill

    const result = await signalProcessRestart("dep-1", { MY_VAR: "value" });

    expect(result).toBe(true);
    expect(mockExecInPod).toHaveBeenCalledTimes(4);
    // kill call
    expect(mockExecInPod.mock.calls[3][1]).toEqual(["kill", "42"]);
  });

  it("skips env keys with unsafe names", async () => {
    mockFindPod.mockResolvedValue("pod-1");
    mockExecInPod
      .mockResolvedValueOnce("42\n")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");

    const result = await signalProcessRestart("dep-1", {
      "VALID_KEY": "ok",
      "invalid key": "skip",
      "123BAD": "skip",
    });

    expect(result).toBe(true);
    // The env file write call is the second exec
    const envWriteScript = mockExecInPod.mock.calls[1][1][2];
    const envContent = Buffer.from(
      envWriteScript.match(/echo '([^']+)'/)?.[1] ?? "",
      "base64"
    ).toString("utf-8");
    expect(envContent).toContain("VALID_KEY");
    expect(envContent).not.toContain("invalid key");
    expect(envContent).not.toContain("123BAD");
  });

  it("returns true even if kill fails (process may have exited)", async () => {
    mockFindPod.mockResolvedValue("pod-1");
    mockExecInPod
      .mockResolvedValueOnce("42\n")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("No such process"));

    const result = await signalProcessRestart("dep-1", { K: "v" });
    expect(result).toBe(true);
  });
});
