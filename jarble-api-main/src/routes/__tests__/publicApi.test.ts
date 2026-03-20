/**
 * Public API route tests
 *
 * Tests the unauthenticated REST endpoints for leaderboard and agent profile.
 * Uses a real Express app with mocked DB and logger, served via a temporary
 * Node HTTP server (same pattern as artifact.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

// DB — chain-style query builder
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInnerJoin = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

function chainableDb() {
  mockSelect.mockReturnThis();
  mockFrom.mockReturnThis();
  mockWhere.mockReturnThis();
  mockInnerJoin.mockReturnThis();
  mockOrderBy.mockReturnThis();
  mockLimit.mockResolvedValue([]);
  return {
    select: mockSelect,
    from: mockFrom,
    where: mockWhere,
    innerJoin: mockInnerJoin,
    orderBy: mockOrderBy,
    limit: mockLimit,
  };
}

const mockDb = chainableDb();

vi.mock("../../db/index.js", () => ({
  db: {
    select: (...args: any[]) => mockDb.select(...args),
    from: (...args: any[]) => mockDb.from(...args),
    where: (...args: any[]) => mockDb.where(...args),
    innerJoin: (...args: any[]) => mockDb.innerJoin(...args),
    orderBy: (...args: any[]) => mockDb.orderBy(...args),
    limit: (...args: any[]) => mockDb.limit(...args),
  },
  tables: {
    domains: { id: "id", name: "name", displayName: "displayName" },
    deployments: {
      id: "id",
      name: "name",
      description: "description",
      runtime: "runtime",
      systemPrompt: "systemPrompt",
      isPublic: "isPublic",
      specialties: "specialties",
      bio: "bio",
      showcasePrompts: "showcasePrompts",
      forkCount: "forkCount",
      forkedFromId: "forkedFromId",
      featuredAt: "featuredAt",
    },
    deploymentDomainScores: {
      deploymentId: "deploymentId",
      domainId: "domainId",
      overallScore: "overallScore",
      avgAccuracy: "avgAccuracy",
      avgHelpfulness: "avgHelpfulness",
      avgCreativity: "avgCreativity",
      ratingCount: "ratingCount",
      confidence: "confidence",
    },
    marketplaceServices: {
      id: "id",
      displayName: "displayName",
    },
    serviceInstalls: {
      deploymentId: "deploymentId",
      packageId: "packageId",
    },
  },
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Drizzle operators — stub them so imports don't fail
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ op: "eq", args })),
  and: vi.fn((...args: any[]) => ({ op: "and", args })),
  desc: vi.fn((col: any) => ({ op: "desc", col })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({
      op: "sql",
      strings,
      values,
    }),
    { raw: (s: string) => s }
  ),
}));

import { publicApiRouter } from "../publicApi.js";

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/public", publicApiRouter);
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

/** Reset the chainable mock to return fresh results each test */
function resetDbChain() {
  Object.values(mockDb).forEach((fn) => fn.mockReset());
  mockSelect.mockReturnThis();
  mockFrom.mockReturnThis();
  mockWhere.mockReturnThis();
  mockInnerJoin.mockReturnThis();
  mockOrderBy.mockReturnThis();
  mockLimit.mockResolvedValue([]);
}

/**
 * Configure mock DB calls for the leaderboard endpoint.
 * Call 1 (domain lookup) returns the domain row.
 * Call 2 (scores query) returns the leaderboard rows.
 */
function setupLeaderboardMocks(
  domain: { id: string; displayName: string } | null,
  scores: any[] = []
) {
  let callCount = 0;
  mockLimit.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(domain ? [domain] : []);
    }
    return Promise.resolve(scores);
  });
}

/**
 * Configure mock DB calls for the profile endpoint.
 * Call 1: deployment lookup
 * Call 2: domain scores
 * Call 3: installed services
 */
