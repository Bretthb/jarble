import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { isAdmin } from "../utils/rbac.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure - requires authenticated user
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource"
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Admin procedure - requires authenticated user with super_admin role
// Composes from protectedProcedure to share auth logic
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdmin(ctx.user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});
