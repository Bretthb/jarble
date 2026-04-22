/**
 * File management route tests
 *
 * Tests the Express route handlers by mounting the router on a minimal Express
 * app and using Node's built-in fetch. Dependencies (auth, DB, K8s exec) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../k8s/index.js", () => ({
  findPodForDeployment: vi.fn(),
  execInPod: vi.fn(),
  execInPodWithStdin: vi.fn(),
  execInPodStreaming: vi.fn(),
  escapeShellValue: vi.fn((v: string) => v.replace(/'/g, "'\\''")),
}));

vi.mock("../../k8s/constants.js", () => ({
  getPvcMountPath: vi.fn(() => "/data"),
  getContainerName: vi.fn(() => "runtime"),
}));

vi.mock("../../services/auth.js", () => ({
  verifyToken: vi.fn(),
  getUserFromToken: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  db: { query: { deployments: { findFirst: vi.fn() } } },
  tables: { deployments: { id: "id", userId: "userId" } },
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { verifyToken, getUserFromToken } from "../../services/auth.js";
import { db } from "../../db/index.js";
import { filesRouter } from "../files.js";

const mockFindFirst = db.query.deployments.findFirst as ReturnType<typeof vi.fn>;

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/deployments", filesRouter);
  return app;
}

function startServer(app: express.Application): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

const AUTH_HEADER = { Authorization: "Bearer test-token" };

/** Helper to parse JSON response with proper typing */
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

function mockAuth(userId = "user-1") {
  (verifyToken as ReturnType<typeof vi.fn>).mockResolvedValue({ sub: userId });
  (getUserFromToken as ReturnType<typeof vi.fn>).mockResolvedValue({ id: userId });
}

function mockDeployment(overrides: Record<string, unknown> = {}) {
  mockFindFirst.mockResolvedValue({ id: "dep-1", userId: "user-1", managedBy: "legacy", ...overrides });
}

function mockPod(podName = "pod-1") {
  (findPodForDeployment as ReturnType<typeof vi.fn>).mockResolvedValue(podName);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("files routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const app = createTestApp();
    baseUrl = await startServer(app);
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  // ── LIST ─────────────────────────────────────────────────────────────

  describe("GET /:id/files/list", () => {
    it("returns 401 without auth", async () => {
      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/list`);
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-owned deployment", async () => {
      mockAuth();
      mockFindFirst.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(404);
    });

    it("returns empty entries when pod is not running", async () => {
      mockAuth();
      mockDeployment();
      (findPodForDeployment as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.entries).toEqual([]);
    });

    it("lists directory entries from pod", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      const lsOutput = [
        "total 16",
        "drwxr-xr-x 2 root root 4096 2024-01-15 10:30 config",
        "-rw-r--r-- 1 root root 1234 2024-01-15 10:31 soul.md",
        "drwxr-xr-x 2 root root 4096 2024-01-15 10:32 workspace",
      ].join("\n");

      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValue(lsOutput);

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/list?path=/data`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.entries).toHaveLength(3);
      // Directories first
      expect(data.entries[0].name).toBe("config");
      expect(data.entries[0].isDirectory).toBe(true);
      expect(data.entries[1].name).toBe("workspace");
      expect(data.entries[1].isDirectory).toBe(true);
      // Then files
      expect(data.entries[2].name).toBe("soul.md");
      expect(data.entries[2].isDirectory).toBe(false);
      expect(data.entries[2].size).toBe(1234);
    });

    it("rejects path traversal", async () => {
      mockAuth();
      mockDeployment();

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/list?path=/data/../etc`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(400);
      const data = await jsonBody(res);
      expect(data.error).toContain("traversal");
    });

    it("allows listing previously protected directories in read-only mode (JAR-128)", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValue(
        [
          "total 4",
          "drwxr-xr-x 2 root root 4096 2024-01-15 10:30 _cacache",
        ].join("\n")
      );

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/list?path=/data/.npm`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].name).toBe("_cacache");
    });
  });

  // ── DOWNLOAD ─────────────────────────────────────────────────────────

  describe("GET /:id/files/download", () => {
    it("returns 400 without path", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/download`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(400);
    });

    it("downloads a file as attachment", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      // First call: stat
      // Second call: base64
      (execInPod as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("42 regular file")
        .mockResolvedValueOnce(Buffer.from("hello world").toString("base64"));

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/download?path=/data/test.txt`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("test.txt");
      const body = await res.arrayBuffer();
      const text = Buffer.from(body).toString("utf8");
      expect(text).toBe("hello world");
    });

    it("returns 413 for files exceeding size limit", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValueOnce("60000000 regular file");

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/download?path=/data/big.bin`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(413);
    });
  });

  // ── MKDIR ────────────────────────────────────────────────────────────

  describe("POST /:id/files/mkdir", () => {
    it("creates a directory", async () => {
      mockAuth();
      mockDeployment();
      mockPod();
      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValue("");

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/mkdir`, {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/data/new-folder" }),
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.ok).toBe(true);
    });

    it("still rejects writes into protected directories (JAR-128)", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/mkdir`, {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/data/.npm/evil" }),
      });
      expect(res.status).toBe(400);
      const data = await jsonBody(res);
      expect(data.error).toContain(".npm");
    });
  });

  // ── DELETE ───────────────────────────────────────────────────────────

  describe("DELETE /:id/files", () => {
    it("deletes a file", async () => {
      mockAuth();
      mockDeployment();
      mockPod();
      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValue("");

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files?path=/data/old-file.txt`,
        { method: "DELETE", headers: AUTH_HEADER }
      );
      expect(res.status).toBe(200);
    });

    it("prevents deleting PVC root", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files?path=/data`,
        { method: "DELETE", headers: AUTH_HEADER }
      );
      expect(res.status).toBe(400);
      const data = await jsonBody(res);
      expect(data.error).toContain("root");
    });
  });

  // ── MOVE ─────────────────────────────────────────────────────────────

  describe("PATCH /:id/files/move", () => {
    it("moves/renames a file", async () => {
      mockAuth();
      mockDeployment();
      mockPod();
      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValue("");

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/move`, {
        method: "PATCH",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "/data/old.txt", to: "/data/new.txt" }),
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.ok).toBe(true);
    });

    it("validates both paths", async () => {
      mockAuth();
      mockDeployment();

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/files/move`, {
        method: "PATCH",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "/data/../etc/passwd", to: "/data/safe.txt" }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── DOWNLOAD ARCHIVE ─────────────────────────────────────────────────

  describe("POST /:id/files/download-archive", () => {
    it("returns 400 for empty paths array", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/download-archive`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify({ paths: [] }),
        }
      );
      expect(res.status).toBe(400);
    });

    it("creates a ZIP archive for valid paths", async () => {
      mockAuth();
      mockDeployment();
      mockPod();

      (execInPod as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.from("file content").toString("base64")
      );

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/files/download-archive`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify({ paths: ["/data/file1.txt", "/data/file2.txt"] }),
        }
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
    });
  });
});
