import { z } from "zod";
import { router, adminProcedure } from "../middleware.js";
import { tables, db, dbDate } from "../../db/index.js";
import { eq, and, like, sql, or, isNotNull, desc, ne } from "drizzle-orm";
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

const { users, deployments, chatSessions, auditLogs, promoCodes, promoRedemptions, organizations, announcements } = tables;

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

// ── Promo Codes ─────────────────────────────────────────────────────────

const listPromoCodes = adminProcedure
  .input(z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
    includeInactive: z.boolean().default(true),
  }))
  .query(async ({ input }) => {
    const { page, limit, includeInactive } = input;
    const offset = (page - 1) * limit;
    const conditions = includeInactive ? undefined : eq(promoCodes.active, true);

    const rows = await db
      .select({
        id: promoCodes.id,
        code: promoCodes.code,
        discountType: promoCodes.discountType,
        discountAmount: promoCodes.discountAmount,
        maxUses: promoCodes.maxUses,
        maxUsesPerUser: promoCodes.maxUsesPerUser,
        currentUses: promoCodes.currentUses,
        expiresAt: promoCodes.expiresAt,
        active: promoCodes.active,
        createdAt: promoCodes.createdAt,
      })
      .from(promoCodes)
      .where(conditions)
      .orderBy(desc(promoCodes.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(promoCodes)
      .where(conditions);

    return { codes: rows, total: Number(totalResult.count), page, limit };
  });

const CODE_REGEX = /^[A-Z0-9_-]{3,50}$/;

const createPromoCode = adminProcedure
  .input(z.object({
    code: z.string().min(3).max(50).transform((v) => v.trim().toUpperCase()),
    discountType: z.enum(["fixed", "percent"]),
    discountAmount: z.number().int().min(1),
    maxUses: z.number().int().min(1).nullable(),
    maxUsesPerUser: z.number().int().min(1).default(1),
    expiresAt: z.string().datetime().nullable().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!CODE_REGEX.test(input.code)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Code must be 3–50 characters: A–Z, 0–9, underscore, hyphen",
      });
    }
    if (input.discountType === "percent" && input.discountAmount > 100) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Percent discount cannot exceed 100" });
    }

    const existing = await db.query.promoCodes.findFirst({
      where: eq(promoCodes.code, input.code),
    });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "Promo code already exists" });
    }

    const [inserted] = await db
      .insert(promoCodes)
      .values({
        code: input.code,
        discountType: input.discountType,
        discountAmount: input.discountAmount,
        maxUses: input.maxUses,
        maxUsesPerUser: input.maxUsesPerUser,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: ctx.user.id,
      })
      .returning({ id: promoCodes.id });

    await logAdminAction({
      userId: ctx.user.id,
      action: "create_promo_code",
      targetType: "promo_code",
      targetId: inserted.id,
      metadata: {
        code: input.code,
        discountType: input.discountType,
        discountAmount: input.discountAmount,
        maxUses: input.maxUses,
        maxUsesPerUser: input.maxUsesPerUser,
      },
      ipAddress: ctx.ip ?? undefined,
    });

    return { id: inserted.id };
  });

