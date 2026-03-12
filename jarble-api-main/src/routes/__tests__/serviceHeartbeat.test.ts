/**
 * Tests for the service heartbeat route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";
import crypto from "crypto";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFindFirstService = vi.fn();
const mockSelectHeartbeats = vi.fn();
const mockUpdateHeartbeats = vi.fn();
const mockInsertHeartbeats = vi.fn();
const mockUpdateService = vi.fn();

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      marketplaceServices: { findFirst: (...args: any[]) => mockFindFirstService(...args) },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: (...args: any[]) => mockSelectHeartbeats(...args),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: (...args: any[]) => {
          mockUpdateService(...args);
          return Promise.resolve();
        },
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: (...args: any[]) => {
        mockInsertHeartbeats(...args);
        return Promise.resolve();
      },
    }),
  },
  tables: {
    marketplaceServices: { id: "id" },
    serviceHeartbeats: { id: "id", serviceId: "service_id" },
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

import { serviceHeartbeatRouter } from "../serviceHeartbeat.js";

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/services", serviceHeartbeatRouter);
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

function makeSignature(secret: string, timestamp: string, body: string): string {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${sig}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Service Heartbeat Route", () => {
  const HEARTBEAT_SECRET = "test-heartbeat-secret-1234567890";

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSelectHeartbeats.mockResolvedValue([]);
    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  it("returns 404 when service not found", async () => {
    mockFindFirstService.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/services/heartbeat/svc-unknown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 when service has no heartbeat configured", async () => {
    mockFindFirstService.mockResolvedValue({
      id: "svc-1",
      remoteApiConfig: JSON.stringify({
        endpoint: "https://example.com",
        auth: { type: "api_key", headerName: "X-API-Key" },
        skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
        version: "1.0.0",
        // No heartbeatSecret
      }),
    });

    const res = await fetch(`${baseUrl}/api/services/heartbeat/svc-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(400);
  });

  it("returns 401 when signature is missing", async () => {
    mockFindFirstService.mockResolvedValue({
      id: "svc-1",
      remoteApiConfig: JSON.stringify({
        endpoint: "https://example.com",
        auth: { type: "api_key", headerName: "X-API-Key" },
        skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
        version: "1.0.0",
        heartbeatSecret: HEARTBEAT_SECRET,
      }),
    });

    const res = await fetch(`${baseUrl}/api/services/heartbeat/svc-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is invalid", async () => {
    mockFindFirstService.mockResolvedValue({
      id: "svc-1",
      remoteApiConfig: JSON.stringify({
        endpoint: "https://example.com",
        auth: { type: "api_key", headerName: "X-API-Key" },
        skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
        version: "1.0.0",
        heartbeatSecret: HEARTBEAT_SECRET,
      }),
    });

    const timestamp = String(Date.now());
    const res = await fetch(`${baseUrl}/api/services/heartbeat/svc-1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Heartbeat-Signature": "sha256=invalid",
        "X-Heartbeat-Timestamp": timestamp,
      },
      body: "{}",
    });

    expect(res.status).toBe(401);
  });

  it("accepts valid heartbeat with correct HMAC", async () => {
    mockFindFirstService.mockResolvedValue({
      id: "svc-1",
      remoteApiConfig: JSON.stringify({
        endpoint: "https://example.com",
        auth: { type: "api_key", headerName: "X-API-Key" },
        skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
        version: "1.0.0",
        heartbeatSecret: HEARTBEAT_SECRET,
        heartbeatIntervalMs: 30000,
      }),
    });

    const timestamp = String(Date.now());
    const body = "{}";
    const signature = makeSignature(HEARTBEAT_SECRET, timestamp, body);

    const res = await fetch(`${baseUrl}/api/services/heartbeat/svc-1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Heartbeat-Signature": signature,
        "X-Heartbeat-Timestamp": timestamp,
      },
      body,
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { received: boolean };
    expect(data.received).toBe(true);
  });

  it("returns 401 when timestamp is too old", async () => {
    mockFindFirstService.mockResolvedValue({
      id: "svc-1",
      remoteApiConfig: JSON.stringify({
        endpoint: "https://example.com",
        auth: { type: "api_key", headerName: "X-API-Key" },
        skills: [{ name: "test_skill", description: "Test", inputSchema: { type: "object", properties: {} } }],
        version: "1.0.0",
        heartbeatSecret: HEARTBEAT_SECRET,
      }),
    });

    const oldTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    const body = "{}";
    const signature = makeSignature(HEARTBEAT_SECRET, oldTimestamp, body);

    const res = await fetch(`${baseUrl}/api/services/heartbeat/svc-1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Heartbeat-Signature": signature,
        "X-Heartbeat-Timestamp": oldTimestamp,
      },
      body,
    });

    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("timestamp");
  });
});
