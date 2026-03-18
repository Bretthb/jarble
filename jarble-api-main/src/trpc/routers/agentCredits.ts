/**
 * Agent Credits tRPC Router
 *
 * Manages the agent credits ledger — balance queries, transaction history,
 * and credit purchases (mock for now, Stripe integration later).
 */

import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { db, tables, dbDate } from "../../db/index.js";
import { eq, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createModuleLogger } from "../../utils/logger.js";

const logger = createModuleLogger("agent-credits");

const { agentCredits, agentCalls } = tables;

// Credit purchase tiers
const CREDIT_TIERS = {
  500: { credits: 500, label: "$5 / 500 credits" },
  2500: { credits: 2500, label: "$20 / 2,500 credits" },
  10000: { credits: 10000, label: "$100 / 10,000 credits" },
} as const;

/**
 * Get the current credit balance for a user by reading the most recent
 * ledger entry. Returns 0 if no entries exist.
 */
async function getCurrentBalance(userId: string): Promise<number> {
  const latest = await db
    .select({ balance: agentCredits.balance })
    .from(agentCredits)
    .where(eq(agentCredits.userId, userId))
    .orderBy(desc(agentCredits.createdAt))
    .limit(1);

  return latest.length > 0 ? latest[0].balance : 0;
}

/**
 * Add a credit ledger entry (append-only). Computes the new running balance.
 */
async function addLedgerEntry(params: {
  userId: string;
  amount: number;
  reason: string;
  reference?: string;
}): Promise<{ balance: number; entryId: string }> {
  const currentBalance = await getCurrentBalance(params.userId);
  const newBalance = currentBalance + params.amount;

  if (newBalance < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Insufficient credits. Current balance: ${currentBalance}, required: ${Math.abs(params.amount)}`,
    });
  }

  const result = await db.insert(agentCredits).values({
    userId: params.userId,
    amount: params.amount,
    balance: newBalance,
    reason: params.reason,
    reference: params.reference ?? null,
    createdAt: dbDate(),
  } as any);

  // For SQLite, we need to get the inserted ID differently
  // The $defaultFn on the id column auto-generates it, so query the latest entry
  const latest = await db
    .select({ id: agentCredits.id, balance: agentCredits.balance })
    .from(agentCredits)
    .where(eq(agentCredits.userId, params.userId))
    .orderBy(desc(agentCredits.createdAt))
    .limit(1);

  return {
    balance: newBalance,
    entryId: latest[0]?.id ?? "unknown",
  };
}

export { getCurrentBalance, addLedgerEntry };

export const agentCreditsRouter = router({
  /**
   * Get current credit balance for the authenticated user.
   */
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const balance = await getCurrentBalance(ctx.user.id);
    return { balance, tiers: CREDIT_TIERS };
  }),

  /**
   * Get credit transaction history (paginated).
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const entries = await db
        .select()
        .from(agentCredits)
        .where(eq(agentCredits.userId, ctx.user.id))
        .orderBy(desc(agentCredits.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(agentCredits)
        .where(eq(agentCredits.userId, ctx.user.id));

      const total = Number(countResult[0]?.count ?? 0);

      return { entries, total, limit, offset };
    }),

  /**
   * Purchase credits (mock — no real payment processing yet).
   * Adds credits to the user's ledger immediately.
   */
  purchaseCredits: protectedProcedure
    .input(
      z.object({
        amount: z.enum(["500", "2500", "10000"]).transform(Number),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tier = CREDIT_TIERS[input.amount as keyof typeof CREDIT_TIERS];
      if (!tier) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid credit tier",
        });
      }

      logger.info(
        { userId: ctx.user.id, credits: input.amount },
        "Processing credit purchase (mock)"
      );

      const result = await addLedgerEntry({
        userId: ctx.user.id,
        amount: input.amount,
        reason: "purchase",
        reference: `mock_purchase_${Date.now()}`,
      });

      logger.info(
        { userId: ctx.user.id, newBalance: result.balance },
        "Credit purchase completed"
      );

      return {
        success: true,
        creditsAdded: input.amount,
        newBalance: result.balance,
        transactionId: result.entryId,
      };
    }),

  /**
   * Get recent agent-to-agent call history for the user's deployments.
   */
  getCallHistory: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;

      // Get all deployment IDs for this user
      const userDeployments = await db
        .select({ id: tables.deployments.id })
        .from(tables.deployments)
        .where(eq(tables.deployments.userId, ctx.user.id));

      const deploymentIds = userDeployments.map((d) => d.id);
      if (deploymentIds.length === 0) return { calls: [] };

      // Query calls where user's deployments are the caller
      const calls = await db
        .select()
        .from(agentCalls)
        .where(
          input?.deploymentId
            ? eq(agentCalls.callerDeploymentId, input.deploymentId)
            : sql`${agentCalls.callerDeploymentId} IN (${sql.join(
                deploymentIds.map((id) => sql`${id}`),
                sql`, `
              )})`
        )
        .orderBy(desc(agentCalls.createdAt))
        .limit(limit);

      return { calls };
    }),
});
