import { z } from "zod";
import { router, adminProcedure } from "../middleware.js";
import { tables, db } from "../../db/index.js";
import { eq, and, like, sql, or, isNotNull, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  startDeployment,
  stopDeployment,
  restartDeployment,
  deleteDeployment,
} from "../../k8s/index.js";
import {
  cancelSubscriptionImmediately,
  isStripeConfigured,
} from "../../services/stripe.js";
import { logAdminAction } from "../../services/auditLog.js";
import { logger } from "../../utils/logger.js";

const { users, deployments, chatSessions, auditLogs } = tables;

// ── Platform Stats ──────────────────────────────────────────────────────

const getStats = adminProcedure.query(async () => {
  const [userCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users);
  const [deploymentCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deployments);
  const [activeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deployments)
    .where(eq(deployments.status, "running"));
  const [sessionCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatSessions);
  const [revenueResult] = await db
    .select({ total: sql<number>`coalesce(sum(${deployments.monthlyPriceCents}), 0)` })
    .from(deployments)
    .where(isNotNull(deployments.stripeSubscriptionId));

  return {
    totalUsers: Number(userCount.count),
    totalDeployments: Number(deploymentCount.count),
    activeDeployments: Number(activeCount.count),
    totalChatSessions: Number(sessionCount.count),
    totalRevenueCents: Number(revenueResult.total),
  };
});

// ── User Management ─────────────────────────────────────────────────────

const listUsers = adminProcedure
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    const { page, limit, search } = input;
    const offset = (page - 1) * limit;

    const conditions = search
      ? or(
          like(users.name, `%${search}%`),
          like(users.email, `%${search}%`)
        )
      : undefined;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        deploymentCount: sql<number>`(select count(*) from ${deployments} where ${deployments.userId} = ${users.id})`,
      })
      .from(users)
      .where(conditions)
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(conditions);

    return {
      users: rows,
      total: Number(totalResult.count),
      page,
      limit,
    };
  });

const getUserById = adminProcedure
  .input(z.object({ userId: z.string() }))
  .query(async ({ input }) => {
    const user = await (db as any).query.users.findFirst({
      where: eq(users.id, input.userId),
      with: { deployments: true },
    });
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    return user;
  });

const updateUserRole = adminProcedure
  .input(
    z.object({
      userId: z.string(),
      role: z.enum(["user", "super_admin"]),
    })
  )
  .mutation(async ({ ctx, input }) => {
    if (input.role !== "super_admin" && ctx.user.id === input.userId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You cannot demote yourself",
      });
    }

    await db
      .update(users)
      .set({ role: input.role })
      .where(eq(users.id, input.userId));

    logAdminAction({
      userId: ctx.user.id,
      action: "update_user_role",
      targetType: "user",
      targetId: input.userId,
      metadata: { newRole: input.role },
    });

    return { success: true };
  });

// ── All Deployments ─────────────────────────────────────────────────────

const listAllDeployments = adminProcedure
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    const { page, limit, status, search } = input;
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];
    if (status) {
      conditions.push(eq(deployments.status, status));
    }
    if (search) {
      conditions.push(
        or(
          like(deployments.name, `%${search}%`),
          like(deployments.id, `%${search}%`)
        )!
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: deployments.id,
        name: deployments.name,
        runtime: deployments.runtime,
        status: deployments.status,
        monthlyPriceCents: deployments.monthlyPriceCents,
        createdAt: deployments.createdAt,
        userId: deployments.userId,
        ownerEmail: users.email,
        ownerName: users.name,
      })
      .from(deployments)
      .leftJoin(users, eq(deployments.userId, users.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(deployments)
      .where(whereClause);

    return {
      deployments: rows,
      total: Number(totalResult.count),
      page,
      limit,
    };
  });

const getDeploymentById = adminProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input }) => {
    const deployment = await (db as any).query.deployments.findFirst({
      where: eq(deployments.id, input.id),
      with: { runtimeCatalogEntry: true, user: true },
    });
    if (!deployment) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Deployment not found",
      });
    }
    return deployment;
  });

// ── Deployment Control ──────────────────────────────────────────────────

const adminStartDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await startDeployment(input.id);

    logAdminAction({
      userId: ctx.user.id,
      action: "start_deployment",
      targetType: "deployment",
      targetId: input.id,
    });

    return { success: true };
  });

const adminStopDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await stopDeployment(input.id);

    logAdminAction({
      userId: ctx.user.id,
      action: "stop_deployment",
      targetType: "deployment",
      targetId: input.id,
    });

    return { success: true };
  });

const adminRestartDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await restartDeployment(input.id);

    logAdminAction({
      userId: ctx.user.id,
      action: "restart_deployment",
      targetType: "deployment",
      targetId: input.id,
    });

    return { success: true };
  });

const adminDeleteDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Look up deployment for Stripe subscription info
    const [dep] = await db
      .select({
        stripeSubscriptionId: deployments.stripeSubscriptionId,
      })
      .from(deployments)
      .where(eq(deployments.id, input.id));

    if (!dep) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Deployment not found",
      });
    }

    // Delete K8s resources
    await deleteDeployment(input.id);

    // Cancel Stripe subscription if exists
    if (dep.stripeSubscriptionId && isStripeConfigured()) {
      try {
        await cancelSubscriptionImmediately(dep.stripeSubscriptionId);
      } catch (err) {
        logger.error(
          { err, deploymentId: input.id, subscriptionId: dep.stripeSubscriptionId },
          "Failed to cancel Stripe subscription during admin delete"
        );
      }
    }

    // Delete from DB
    await db.delete(deployments).where(eq(deployments.id, input.id));

    logAdminAction({
      userId: ctx.user.id,
      action: "delete_deployment",
      targetType: "deployment",
      targetId: input.id,
    });

    return { success: true };
  });

// ── Billing ─────────────────────────────────────────────────────────────

const getRevenueStats = adminProcedure.query(async () => {
  const [activeSubsResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deployments)
    .where(
      and(
        isNotNull(deployments.stripeSubscriptionId),
        sql`${deployments.status} != 'stopped'`
      )
    );

  const [mrrResult] = await db
    .select({ total: sql<number>`coalesce(sum(${deployments.monthlyPriceCents}), 0)` })
    .from(deployments)
    .where(
      and(
        isNotNull(deployments.stripeSubscriptionId),
        sql`${deployments.status} != 'stopped'`
      )
    );

  const [freeCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deployments)
    .where(eq(deployments.isFree, true));

  const [paidCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deployments)
    .where(isNotNull(deployments.stripeSubscriptionId));

  return {
    activeSubscriptions: Number(activeSubsResult.count),
    mrrCents: Number(mrrResult.total),
    freeDeployments: Number(freeCount.count),
    paidDeployments: Number(paidCount.count),
  };
});

// ── System Health ───────────────────────────────────────────────────────

const getSystemHealth = adminProcedure.query(async () => {
  const statusRows = await db
    .select({
      status: deployments.status,
      count: sql<number>`count(*)`,
    })
    .from(deployments)
    .groupBy(deployments.status);

  const podsByStatus: Record<string, number> = {};
  for (const row of statusRows) {
    podsByStatus[row.status] = Number(row.count);
  }

  return { podsByStatus };
});

// ── Audit Logs ──────────────────────────────────────────────────────────

const getAuditLogs = adminProcedure
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
      action: z.string().optional(),
      userId: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    const { page, limit, action, userId } = input;
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];
    if (action) {
      conditions.push(eq(auditLogs.action, action));
    }
    if (userId) {
      conditions.push(eq(auditLogs.userId, userId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause);

    return {
      logs: rows,
      total: Number(totalResult.count),
      page,
      limit,
    };
  });

// ── Router ──────────────────────────────────────────────────────────────

export const adminRouter = router({
  getStats,
  listUsers,
  getUserById,
  updateUserRole,
  listAllDeployments,
  getDeploymentById,
  adminStartDeployment,
  adminStopDeployment,
  adminRestartDeployment,
  adminDeleteDeployment,
  getRevenueStats,
  getSystemHealth,
  getAuditLogs,
});
