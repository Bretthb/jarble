/**
 * Integration tests for the deployment chat persistence tRPC procedures.
 *
 * Tests listChatSessions, getChatMessages, syncChatSession, deleteChatSession.
 * Uses real in-memory SQLite with mocked K8s, Stripe, configSync, and OpenRouter.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { createTestDb, type TestDbContext } from "../helpers/testDb.js";
import { createTestCaller, createAnonymousCaller } from "../helpers/testCaller.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../k8s/index.js", () => ({
  createDeployment: vi.fn().mockResolvedValue(undefined),
  deleteDeployment: vi.fn().mockResolvedValue(undefined),
  stopDeployment: vi.fn().mockResolvedValue(undefined),
  startDeployment: vi.fn().mockResolvedValue(undefined),
  restartDeployment: vi.fn().mockResolvedValue(undefined),
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
  getDeploymentStorageUsage: vi.fn().mockResolvedValue({ usedGb: 1, totalGb: 20 }),
  exportDeploymentConfigs: vi.fn().mockResolvedValue([]),
  getDeploymentLogs: vi.fn().mockResolvedValue({ logs: "", podName: null }),
  getCustomComponentsWithDefinitions: vi.fn().mockResolvedValue([]),
  writeComponentToPvc: vi.fn().mockResolvedValue(undefined),
  deleteComponentFromPvc: vi.fn().mockResolvedValue(true),
  findPodForDeployment: vi.fn().mockResolvedValue(null),
  execInPod: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../services/stripe.js", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: vi.fn().mockResolvedValue(undefined),
  reactivateSubscription: vi.fn(),
  isStripeConfigured: vi.fn().mockReturnValue(false),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/openrouter.js", () => ({
  provisionOpenRouterKey: vi.fn().mockResolvedValue({ key: "sk-or-test", hash: "hash123" }),
  revokeOpenRouterKey: vi.fn().mockResolvedValue(true),
  getOpenRouterKeyUsage: vi.fn().mockResolvedValue(null),
  updateOpenRouterKeyLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    DB_PROVIDER: "postgres",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    OPENROUTER_API_KEY: "sk-test",
    OPENROUTER_MANAGEMENT_KEY: undefined,
    API_KEY_ENCRYPTION_KEY: undefined,
    STRIPE_SECRET_KEY: undefined,
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
  },
}));
// Mock db/index.js to prevent Postgres connection at import time.
// Tests pass the in-memory SQLite db through the tRPC caller context.
// The  export must carry real Drizzle column definitions so routers
// can build  expressions.
vi.mock("../../db/index.js", async () => {
  const schema = await import("../helpers/testSchema.sqlite.js");
  return {
    db: {},
    tables: schema,
    dbDate: (date: Date = new Date()) => date.toISOString(),
    getRowsAffected: (result: any) => {
      if (result?.rowCount != null) return result.rowCount;
      if (result?.rowsAffected != null) return result.rowsAffected;
      if (result?.changes != null) return result.changes;
      return 0;
    },
  };
});

// ── Setup ────────────────────────────────────────────────────────────────────

let ctx: TestDbContext;

beforeEach(() => {
  if (ctx) ctx.raw.close();
  ctx = createTestDb();
  vi.clearAllMocks();
});

afterAll(() => {
  ctx?.raw.close();
});

function authedCaller() {
  return createTestCaller(ctx.db, {
    id: ctx.testUserId,
    email: "test@jarble.ai",
    name: "Test User",
    auth0Id: ctx.testAuth0Id,
    emailVerified: true,
  });
}

function otherUserCaller() {
  return createTestCaller(ctx.db, {
    id: "other-user-001",
    email: "other@jarble.ai",
    name: "Other User",
    auth0Id: "auth0|other-001",
    emailVerified: true,
  });
}

/** Seed a deployment owned by the test user. */
function seedDeployment(overrides: Record<string, any> = {}) {
  const id = overrides.id || "dep-chat-001";
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.userId || ctx.testUserId,
    overrides.name || "Test Deployment",
    overrides.runtime || "openclaw",
    overrides.runtimeCatalogId || ctx.openclawCatalogId,
    overrides.status || "running",
    overrides.llmMode || "byok",
    overrides.llmProvider || "openrouter",
    overrides.managedBy || "legacy",
  );
  return id;
}