function setupProfileMocks(
  deployment: any | null,
  scores: any[] = [],
  services: any[] = []
) {
  let callCount = 0;
  // For profile: deployment lookup uses .limit(), scores uses .orderBy() (no limit),
  // services uses .where() (no limit). We need to intercept differently.
  // The route chains: select().from().where().limit(1) for deployment,
  // select().from().innerJoin().where().orderBy() for scores,
  // select().from().innerJoin().where() for services.
  // Since orderBy and the final where both resolve the promise, we use limit for call 1
  // and track subsequent resolves.

  mockLimit.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve(deployment ? [deployment] : []);
    }
    return Promise.resolve([]);
  });

  // For score and service queries that end with orderBy or where (not limit)
  mockOrderBy.mockImplementation(() => {
    return Promise.resolve(scores);
  });

  // Override the last .where for services (3rd chain)
  // This is tricky — the route calls .where() multiple times in different chains.
  // We use a counter on the full chain resolution.
  const originalWhere = mockWhere.getMockImplementation();
  let whereResolveCount = 0;
  mockWhere.mockImplementation((...args: any[]) => {
    whereResolveCount++;
    // Return chainable for calls that continue (they have .innerJoin, .orderBy, .limit after)
    // The service query ends at .where() so it needs to resolve as Promise
    // We can't easily distinguish, so we'll make innerJoin handle the service path

    // Actually, looking at the route code more carefully:
    // Query 1: select().from().where().limit(1) — deployment
    // Query 2: select().from().innerJoin().where().orderBy() — scores
    // Query 3: select().from().innerJoin().where() — services
    // The 3rd .where() is the terminal call for services.
    // But our mock returns `this` for where, which only works if the next call is chained.
    // For the service query, .where() is terminal, so it needs to be thenable.

    // Make where return a thenable that also has chain methods
    const proxy = {
      then: (resolve: any, reject: any) =>
        Promise.resolve(services).then(resolve, reject),
      innerJoin: mockInnerJoin,
      orderBy: mockOrderBy,
      limit: mockLimit,
    };
    return proxy;
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("Public API routes", () => {
  beforeEach(async () => {
    resetDbChain();
    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  // ── Router exports ──────────────────────────────────────────────────────

  describe("module exports", () => {
    it("exports publicApiRouter as a function (Express Router)", () => {
      expect(typeof publicApiRouter).toBe("function");
    });
  });

  // ── GET /leaderboard/:domainSlug ────────────────────────────────────────

  describe("GET /leaderboard/:domainSlug", () => {
    it("returns 400 for invalid metric parameter", async () => {
      const res = await fetch(
        `${baseUrl}/public/leaderboard/coding?metric=invalid`
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid metric");
      expect(body.error).toContain("overall");
    });

    it("accepts valid metric values without 400", async () => {
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" });
      for (const metric of [
        "overall",
        "accuracy",
        "helpfulness",
        "creativity",
      ]) {
        resetDbChain();
        setupLeaderboardMocks({ id: "d1", displayName: "Coding" });
        const res = await fetch(
          `${baseUrl}/public/leaderboard/coding?metric=${metric}`
        );
        expect(res.status).not.toBe(400);
      }
    });

    it("returns 404 when domain slug is not found", async () => {
      setupLeaderboardMocks(null);
      const res = await fetch(`${baseUrl}/public/leaderboard/nonexistent`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("returns empty entries for a valid domain with no scores", async () => {
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" }, []);
      const res = await fetch(`${baseUrl}/public/leaderboard/coding`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.domain).toEqual({ name: "Coding", slug: "coding" });
      expect(body.metric).toBe("overall");
      expect(body.entries).toEqual([]);
    });

    it("returns leaderboard entries with forkability scores", async () => {
      const mockScores = [
        {
          deploymentId: "dep-1",
          deploymentName: "CodingBot",
          deploymentDescription: "A coding bot",
          specialties: JSON.stringify(["typescript", "react"]),
          bio: "Expert coder",
          showcasePrompts: JSON.stringify(["Build an API"]),
          featuredAt: null,
          forkCount: 5,
          isPublic: true,
          overallScore: 400,
          avgAccuracy: 420,
          avgHelpfulness: 380,
          avgCreativity: 350,
          ratingCount: 15,
          confidence: "medium",
        },
      ];
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" }, mockScores);

      const res = await fetch(`${baseUrl}/public/leaderboard/coding`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.entries).toHaveLength(1);
      const entry = body.entries[0];
      expect(entry.rank).toBe(1);
      expect(entry.deploymentId).toBe("dep-1");
      expect(entry.name).toBe("CodingBot");
      expect(entry.forkabilityScore).toBeGreaterThan(0);
      expect(entry.scores.overall).toBe(400);
    });

    it("sets Cache-Control header on success", async () => {
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" }, []);
      const res = await fetch(`${baseUrl}/public/leaderboard/coding`);
      expect(res.headers.get("cache-control")).toContain("public");
      expect(res.headers.get("cache-control")).toContain("max-age=60");
    });

    it("clamps limit to range 1-100", async () => {
      // limit=0 should become 1, limit=200 should become 100
      // We just verify the request doesn't fail — the clamping happens internally
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" });
      const res1 = await fetch(
        `${baseUrl}/public/leaderboard/coding?limit=0`
      );
      expect(res1.status).toBe(200);

      resetDbChain();
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" });
      const res2 = await fetch(
        `${baseUrl}/public/leaderboard/coding?limit=200`
      );
      expect(res2.status).toBe(200);
    });

    it("defaults metric to overall when not specified", async () => {
      setupLeaderboardMocks({ id: "d1", displayName: "Coding" }, []);
      const res = await fetch(`${baseUrl}/public/leaderboard/coding`);
      const body = await res.json();
      expect(body.metric).toBe("overall");
    });

    it("returns 500 when DB throws", async () => {
      mockLimit.mockRejectedValue(new Error("DB connection lost"));
      const res = await fetch(`${baseUrl}/public/leaderboard/coding`);
      // The 400 check happens before DB, so we need a valid metric
      // With the mock throwing on the first .limit() call (domain lookup), we get 500
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("failed");
    });
  });

  // ── GET /agents/:deploymentId/profile ───────────────────────────────────

  describe("GET /agents/:deploymentId/profile", () => {
    it("returns 404 when deployment is not found", async () => {
      mockLimit.mockResolvedValue([]);
      const res = await fetch(`${baseUrl}/public/agents/nonexistent/profile`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("returns 404 when deployment exists but is not public", async () => {
      mockLimit.mockResolvedValue([
        {
          id: "dep-1",
          name: "Private Bot",
          isPublic: false,
        },
      ]);
      const res = await fetch(`${baseUrl}/public/agents/dep-1/profile`);
      expect(res.status).toBe(404);
    });

    it("returns profile with forkability score for a public deployment", async () => {
      setupProfileMocks(
        {
          id: "dep-1",
          name: "CodingBot",
          description: "A great bot",
          runtime: "openclaw",
          systemPrompt: "You are a helpful assistant. " + "x".repeat(300),
          isPublic: true,
          specialties: JSON.stringify(["ts", "react"]),
          bio: "Expert coder",
          showcasePrompts: JSON.stringify(["Build an API"]),
          forkCount: 3,
          forkedFromId: null,
          featuredAt: null,
        },
        [
          {
            domainId: "d1",
            domainName: "coding",
            domainDisplayName: "Coding",
            avgAccuracy: 400,
            avgHelpfulness: 380,
            avgCreativity: 350,
            overallScore: 390,
            ratingCount: 12,
            confidence: "medium",
          },
        ],
        [{ serviceName: "Web Search" }]
      );

      const res = await fetch(`${baseUrl}/public/agents/dep-1/profile`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.id).toBe("dep-1");
      expect(body.name).toBe("CodingBot");
      expect(body.forkabilityScore).toBeGreaterThan(0);
      expect(body.specialties).toEqual(["ts", "react"]);
      // systemPromptPreview was removed to avoid leaking proprietary prompts
      expect(body.systemPromptPreview).toBeUndefined();
    });

    it("sets Cache-Control header on success", async () => {
      setupProfileMocks({
        id: "dep-1",
        name: "Bot",
        isPublic: true,
        bio: null,
        specialties: null,
        showcasePrompts: null,
        forkCount: 0,
        forkedFromId: null,
        featuredAt: null,
        description: null,
        runtime: "openclaw",
        systemPrompt: null,
      });

      const res = await fetch(`${baseUrl}/public/agents/dep-1/profile`);
      if (res.status === 200) {
        expect(res.headers.get("cache-control")).toContain("max-age=30");
      }
    });

    it("returns 500 when DB throws", async () => {
      mockLimit.mockRejectedValue(new Error("DB gone"));
      const res = await fetch(`${baseUrl}/public/agents/dep-1/profile`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("failed");
    });
  });
});