const updatePromoCode = adminProcedure
  .input(z.object({
    id: z.string(),
    maxUses: z.number().int().min(1).nullable().optional(),
    maxUsesPerUser: z.number().int().min(1).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    active: z.boolean().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const existing = await db.query.promoCodes.findFirst({
      where: eq(promoCodes.id, input.id),
    });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Promo code not found" });
    }

    const patch: Record<string, unknown> = {};
    if (input.maxUses !== undefined) patch.maxUses = input.maxUses;
    if (input.maxUsesPerUser !== undefined) patch.maxUsesPerUser = input.maxUsesPerUser;
    if (input.expiresAt !== undefined) {
      patch.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    }
    if (input.active !== undefined) patch.active = input.active;

    if (Object.keys(patch).length === 0) {
      return { success: true };
    }

    await db.update(promoCodes).set(patch).where(eq(promoCodes.id, input.id));

    await logAdminAction({
      userId: ctx.user.id,
      action: "update_promo_code",
      targetType: "promo_code",
      targetId: input.id,
      metadata: patch as Record<string, unknown>,
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

const listPromoRedemptions = adminProcedure
  .input(z.object({
    promoCodeId: z.string(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(200).default(100),
  }))
  .query(async ({ input }) => {
    const { promoCodeId, page, limit } = input;
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: promoRedemptions.id,
        userId: promoRedemptions.userId,
        userEmail: users.email,
        userName: users.name,
        deploymentId: promoRedemptions.deploymentId,
        redeemedAt: promoRedemptions.redeemedAt,
      })
      .from(promoRedemptions)
      .leftJoin(users, eq(users.id, promoRedemptions.userId))
      .where(eq(promoRedemptions.promoCodeId, promoCodeId))
      .orderBy(desc(promoRedemptions.redeemedAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(promoRedemptions)
      .where(eq(promoRedemptions.promoCodeId, promoCodeId));

    return { redemptions: rows, total: Number(totalResult.count), page, limit };
  });

// ── Announcements ───────────────────────────────────────────────────────

const SEVERITY = z.enum(["info", "warning", "critical"]);

const listAnnouncements = adminProcedure
  .input(z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  }))
  .query(async ({ input }) => {
    const { page, limit } = input;
    const offset = (page - 1) * limit;

    const rows = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(announcements);

    return { announcements: rows, total: Number(totalResult.count), page, limit };
  });

const createAnnouncement = adminProcedure
  .input(z.object({
    message: z.string().trim().min(1).max(280),
    severity: SEVERITY.default("info"),
    dismissible: z.boolean().default(true),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    // Critical banners are intentionally not dismissible regardless of input.
    const dismissible = input.severity === "critical" ? false : input.dismissible;

    // Only one announcement is active at a time — deactivate all others first.
    await db
      .update(announcements)
      .set({ active: false })
      .where(eq(announcements.active, true));

    const [inserted] = await db
      .insert(announcements)
      .values({
        message: input.message,
        severity: input.severity,
        dismissible,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        createdBy: ctx.user.id,
      })
      .returning({ id: announcements.id });

    await logAdminAction({
      userId: ctx.user.id,
      action: "create_announcement",
      targetType: "announcement",
      targetId: inserted.id,
      metadata: {
        message: input.message,
        severity: input.severity,
        dismissible,
      },
      ipAddress: ctx.ip ?? undefined,
    });

    return { id: inserted.id };
  });

const updateAnnouncement = adminProcedure
  .input(z.object({
    id: z.string(),
    message: z.string().trim().min(1).max(280).optional(),
    severity: SEVERITY.optional(),
    active: z.boolean().optional(),
    dismissible: z.boolean().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const existing = await db.query.announcements.findFirst({
      where: eq(announcements.id, input.id),
    });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Announcement not found" });
    }

    const patch: Record<string, unknown> = {};
    if (input.message !== undefined) patch.message = input.message;
    if (input.severity !== undefined) {
      patch.severity = input.severity;
      // Critical severity forces non-dismissible.
      if (input.severity === "critical") patch.dismissible = false;
    }
    if (input.active !== undefined) patch.active = input.active;
    if (input.dismissible !== undefined && patch.dismissible === undefined) {
      patch.dismissible = input.dismissible;
    }
    if (input.startsAt !== undefined) {
      patch.startsAt = input.startsAt ? new Date(input.startsAt) : null;
    }
    if (input.endsAt !== undefined) {
      patch.endsAt = input.endsAt ? new Date(input.endsAt) : null;
    }

    if (Object.keys(patch).length === 0) return { success: true };

    // If this edit turns the announcement on, any other active row must turn off.
    if (patch.active === true) {
      await db
        .update(announcements)
        .set({ active: false })
        .where(and(eq(announcements.active, true), ne(announcements.id, input.id)));
    }

    await db.update(announcements).set(patch).where(eq(announcements.id, input.id));

    await logAdminAction({
      userId: ctx.user.id,
      action: "update_announcement",
      targetType: "announcement",
      targetId: input.id,
      metadata: patch as Record<string, unknown>,
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

const deleteAnnouncement = adminProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const existing = await db.query.announcements.findFirst({
      where: eq(announcements.id, input.id),
    });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Announcement not found" });
    }

    await db.delete(announcements).where(eq(announcements.id, input.id));

    await logAdminAction({
      userId: ctx.user.id,
      action: "delete_announcement",
      targetType: "announcement",
      targetId: input.id,
      metadata: { message: existing.message, severity: existing.severity },
      ipAddress: ctx.ip ?? undefined,
    });

    return { success: true };
  });

// ── Global Search ───────────────────────────────────────────────────────

const globalSearch = adminProcedure
  .input(z.object({
    query: z.string().trim().min(1).max(100),
    limitPerGroup: z.number().int().min(1).max(20).default(5),
  }))
  .query(async ({ input }) => {
    const pattern = `%${escapeLike(input.query)}%`;
    const upperPattern = `%${escapeLike(input.query.toUpperCase())}%`;
    const cap = input.limitPerGroup;

    const [userRows, deploymentRows, orgRows, promoRows] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
        })
        .from(users)
        .where(or(
          like(users.email, pattern),
          like(users.name, pattern),
        ))
        .limit(cap),
      db
        .select({
          id: deployments.id,
          name: deployments.name,
          status: deployments.status,
          userId: deployments.userId,
        })
        .from(deployments)
        .where(or(
          like(deployments.name, pattern),
          like(deployments.id, pattern),
        ))
        .limit(cap),
      db
        .select({
          id: organizations.id,
          name: organizations.name,
        })
        .from(organizations)
        .where(like(organizations.name, pattern))
        .limit(cap),
      db
        .select({
          id: promoCodes.id,
          code: promoCodes.code,
          active: promoCodes.active,
        })
        .from(promoCodes)
        .where(like(promoCodes.code, upperPattern))
        .limit(cap),
    ]);

    return {
      users: userRows,
      deployments: deploymentRows,
      organizations: orgRows,
      promoCodes: promoRows,
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
  getClusterMetrics,
  getMetricsTimeSeries,
  getClusterAlerts,
  listBetaSignups,
  sendBetaInvite,
  sendBetaInviteAll,
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  listPromoRedemptions,
  globalSearch,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
});
