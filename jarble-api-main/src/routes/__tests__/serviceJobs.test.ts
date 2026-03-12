/**
 * Tests for the service async jobs route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();

vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

const mockSelectJobs = vi.fn();
const mockFindFirstDeployment = vi.fn();
const mockInsertJob = vi.fn();
const mockUpdateJob = vi.fn();
const mockDeleteJobs = vi.fn();

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      deployments: { findFirst: (...args: any[]) => mockFindFirstDeployment(...args) },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: (...args: any[]) => mockSelectJobs(...args),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: (...args: any[]) => {
        mockInsertJob(...args);
        return Promise.resolve();
      },
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: (...args: any[]) => {
          mockUpdateJob(...args);
          return Promise.resolve();
        },
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: (...args: any[]) => {
        mockDeleteJobs(...args);
        return Promise.resolve();
      },
    }),
  },
  tables: {
    serviceAsyncJobs: {
      id: "id",
      deploymentId: "deployment_id",
      expiresAt: "expires_at",
    },
    deployments: {
      id: "id",
      userId: "user_id",
    },
  },
  dbDate: (d?: Date) => d ?? new Date(),
}));

vi.mock("../../db/schema.js", () => ({
  generateMarketplaceId: (prefix: string) => `${prefix}_test123`,
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { serviceJobsRouter } from "../serviceJobs.js";

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/services", serviceJobsRouter);
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Service Jobs Route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  it("returns 401 when no auth provided", async () => {
    const res = await fetch(`${baseUrl}/api/services/jobs/sjb_test123`, {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 when job not found", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "auth0|user1" });
    mockGetUserFromToken.mockResolvedValue({ id: "user-1" });
    mockSelectJobs.mockResolvedValue([]);

    const res = await fetch(`${baseUrl}/api/services/jobs/sjb_nonexistent`, {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the deployment", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "auth0|user1" });
    mockGetUserFromToken.mockResolvedValue({ id: "user-1" });

    mockSelectJobs.mockResolvedValue([{
      id: "sjb_test123",
      deploymentId: "dep-001",
      serviceId: "svc-001",
      skillName: "test_skill",
      status: "pending",
      requestBody: "{}",
      createdAt: new Date().toISOString(),
    }]);

    mockFindFirstDeployment.mockResolvedValue({
      id: "dep-001",
      userId: "user-2", // Different user
    });

    const res = await fetch(`${baseUrl}/api/services/jobs/sjb_test123`, {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(403);
  });

  it("returns pending job status", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "auth0|user1" });
    mockGetUserFromToken.mockResolvedValue({ id: "user-1" });

    mockSelectJobs.mockResolvedValue([{
      id: "sjb_test123",
      deploymentId: "dep-001",
      serviceId: "svc-001",
      skillName: "test_skill",
      status: "pending",
      requestBody: "{}",
      createdAt: "2026-03-11T00:00:00.000Z",
    }]);

    mockFindFirstDeployment.mockResolvedValue({
      id: "dep-001",
      userId: "user-1",
    });

    const res = await fetch(`${baseUrl}/api/services/jobs/sjb_test123`, {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.jobId).toBe("sjb_test123");
    expect(data.status).toBe("pending");
    expect(data.skillName).toBe("test_skill");
  });

  it("returns completed job with response body", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "auth0|user1" });
    mockGetUserFromToken.mockResolvedValue({ id: "user-1" });

    mockSelectJobs.mockResolvedValue([{
      id: "sjb_test123",
      deploymentId: "dep-001",
      serviceId: "svc-001",
      skillName: "test_skill",
      status: "completed",
      requestBody: "{}",
      responseBody: '{"result":"ok"}',
      responseStatus: 200,
      createdAt: "2026-03-11T00:00:00.000Z",
      completedAt: "2026-03-11T00:01:00.000Z",
    }]);

    mockFindFirstDeployment.mockResolvedValue({
      id: "dep-001",
      userId: "user-1",
    });

    const res = await fetch(`${baseUrl}/api/services/jobs/sjb_test123`, {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("completed");
    expect(data.responseStatus).toBe(200);
    expect(data.responseBody).toEqual({ result: "ok" });
  });

  it("returns failed job with error message", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "auth0|user1" });
    mockGetUserFromToken.mockResolvedValue({ id: "user-1" });

    mockSelectJobs.mockResolvedValue([{
      id: "sjb_test123",
      deploymentId: "dep-001",
      serviceId: "svc-001",
      skillName: "test_skill",
      status: "failed",
      requestBody: "{}",
      errorMessage: "Upstream returned 500",
      createdAt: "2026-03-11T00:00:00.000Z",
      completedAt: "2026-03-11T00:01:00.000Z",
    }]);

    mockFindFirstDeployment.mockResolvedValue({
      id: "dep-001",
      userId: "user-1",
    });

    const res = await fetch(`${baseUrl}/api/services/jobs/sjb_test123`, {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("failed");
    expect(data.errorMessage).toBe("Upstream returned 500");
  });
});
