import { z } from "zod";
import { router, adminProcedure } from "../middleware.js";
import { tables, db, dbDate } from "../../db/index.js";
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
import { sendBetaWelcomeEmail, isEmailConfigured } from "../../services/email.js";
import { logger } from "../../utils/logger.js";
import {
  queryInstant,
  queryRange,
  getActiveAlerts as getPrometheusAlerts,
  isReachable as isPrometheusReachable,
  QUERY_KEYS,
} from "../../services/prometheus.js";

const { users, deployments, chatSessions, auditLogs } = tables;

/** Escape SQL LIKE wildcards in user-provided search strings */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/** Verify a deployment exists and return safe fields, or throw NOT_FOUND */
async function requireDeployment(id: string) {
  const [dep] = await db
    .select({
      id: deployments.id,
      stripeSubscriptionId: deployments.stripeSubscriptionId,
    })
    .from(deployments)
    .where(eq(deployments.id, id));
  if (!dep) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }
  return dep;
}

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
      search: z.string().max(100).optional(),
    })
  )
  .query(async ({ input }) => {
    const { page, limit, search } = input;
    const offset = (page - 1) * limit;

    const conditions = search
      ? or(
          like(users.name, `%${escapeLike(search)}%`),
          like(users.email, `%${escapeLike(search)}%`)
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
    // Explicit select to avoid leaking sensitive fields (llmApiKey, auth0Id, stripeCustomerId)
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, input.userId));

    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    // Fetch deployments with safe fields only
    const userDeployments = await db
      .select({
        id: deployments.id,
        name: deployments.name,
        runtime: deployments.runtime,
        status: deployments.status,
        llmProvider: deployments.llmProvider,
        llmModel: deployments.llmModel,
        llmMode: deployments.llmMode,
        monthlyPriceCents: deployments.monthlyPriceCents,
        createdAt: deployments.createdAt,
      })
      .from(deployments)
      .where(eq(deployments.userId, input.userId));

    return { ...user, deployments: userDeployments };
  });

