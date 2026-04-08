import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import * as Sentry from "@sentry/node";
import type { Context } from "./context.js";
import { createModuleLogger } from "../utils/logger.js";
import { isAdmin } from "../utils/admin.js";

const log = createModuleLogger("trpc:middleware");

// Whether to include stack traces in error responses. Default is NEVER —
// even deployed "development" environments must strip stacks because they're
// exposed to the public internet. Only set EXPOSE_INTERNAL_ERRORS=true on
// your LOCAL machine when debugging.
const EXPOSE_INTERNAL_ERRORS = process.env.EXPOSE_INTERNAL_ERRORS === "true";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Strip stack traces unless explicitly enabled for local dev.
        // Leaking stacks exposes internal file paths and code structure.
        stack: EXPOSE_INTERNAL_ERRORS ? error.stack : undefined,
      },
    };
  },
});

const sentryMiddleware = t.middleware(
  Sentry.trpcMiddleware({ attachRpcInput: false })
);

const loggingMiddleware = t.middleware(async ({ ctx, next, path, type }) => {
  log.debug({ path, type, requestId: ctx.requestId }, "procedure start");
  const start = Date.now();

  const result = await next();

  const durationMs = Date.now() - start;

  if (result.ok) {
    log.debug({ path, type, durationMs, requestId: ctx.requestId, ok: result.ok }, "procedure end");
  } else {
    log.error({ path, type, durationMs, requestId: ctx.requestId, ok: result.ok, error: result.error }, "procedure end");
  }

  return result;
});

const authMiddleware = t.middleware(({ ctx, next, path }) => {
  if (!ctx.user) {
    log.warn({ requestId: ctx.requestId, path }, "unauthorized access attempt");
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource"
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const router = t.router;
export const publicProcedure = t.procedure.use(sentryMiddleware).use(loggingMiddleware);

// Protected procedure - requires authenticated user
export const protectedProcedure = t.procedure.use(sentryMiddleware).use(loggingMiddleware).use(authMiddleware);

// Admin procedure - requires authenticated admin user
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdmin(ctx.user.auth0Id)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});
