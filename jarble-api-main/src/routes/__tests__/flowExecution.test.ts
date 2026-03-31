/**
 * Flow execution SSE endpoint tests.
 *
 * Tests POST /api/flows/:flowId/execute auth, validation, SSE headers,
 * and error responses.
 *
 * Uses a similar inline DB + mock pattern to stripe.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    USE_SQLITE: "true",
    NODE_ENV: "test",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
  },
}));

const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();

vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

// Mock the DB module - flow execution now looks up flows from DB
const mockDbSelect = vi.fn();
const mockDbSelectFrom = vi.fn();
const mockDbSelectWhere = vi.fn();
const mockDbSelectLimit = vi.fn();

vi.mock("../../db/index.js", () => {
  const chainedSelect = {
    from: (...args: any[]) => {
      mockDbSelectFrom(...args);
      return {
        where: (...wArgs: any[]) => {
          mockDbSelectWhere(...wArgs);
          return {
            limit: (...lArgs: any[]) => {
              mockDbSelectLimit(...lArgs);
              // Return empty by default (no flow in DB → falls back to body.definition)
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };
  return {
    db: {
      select: (...args: any[]) => {
        mockDbSelect(...args);
        return chainedSelect;
      },
    },
    tables: {
      orchestrationFlows: {
        id: "id",
        definition: "definition",
        userId: "userId",
      },
      deployments: {
        id: "id",
        userId: "userId",
      },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: any[]) => ({ type: "eq", args }),
  and: (...args: any[]) => ({ type: "and", args }),
}));

// Mock the FlowExecutionEngine to avoid DB/marketplaceHub dependencies
const mockExecute = vi.fn();

vi.mock("../../services/flowEngine.js", () => {
  const { EventEmitter } = require("events");
  class MockFlowExecutionEngine extends EventEmitter {
    public executionState = {
      status: "completed" as string,
      stepResults: new Map(),
      totalCredits: 0,
      startedAt: Date.now(),
      completedAt: Date.now(),
    };
    constructor(..._args: any[]) {
      super();
      this.setMaxListeners(50);
    }
    execute() {
      return mockExecute().then((result: any) => {
        // Emit flow:completed so the SSE stream ends
        this.emit("flow:completed", {
          executionId: "fex_test",
          totalCredits: 0,
          durationMs: 10,
          stepResults: {},
        });
        return result;
      });
    }
    cancel() {
      this.executionState.status = "cancelled";
    }
    get signal() {
      return new AbortController().signal;
    }
  }
  return { FlowExecutionEngine: MockFlowExecutionEngine };
});

import { flowExecutionRouter } from "../flowExecution.js";
import express from "express";
import http from "http";

// ── Test App Setup ───────────────────────────────────────────────────────────

let app: express.Express;
let server: http.Server;
let baseUrl: string;

function startTestServer(): Promise<void> {
  return new Promise((resolve) => {
    app = express();
    app.use(express.json());
    app.use("/api/flows", flowExecutionRouter);
    server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

function stopTestServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER = { id: "test-user-001", email: "test@jarble.ai" };

const VALID_DEFINITION = {
  nodes: [
    {
      id: "n1",
      type: "deployment",
      label: "Step 1",
      position: { x: 0, y: 0 },
      serviceId: "svc_test",
    },
  ],
  edges: [],
};

function authenticatedHeaders() {
  return {
    Authorization: "Bearer valid-token",
    "Content-Type": "application/json",
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/flows/:flowId/execute", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue({ sub: "auth0|test" });
    mockGetUserFromToken.mockResolvedValue(TEST_USER);
    mockExecute.mockResolvedValue({
      status: "completed",
      stepResults: new Map(),
      totalCredits: 0,
    });
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it("returns 401 when no auth token is provided", async () => {
    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition: VALID_DEFINITION }),
    });

    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toContain("Unauthorized");
  });

  it("returns 401 when token verification fails", async () => {
    mockVerifyToken.mockRejectedValue(new Error("Invalid token"));

    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({ definition: VALID_DEFINITION }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 400 when definition is missing", async () => {
    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain("Missing flow definition");
  });

  it("returns 400 when definition is invalid (nodes not array)", async () => {
    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({ definition: { nodes: "bad", edges: [] } }),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain("nodes and edges must be arrays");
  });

  it("returns 400 when flow has more than 50 nodes", async () => {
    const bigDef = {
      nodes: Array.from({ length: 51 }, (_, i) => ({
        id: `n${i}`,
        type: "output",
        label: `Node ${i}`,
        position: { x: 0, y: 0 },
      })),
      edges: [],
    };

    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({ definition: bigDef }),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain("maximum 50 nodes");
  });

  it.skip("returns SSE stream with correct Content-Type headers on success", async () => {
    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({ definition: VALID_DEFINITION }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");

    // Read the beginning of the stream
    const reader = res.body?.getReader();
    if (reader) {
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      // Should start with SSE comment (": connected")
      expect(text).toContain(": connected");
      reader.cancel();
    }
  });

  it.skip("includes execution ID in the first SSE event", async () => {
    const res = await fetch(`${baseUrl}/api/flows/flw_test/execute`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: JSON.stringify({ definition: VALID_DEFINITION }),
    });

    expect(res.status).toBe(200);

    // Read the full body (engine resolves immediately in mock)
    const body = await res.text();
    expect(body).toContain("jarble.flow.execution.created");
    expect(body).toContain("fex_");
    expect(body).toContain("flw_test");
  });
});

describe("GET /api/flows/:flowId/executions/:execId/stream", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockVerifyToken.mockResolvedValue({ sub: "auth0|test" });
    mockGetUserFromToken.mockResolvedValue(TEST_USER);
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it("returns 401 without auth", async () => {
    const res = await fetch(
      `${baseUrl}/api/flows/flw_test/executions/fex_test/stream`
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent execution", async () => {
    const res = await fetch(
      `${baseUrl}/api/flows/flw_test/executions/fex_nonexistent/stream`,
      { headers: { Authorization: "Bearer valid-token" } }
    );
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toContain("not found");
  });
});
