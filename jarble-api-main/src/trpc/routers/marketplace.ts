import { z } from "zod";
import crypto from "crypto";
import { router, publicProcedure, protectedProcedure } from "../middleware.js";
import { tables, dbDate } from "../../db/index.js";
import type { InferSelectModel } from "drizzle-orm";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../../utils/logger.js";
import {
  syncMarketplaceComponent,
  removeMarketplaceComponent,
} from "../../services/configSync.js";

const {
  users,
  deployments,
  creatorProfiles,
  marketplaceComponents,
  componentVersions,
  componentInstalls,
  componentPurchases,
  componentReviews,
} = tables;

// ── Row types inferred from the canonical MySQL schema ────────────────────
type ComponentRow = InferSelectModel<typeof marketplaceComponents>;
type VersionRow = InferSelectModel<typeof componentVersions>;
type InstallRow = InferSelectModel<typeof componentInstalls>;
type ReviewRow = InferSelectModel<typeof componentReviews>;
type PurchaseRow = InferSelectModel<typeof componentPurchases>;
type CreatorRow = InferSelectModel<typeof creatorProfiles>;

// --- Helpers ---

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

import { isAdmin } from "../../utils/rbac.js";

function assertAdmin(user: { role?: string }) {
  if (!isAdmin(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
}

/**
 * Convert a 1-5 average rating into the 1-500 scaled integer format
 * used in the database (e.g. 4.50 -> 450).
 */
function ratingToScaled(avg: number): number {
  return Math.round(avg * 100);
}

// --- Input Schemas ---

const browseInput = z.object({
  category: z.string().optional(),
  tier: z.enum(["template", "sandbox"]).optional(),
  pricing: z.enum(["free", "paid"]).optional(),
  sort: z.enum(["popular", "newest", "top_rated", "trending"]).default("popular"),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(50).default(20),
});

const componentNameRegex = /^[a-z][a-z0-9_]{0,63}$/;

const submitComponentInput = z.object({
  name: z.string().regex(componentNameRegex, "Name must be lowercase alphanumeric with underscores, starting with a letter, max 64 chars"),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  botDescription: z.string().max(500).optional(),
  tier: z.enum(["template", "sandbox"]),
  category: z.string().min(1).max(50),
  tags: z.array(z.string().max(30)).max(10).default([]),
  propsSchema: z.string().min(1), // JSON string of Zod-compatible schema
  exampleProps: z.string().optional(), // JSON string
  examplePrompts: z.array(z.string().max(200)).max(5).optional(),
  pricingModel: z.enum(["free", "one_time", "subscription"]).default("free"),
  priceUsdCents: z.number().int().min(0).default(0),
});

// --- Router ---

export const marketplaceRouter = router({
  // ==========================================
  // DISCOVERY (public)
  // ==========================================

  browse: publicProcedure
    .input(browseInput)
    .query(async ({ ctx, input }) => {
      // Fetch all published components — filter/sort in memory for MVP.
      const allComponents = await ctx.db.query.marketplaceComponents.findMany({
        where: eq(marketplaceComponents.status, "published"),
      });

      let filtered: ComponentRow[] = allComponents;

      // Category filter
      if (input.category) {
        filtered = filtered.filter((c) => c.category === input.category);
      }

      // Tier filter
      if (input.tier) {
        filtered = filtered.filter((c) => c.tier === input.tier);
      }

      // Pricing filter
      if (input.pricing === "free") {
        filtered = filtered.filter((c) => c.pricingModel === "free");
      } else if (input.pricing === "paid") {
        filtered = filtered.filter((c) => c.pricingModel !== "free");
      }

      // Search filter (name, displayName, description)
      if (input.search) {
        const searchLower = input.search.toLowerCase();
        filtered = filtered.filter((c) =>
          c.name?.toLowerCase().includes(searchLower) ||
          c.displayName?.toLowerCase().includes(searchLower) ||
          c.description?.toLowerCase().includes(searchLower)
        );
      }

      // Tags filter (component must have at least one matching tag)
      if (input.tags && input.tags.length > 0) {
        const searchTags = new Set(input.tags.map((t) => t.toLowerCase()));
        filtered = filtered.filter((c) => {
          const componentTags: string[] = c.tags ? JSON.parse(c.tags) : [];
          return componentTags.some((t) => searchTags.has(t.toLowerCase()));
        });
      }

      // Sort
      filtered.sort((a, b) => {
        switch (input.sort) {
          case "popular":
            return (b.totalInstalls ?? 0) - (a.totalInstalls ?? 0);
          case "newest":
            return new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime();
          case "top_rated":
            return (b.averageRating ?? 0) - (a.averageRating ?? 0);
          case "trending":
            // For MVP, use totalInstalls as a proxy for trending
            return (b.totalInstalls ?? 0) - (a.totalInstalls ?? 0);
          default:
            return 0;
        }
      });

      // Cursor-based pagination
      let startIdx = 0;
      if (input.cursor) {
        const cursorIdx = filtered.findIndex((c) => c.id === input.cursor);
        if (cursorIdx >= 0) {
          startIdx = cursorIdx + 1;
        }
      }

      const page = filtered.slice(startIdx, startIdx + input.limit);
      const nextCursor = page.length === input.limit ? page[page.length - 1]?.id : undefined;

      // creatorId references users.id — look up creator profiles by userId
      const creatorUserIds = [...new Set(page.map((c) => c.creatorId).filter(Boolean))];
      const creatorProfilesList: CreatorRow[] = [];
      for (const userId of creatorUserIds) {
        const profile = await ctx.db.query.creatorProfiles.findFirst({
          where: eq(creatorProfiles.userId, userId),
        });
        if (profile) creatorProfilesList.push(profile);
      }
      const creatorMap = new Map(creatorProfilesList.map((p) => [p.userId, p]));

      return {
        items: page.map((c) => ({
          id: c.id,
          name: c.name,
          displayName: c.displayName,
          description: c.description,
          tier: c.tier,
          category: c.category,
          tags: c.tags ? JSON.parse(c.tags) : [],
          pricingModel: c.pricingModel,
          priceUsdCents: c.priceUsdCents,
          totalInstalls: c.totalInstalls,
          averageRating: c.averageRating,
          ratingCount: c.ratingCount,
          publishedAt: c.publishedAt,
          creator: creatorMap.get(c.creatorId) ? {
            id: creatorMap.get(c.creatorId)!.id,
            displayName: creatorMap.get(c.creatorId)!.displayName,
          } : null,
        })),
        nextCursor,
      };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.id),
      });

      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component not found" });
      }

      // Fetch creator profile by userId (creatorId references users.id)
      const creator = component.creatorId
        ? await ctx.db.query.creatorProfiles.findFirst({
            where: eq(creatorProfiles.userId, component.creatorId),
          })
        : null;

      // Fetch versions
      const versions = await ctx.db.query.componentVersions.findMany({
        where: eq(componentVersions.componentId, input.id),
      });

      // Fetch review summary
      const reviews = await ctx.db.query.componentReviews.findMany({
        where: eq(componentReviews.componentId, input.id),
      });

      const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const review of reviews) {
        if (review.rating >= 1 && review.rating <= 5) {
          ratingDistribution[review.rating]++;
        }
      }

      return {
        ...component,
        tags: component.tags ? JSON.parse(component.tags) : [],
        examplePrompts: component.examplePrompts ? JSON.parse(component.examplePrompts) : [],
        creator: creator ? {
          id: creator.id,
          displayName: creator.displayName,
          bio: creator.bio,
          websiteUrl: creator.websiteUrl,
        } : null,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          changelog: v.changelog,
          createdAt: v.createdAt,
        })),
        reviewSummary: {
          averageRating: component.averageRating ?? 0,
          count: component.ratingCount ?? 0,
          distribution: ratingDistribution,
        },
      };
    }),

  getFeatured: publicProcedure.query(async ({ ctx }) => {
    // Fetch all published components that have a featuredAt value
    const allPublished = await ctx.db.query.marketplaceComponents.findMany({
      where: eq(marketplaceComponents.status, "published"),
    });

    const featured = allPublished
      .filter((c) => c.featuredAt != null)
      .sort((a, b) => new Date(b.featuredAt!).getTime() - new Date(a.featuredAt!).getTime())
      .slice(0, 6);

    return featured.map((c) => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      description: c.description,
      tier: c.tier,
      category: c.category,
      tags: c.tags ? JSON.parse(c.tags) : [],
      totalInstalls: c.totalInstalls,
      averageRating: c.averageRating,
      ratingCount: c.ratingCount,
      featuredAt: c.featuredAt,
    }));
  }),

  getCategories: publicProcedure.query(async ({ ctx }) => {
    const allPublished = await ctx.db.query.marketplaceComponents.findMany({
      where: eq(marketplaceComponents.status, "published"),
    });

    const categoryCounts = new Map<string, number>();
    for (const c of allPublished) {
      const category = c.category ?? "uncategorized";
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }

    return Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }),

  // ==========================================
  // INSTALLATION (protected)
  // ==========================================

  install: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
      versionId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify user owns the deployment
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Verify component exists and is published
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: and(
          eq(marketplaceComponents.id, input.componentId),
          eq(marketplaceComponents.status, "published"),
        ),
      });
      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component not found or not published" });
      }

      // Access check: paid components require a purchase
      if (component.pricingModel !== "free") {
        const purchase = await ctx.db.query.componentPurchases.findFirst({
          where: and(
            eq(componentPurchases.userId, ctx.user.id),
            eq(componentPurchases.componentId, input.componentId),
            eq(componentPurchases.status, "active"),
          ),
        });
        if (!purchase) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You must purchase this component before installing it",
          });
        }
      }

      // Check not already installed
      const existing = await ctx.db.query.componentInstalls.findFirst({
        where: and(
          eq(componentInstalls.componentId, input.componentId),
          eq(componentInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Component is already installed on this deployment" });
      }

      // Resolve version
      let versionId = input.versionId;
      let installedVersion = "1.0.0";
      if (versionId) {
        const version = await ctx.db.query.componentVersions.findFirst({
          where: and(
            eq(componentVersions.id, versionId),
            eq(componentVersions.componentId, input.componentId),
          ),
        });
        if (!version) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });
        }
        installedVersion = version.version;
      } else {
        // Find latest version
        const versions = await ctx.db.query.componentVersions.findMany({
          where: eq(componentVersions.componentId, input.componentId),
        });
        if (versions.length > 0) {
          // Sort by createdAt desc, take first
          const sorted = versions.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          versionId = sorted[0].id;
          installedVersion = sorted[0].version;
        }
      }

      if (!versionId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No version found for this component" });
      }

      // Create install record (userId and versionId are required by schema)
      await ctx.db.insert(componentInstalls).values({
        id: generateId("ci"),
        componentId: input.componentId,
        deploymentId: input.deploymentId,
        versionId,
        userId: ctx.user.id,
        installedAt: dbDate(),
      });

      // Increment totalInstalls on the component
      await ctx.db
        .update(marketplaceComponents)
        .set({
          totalInstalls: sql`${marketplaceComponents.totalInstalls} + 1` as any,
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info({
        componentId: input.componentId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        version: installedVersion,
      }, "Marketplace component installed");

      // Fire-and-forget: sync component to pod PVC if deployment is running
      if (deployment.status === "running") {
        const manifest = {
          name: component.name,
          displayName: component.displayName,
          description: component.description,
          tier: component.tier,
          category: component.category,
          propsSchema: component.propsSchema,
          version: installedVersion,
        };
        const templateOrHtml = component.exampleProps ?? component.propsSchema ?? "";
        void syncMarketplaceComponent(
          input.deploymentId,
          input.componentId,
          manifest,
          templateOrHtml,
          component.tier as "template" | "sandbox",
        ).catch((err) =>
          logger.error({ err, componentId: input.componentId, deploymentId: input.deploymentId },
            "marketplace.install: failed to sync component to pod (non-fatal)")
        );
      }

      return { success: true as const, installedVersion };
    }),

  uninstall: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify user owns the deployment
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Verify install exists
      const existing = await ctx.db.query.componentInstalls.findFirst({
        where: and(
          eq(componentInstalls.componentId, input.componentId),
          eq(componentInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component is not installed on this deployment" });
      }

      await ctx.db.delete(componentInstalls)
        .where(and(
          eq(componentInstalls.componentId, input.componentId),
          eq(componentInstalls.deploymentId, input.deploymentId),
        ));

      logger.info({
        componentId: input.componentId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
      }, "Marketplace component uninstalled");

      // Fire-and-forget: remove component from pod PVC if deployment is running
      if (deployment.status === "running") {
        void removeMarketplaceComponent(
          input.deploymentId,
          input.componentId,
        ).catch((err) =>
          logger.error({ err, componentId: input.componentId, deploymentId: input.deploymentId },
            "marketplace.uninstall: failed to remove component from pod (non-fatal)")
        );
      }

      return { success: true as const };
    }),

  listInstalled: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify user owns the deployment
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const installs = await ctx.db.query.componentInstalls.findMany({
        where: eq(componentInstalls.deploymentId, input.deploymentId),
      });

      if (installs.length === 0) return [];

      // Fetch component and version details for each install
      const results = [];
      for (const install of installs) {
        const component = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, install.componentId),
        });

        let version: VersionRow | undefined = undefined;
        if (install.versionId) {
          version = await ctx.db.query.componentVersions.findFirst({
            where: eq(componentVersions.id, install.versionId),
          });
        }

        results.push({
          installId: install.id,
          installedAt: install.installedAt,
          versionId: install.versionId,
          version: version ? version.version : null,
          component: component ? {
            id: component.id,
            name: component.name,
            displayName: component.displayName,
            description: component.description,
            tier: component.tier,
            category: component.category,
          } : null,
        });
      }

      return results.filter((r) => r.component !== null);
    }),

  updateVersion: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
      versionId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify user owns the deployment
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Verify install exists
      const install = await ctx.db.query.componentInstalls.findFirst({
        where: and(
          eq(componentInstalls.componentId, input.componentId),
          eq(componentInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component is not installed on this deployment" });
      }

      // Verify version exists for this component
      const version = await ctx.db.query.componentVersions.findFirst({
        where: and(
          eq(componentVersions.id, input.versionId),
          eq(componentVersions.componentId, input.componentId),
        ),
      });
      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Version not found for this component" });
      }

      // Update the install to use the new version
      await ctx.db
        .update(componentInstalls)
        .set({ versionId: input.versionId })
        .where(and(
          eq(componentInstalls.componentId, input.componentId),
          eq(componentInstalls.deploymentId, input.deploymentId),
        ));

      logger.info({
        componentId: input.componentId,
        deploymentId: input.deploymentId,
        versionId: input.versionId,
        userId: ctx.user.id,
      }, "Marketplace component version updated");

      // Fire-and-forget: re-sync component to pod PVC with new version
      if (deployment.status === "running") {
        const component = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, input.componentId),
        });
        if (component) {
          const manifest = {
            name: component.name,
            displayName: component.displayName,
            description: component.description,
            tier: component.tier,
            category: component.category,
            propsSchema: component.propsSchema,
            version: version.version,
          };
          const templateOrHtml = component.exampleProps ?? component.propsSchema ?? "";
          void syncMarketplaceComponent(
            input.deploymentId,
            input.componentId,
            manifest,
            templateOrHtml,
            component.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error({ err, componentId: input.componentId, deploymentId: input.deploymentId },
              "marketplace.updateVersion: failed to sync component to pod (non-fatal)")
          );
        }
      }

      return { success: true as const, version: version.version };
    }),

  // ==========================================
  // PURCHASES (protected)
  // ==========================================

  createCheckout: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      deploymentId: z.string(),
    }))
    .mutation(async () => {
      // Placeholder — Stripe Connect setup is Phase 3.3
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Paid marketplace coming soon",
      });
    }),

  getPurchases: protectedProcedure.query(async ({ ctx }) => {
    const purchases = await ctx.db.query.componentPurchases.findMany({
      where: eq(componentPurchases.userId, ctx.user.id),
    });

    // Fetch component details for each purchase
    const results = [];
    for (const purchase of purchases) {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, purchase.componentId),
      });

      results.push({
        id: purchase.id,
        componentId: purchase.componentId,
        amountCents: purchase.amountCents,
        status: purchase.status,
        purchasedAt: purchase.purchasedAt,
        component: component ? {
          id: component.id,
          name: component.name,
          displayName: component.displayName,
        } : null,
      });
    }

    return results;
  }),

  // ==========================================
  // REVIEWS (mixed)
  // ==========================================

  getReviews: publicProcedure
    .input(z.object({
      componentId: z.string(),
      sort: z.enum(["newest", "highest", "lowest"]).default("newest"),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const allReviews = await ctx.db.query.componentReviews.findMany({
        where: eq(componentReviews.componentId, input.componentId),
      });

      // Sort
      const sorted = [...allReviews];
      sorted.sort((a, b) => {
        switch (input.sort) {
          case "newest":
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          case "highest":
            return (b.rating ?? 0) - (a.rating ?? 0);
          case "lowest":
            return (a.rating ?? 0) - (b.rating ?? 0);
          default:
            return 0;
        }
      });

      // Cursor-based pagination
      let startIdx = 0;
      if (input.cursor) {
        const cursorIdx = sorted.findIndex((r) => r.id === input.cursor);
        if (cursorIdx >= 0) {
          startIdx = cursorIdx + 1;
        }
      }

      const page = sorted.slice(startIdx, startIdx + input.limit);
      const nextCursor = page.length === input.limit ? page[page.length - 1]?.id : undefined;

      // Fetch user info for reviews
      const userIds = [...new Set(page.map((r) => r.userId).filter(Boolean))];
      const reviewUsers: Array<InferSelectModel<typeof users>> = [];
      for (const userId of userIds) {
        const user = await ctx.db.query.users.findFirst({
          where: eq(users.id, userId),
        });
        if (user) reviewUsers.push(user);
      }
      const userMap = new Map(reviewUsers.map((u) => [u.id, u]));

      // Summary stats
      const totalRating = allReviews.reduce((sum, r) => sum + (r.rating ?? 0), 0);
      const avgRating = allReviews.length > 0 ? totalRating / allReviews.length : 0;

      return {
        items: page.map((r) => ({
          id: r.id,
          rating: r.rating,
          title: r.title,
          body: r.body,
          createdAt: r.createdAt,
          user: userMap.get(r.userId) ? {
            id: userMap.get(r.userId)!.id,
            name: userMap.get(r.userId)!.name,
          } : null,
        })),
        nextCursor,
        summary: {
          averageRating: Math.round(avgRating * 100) / 100,
          count: allReviews.length,
        },
      };
    }),

  createReview: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      rating: z.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      body: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Must have the component installed to review.
      // Check if any of the user's deployments have this component installed.
      const userInstalls = await ctx.db.query.componentInstalls.findMany({
        where: and(
          eq(componentInstalls.componentId, input.componentId),
          eq(componentInstalls.userId, ctx.user.id),
        ),
      });

      if (userInstalls.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must have this component installed to leave a review",
        });
      }

      // Upsert: one review per user per component
      const existing = await ctx.db.query.componentReviews.findFirst({
        where: and(
          eq(componentReviews.userId, ctx.user.id),
          eq(componentReviews.componentId, input.componentId),
        ),
      });

      if (existing) {
        // Update existing review
        await ctx.db
          .update(componentReviews)
          .set({
            rating: input.rating,
            title: input.title ?? null,
            body: input.body ?? null,
            updatedAt: dbDate(),
          })
          .where(eq(componentReviews.id, existing.id));
      } else {
        // Create new review
        await ctx.db.insert(componentReviews).values({
          id: generateId("rev"),
          componentId: input.componentId,
          userId: ctx.user.id,
          rating: input.rating,
          title: input.title ?? null,
          body: input.body ?? null,
          createdAt: dbDate(),
          updatedAt: dbDate(),
        });
      }

      // Recalculate average rating for the component (stored as 1-500 scaled integer)
      const allReviews = await ctx.db.query.componentReviews.findMany({
        where: eq(componentReviews.componentId, input.componentId),
      });
      const totalRating = allReviews.reduce((sum, r) => sum + (r.rating ?? 0), 0);
      const avgRating = allReviews.length > 0 ? totalRating / allReviews.length : 0;

      await ctx.db
        .update(marketplaceComponents)
        .set({
          averageRating: ratingToScaled(avgRating),
          ratingCount: allReviews.length,
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info({
        componentId: input.componentId,
        userId: ctx.user.id,
        rating: input.rating,
        isUpdate: !!existing,
      }, "Component review submitted");

      return { success: true as const };
    }),

  // ==========================================
  // CREATOR (protected)
  // ==========================================

  createCreatorProfile: protectedProcedure
    .input(z.object({
      displayName: z.string().min(1).max(100),
      bio: z.string().max(500).optional(),
      websiteUrl: z.string().url().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user already has a creator profile
      const existing = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Creator profile already exists" });
      }

      const id = generateId("cp");
      await ctx.db.insert(creatorProfiles).values({
        id,
        userId: ctx.user.id,
        displayName: input.displayName,
        bio: input.bio ?? null,
        websiteUrl: input.websiteUrl ?? null,
        createdAt: dbDate(),
        updatedAt: dbDate(),
      });

      logger.info({ userId: ctx.user.id, profileId: id }, "Creator profile created");

      return { id };
    }),

  getCreatorProfile: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, input.userId),
      });
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Creator profile not found" });
      }

      // Fetch published components by this creator (creatorId = userId)
      const allComponents = await ctx.db.query.marketplaceComponents.findMany({
        where: and(
          eq(marketplaceComponents.creatorId, input.userId),
          eq(marketplaceComponents.status, "published"),
        ),
      });

      return {
        ...profile,
        components: allComponents.map((c) => ({
          id: c.id,
          name: c.name,
          displayName: c.displayName,
          description: c.description,
          tier: c.tier,
          category: c.category,
          totalInstalls: c.totalInstalls,
          averageRating: c.averageRating,
          ratingCount: c.ratingCount,
        })),
      };
    }),

  submitComponent: protectedProcedure
    .input(submitComponentInput)
    .mutation(async ({ ctx, input }) => {
      // Verify user has a creator profile
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You must create a creator profile before submitting components",
        });
      }

      // Check for duplicate name from same creator
      const existingName = await ctx.db.query.marketplaceComponents.findFirst({
        where: and(
          eq(marketplaceComponents.creatorId, ctx.user.id),
          eq(marketplaceComponents.name, input.name),
        ),
      });
      if (existingName) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a component with this name" });
      }

      const componentId = generateId("cmp");

      // creatorId references users.id
      await ctx.db.insert(marketplaceComponents).values({
        id: componentId,
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        botDescription: input.botDescription ?? null,
        tier: input.tier,
        category: input.category,
        tags: JSON.stringify(input.tags),
        propsSchema: input.propsSchema,
        exampleProps: input.exampleProps ?? null,
        examplePrompts: input.examplePrompts ? JSON.stringify(input.examplePrompts) : null,
        pricingModel: input.pricingModel,
        priceUsdCents: input.priceUsdCents,
        creatorId: ctx.user.id,
        status: "draft",
        totalInstalls: 0,
        ratingCount: 0,
        createdAt: dbDate(),
        updatedAt: dbDate(),
      });

      // Create initial version with placeholder package info (S3 upload skipped for MVP)
      await ctx.db.insert(componentVersions).values({
        id: generateId("ver"),
        componentId,
        version: "1.0.0",
        changelog: "Initial version",
        packageUrl: "pending://upload", // Placeholder — real uploads added later
        packageSizeBytes: 0,
        manifestHash: crypto.createHash("sha256").update(componentId).digest("hex"),
        createdAt: dbDate(),
      });

      logger.info({
        componentId,
        name: input.name,
        tier: input.tier,
        userId: ctx.user.id,
      }, "Marketplace component submitted");

      return { componentId };
    }),

  publishComponent: protectedProcedure
    .input(z.object({ componentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });
      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component not found" });
      }

      // Verify creator owns this component (creatorId = userId)
      if (component.creatorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this component" });
      }
      if (component.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Component status is "${component.status}", must be "draft" to publish`,
        });
      }

      // Tier 1 (template): auto-approve
      // Tier 2 (sandbox): needs review
      const newStatus = component.tier === "template" ? "published" : "submitted";

      await ctx.db
        .update(marketplaceComponents)
        .set({
          status: newStatus,
          updatedAt: dbDate(),
          ...(newStatus === "published" ? { publishedAt: dbDate() } : {}),
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info({
        componentId: input.componentId,
        tier: component.tier,
        newStatus,
        userId: ctx.user.id,
      }, "Marketplace component publish requested");

      return { status: newStatus };
    }),

  updateComponent: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      displayName: z.string().min(1).max(100).optional(),
      description: z.string().min(1).max(2000).optional(),
      botDescription: z.string().max(500).optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      priceUsdCents: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });
      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component not found" });
      }

      // Verify creator owns this component (creatorId = userId)
      if (component.creatorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this component" });
      }

      const updateData: Record<string, unknown> = { updatedAt: dbDate() };
      if (input.displayName !== undefined) updateData.displayName = input.displayName;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.botDescription !== undefined) updateData.botDescription = input.botDescription;
      if (input.tags !== undefined) updateData.tags = JSON.stringify(input.tags);
      if (input.priceUsdCents !== undefined) updateData.priceUsdCents = input.priceUsdCents;

      await ctx.db
        .update(marketplaceComponents)
        .set(updateData as any)
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info({
        componentId: input.componentId,
        userId: ctx.user.id,
      }, "Marketplace component updated");

      return { success: true as const };
    }),

  myComponents: protectedProcedure.query(async ({ ctx }) => {
    // creatorId references users.id — filter by current user
    const myComponents = await ctx.db.query.marketplaceComponents.findMany({
      where: eq(marketplaceComponents.creatorId, ctx.user.id),
    });

    return myComponents
      .map((c) => ({
        id: c.id,
        name: c.name,
        displayName: c.displayName,
        description: c.description,
        tier: c.tier,
        category: c.category,
        tags: c.tags ? JSON.parse(c.tags) : [],
        pricingModel: c.pricingModel,
        priceUsdCents: c.priceUsdCents,
        status: c.status,
        totalInstalls: c.totalInstalls,
        averageRating: c.averageRating,
        ratingCount: c.ratingCount,
        publishedAt: c.publishedAt,
        createdAt: c.createdAt,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }),

  getCreatorAnalytics: protectedProcedure
    .input(z.object({
      componentId: z.string().optional(),
      period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
    }).optional())
    .query(async ({ ctx, input }) => {
      // If specific component requested, verify ownership
      if (input?.componentId) {
        const component = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, input.componentId),
        });
        if (!component || component.creatorId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Component not found" });
        }

        return {
          totalInstalls: component.totalInstalls ?? 0,
          averageRating: component.averageRating ?? 0,
          ratingCount: component.ratingCount ?? 0,
        };
      }

      // Aggregate across all creator's components
      const myComponents = await ctx.db.query.marketplaceComponents.findMany({
        where: eq(marketplaceComponents.creatorId, ctx.user.id),
      });

      const totalInstalls = myComponents.reduce((sum, c) => sum + (c.totalInstalls ?? 0), 0);
      const totalRatings = myComponents.reduce((sum, c) => sum + (c.ratingCount ?? 0), 0);
      const weightedRatingSum = myComponents.reduce(
        (sum, c) => sum + ((c.averageRating ?? 0) * (c.ratingCount ?? 0)), 0
      );
      const overallRating = totalRatings > 0 ? Math.round(weightedRatingSum / totalRatings) : 0;

      return {
        totalComponents: myComponents.length,
        publishedComponents: myComponents.filter((c) => c.status === "published").length,
        totalInstalls,
        overallAverageRating: overallRating,
        totalRatingCount: totalRatings,
      };
    }),

  // ==========================================
  // ADMIN
  // ==========================================

  getReviewQueue: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.user);

    const allComponents = await ctx.db.query.marketplaceComponents.findMany();
    return allComponents
      .filter((c) => c.status === "submitted" || c.status === "in_review")
      .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      .map((c) => ({
        id: c.id,
        name: c.name,
        displayName: c.displayName,
        description: c.description,
        tier: c.tier,
        category: c.category,
        status: c.status,
        creatorId: c.creatorId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
  }),

  approveComponent: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user);

      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });
      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component not found" });
      }

      if (component.status !== "submitted" && component.status !== "in_review") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Component status is "${component.status}", must be "submitted" or "in_review" to approve`,
        });
      }

      await ctx.db
        .update(marketplaceComponents)
        .set({
          status: "published",
          publishedAt: dbDate(),
          reviewNotes: input.notes ?? null,
          updatedAt: dbDate(),
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info({
        componentId: input.componentId,
        adminUserId: ctx.user.id,
      }, "Marketplace component approved");

      return { success: true as const };
    }),

  rejectComponent: protectedProcedure
    .input(z.object({
      componentId: z.string(),
      notes: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user);

      const component = await ctx.db.query.marketplaceComponents.findFirst({
        where: eq(marketplaceComponents.id, input.componentId),
      });
      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Component not found" });
      }

      if (component.status !== "submitted" && component.status !== "in_review") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Component status is "${component.status}", must be "submitted" or "in_review" to reject`,
        });
      }

      await ctx.db
        .update(marketplaceComponents)
        .set({
          status: "rejected",
          reviewNotes: input.notes,
          updatedAt: dbDate(),
        })
        .where(eq(marketplaceComponents.id, input.componentId));

      logger.info({
        componentId: input.componentId,
        adminUserId: ctx.user.id,
        notes: input.notes,
      }, "Marketplace component rejected");

      return { success: true as const };
    }),
});