/** Seed a chat session directly via SQL. */
function seedChatSession(overrides: Record<string, any> = {}) {
  const id = overrides.id || "session-001";
  ctx.raw.prepare(`
    INSERT INTO chat_sessions (id, deployment_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.deploymentId || "dep-chat-001",
    overrides.title || "Test Conversation",
    overrides.createdAt || "2025-01-01T00:00:00.000Z",
    overrides.updatedAt || "2025-01-01T00:00:00.000Z",
  );
  return id;
}

/** Seed a chat message directly via SQL. */
function seedChatMessage(overrides: Record<string, any> = {}) {
  const id = overrides.id || "msg-001";
  ctx.raw.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, thinking_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.sessionId || "session-001",
    overrides.role || "user",
    overrides.content || "Hello",
    overrides.thinkingText || null,
    overrides.createdAt || "2025-01-01T00:00:00.000Z",
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("deployment.listChatSessions", () => {
  it("returns empty array when no sessions exist", async () => {
    seedDeployment();
    const caller = authedCaller();
    const result = await caller.deployment.listChatSessions({ deploymentId: "dep-chat-001" });
    expect(result).toEqual([]);
  });

  it("returns sessions for a deployment", async () => {
    seedDeployment();
    seedChatSession({ id: "s1", deploymentId: "dep-chat-001", title: "Chat A" });
    seedChatSession({ id: "s2", deploymentId: "dep-chat-001", title: "Chat B" });

    const caller = authedCaller();
    const result = await caller.deployment.listChatSessions({ deploymentId: "dep-chat-001" });
    expect(result).toHaveLength(2);
    const titles = result.map((s: any) => s.title).sort();
    expect(titles).toEqual(["Chat A", "Chat B"]);
  });

  it("orders by most recently updated first", async () => {
    seedDeployment();
    seedChatSession({
      id: "s-old",
      deploymentId: "dep-chat-001",
      title: "Old Chat",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    seedChatSession({
      id: "s-new",
      deploymentId: "dep-chat-001",
      title: "New Chat",
      updatedAt: "2025-06-01T00:00:00.000Z",
    });

    const caller = authedCaller();
    const result = await caller.deployment.listChatSessions({ deploymentId: "dep-chat-001" });
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("New Chat");
    expect(result[1].title).toBe("Old Chat");
  });

  it("only returns sessions for owned deployments", async () => {
    // Seed another user and their deployment
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('other-user-001', 'other@jarble.ai', 'Other', 'auth0|other-001', 1)`);
    seedDeployment({ id: "dep-other", userId: "other-user-001" });
    seedChatSession({ id: "s-other", deploymentId: "dep-other", title: "Their Chat" });

    const caller = authedCaller();
    await expect(
      caller.deployment.listChatSessions({ deploymentId: "dep-other" })
    ).rejects.toThrow("Deployment not found");
  });

  it("rejects for non-existent deployment", async () => {
    const caller = authedCaller();
    await expect(
      caller.deployment.listChatSessions({ deploymentId: "nonexistent" })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("deployment.syncChatSession", () => {
  it("creates a new session with messages", async () => {
    seedDeployment();
    const caller = authedCaller();

    const result = await caller.deployment.syncChatSession({
      deploymentId: "dep-chat-001",
      sessionId: "new-session-001",
      title: "My Chat",
      messages: [
        { id: "m1", role: "user", content: "Hello", createdAt: Date.now() - 2000 },
        { id: "m2", role: "assistant", content: "Hi there!", createdAt: Date.now() - 1000 },
      ],
    });

    expect(result.success).toBe(true);

    // Verify session was created
    const session = ctx.raw.prepare("SELECT * FROM chat_sessions WHERE id = ?").get("new-session-001") as any;
    expect(session).toBeTruthy();
    expect(session.title).toBe("My Chat");
    expect(session.deployment_id).toBe("dep-chat-001");

    // Verify messages were created
    const messages = ctx.raw.prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at").all("new-session-001") as any[];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hi there!");
  });

  it("updates existing session title", async () => {
    seedDeployment();
    seedChatSession({ id: "existing-session", deploymentId: "dep-chat-001", title: "Old Title" });

    const caller = authedCaller();
    await caller.deployment.syncChatSession({
      deploymentId: "dep-chat-001",
      sessionId: "existing-session",
      title: "Updated Title",
      messages: [],
    });

    const session = ctx.raw.prepare("SELECT * FROM chat_sessions WHERE id = ?").get("existing-session") as any;
    expect(session.title).toBe("Updated Title");
  });

  it("replaces messages on re-sync (idempotent)", async () => {
    seedDeployment();
    const caller = authedCaller();

    // First sync with 2 messages
    await caller.deployment.syncChatSession({
      deploymentId: "dep-chat-001",
      sessionId: "idempotent-session",
      title: "Chat",
      messages: [
        { id: "m1", role: "user", content: "First message", createdAt: Date.now() - 2000 },
        { id: "m2", role: "assistant", content: "First reply", createdAt: Date.now() - 1000 },
      ],
    });

    let messages = ctx.raw.prepare("SELECT * FROM chat_messages WHERE session_id = ?").all("idempotent-session") as any[];
    expect(messages).toHaveLength(2);

    // Re-sync with 3 messages (replaces all)
    await caller.deployment.syncChatSession({
      deploymentId: "dep-chat-001",
      sessionId: "idempotent-session",
      title: "Chat",
      messages: [
        { id: "m1", role: "user", content: "First message", createdAt: Date.now() - 3000 },
        { id: "m2", role: "assistant", content: "First reply", createdAt: Date.now() - 2000 },
        { id: "m3", role: "user", content: "Second message", createdAt: Date.now() - 1000 },
      ],
    });

    messages = ctx.raw.prepare("SELECT * FROM chat_messages WHERE session_id = ?").all("idempotent-session") as any[];
    expect(messages).toHaveLength(3);
    expect(messages.find((m: any) => m.id === "m3").content).toBe("Second message");
  });

  it("handles empty messages array", async () => {
    seedDeployment();
    const caller = authedCaller();

    const result = await caller.deployment.syncChatSession({
      deploymentId: "dep-chat-001",
      sessionId: "empty-session",
      title: "Empty Chat",
      messages: [],
    });

    expect(result.success).toBe(true);

    const session = ctx.raw.prepare("SELECT * FROM chat_sessions WHERE id = ?").get("empty-session") as any;
    expect(session).toBeTruthy();
    expect(session.title).toBe("Empty Chat");

    const messages = ctx.raw.prepare("SELECT * FROM chat_messages WHERE session_id = ?").all("empty-session") as any[];
    expect(messages).toHaveLength(0);
  });

  it("rejects for non-owned deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('other-user-001', 'other@jarble.ai', 'Other', 'auth0|other-001', 1)`);
    seedDeployment({ id: "dep-other", userId: "other-user-001" });

    const caller = authedCaller();
    await expect(
      caller.deployment.syncChatSession({
        deploymentId: "dep-other",
        sessionId: "should-fail",
        title: "Unauthorized",
        messages: [],
      })
    ).rejects.toThrow("Deployment not found");
  });

  it("validates message role enum", async () => {
    seedDeployment();
    const caller = authedCaller();

    await expect(
      caller.deployment.syncChatSession({
        deploymentId: "dep-chat-001",
        sessionId: "bad-role-session",
        title: "Bad Role",
        messages: [
          { id: "m1", role: "system" as any, content: "Invalid role", createdAt: Date.now() },
        ],
      })
    ).rejects.toThrow();
  });
});

describe("deployment.getChatMessages", () => {
  it("returns messages ordered by createdAt", async () => {
    seedDeployment();
    seedChatSession({ id: "s-msgs", deploymentId: "dep-chat-001" });
    seedChatMessage({
      id: "msg-a",
      sessionId: "s-msgs",
      role: "user",
      content: "First",
      createdAt: "2025-01-01T00:00:01.000Z",
    });
    seedChatMessage({
      id: "msg-b",
      sessionId: "s-msgs",
      role: "assistant",
      content: "Second",
      createdAt: "2025-01-01T00:00:02.000Z",
    });
    seedChatMessage({
      id: "msg-c",
      sessionId: "s-msgs",
      role: "user",
      content: "Third",
      createdAt: "2025-01-01T00:00:03.000Z",
    });

    const caller = authedCaller();
    const result = await caller.deployment.getChatMessages({
      sessionId: "s-msgs",
      deploymentId: "dep-chat-001",
    });

    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("First");
    expect(result[1].content).toBe("Second");
    expect(result[2].content).toBe("Third");
  });

  it("returns empty array for session with no messages", async () => {
    seedDeployment();
    seedChatSession({ id: "s-empty", deploymentId: "dep-chat-001" });

    const caller = authedCaller();
    const result = await caller.deployment.getChatMessages({
      sessionId: "s-empty",
      deploymentId: "dep-chat-001",
    });

    expect(result).toEqual([]);
  });

  it("rejects for non-owned deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('other-user-001', 'other@jarble.ai', 'Other', 'auth0|other-001', 1)`);
    seedDeployment({ id: "dep-other", userId: "other-user-001" });
    seedChatSession({ id: "s-other", deploymentId: "dep-other" });

    const caller = authedCaller();
    await expect(
      caller.deployment.getChatMessages({
        sessionId: "s-other",
        deploymentId: "dep-other",
      })
    ).rejects.toThrow("Deployment not found");
  });
});

