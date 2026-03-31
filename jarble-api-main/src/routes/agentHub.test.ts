/**
 * Tests for the agentHub route - Phase 2 agent call event emission.
 *
 * Since supertest is not available, these tests verify the agentCallEvents
 * bridge behavior by calling the route handler directly with mock req/res.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agentCallEvents } from "../utils/agentCallEvents.js";

// Mock auth - always resolves to a test user
vi.mock("../services/auth.js", () => ({
  verifyToken: vi.fn().mockResolvedValue({ sub: "auth0|test-user" }),
  getUserFromToken: vi
    .fn()
    .mockResolvedValue({ id: "user-1", email: "test@example.com" }),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock DB - returns matching deployment for ownership check
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ userId: "user-1" }]),
    innerJoin: vi.fn().mockReturnThis(),
  },
  tables: {
    deployments: { id: "id", userId: "userId" },
    marketplaceServices: {
      id: "id",
      name: "name",
      displayName: "displayName",
      description: "description",
      status: "status",
      hostingModel: "hostingModel",
      pricingModel: "pricingModel",
      priceUsdCents: "priceUsdCents",
      totalInstalls: "totalInstalls",
      avgRating: "avgRating",
    },
    serviceSkills: { packageId: "packageId", skillId: "skillId" },
    skillsCatalog: { id: "id", name: "name", description: "description" },
  },
}));

// Mock executeAgentCall
const mockExecuteAgentCall = vi.fn();
vi.mock("../services/marketplaceHub.js", () => ({
  executeAgentCall: (...args: any[]) => mockExecuteAgentCall(...args),
}));

// Import the router after mocks are set up
import { agentHubRouter } from "./agentHub.js";

// ── Mock Express req/res ─────────────────────────────────────────────────────

function mockReq(overrides: any = {}) {
  return {
    headers: {
      authorization: "Bearer test-jwt-token",
      ...overrides.headers,
    },
    body: {
      callerDeploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
      ...overrides.body,
    },
    query: overrides.query || {},
    ...overrides,
  };
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res;
}

// Get the POST /call handler from the router
// Express routers store handlers in router.stack
function getCallHandler() {
  const stack = (agentHubRouter as any).stack;
  const callRoute = stack.find(
    (layer: any) => layer.route?.path === "/call" && layer.route?.methods?.post
  );
  if (!callRoute) throw new Error("POST /call route not found on agentHubRouter");
  // The handler is the last function in the route's stack
  const handlers = callRoute.route.stack;
  return handlers[handlers.length - 1].handle;
}

describe("agentHub /call route - agent call event emission", () => {
  let startHandler: (...args: any[]) => void;
  let endHandler: (...args: any[]) => void;
  let callHandler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    startHandler = vi.fn();
    endHandler = vi.fn();
    agentCallEvents.on("start", startHandler);
    agentCallEvents.on("end", endHandler);
    callHandler = getCallHandler();

    mockExecuteAgentCall.mockResolvedValue({
      result: "Agent response",
      creditsCharged: 1,
      callId: "call-123",
    });
  });

  afterEach(() => {
    agentCallEvents.removeListener("start", startHandler);
    agentCallEvents.removeListener("end", endHandler);
  });

  it("emits start event when call begins", async () => {
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(startHandler).toHaveBeenCalledOnce();
    expect(startHandler).toHaveBeenCalledWith({
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
    });
  });

  it("emits end event with success=true on successful call", async () => {
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(endHandler).toHaveBeenCalledOnce();
    expect(endHandler).toHaveBeenCalledWith({
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
      creditsCharged: 1,
      success: true,
    });
  });

  it("emits end event with success=false on failure", async () => {
    mockExecuteAgentCall.mockRejectedValue(new Error("Service not found"));
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(endHandler).toHaveBeenCalledOnce();
    expect(endHandler).toHaveBeenCalledWith({
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
      creditsCharged: 0,
      success: false,
    });
  });

  it("emits start before end on successful call", async () => {
    const callOrder: string[] = [];
    const orderStart = vi.fn(() => callOrder.push("start"));
    const orderEnd = vi.fn(() => callOrder.push("end"));

    agentCallEvents.on("start", orderStart);
    agentCallEvents.on("end", orderEnd);

    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(callOrder).toEqual(["start", "end"]);

    agentCallEvents.removeListener("start", orderStart);
    agentCallEvents.removeListener("end", orderEnd);
  });

  it("does not emit events when required fields are missing", async () => {
    const req = mockReq({
      body: { callerDeploymentId: "dep-1" }, // missing serviceId and skillName
    });
    const res = mockRes();

    await callHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(startHandler).not.toHaveBeenCalled();
    expect(endHandler).not.toHaveBeenCalled();
  });

  it("returns 404 for 'not found' errors", async () => {
    mockExecuteAgentCall.mockRejectedValue(new Error("Service not found"));
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it("returns 402 for insufficient credits errors", async () => {
    mockExecuteAgentCall.mockRejectedValue(
      new Error("Insufficient credits")
    );
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(res.statusCode).toBe(402);
  });

  it("returns 500 for generic errors", async () => {
    mockExecuteAgentCall.mockRejectedValue(new Error("Something broke"));
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(res.statusCode).toBe(500);
  });

  it("returns success response with result, creditsCharged, callId", async () => {
    const req = mockReq();
    const res = mockRes();

    await callHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      result: "Agent response",
      creditsCharged: 1,
      callId: "call-123",
    });
  });
});
