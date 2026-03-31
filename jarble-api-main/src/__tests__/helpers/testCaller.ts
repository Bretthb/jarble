/**
 * Test caller helper - creates a tRPC caller backed by a test database.
 *
 * The caller uses the real appRouter and real middleware (protectedProcedure
 * auth checks etc.), but with an injected test DB and mock user context.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "../../trpc/context.js";
import { appRouter } from "../../trpc/index.js";
import { createRequestLogger } from "../../utils/logger.js";

/**
 * Create a tRPC caller with a mock authenticated context.
 *
 * The returned caller has all routers (deployment, user, etc.) available
 * and uses the provided db instance for all queries.
 */
export function createTestCaller(db: any, user: {
  id: string;
  email: string;
  name: string;
  auth0Id: string;
  emailVerified: boolean;
  freeDeploymentUsed?: boolean;
  stripeCustomerId?: string | null;
}) {
  const ctx: Context = {
    user: user as any,
    db: db as any,
    requestId: "test-request",
    log: createRequestLogger("test-request"),
    ip: null,
  };

  return appRouter.createCaller(ctx);
}

/**
 * Create a tRPC caller with no authentication (anonymous).
 * Protected procedures will throw UNAUTHORIZED.
 */
export function createAnonymousCaller(db: any) {
  const ctx: Context = {
    user: null,
    db: db as any,
    requestId: "test-request",
    log: createRequestLogger("test-request"),
    ip: null,
  };

  return appRouter.createCaller(ctx);
}
