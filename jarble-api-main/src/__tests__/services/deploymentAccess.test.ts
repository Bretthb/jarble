/**
 * Unit tests for the findDeploymentByCreator helper (JAR-89 §10).
 *
 * The helper is a small but load-bearing authz primitive: 4 tRPC routers
 * (skills, platformCredentials, deploymentSecrets, billing) call it to
 * decide whether the caller is allowed to read or mutate a given
 * deployment. A regression that returns "any deployment with this id" or
 * "any deployment owned by anyone" would silently break ownership checks
 * across the entire managed-credentials surface, so the contract is worth
 * pinning down with tests even though the body is one line.
 *
 * Covers:
 *  1. Returns null when deployment id does not exist
 *  2. Returns null when deployment exists but is owned by a different user
 *  3. Returns the deployment row when (id, userId) both match
 *  4. Cross-user isolation: never returns another user's deployment row
 *  5. Returns null when userId matches but id does not
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Mock the production db module so importing the SUT doesn't trip the
// DATABASE_URL guard in src/db/index.ts. The mocked `tables` export uses
// the SQLite mirror schema so the helper's `eq(deployments.userId, ...)`
// calls bind to the same table objects the test is inserting into.
const hoisted = vi.hoisted(() => ({
  ctxRef: { current: null as any },
}));

vi.mock("../../db/index.js", async () => {
  const { createTestDb } = await import("../helpers/testDb.js");
  const schema = await import("../helpers/testSchema.sqlite.js");
  hoisted.ctxRef.current = createTestDb();
  return {
    db: hoisted.ctxRef.current.db,
    tables: schema,
    dbDate: (date: Date = new Date()) => date.toISOString(),
  };
});

import { findDeploymentByCreator } from "../../services/deploymentAccess.js";

const ctx = hoisted.ctxRef.current;

beforeEach(() => {
  // Reset rows between tests so each case starts clean.
  ctx.raw.exec("DELETE FROM deployments");
  ctx.raw.exec("DELETE FROM users WHERE id != 'test-user-001'");
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('test-user-002', 'other@jarble.ai', 'Other User', 'auth0|other-001', 1, 0);
  `);
});

afterAll(() => {
  try {
    ctx.raw.close();
  } catch {
    // ignore
  }
});

function seedDeployment(id: string, userId: string) {
  ctx.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, runtime_catalog_id, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, "Test Dep", "openclaw", ctx.openclawCatalogId, "running", 0, 0, "byok", "openrouter", "legacy");
}

describe("findDeploymentByCreator", () => {
  it("returns null when deployment id does not exist", async () => {
    const result = await findDeploymentByCreator(
      ctx.db,
      "dep-does-not-exist",
      ctx.testUserId,
    );
    expect(result).toBeNull();
  });

  it("returns null when deployment exists but is owned by a different user", async () => {
    seedDeployment("dep-owned-by-other", "test-user-002");

    const result = await findDeploymentByCreator(
      ctx.db,
      "dep-owned-by-other",
      ctx.testUserId,
    );
    expect(result).toBeNull();
  });

  it("returns the deployment when id and userId both match", async () => {
    seedDeployment("dep-mine", ctx.testUserId);

    const result = await findDeploymentByCreator(
      ctx.db,
      "dep-mine",
      ctx.testUserId,
    );
    expect(result).not.toBeNull();
    expect(result?.id).toBe("dep-mine");
    expect(result?.userId).toBe(ctx.testUserId);
  });

  it("does not leak another user's deployment when ids do not collide", async () => {
    // Two deployments, different ids, different owners. The helper must
    // discriminate by userId — returning the wrong row would leak
    // credentials/skills across accounts.
    seedDeployment("dep-mine", ctx.testUserId);
    seedDeployment("dep-theirs", "test-user-002");

    const mine = await findDeploymentByCreator(
      ctx.db,
      "dep-mine",
      ctx.testUserId,
    );
    const theirs = await findDeploymentByCreator(
      ctx.db,
      "dep-theirs",
      ctx.testUserId,
    );

    expect(mine?.id).toBe("dep-mine");
    expect(theirs).toBeNull();
  });

  it("returns null when userId matches but id does not", async () => {
    seedDeployment("dep-mine", ctx.testUserId);

    const result = await findDeploymentByCreator(
      ctx.db,
      "dep-different-id",
      ctx.testUserId,
    );
    expect(result).toBeNull();
  });
});
