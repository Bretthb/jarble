import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import {
  isStripeConfigured,
  listInvoices,
  getSubscriptionDetails,
} from "../../services/stripe.js";
import { logger } from "../../utils/logger.js";

const { users, deployments } = tables;

export const billingRouter = router({
  getOverview: protectedProcedure.query(async ({ ctx }) => {
    const deps = await ctx.db.query.deployments.findMany({
      where: eq(deployments.userId, ctx.user.id),
    });

    const paidDeps = deps.filter((d) => !d.isFree && d.stripeSubscriptionId);
    const totalMonthlyCents = deps.reduce(
      (sum, d) => sum + (d.isFree ? 0 : (d.monthlyPriceCents || 0)),
      0
    );

    let nextBillingDate: string | null = null;
    let paymentMethodLast4: string | null = null;

    if (isStripeConfigured() && paidDeps.length > 0) {
      try {
        const sub = await getSubscriptionDetails(paidDeps[0].stripeSubscriptionId!);
        const periodEnd = (sub as any).current_period_end;
        if (periodEnd) {
          nextBillingDate = new Date(periodEnd * 1000).toISOString();
        }
        const pm = (sub as any).default_payment_method;
        if (pm && typeof pm === "object" && pm.card) {
          paymentMethodLast4 = pm.card.last4 ?? null;
        }
      } catch (err) {
        logger.warn({ err, userId: ctx.user.id }, "Failed to fetch subscription details for billing overview");
      }
    }

    return {
      totalMonthlyCents,
      activeSubscriptionCount: paidDeps.length,
      nextBillingDate,
      paymentMethodLast4,
    };
  }),

  getInvoices: protectedProcedure.query(async ({ ctx }) => {
    if (!isStripeConfigured()) return [];

    const currentUser = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
    });

    const customerId = currentUser?.stripeCustomerId;
    if (!customerId) return [];

    try {
      const invoices = await listInvoices(customerId);
      return invoices.map((inv) => ({
        id: inv.id,
        date: new Date(inv.created * 1000).toISOString(),
        description: inv.description || (inv.lines?.data?.[0] as any)?.description || "Subscription",
        amountCents: inv.amount_paid || inv.amount_due || 0,
        status: inv.status as string,
        pdfUrl: inv.invoice_pdf ?? null,
        hostedUrl: inv.hosted_invoice_url ?? null,
      }));
    } catch (err) {
      logger.warn({ err, userId: ctx.user.id }, "Failed to fetch invoices");
      return [];
    }
  }),

  getSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const deps = await ctx.db.query.deployments.findMany({
      where: eq(deployments.userId, ctx.user.id),
      with: { runtimeCatalogEntry: true },
    });

    const paidDeps = deps.filter((d) => !d.isFree && d.stripeSubscriptionId);
    if (paidDeps.length === 0) return [];

    const results = await Promise.allSettled(
      paidDeps.map(async (d) => {
        let periodStart: string | null = null;
        let periodEnd: string | null = null;
        let stripeStatus = "unknown";

        if (isStripeConfigured()) {
          try {
            const sub = await getSubscriptionDetails(d.stripeSubscriptionId!);
            periodStart = new Date((sub as any).current_period_start * 1000).toISOString();
            periodEnd = new Date((sub as any).current_period_end * 1000).toISOString();
            stripeStatus = (sub as any).status;
          } catch {
            // Fall through with defaults
          }
        }

        return {
          deploymentId: d.id,
          deploymentName: d.name,
          runtime: d.runtimeCatalogEntry?.name ?? d.runtime,
          monthlyPriceCents: d.monthlyPriceCents,
          cancelledAt: d.cancelledAt ? new Date(d.cancelledAt).toISOString() : null,
          cancelAtPeriodEnd: d.cancelAtPeriodEnd ? new Date(d.cancelAtPeriodEnd).toISOString() : null,
          stripeStatus,
          periodStart,
          periodEnd,
        };
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map((r) => r.value);
  }),
});
