import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client.js", () => ({
  coreApi: {
    listNamespacedPod: vi.fn(),
  },
  execClient: {
    exec: vi.fn(),
  },
}));

import { coreApi, execClient } from "./client.js";
import { execInPod, execInPodWithStdin, findPodForDeployment, escapeShellValue } from "./exec.js";

const mockCoreApi = vi.mocked(coreApi);
const mockExecClient = vi.mocked(execClient);

function makePodListResponse(pods: Array<{
  name: string;
  phase?: string;
  ready?: boolean;
  containerName?: string;
}>) {
  return {
    body: {
      items: pods.map((p) => ({
        metadata: { name: p.name },
        status: {
          phase: p.phase ?? "Running",
          containerStatuses: [{
            name: p.containerName ?? "runtime",
            ready: p.ready ?? true,
          }],
        },
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════
// execInPod
// ═══════════════════════════════════════════════════════════════════════
describe("execInPod", () => {
  it("executes command and returns stdout", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, stdout, _stderr, _stdin, _tty, callback) => {
        stdout.write("hello world");
        callback({ status: "Success" });
        return Promise.resolve({} as any);
      }
    );

    const result = await execInPod("pod-1", ["echo", "hello"]);
    expect(result).toBe("hello world");
  });

  it("passes correct arguments to exec client", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, _stderr, _stdin, _tty, callback) => {
        callback({ status: "Success" });
        return Promise.resolve({} as any);
      }
    );

    await execInPod("my-pod", ["cat", "/data/file.txt"], "my-container");

    expect(mockExecClient.exec).toHaveBeenCalledWith(
      "jarble",
      "my-pod",
      "my-container",
      ["cat", "/data/file.txt"],
      expect.any(Object), // stdout
      expect.any(Object), // stderr
      null,               // stdin
      false,              // tty
      expect.any(Function) // callback
    );
  });

  it("uses default container name 'runtime'", async () => {
    let capturedContainer: string | undefined;
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, container, _cmd, _stdout, _stderr, _stdin, _tty, callback) => {
        capturedContainer = container;
        callback({ status: "Success" });
        return Promise.resolve({} as any);
      }
    );

    await execInPod("pod-1", ["ls"]);

    expect(capturedContainer).toBe("runtime");
  });

  it("throws on exec failure with status message", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, _stderr, _stdin, _tty, callback) => {
        callback({ status: "Failure", message: "command not found" });
        return Promise.resolve({} as any);
      }
    );

    await expect(execInPod("pod-1", ["bad-cmd"])).rejects.toThrow("exec failed: command not found");
  });

  it("throws on exec failure with stderr content", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, stderr, _stdin, _tty, callback) => {
        stderr.write("permission denied");
        callback({ status: "Failure" });
        return Promise.resolve({} as any);
      }
    );

    await expect(execInPod("pod-1", ["cat", "/root/secret"])).rejects.toThrow("permission denied");
  });

  it("throws on WebSocket connection error", async () => {
    mockExecClient.exec.mockRejectedValue(new Error("WebSocket connect failed"));

    await expect(execInPod("pod-1", ["ls"])).rejects.toThrow("WebSocket connect failed");
  });

  it("returns empty string for commands with no output", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, _stderr, _stdin, _tty, callback) => {
        callback({ status: "Success" });
        return Promise.resolve({} as any);
      }
    );

    const result = await execInPod("pod-1", ["touch", "/data/file"]);
    expect(result).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// execInPodWithStdin
