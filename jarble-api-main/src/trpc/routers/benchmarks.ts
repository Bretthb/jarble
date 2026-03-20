import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../middleware.js";
import { tables, dbDate } from "../../db/index.js";
import { eq, and, desc, sql, asc, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../../utils/logger.js";
import { isAdmin } from "../../utils/admin.js";
import { customAlphabet } from "nanoid";

const alphanumeric = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const genId = (prefix: string) => `${prefix}_${alphanumeric()}`;

const {
  domains,
  deployments,
  deploymentRatings,
  deploymentDomainScores,
  serviceBenchmarkSamples,
  serviceBenchmarkAggregates,
  serviceReviews,
  marketplaceServices,
  serviceInstalls,
  users,
} = tables;

// Kebab-case slug validation: lowercase letters, digits, hyphens; must start with a letter
const kebabCaseRegex = /^[a-z][a-z0-9-]{0,98}[a-z0-9]$/;

/** Safely parse a JSON string, returning fallback on failure */
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// --- Router ---

export const benchmarksRouter = router({
  // ==========================================
  // DOMAIN PROCEDURES
  // ==========================================

  listDomains: publicProcedure
    .input(
      z.object({
        parentId: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const parentId = input?.parentId;

      if (parentId) {
        // Return children of the specified parent
        return ctx.db
          .select()
          .from(domains)
          .where(eq(domains.parentId, parentId))
          .orderBy(asc(domains.sortOrder));
      }

      // Return root domains (where parentId is null)
      return ctx.db
        .select()
        .from(domains)
        .where(isNull(domains.parentId))
        .orderBy(asc(domains.sortOrder));
    }),

  createDomain: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).regex(kebabCaseRegex, "Name must be a kebab-case slug (e.g. 'data-analysis')"),
        displayName: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        parentId: z.string().optional(),
        icon: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate parent exists if provided
      if (input.parentId) {
        const parent = await ctx.db
          .select({ id: domains.id })
          .from(domains)
          .where(eq(domains.id, input.parentId))
          .limit(1);

        if (parent.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Parent domain not found",
          });
        }
      }

      // Check for duplicate name
      const existing = await ctx.db
        .select({ id: domains.id })
        .from(domains)
        .where(eq(domains.name, input.name))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Domain with name '${input.name}' already exists`,
        });
      }

      const id = genId("dom");
      await ctx.db.insert(domains).values({
        id,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        icon: input.icon ?? null,
        sortOrder: 0,
        createdAt: dbDate(),
      });

      return { id, name: input.name };
    }),

  // ==========================================
  // DEPLOYMENT RATING PROCEDURES
  // ==========================================

  rateDeployment: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        domainId: z.string(),
        accuracy: z.number().int().min(1).max(5),
        helpfulness: z.number().int().min(1).max(5),
        creativity: z.number().int().min(1).max(5),
        comment: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify deployment exists
      const deployment = await ctx.db
        .select({ id: deployments.id })
        .from(deployments)
        .where(eq(deployments.id, input.deploymentId))
        .limit(1);

      if (deployment.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Verify domain exists
      const domain = await ctx.db
        .select({ id: domains.id })
        .from(domains)
        .where(eq(domains.id, input.domainId))
        .limit(1);

      if (domain.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Domain not found",
        });
      }

      // Upsert rating — check if one exists for this user+deployment+domain
      const existingRating = await ctx.db
        .select({ id: deploymentRatings.id })
        .from(deploymentRatings)
        .where(
          and(
            eq(deploymentRatings.userId, userId),
            eq(deploymentRatings.deploymentId, input.deploymentId),
            eq(deploymentRatings.domainId, input.domainId)
          )
        )
        .limit(1);

      let ratingId: string;

      if (existingRating.length > 0) {
        ratingId = existingRating[0].id;
        await ctx.db
          .update(deploymentRatings)
          .set({
            accuracy: input.accuracy,
            helpfulness: input.helpfulness,
            creativity: input.creativity,
            comment: input.comment ?? null,
            updatedAt: dbDate(),
          })
          .where(eq(deploymentRatings.id, ratingId));
      } else {
        ratingId = genId("drt");
        await ctx.db.insert(deploymentRatings).values({
          id: ratingId,
          deploymentId: input.deploymentId,
          domainId: input.domainId,
          userId,
          accuracy: input.accuracy,
          helpfulness: input.helpfulness,
          creativity: input.creativity,
          comment: input.comment ?? null,
          createdAt: dbDate(),
          updatedAt: dbDate(),
        });
      }

      // Recompute deploymentDomainScores for this deployment+domain
      const allRatings = await ctx.db
        .select({
          accuracy: deploymentRatings.accuracy,
          helpfulness: deploymentRatings.helpfulness,
          creativity: deploymentRatings.creativity,
        })
        .from(deploymentRatings)
        .where(
          and(
            eq(deploymentRatings.deploymentId, input.deploymentId),
            eq(deploymentRatings.domainId, input.domainId)
          )
        );

      const count = allRatings.length;
      const sumAccuracy = allRatings.reduce((s, r) => s + r.accuracy, 0);
      const sumHelpfulness = allRatings.reduce((s, r) => s + r.helpfulness, 0);
      const sumCreativity = allRatings.reduce((s, r) => s + r.creativity, 0);

      // Scale to 100-500 range (avg * 100)
      const avgAccuracy = Math.round((sumAccuracy / count) * 100);
      const avgHelpfulness = Math.round((sumHelpfulness / count) * 100);
      const avgCreativity = Math.round((sumCreativity / count) * 100);
      const overallScore = Math.round((avgAccuracy + avgHelpfulness + avgCreativity) / 3);

      const confidence: "low" | "medium" | "high" =
        count < 5 ? "low" : count < 20 ? "medium" : "high";

      // Upsert the scores row
      const existingScore = await ctx.db
        .select({ id: deploymentDomainScores.id })
        .from(deploymentDomainScores)
        .where(
          and(
            eq(deploymentDomainScores.deploymentId, input.deploymentId),
            eq(deploymentDomainScores.domainId, input.domainId)
          )
        )
        .limit(1);

      if (existingScore.length > 0) {
        await ctx.db
          .update(deploymentDomainScores)
          .set({
            avgAccuracy,
            avgHelpfulness,
            avgCreativity,
            overallScore,
            ratingCount: count,
            confidence,
            updatedAt: dbDate(),
          })
          .where(eq(deploymentDomainScores.id, existingScore[0].id));
      } else {
        await ctx.db.insert(deploymentDomainScores).values({
          id: genId("dds"),
          deploymentId: input.deploymentId,
          domainId: input.domainId,
          avgAccuracy,
          avgHelpfulness,
          avgCreativity,
          overallScore,
          ratingCount: count,
          confidence,
          updatedAt: dbDate(),
        });
      }

      logger.info(
        { deploymentId: input.deploymentId, domainId: input.domainId, ratingCount: count, overallScore },
        "deployment rating upserted + scores recomputed"
      );

      return { ratingId, overallScore, ratingCount: count, confidence };
    }),

  getDeploymentRatings: publicProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const ratings = await ctx.db
        .select({
          id: deploymentRatings.id,
          deploymentId: deploymentRatings.deploymentId,
          domainId: deploymentRatings.domainId,
          userId: deploymentRatings.userId,
          accuracy: deploymentRatings.accuracy,
          helpfulness: deploymentRatings.helpfulness,
          creativity: deploymentRatings.creativity,
          comment: deploymentRatings.comment,
          createdAt: deploymentRatings.createdAt,
          updatedAt: deploymentRatings.updatedAt,
          domainName: domains.name,
          domainDisplayName: domains.displayName,
        })
        .from(deploymentRatings)
        .innerJoin(domains, eq(deploymentRatings.domainId, domains.id))
        .where(eq(deploymentRatings.deploymentId, input.deploymentId))
        .orderBy(desc(deploymentRatings.createdAt));

      return ratings;
    }),

  // ==========================================
  // DEPLOYMENT PROFILE PROCEDURES
  // ==========================================

  setSpecialties: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        specialties: z.array(z.string()).max(5),
        bio: z.string().max(2000).optional(),
        showcasePrompts: z.array(z.string().max(500)).max(10).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify ownership
      const deployment = await ctx.db
        .select({ id: deployments.id, userId: deployments.userId })
        .from(deployments)
        .where(eq(deployments.id, input.deploymentId))
        .limit(1);

      if (deployment.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      if (deployment[0].userId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not own this deployment",
        });
      }

      await ctx.db
        .update(deployments)
        .set({
          specialties: JSON.stringify(input.specialties),
          bio: input.bio ?? null,
          showcasePrompts: input.showcasePrompts
            ? JSON.stringify(input.showcasePrompts)
            : null,
          updatedAt: dbDate(),
        })
        .where(eq(deployments.id, input.deploymentId));

      return { success: true };
    }),

  getPublicProfile: publicProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db
        .select({
          id: deployments.id,
          name: deployments.name,
          description: deployments.description,
          runtime: deployments.runtime,
          systemPrompt: deployments.systemPrompt,
          isPublic: deployments.isPublic,
          specialties: deployments.specialties,
          bio: deployments.bio,
          showcasePrompts: deployments.showcasePrompts,
          forkCount: deployments.forkCount,
          forkedFromId: deployments.forkedFromId,
          featuredAt: deployments.featuredAt,
        })
        .from(deployments)
        .where(eq(deployments.id, input.deploymentId))
        .limit(1);

      if (deployment.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      const dep = deployment[0];

      if (!dep.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This deployment is not public",
        });
      }

      // Get installed service names
      const installedServices = await ctx.db
        .select({
          serviceName: marketplaceServices.displayName,
        })
        .from(serviceInstalls)
        .innerJoin(
          marketplaceServices,
          eq(serviceInstalls.packageId, marketplaceServices.id)
        )
        .where(eq(serviceInstalls.deploymentId, input.deploymentId));

      // Get domain scores
      const scores = await ctx.db
        .select({
          domainId: deploymentDomainScores.domainId,
          domainName: domains.name,
          domainDisplayName: domains.displayName,
          avgAccuracy: deploymentDomainScores.avgAccuracy,
          avgHelpfulness: deploymentDomainScores.avgHelpfulness,
          avgCreativity: deploymentDomainScores.avgCreativity,
          overallScore: deploymentDomainScores.overallScore,
          ratingCount: deploymentDomainScores.ratingCount,
          confidence: deploymentDomainScores.confidence,
        })
        .from(deploymentDomainScores)
        .innerJoin(domains, eq(deploymentDomainScores.domainId, domains.id))
        .where(eq(deploymentDomainScores.deploymentId, input.deploymentId))
        .orderBy(desc(deploymentDomainScores.overallScore));

      // Parse JSON fields safely
      let specialties: string[] = [];
      try {
        specialties = dep.specialties ? JSON.parse(dep.specialties) : [];
      } catch {
        specialties = [];
      }

      let showcasePrompts: string[] = [];
      try {
        showcasePrompts = dep.showcasePrompts ? JSON.parse(dep.showcasePrompts) : [];
      } catch {
        showcasePrompts = [];
      }

      return {
        id: dep.id,
        name: dep.name,
        description: dep.description,
        runtime: dep.runtime,
        systemPromptPreview: dep.systemPrompt
          ? dep.systemPrompt.slice(0, 200)
          : null,
        specialties,
        bio: dep.bio,
        showcasePrompts,
        forkCount: dep.forkCount,
        forkedFromId: dep.forkedFromId,
        featuredAt: dep.featuredAt,
        installedServices: installedServices.map((s) => s.serviceName),
        domainScores: scores,
      };
    }),

  // ==========================================
  // LEADERBOARD PROCEDURES
  // ==========================================

  leaderboard: publicProcedure
    .input(
      z.object({
        domainSlug: z.string(),
        metric: z.enum(["overall", "accuracy", "helpfulness", "creativity"]).default("overall"),
        limit: z.number().int().min(1).max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      // Find domain by slug (name)
      const domain = await ctx.db
        .select({ id: domains.id, displayName: domains.displayName })
        .from(domains)
        .where(eq(domains.name, input.domainSlug))
        .limit(1);

      if (domain.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Domain '${input.domainSlug}' not found`,
        });
      }

      const domainId = domain[0].id;

      // Determine sort column
      const metricColumn = {
        overall: deploymentDomainScores.overallScore,
        accuracy: deploymentDomainScores.avgAccuracy,
        helpfulness: deploymentDomainScores.avgHelpfulness,
        creativity: deploymentDomainScores.avgCreativity,
      }[input.metric];

      // Query scores joined with deployments, filtering public + minimum ratings
      const results = await ctx.db
        .select({
          deploymentId: deploymentDomainScores.deploymentId,
          deploymentName: deployments.name,
          deploymentDescription: deployments.description,
          specialties: deployments.specialties,
          overallScore: deploymentDomainScores.overallScore,
          avgAccuracy: deploymentDomainScores.avgAccuracy,
          avgHelpfulness: deploymentDomainScores.avgHelpfulness,
          avgCreativity: deploymentDomainScores.avgCreativity,
          ratingCount: deploymentDomainScores.ratingCount,
          confidence: deploymentDomainScores.confidence,
        })
        .from(deploymentDomainScores)
        .innerJoin(
          deployments,
          eq(deploymentDomainScores.deploymentId, deployments.id)
        )
        .where(
          and(
            eq(deploymentDomainScores.domainId, domainId),
            eq(deployments.isPublic, true),
            sql`${deploymentDomainScores.ratingCount} >= 3`
          )
        )
        .orderBy(desc(metricColumn))
        .limit(input.limit);

      return {
        domain: {
          id: domainId,
          displayName: domain[0].displayName,
          slug: input.domainSlug,
        },
        metric: input.metric,
        entries: results.map((r, idx) => ({
          rank: idx + 1,
          deploymentId: r.deploymentId,
          name: r.deploymentName,
          description: r.deploymentDescription,
          specialties: safeJsonParse(r.specialties, []),
          scores: {
            overall: r.overallScore,
            accuracy: r.avgAccuracy,
            helpfulness: r.avgHelpfulness,
            creativity: r.avgCreativity,
          },
          ratingCount: r.ratingCount,
          confidence: r.confidence,
        })),
      };
    }),

  // ==========================================
  // SERVICE METRICS PROCEDURES
  // ==========================================

  getServiceMetrics: publicProcedure
    .input(
      z.object({
        serviceId: z.string(),
        period: z.enum(["24h", "7d", "30d"]).default("7d"),
      })
    )
    .query(async ({ ctx, input }) => {
      const aggregates = await ctx.db
        .select()
        .from(serviceBenchmarkAggregates)
        .where(
          and(
            eq(serviceBenchmarkAggregates.serviceId, input.serviceId),
            eq(serviceBenchmarkAggregates.period, input.period)
          )
        )
        .orderBy(asc(serviceBenchmarkAggregates.skillName));

      return {
        serviceId: input.serviceId,
        period: input.period,
        metrics: aggregates,
      };
    }),

  serviceLeaderboard: publicProcedure
    .input(
      z.object({
        metric: z.enum(["reliability", "speed", "popularity"]).default("reliability"),
        limit: z.number().int().min(1).max(100).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.metric === "popularity") {
        // For popularity, sort by totalInstalls on marketplaceServices directly
        const results = await ctx.db
          .select({
            serviceId: marketplaceServices.id,
            serviceName: marketplaceServices.displayName,
            description: marketplaceServices.description,
            totalInstalls: marketplaceServices.totalInstalls,
            avgRating: marketplaceServices.avgRating,
          })
          .from(marketplaceServices)
          .where(eq(marketplaceServices.status, "published"))
          .orderBy(desc(marketplaceServices.totalInstalls))
          .limit(input.limit);

        return {
          metric: input.metric,
          entries: results.map((r, idx) => ({
            rank: idx + 1,
            serviceId: r.serviceId,
            name: r.serviceName,
            description: r.description,
            totalInstalls: r.totalInstalls,
            avgRating: r.avgRating,
          })),
        };
      }

      // For reliability and speed, join services with their 7d aggregates
      const orderCol =
        input.metric === "reliability"
          ? desc(serviceBenchmarkAggregates.uptimePercent)
          : asc(serviceBenchmarkAggregates.latencyP50);

      const results = await ctx.db
        .select({
          serviceId: marketplaceServices.id,
          serviceName: marketplaceServices.displayName,
          description: marketplaceServices.description,
          totalInstalls: marketplaceServices.totalInstalls,
          avgRating: marketplaceServices.avgRating,
          latencyP50: serviceBenchmarkAggregates.latencyP50,
          latencyP95: serviceBenchmarkAggregates.latencyP95,
          uptimePercent: serviceBenchmarkAggregates.uptimePercent,
          errorRate: serviceBenchmarkAggregates.errorRate,
          sampleCount: serviceBenchmarkAggregates.sampleCount,
        })
        .from(marketplaceServices)
        .innerJoin(
          serviceBenchmarkAggregates,
          and(
            eq(serviceBenchmarkAggregates.serviceId, marketplaceServices.id),
            eq(serviceBenchmarkAggregates.period, "7d")
          )
        )
        .where(eq(marketplaceServices.status, "published"))
        .orderBy(orderCol)
        .limit(input.limit);

      return {
        metric: input.metric,
        entries: results.map((r, idx) => ({
          rank: idx + 1,
          serviceId: r.serviceId,
          name: r.serviceName,
          description: r.description,
          totalInstalls: r.totalInstalls,
          avgRating: r.avgRating,
          latencyP50: r.latencyP50,
          latencyP95: r.latencyP95,
          uptimePercent: r.uptimePercent,
          errorRate: r.errorRate,
          sampleCount: r.sampleCount,
        })),
      };
    }),

  // ==========================================
  // SERVICE REVIEW PROCEDURES
  // ==========================================

  getServiceReviews: publicProcedure
    .input(
      z.object({
        serviceId: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const reviews = await ctx.db
        .select({
          id: serviceReviews.id,
          serviceId: serviceReviews.serviceId,
          userId: serviceReviews.userId,
          userName: users.name,
          rating: serviceReviews.rating,
          title: serviceReviews.title,
          body: serviceReviews.body,
          creatorResponse: serviceReviews.creatorResponse,
          creatorRespondedAt: serviceReviews.creatorRespondedAt,
          helpful: serviceReviews.helpful,
          createdAt: serviceReviews.createdAt,
          updatedAt: serviceReviews.updatedAt,
        })
        .from(serviceReviews)
        .innerJoin(users, eq(serviceReviews.userId, users.id))
        .where(eq(serviceReviews.serviceId, input.serviceId))
        .orderBy(desc(serviceReviews.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return reviews;
    }),

  createServiceReview: protectedProcedure
    .input(
      z.object({
        serviceId: z.string(),
        rating: z.number().int().min(1).max(5),
        title: z.string().max(255).optional(),
        body: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify service exists
      const service = await ctx.db
        .select({ id: marketplaceServices.id })
        .from(marketplaceServices)
        .where(eq(marketplaceServices.id, input.serviceId))
        .limit(1);

      if (service.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      // Check for existing review (one per user per service)
      const existingReview = await ctx.db
        .select({ id: serviceReviews.id })
        .from(serviceReviews)
        .where(
          and(
            eq(serviceReviews.userId, userId),
            eq(serviceReviews.serviceId, input.serviceId)
          )
        )
        .limit(1);

      if (existingReview.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You have already reviewed this service",
        });
      }

      const reviewId = genId("srv");
      await ctx.db.insert(serviceReviews).values({
        id: reviewId,
        serviceId: input.serviceId,
        userId,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body ?? null,
        helpful: 0,
        createdAt: dbDate(),
        updatedAt: dbDate(),
      });

      // Recompute avgRating for the service
      const allReviews = await ctx.db
        .select({ rating: serviceReviews.rating })
        .from(serviceReviews)
        .where(eq(serviceReviews.serviceId, input.serviceId));

      const avgRating =
        allReviews.length > 0
          ? (
              allReviews.reduce((sum, r) => sum + r.rating, 0) /
              allReviews.length
            ).toFixed(2)
          : null;

      await ctx.db
        .update(marketplaceServices)
        .set({
          avgRating,
          updatedAt: dbDate(),
        })
        .where(eq(marketplaceServices.id, input.serviceId));

      logger.info(
        { serviceId: input.serviceId, userId, rating: input.rating, avgRating },
        "service review created"
      );

      return { reviewId, avgRating };
    }),

  respondToServiceReview: protectedProcedure
    .input(
      z.object({
        reviewId: z.string(),
        response: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Fetch the review
      const review = await ctx.db
        .select({
          id: serviceReviews.id,
          serviceId: serviceReviews.serviceId,
        })
        .from(serviceReviews)
        .where(eq(serviceReviews.id, input.reviewId))
        .limit(1);

      if (review.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Review not found",
        });
      }

      // Verify that the current user is the service creator
      const service = await ctx.db
        .select({
          id: marketplaceServices.id,
          creatorId: marketplaceServices.creatorId,
        })
        .from(marketplaceServices)
        .where(eq(marketplaceServices.id, review[0].serviceId))
        .limit(1);

      if (service.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service not found",
        });
      }

      // creatorId references creatorProfiles — look up the profile to get the userId
      const creatorProfile = await ctx.db
        .select({ userId: tables.creatorProfiles.userId })
        .from(tables.creatorProfiles)
        .where(eq(tables.creatorProfiles.id, service[0].creatorId))
        .limit(1);

      if (creatorProfile.length === 0 || creatorProfile[0].userId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the service creator can respond to reviews",
        });
      }

      await ctx.db
        .update(serviceReviews)
        .set({
          creatorResponse: input.response,
          creatorRespondedAt: dbDate(),
          updatedAt: dbDate(),
        })
        .where(eq(serviceReviews.id, input.reviewId));

      return { success: true };
    }),

  // ==========================================
  // ADMIN CURATION PROCEDURES
  // ==========================================

  adminFeature: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isAdmin(ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      const deployment = await ctx.db
        .select({ id: deployments.id, isPublic: deployments.isPublic })
        .from(deployments)
        .where(eq(deployments.id, input.deploymentId))
        .limit(1);

      if (deployment.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      if (!deployment[0].isPublic) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Deployment must be public to be featured",
        });
      }

      await ctx.db
        .update(deployments)
        .set({ featuredAt: new Date() })
        .where(eq(deployments.id, input.deploymentId));

      logger.info(
        { deploymentId: input.deploymentId, adminUserId: ctx.user.id },
        "deployment featured by admin"
      );

      return { success: true, deploymentId: input.deploymentId };
    }),

  adminUnfeature: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isAdmin(ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      const deployment = await ctx.db
        .select({ id: deployments.id })
        .from(deployments)
        .where(eq(deployments.id, input.deploymentId))
        .limit(1);

      if (deployment.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      await ctx.db
        .update(deployments)
        .set({ featuredAt: null })
        .where(eq(deployments.id, input.deploymentId));

      logger.info(
        { deploymentId: input.deploymentId, adminUserId: ctx.user.id },
        "deployment unfeatured by admin"
      );

      return { success: true, deploymentId: input.deploymentId };
    }),
});