// Self-demotion guard: admins cannot remove their own admin role.
// Note: self-promotion (already admin setting super_admin) is a no-op and allowed by design.
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

    await logAdminAction({
      userId: ctx.user.id,
      action: "update_user_role",
      targetType: "user",
      targetId: input.userId,
      metadata: { newRole: input.role },
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

// ── All Deployments ─────────────────────────────────────────────────────

const listAllDeployments = adminProcedure
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.enum([
        "creating",
        "provisioning_node",
        "waiting_volume",
        "pulling_image",
        "initializing",
        "running",
        "stopped",
        "failed",
        "pending",
        "error",
      ]).optional(),
      search: z.string().max(100).optional(),
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
      const escaped = escapeLike(search);
      conditions.push(
        or(
          like(deployments.name, `%${escaped}%`),
          like(deployments.id, `%${escaped}%`)
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
    // Explicit select to avoid leaking llmApiKey, llmApiKeyId, and other sensitive fields
    const [dep] = await db
      .select({
        id: deployments.id,
        name: deployments.name,
        description: deployments.description,
        runtime: deployments.runtime,
        status: deployments.status,
        error: deployments.error,
        llmProvider: deployments.llmProvider,
        llmModel: deployments.llmModel,
        llmMode: deployments.llmMode,
        llmCreditLimitDollars: deployments.llmCreditLimitDollars,
        monthlyPriceCents: deployments.monthlyPriceCents,
        messagingOnly: deployments.messagingOnly,
        userId: deployments.userId,
        createdAt: deployments.createdAt,
        updatedAt: deployments.updatedAt,
        ownerEmail: users.email,
        ownerName: users.name,
      })
      .from(deployments)
      .leftJoin(users, eq(deployments.userId, users.id))
      .where(eq(deployments.id, input.id));

    if (!dep) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
    }
    return dep;
  });

// ── Deployment Control ──────────────────────────────────────────────────

const adminStartDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await requireDeployment(input.id);
    await startDeployment(input.id);

    await logAdminAction({
      userId: ctx.user.id,
      action: "start_deployment",
      targetType: "deployment",
      targetId: input.id,
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

const adminStopDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await requireDeployment(input.id);
    await stopDeployment(input.id);

    await logAdminAction({
      userId: ctx.user.id,
      action: "stop_deployment",
      targetType: "deployment",
      targetId: input.id,
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

const adminRestartDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    await requireDeployment(input.id);
    await restartDeployment(input.id);

    await logAdminAction({
      userId: ctx.user.id,
      action: "restart_deployment",
      targetType: "deployment",
      targetId: input.id,
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

const adminDeleteDeployment = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const dep = await requireDeployment(input.id);

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

    await logAdminAction({
      userId: ctx.user.id,
      action: "delete_deployment",
      targetType: "deployment",
      targetId: input.id,
      ipAddress: ctx.ip ?? undefined,
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

  const [paidCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(deployments)
    .where(isNotNull(deployments.stripeSubscriptionId));

  return {
    activeSubscriptions: Number(activeSubsResult.count),
    mrrCents: Number(mrrResult.total),
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

  const statusCounts = statusRows.map((row) => ({
    status: row.status,
    count: Number(row.count),
  }));

  return { statusCounts };
});

// ── Audit Logs ──────────────────────────────────────────────────────────

const getAuditLogs = adminProcedure
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
      action: z.string().max(100).optional(),
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

// ── Cluster Metrics (Prometheus) ────────────────────────────────────────

const RANGE_CONFIG: Record<string, { seconds: number; step: number }> = {
  "1h": { seconds: 3600, step: 60 },
  "6h": { seconds: 21600, step: 300 },
  "24h": { seconds: 86400, step: 900 },
  "7d": { seconds: 604800, step: 3600 },
};

const getClusterMetrics = adminProcedure.query(async () => {
  const reachable = await isPrometheusReachable();
  if (!reachable) {
    return { available: false as const, nodes: [], runningPods: 0, recentRestarts: 0 };
  }

  const [cpuResults, memResults, diskResults, podCountResults, restartResults] =
    await Promise.all([
      queryInstant("node_cpu"),
      queryInstant("node_memory"),
      queryInstant("node_disk"),
      queryInstant("running_pods"),
      queryInstant("pod_restarts"),
    ]);

  // Build per-node metrics map
  const nodeMap = new Map<string, { cpu: number; memory: number; disk: number }>();
  for (const s of cpuResults) {
    const inst = s.metric.instance ?? "unknown";
    const entry = nodeMap.get(inst) ?? { cpu: 0, memory: 0, disk: 0 };
    entry.cpu = Math.round(s.value * 10) / 10;
    nodeMap.set(inst, entry);
  }
  for (const s of memResults) {
    const inst = s.metric.instance ?? "unknown";
    const entry = nodeMap.get(inst) ?? { cpu: 0, memory: 0, disk: 0 };
    entry.memory = Math.round(s.value * 10) / 10;
    nodeMap.set(inst, entry);
  }
  for (const s of diskResults) {
    const inst = s.metric.instance ?? "unknown";
    const entry = nodeMap.get(inst) ?? { cpu: 0, memory: 0, disk: 0 };
    entry.disk = Math.round(s.value * 10) / 10;
    nodeMap.set(inst, entry);
  }

  const nodes = Array.from(nodeMap.entries()).map(([instance, metrics]) => ({
    instance,
    ...metrics,
  }));

  const runningPods = podCountResults[0]?.value ?? 0;
  const recentRestarts = restartResults.reduce((sum, s) => sum + s.value, 0);

  return {
    available: true as const,
    nodes,
    runningPods: Math.round(runningPods),
    recentRestarts: Math.round(recentRestarts),
  };
});

const getMetricsTimeSeries = adminProcedure
  .input(
    z.object({
      queryKey: z.enum(QUERY_KEYS),
      range: z.enum(["1h", "6h", "24h", "7d"]).default("1h"),
    })
  )
  .query(async ({ input }) => {
    const reachable = await isPrometheusReachable();
    if (!reachable) {
      return { available: false as const, series: [] };
    }

    const config = RANGE_CONFIG[input.range];
    const end = Math.floor(Date.now() / 1000);
    const start = end - config.seconds;

    const series = await queryRange(input.queryKey, start, end, config.step);
    return { available: true as const, series };
  });

const getClusterAlerts = adminProcedure.query(async () => {
  const reachable = await isPrometheusReachable();
  if (!reachable) {
    return { available: false as const, alerts: [] };
  }

  const alerts = await getPrometheusAlerts();
  return { available: true as const, alerts };
});

// ── Beta Signups ─────────────────────────────────────────────────────────

const listBetaSignups = adminProcedure
  .input(
    z.object({
      status: z.enum(["pending", "invited", "all"]).default("all"),
    }).optional()
  )
  .query(async ({ input }) => {
    const filter = input?.status ?? "all";
    const rows = filter === "all"
      ? await db.select().from(tables.betaSignups).orderBy(desc(tables.betaSignups.createdAt))
      : await db.select().from(tables.betaSignups)
          .where(eq(tables.betaSignups.status, filter))
          .orderBy(desc(tables.betaSignups.createdAt));
    return { signups: rows, emailConfigured: isEmailConfigured() };
  });

const sendBetaInvite = adminProcedure
  .input(z.object({ signupId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    const [signup] = await db
      .select()
      .from(tables.betaSignups)
      .where(eq(tables.betaSignups.id, input.signupId))
      .limit(1);

    if (!signup) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Signup not found" });
    }

    if ((signup as any).status === "invited") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Already invited" });
    }

    const sent = await sendBetaWelcomeEmail(signup.email, signup.name);
    if (!sent) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send email - check RESEND_API_KEY" });
    }

    await db
      .update(tables.betaSignups)
      .set({ status: "invited", invitedAt: dbDate() } as any)
      .where(eq(tables.betaSignups.id, input.signupId));

    await logAdminAction({
      userId: ctx.user.id,
      action: "send_beta_invite",
      targetType: "beta_signup",
      targetId: input.signupId,
      metadata: { email: signup.email },
      ipAddress: undefined,
    });

    return { success: true, email: signup.email };
  });

const sendBetaInviteAll = adminProcedure.mutation(async ({ ctx }) => {
  const pending = await db
    .select()
    .from(tables.betaSignups)
    .where(eq(tables.betaSignups.status, "pending"));

  let sent = 0;
  let failed = 0;

  for (const signup of pending) {
    const ok = await sendBetaWelcomeEmail(signup.email, signup.name);
    if (ok) {
      await db
        .update(tables.betaSignups)
        .set({ status: "invited", invitedAt: dbDate() } as any)
        .where(eq(tables.betaSignups.id, signup.id));
      sent++;
    } else {
      failed++;
    }
  }

  await logAdminAction({
    userId: ctx.user.id,
    action: "send_beta_invite_all",
    targetType: "beta_signup",
    targetId: "bulk",
    metadata: { sent, failed, total: pending.length },
    ipAddress: undefined,
  });

  return { sent, failed, total: pending.length };
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
  getClusterMetrics,
  getMetricsTimeSeries,
  getClusterAlerts,
  listBetaSignups,
  sendBetaInvite,
  sendBetaInviteAll,
});
