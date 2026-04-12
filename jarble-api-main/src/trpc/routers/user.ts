import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../middleware.js";
import { tables, dbDate } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import { deleteAccount } from "../../services/accountDeletion.js";

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

  // Update profile (name only - email changes require verification via Auth0)
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id));
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),

  // Complete profile - for email/password signups that need to add their name
  // Called after email verification is confirmed
  completeProfile: protectedProcedure
    .input(z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const fullName = `${input.firstName} ${input.lastName}`;
      await ctx.db
        .update(users)
        .set({ name: fullName })
        .where(eq(users.id, ctx.user.id));
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),

  // Record that the authenticated user has accepted the current Terms of
  // Service and Privacy Policy. Writes tos_accepted_at, tos_version, and
  // privacy_accepted_at. Both the signup-flow checkbox and the returning-
  // user consent modal call this. Idempotent — calling it a second time
  // just bumps the timestamps. JAR-TOS gate.
  acceptTerms: protectedProcedure
    .input(z.object({
      // Version string the client was shown. Locked to a short list so a
      // stale client can't claim acceptance of a version that never
      // existed. Bumping this requires shipping a new client and a new
      // backend version in the same deploy.
      tosVersion: z.enum(["1.0"]),
    }))
    .mutation(async ({ ctx, input }) => {
      // dbDate() returns a real Date in Postgres and an ISO string under
      // the SQLite test mirror, so the row update works in both runtimes.
      const now = dbDate();
      await ctx.db
        .update(users)
        .set({
          tosAcceptedAt: now,
          tosVersion: input.tosVersion,
          privacyAcceptedAt: now,
        } as any)
        .where(eq(users.id, ctx.user.id));
      logger.info(
        { userId: ctx.user.id, tosVersion: input.tosVersion },
        "User accepted Terms of Service and Privacy Policy",
      );
      return { success: true, tosVersion: input.tosVersion, acceptedAt: now };
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

  // Permanently delete the authenticated user's account and all associated data.
  // Requires the user to type "DELETE MY ACCOUNT" as a safety confirmation.
  deleteAccount: protectedProcedure
    .input(z.object({
      confirmation: z.literal("DELETE MY ACCOUNT"),
    }))
    .mutation(async ({ ctx, input }) => {
      // Defense-in-depth: Zod validates the literal, but guard explicitly too
      if (input.confirmation !== "DELETE MY ACCOUNT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid confirmation" });
      }

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      logger.info({ userId: user.id }, "User initiated account deletion");

      await deleteAccount({
        userId: user.id,
        auth0Id: user.auth0Id,
        email: user.email,
        ipAddress: ctx.ip,
      });

      return { success: true };
    }),
});