describe("deployment.deleteChatSession", () => {
  it("deletes session and cascades to messages", async () => {
    seedDeployment();
    seedChatSession({ id: "s-del", deploymentId: "dep-chat-001" });
    seedChatMessage({ id: "msg-del-1", sessionId: "s-del", role: "user", content: "Hello" });
    seedChatMessage({ id: "msg-del-2", sessionId: "s-del", role: "assistant", content: "Hi" });

    const caller = authedCaller();
    const result = await caller.deployment.deleteChatSession({
      sessionId: "s-del",
      deploymentId: "dep-chat-001",
    });

    expect(result.success).toBe(true);

    // Verify session is gone
    const session = ctx.raw.prepare("SELECT * FROM chat_sessions WHERE id = ?").get("s-del");
    expect(session).toBeUndefined();

    // Verify messages are cascade-deleted
    const messages = ctx.raw.prepare("SELECT * FROM chat_messages WHERE session_id = ?").all("s-del");
    expect(messages).toHaveLength(0);
  });

  it("rejects for non-owned deployment", async () => {
    ctx.raw.exec(`INSERT INTO users (id, email, name, auth0_id, email_verified) VALUES ('other-user-001', 'other@jarble.ai', 'Other', 'auth0|other-001', 1)`);
    seedDeployment({ id: "dep-other", userId: "other-user-001" });
    seedChatSession({ id: "s-other-del", deploymentId: "dep-other" });

    const caller = authedCaller();
    await expect(
      caller.deployment.deleteChatSession({
        sessionId: "s-other-del",
        deploymentId: "dep-other",
      })
    ).rejects.toThrow("Deployment not found");
  });
});