// ═══════════════════════════════════════════════════════════════════════
describe("execInPodWithStdin", () => {
  it("sends stdin content to exec", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, _stderr, _stdin, _tty, callback) => {
        callback({ status: "Success" });
        return Promise.resolve({} as any);
      }
    );

    await execInPodWithStdin("pod-1", ["cat", ">", "/data/file.txt"], "file content");

    expect(mockExecClient.exec).toHaveBeenCalledWith(
      "jarble", "pod-1", "runtime",
      ["cat", ">", "/data/file.txt"],
      expect.any(Object),
      expect.any(Object),
      expect.any(Object), // stdin stream (not null)
      false,
      expect.any(Function)
    );
  });

  it("throws on exec failure", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, stderr, _stdin, _tty, callback) => {
        stderr.write("write error");
        callback({ status: "Failure", message: "write failed" });
        return Promise.resolve({} as any);
      }
    );

    await expect(execInPodWithStdin("pod-1", ["cat"], "data"))
      .rejects.toThrow("exec failed: write failed");
  });

  it("times out after specified duration", async () => {
    mockExecClient.exec.mockImplementation(
      () => {
        // Never call callback — simulates hang
        return Promise.resolve({} as any);
      }
    );

    await expect(execInPodWithStdin("pod-1", ["cat"], "data", 100))
      .rejects.toThrow("timed out after 100ms");
  }, 5000);

  it("uses custom container name", async () => {
    mockExecClient.exec.mockImplementation(
      (_ns, _pod, _container, _cmd, _stdout, _stderr, _stdin, _tty, callback) => {
        callback({ status: "Success" });
        return Promise.resolve({} as any);
      }
    );

    await execInPodWithStdin("pod-1", ["cat"], "data", 30000, "openclaw");

    expect(mockExecClient.exec).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "openclaw",
      expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), expect.anything()
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// findPodForDeployment
// ═══════════════════════════════════════════════════════════════════════
describe("findPodForDeployment", () => {
  it("returns pod name when found and ready", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-abc" }]) as any
    );

    const result = await findPodForDeployment("dep-1");
    expect(result).toBe("pod-abc");
  });

  it("returns null when no pods found", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([]) as any
    );

    const result = await findPodForDeployment("dep-1");
    expect(result).toBeNull();
  });

  it("returns null when pod is not running", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1", phase: "Pending", ready: false }]) as any
    );

    const result = await findPodForDeployment("dep-1");
    expect(result).toBeNull();
  });

  it("returns null when pod is running but not ready (requireReady=true)", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1", phase: "Running", ready: false }]) as any
    );

    const result = await findPodForDeployment("dep-1", { requireReady: true });
    expect(result).toBeNull();
  });

  it("returns pod name when running but not ready with requireReady=false", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1", phase: "Running", ready: false }]) as any
    );

    const result = await findPodForDeployment("dep-1", { requireReady: false });
    expect(result).toBe("pod-1");
  });

  it("uses legacy label selector by default", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1" }]) as any
    );

    await findPodForDeployment("dep-1");

    expect(mockCoreApi.listNamespacedPod).toHaveBeenCalledWith(
      "jarble",
      undefined, undefined, undefined, undefined,
      "app=dep-dep-1"
    );
  });

  it("uses operator label selector when managedBy=operator", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue(
      makePodListResponse([{ name: "pod-1" }]) as any
    );

    await findPodForDeployment("dep-1", { managedBy: "operator" });

    expect(mockCoreApi.listNamespacedPod).toHaveBeenCalledWith(
      "jarble",
      undefined, undefined, undefined, undefined,
      "app.kubernetes.io/instance=dep-dep-1"
    );
  });

  it("returns null when pod has no metadata name", async () => {
    mockCoreApi.listNamespacedPod.mockResolvedValue({
      body: {
        items: [{
          metadata: {},
          status: {
            phase: "Running",
            containerStatuses: [{ name: "runtime", ready: true }],
          },
        }],
      },
    } as any);

    const result = await findPodForDeployment("dep-1");
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// escapeShellValue
// ═══════════════════════════════════════════════════════════════════════
describe("escapeShellValue", () => {
  it("returns unchanged string with no single quotes", () => {
    expect(escapeShellValue("hello world")).toBe("hello world");
  });

  it("escapes single quotes", () => {
    expect(escapeShellValue("it's")).toBe("it'\\''s");
  });

  it("handles multiple single quotes", () => {
    expect(escapeShellValue("a'b'c")).toBe("a'\\''b'\\''c");
  });

  it("handles empty string", () => {
    expect(escapeShellValue("")).toBe("");
  });

  it("handles string that is only a single quote", () => {
    expect(escapeShellValue("'")).toBe("'\\''");
  });
});
