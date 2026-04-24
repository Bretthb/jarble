/**
 * Artifact route tests
 *
 * Tests the Express route handlers by mounting the router on a minimal Express
 * app and using Node's built-in fetch (available in Node 18+) against a
 * temporary server. Dependencies (auth, DB, K8s exec) are all mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

// K8s exec
vi.mock("../../k8s/index.js", () => ({
  findPodForDeployment: vi.fn(),
  execInPod: vi.fn(),
  execInPodWithStdin: vi.fn(),
}));

// Auth
vi.mock("../../services/auth.js", () => ({
  verifyToken: vi.fn(),
  getUserFromToken: vi.fn(),
}));

// DB - vi.fn() inside factory is safe (no top-level variable reference)
vi.mock("../../db/index.js", () => ({
  db: { query: { deployments: { findFirst: vi.fn() } } },
  tables: {
    deployments: { id: "id", userId: "userId" },
  },
}));

// Logger - suppress output
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { findPodForDeployment, execInPod, execInPodWithStdin } from "../../k8s/index.js";
import { verifyToken, getUserFromToken } from "../../services/auth.js";
import { db } from "../../db/index.js";
import { artifactRouter } from "../artifact.js";

/** Type-safe reference to the mocked findFirst */
const mockFindFirst = db.query.deployments.findFirst as ReturnType<typeof vi.fn>;

/** Helper to parse JSON response with proper typing */
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/deployments", artifactRouter);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Configure mocks for a successful authenticated + owned request */
function setupAuthMocks(userId = "user-1", deploymentId = "dep-1") {
  (verifyToken as any).mockResolvedValue({ sub: "auth0|123" });
  (getUserFromToken as any).mockResolvedValue({ id: userId });
  mockFindFirst.mockResolvedValue({ id: deploymentId, userId, status: "running" });
}

const AUTH_HEADER = { Authorization: "Bearer valid-token" };

// ── Suite ────────────────────────────────────────────────────────────────────

