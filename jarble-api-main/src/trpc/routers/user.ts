import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";

const { users } = tables;

export const userRouter = router({
  // Get current user from context
  me: publicProcedure.query(({ ctx }) => ctx.user),

  // Get full profile from DB
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
    });
  }),

  // Update profile
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await (ctx.db as any)
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id));
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),

  // Complete profile — for email/password signups that need to add their name
  // Called after email verification is confirmed
  completeProfile: protectedProcedure
    .input(z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const fullName = `${input.firstName} ${input.lastName}`;
      await (ctx.db as any)
        .update(users)
        .set({ name: fullName })
        .where(eq(users.id, ctx.user.id));
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),

  // Resend email verification via Auth0 Management API
  resendVerificationEmail: protectedProcedure
    .mutation(async ({ ctx }) => {
      // Guard: already verified
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      if (user?.emailVerified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email is already verified",
        });
      }

      // Guard: Auth0 Management API must be configured
      if (!env.AUTH0_MGMT_CLIENT_ID || !env.AUTH0_MGMT_CLIENT_SECRET) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email verification resend is not configured",
        });
      }

      // Get Management API access token via client credentials
      const tokenRes = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: env.AUTH0_MGMT_CLIENT_ID,
          client_secret: env.AUTH0_MGMT_CLIENT_SECRET,
          audience: `https://${env.AUTH0_DOMAIN}/api/v2/`,
        }),
      });

      if (!tokenRes.ok) {
        logger.error({ status: tokenRes.status }, "Failed to get Auth0 Management API token");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to connect to email service",
        });
      }

      const { access_token } = (await tokenRes.json()) as { access_token: string };

      // Send verification email
      const auth0Id = ctx.user.auth0Id;
      const resendRes = await fetch(
        `https://${env.AUTH0_DOMAIN}/api/v2/jobs/verification-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`,
          },
          body: JSON.stringify({
            user_id: auth0Id,
          }),
        }
      );

      if (!resendRes.ok) {
        const errorBody = await resendRes.text();
        logger.error({ status: resendRes.status, body: errorBody, auth0Id }, "Failed to resend verification email");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send verification email. Please try again.",
        });
      }

      logger.info({ userId: ctx.user.id, auth0Id }, "Verification email resent");
      return { success: true };
    }),
});