describe("Artifact API routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // execWrite() in artifact.ts now pipes content through execInPodWithStdin
    // (JAR-89 §4). Default this mock to resolve successfully so write-path
    // tests don't 500 unless they override with a custom resolution.
    (execInPodWithStdin as any).mockResolvedValue("");
    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  // ── GET /list ────────────────────────────────────────────────────────────

  describe("GET /:id/artifact/list", () => {
    it("returns 401 without auth header", async () => {
      const res = await fetch(`${baseUrl}/api/deployments/dep-1/artifact/list`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when deployment not found", async () => {
      (verifyToken as any).mockResolvedValue({ sub: "auth0|123" });
      (getUserFromToken as any).mockResolvedValue({ id: "user-1" });
      mockFindFirst.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/artifact/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(404);
    });

    it("returns empty array when pod not running", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/artifact/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data).toEqual({ artifacts: [] });
    });

    it("returns empty array when manifest does not exist", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      (execInPod as any).mockResolvedValue("__NOT_FOUND__");

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/artifact/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data).toEqual({ artifacts: [] });
    });

    it("returns manifest artifacts when present", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      const manifest = {
        artifacts: [
          { id: "a1", title: "Chart", component: "chart", updatedAt: "2026-01-01" },
        ],
      };
      (execInPod as any).mockResolvedValue(JSON.stringify(manifest));

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/artifact/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].id).toBe("a1");
    });

    it("returns empty array when manifest is corrupt JSON", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      (execInPod as any).mockResolvedValue("{not valid json");

      const res = await fetch(`${baseUrl}/api/deployments/dep-1/artifact/list`, {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data).toEqual({ artifacts: [] });
    });
  });

  // ── GET /:artifactId ─────────────────────────────────────────────────────

  describe("GET /:id/artifact/:artifactId", () => {
    it("returns 401 without auth header", async () => {
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid artifact ID", async () => {
      setupAuthMocks();
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/${"x".repeat(65)}`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(400);
    });

    it("returns 503 when pod not running", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue(null);

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(503);
    });

    it("returns 404 when artifact file not found", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      (execInPod as any).mockResolvedValue("__NOT_FOUND__");

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(404);
    });

    it("returns full artifact JSON", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      const artifact = {
        id: "art-1",
        component: "chart",
        props: { type: "line" },
        title: "Revenue",
      };
      (execInPod as any).mockResolvedValue(JSON.stringify(artifact));

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { headers: AUTH_HEADER }
      );
      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.id).toBe("art-1");
      expect(data.component).toBe("chart");
    });
  });

  // ── POST /sync ───────────────────────────────────────────────────────────

  describe("POST /:id/artifact/sync", () => {
    const validBody = {
      id: "art-1",
      component: "chart",
      props: { type: "line", data: [] },
      title: "Revenue Chart",
    };

    it("returns 401 without auth header", async () => {
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        }
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 when required fields missing", async () => {
      setupAuthMocks();
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify({ id: "art-1" }), // missing component, props, title
        }
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid artifact ID format", async () => {
      setupAuthMocks();
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, id: "invalid id with spaces!" }),
        }
      );
      expect(res.status).toBe(400);
    });

    it("returns 503 when pod not running", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue(null);

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        }
      );
      expect(res.status).toBe(503);
    });

    it("writes artifact file and updates manifest", async () => {
      // Use unique deployment ID to avoid rate limit from other tests
      const depId = "dep-sync-write";
      (verifyToken as any).mockResolvedValue({ sub: "auth0|123" });
      (getUserFromToken as any).mockResolvedValue({ id: "user-1" });
      mockFindFirst.mockResolvedValue({ id: depId, userId: "user-1", status: "running" });
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      // Reads go through execInPod; writes go through execInPodWithStdin
      // (JAR-89 §4 — stdin piping replaces shell-arg base64).
      // First read: existing artifact (not found)
      // Second read: manifest (not found)
      (execInPod as any)
        .mockResolvedValueOnce("__NOT_FOUND__") // read existing artifact
        .mockResolvedValueOnce("__NOT_FOUND__"); // read manifest

      const res = await fetch(
        `${baseUrl}/api/deployments/${depId}/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        }
      );

      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.ok).toBe(true);
      expect(data.artifact.id).toBe("art-1");
      expect(data.artifact.source).toBe("user");

      // Verify 2 reads via execInPod (existing artifact + manifest)
      // and 2 writes via execInPodWithStdin (artifact file + manifest file).
      expect(execInPod).toHaveBeenCalledTimes(2);
      expect(execInPodWithStdin).toHaveBeenCalledTimes(2);
    });

    it("preserves existing createdAt and pinned on update", async () => {
      // Use unique deployment ID to avoid rate limit from other tests
      const depId = "dep-sync-preserve";
      (verifyToken as any).mockResolvedValue({ sub: "auth0|123" });
      (getUserFromToken as any).mockResolvedValue({ id: "user-1" });
      mockFindFirst.mockResolvedValue({ id: depId, userId: "user-1", status: "running" });
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      const existingArtifact = {
        id: "art-1",
        createdAt: "2025-06-15T00:00:00.000Z",
        pinned: true,
      };
      // Reads go through execInPod; writes go through execInPodWithStdin (JAR-89 §4).
      (execInPod as any)
        .mockResolvedValueOnce(JSON.stringify(existingArtifact)) // read existing
        .mockResolvedValueOnce("__NOT_FOUND__"); // read manifest

      const res = await fetch(
        `${baseUrl}/api/deployments/${depId}/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        }
      );

      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.artifact.createdAt).toBe("2025-06-15T00:00:00.000Z");
      expect(data.artifact.pinned).toBe(true);
    });

    it("serializes rapid successive syncs of the same artifact (no 429)", async () => {
      // The old per-deployment rate limiter was replaced with a per-artifact
      // promise lock. Two rapid syncs of the SAME artifact serialize — both
      // succeed with 200 instead of the second getting 429.
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      (execInPod as any).mockResolvedValue("__NOT_FOUND__");

      mockFindFirst.mockResolvedValue({ id: "dep-rate", userId: "user-1", status: "running" });

      // First call should succeed
      const res1 = await fetch(
        `${baseUrl}/api/deployments/dep-rate/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        }
      );
      expect(res1.status).toBe(200);

      // Second immediate call also succeeds (serialized, not rejected)
      const res2 = await fetch(
        `${baseUrl}/api/deployments/dep-rate/artifact/sync`,
        {
          method: "POST",
          headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        }
      );
      expect(res2.status).toBe(200);
    });
  });

  // ── DELETE /:artifactId ──────────────────────────────────────────────────

  describe("DELETE /:id/artifact/:artifactId", () => {
    it("returns 401 without auth header", async () => {
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { method: "DELETE" }
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid artifact ID", async () => {
      setupAuthMocks();
      // Use an ID with special chars that fails the alphanumeric regex
      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/bad%20id%21`,
        { method: "DELETE", headers: AUTH_HEADER }
      );
      expect(res.status).toBe(400);
    });

    it("returns 503 when pod not running", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue(null);

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { method: "DELETE", headers: AUTH_HEADER }
      );
      expect(res.status).toBe(503);
    });

    it("deletes artifact file and updates manifest", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      const manifest = {
        artifacts: [
          { id: "art-1", title: "A" },
          { id: "art-2", title: "B" },
        ],
      };
      (execInPod as any)
        .mockResolvedValueOnce("")  // rm -f artifact file
        .mockResolvedValueOnce(JSON.stringify(manifest)); // read manifest
      // Manifest write goes through execInPodWithStdin (JAR-89 §4).

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { method: "DELETE", headers: AUTH_HEADER }
      );

      expect(res.status).toBe(200);
      const data = await jsonBody(res);
      expect(data.ok).toBe(true);

      // 2 execInPod calls (rm + read manifest) and 1 execInPodWithStdin call
      // (write updated manifest via stdin pipe).
      expect(execInPod).toHaveBeenCalledTimes(2);
      expect(execInPodWithStdin).toHaveBeenCalledTimes(1);

      // The stdin-piped write should contain a manifest without art-1.
      const stdinCalls = (execInPodWithStdin as any).mock.calls;
      const writeCall = stdinCalls[stdinCalls.length - 1];
      // execInPodWithStdin(podName, argv, content) — content is the 3rd arg.
      const writtenContent = writeCall[2];
      const updated = JSON.parse(writtenContent);
      expect(updated.artifacts).toHaveLength(1);
      expect(updated.artifacts[0].id).toBe("art-2");
    });

    it("succeeds even when manifest does not exist", async () => {
      setupAuthMocks();
      (findPodForDeployment as any).mockResolvedValue("pod-1");
      (execInPod as any)
        .mockResolvedValueOnce("")             // rm -f artifact file
        .mockResolvedValueOnce("__NOT_FOUND__"); // read manifest (not found)

      const res = await fetch(
        `${baseUrl}/api/deployments/dep-1/artifact/art-1`,
        { method: "DELETE", headers: AUTH_HEADER }
      );

      expect(res.status).toBe(200);
    });
  });
});
