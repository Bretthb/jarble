/**
 * Public REST API
 *
 * Unauthenticated endpoints for leaderboard and agent profile data.
 * These mirror the tRPC benchmarks router but are accessible via plain REST
 * for external consumers (embed widgets, partner integrations, etc.).
 *
 * GET /leaderboard/:domainSlug  — Domain leaderboard with forkability scores
 * GET /agents/:deploymentId/profile — Public agent profile
 */

import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { computeForkabilityScore, type ForkabilityInput } from "../utils/forkability.js";

const logger = createModuleLogger("public-api");

const {
  domains,
  deployments,
  deploymentDomainScores,
  marketplaceServices,
  serviceInstalls,
} = tables;

export const publicApiRouter = Router();

/**
 * GET /leaderboard/:domainSlug
 *
 * Query params:
 *   metric?: "overall" | "accuracy" | "helpfulness" | "creativity" (default "overall")
 *   limit?:  number 1-100 (default 25)
 */
publicApiRouter.get("/leaderboard/:domainSlug", async (req, res) => {
  try {
    const { domainSlug } = req.params;
    const metric = (req.query.metric as string) || "overall";
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);

    // Validate metric
    const validMetrics = ["overall", "accuracy", "helpfulness", "creativity"] as const;
    if (!validMetrics.includes(metric as any)) {
      res.status(400).json({ error: `Invalid metric. Must be one of: ${validMetrics.join(", ")}` });
      return;
    }

    // Look up domain by slug
    const domain = await db
      .select({ id: domains.id, displayName: domains.displayName })
      .from(domains)
      .where(eq(domains.name, domainSlug))
      .limit(1);

    if (domain.length === 0) {
      res.status(404).json({ error: `Domain '${domainSlug}' not found` });
      return;
    }

    const domainId = domain[0].id;

    // Determine sort column
    const metricColumn = {
      overall: deploymentDomainScores.overallScore,
      accuracy: deploymentDomainScores.avgAccuracy,
      helpfulness: deploymentDomainScores.avgHelpfulness,
      creativity: deploymentDomainScores.avgCreativity,
    }[metric as typeof validMetrics[number]];

    // Query scores joined with deployments — public + minimum 3 ratings
    const results = await db
      .select({
        deploymentId: deploymentDomainScores.deploymentId,
        deploymentName: deployments.name,
        deploymentDescription: deployments.description,
        specialties: deployments.specialties,
        bio: deployments.bio,
        showcasePrompts: deployments.showcasePrompts,
        featuredAt: deployments.featuredAt,
        forkCount: deployments.forkCount,
        isPublic: deployments.isPublic,
        overallScore: deploymentDomainScores.overallScore,
        avgAccuracy: deploymentDomainScores.avgAccuracy,
        avgHelpfulness: deploymentDomainScores.avgHelpfulness,
        avgCreativity: deploymentDomainScores.avgCreativity,
        ratingCount: deploymentDomainScores.ratingCount,
        confidence: deploymentDomainScores.confidence,
      })
      .from(deploymentDomainScores)
      .innerJoin(deployments, eq(deploymentDomainScores.deploymentId, deployments.id))
      .where(
        and(
          eq(deploymentDomainScores.domainId, domainId),
          eq(deployments.isPublic, true),
          sql`${deploymentDomainScores.ratingCount} >= 3`
        )
      )
      .orderBy(desc(metricColumn))
      .limit(limit);

    const entries = results.map((r, idx) => {
      const forkabilityInput: ForkabilityInput = {
        isPublic: !!r.isPublic,
        bio: r.bio,
        specialties: r.specialties,
        showcasePrompts: r.showcasePrompts,
        featuredAt: r.featuredAt ? new Date(r.featuredAt as any) : null,
        bestDomainScore: {
          overallScore: r.overallScore ?? 0,
          ratingCount: r.ratingCount ?? 0,
          confidence: (r.confidence as string) ?? "low",
        },
      };

      return {
        rank: idx + 1,
        deploymentId: r.deploymentId,
        name: r.deploymentName,
        description: r.deploymentDescription,
        specialties: safeJsonParse(r.specialties, []),
        bio: r.bio,
        scores: {
          overall: r.overallScore,
          accuracy: r.avgAccuracy,
          helpfulness: r.avgHelpfulness,
          creativity: r.avgCreativity,
        },
        ratingCount: r.ratingCount,
        confidence: r.confidence,
        forkCount: r.forkCount,
        forkabilityScore: computeForkabilityScore(forkabilityInput),
      };
    });

    res.set("Cache-Control", "public, max-age=60");
    res.json({
      domain: { name: domain[0].displayName, slug: domainSlug },
      metric,
      entries,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Leaderboard query failed");
    res.status(500).json({ error: "Leaderboard query failed" });
  }
});

/**
 * GET /agents/:deploymentId/profile
 *
 * Returns the full public profile for a deployment, including domain scores,
 * installed services, and forkability score.
 */
publicApiRouter.get("/agents/:deploymentId/profile", async (req, res) => {
  try {
    const { deploymentId } = req.params;

    // Fetch deployment — must be public
    const deployment = await db
      .select({
        id: deployments.id,
        name: deployments.name,
        description: deployments.description,
        runtime: deployments.runtime,
        isPublic: deployments.isPublic,
        specialties: deployments.specialties,
        bio: deployments.bio,
        showcasePrompts: deployments.showcasePrompts,
        forkCount: deployments.forkCount,
        forkedFromId: deployments.forkedFromId,
        featuredAt: deployments.featuredAt,
      })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);

    if (deployment.length === 0 || !deployment[0].isPublic) {
      res.status(404).json({ error: "Deployment not found or not public" });
      return;
    }

    const dep = deployment[0];

    // Get domain scores
    const scores = await db
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
      .where(eq(deploymentDomainScores.deploymentId, deploymentId))
      .orderBy(desc(deploymentDomainScores.overallScore));

    // Get installed services
    const installedServices = await db
      .select({
        serviceName: marketplaceServices.displayName,
      })
      .from(serviceInstalls)
      .innerJoin(marketplaceServices, eq(serviceInstalls.packageId, marketplaceServices.id))
      .where(eq(serviceInstalls.deploymentId, deploymentId));

    // Find the best domain score for forkability calculation
    const bestScore = scores.length > 0 ? scores[0] : null;

    const forkabilityInput: ForkabilityInput = {
      isPublic: true,
      bio: dep.bio,
      specialties: dep.specialties,
      showcasePrompts: dep.showcasePrompts,
      featuredAt: dep.featuredAt ? new Date(dep.featuredAt as any) : null,
      bestDomainScore: bestScore
        ? {
            overallScore: bestScore.overallScore ?? 0,
            ratingCount: bestScore.ratingCount ?? 0,
            confidence: (bestScore.confidence as string) ?? "low",
          }
        : null,
    };

    res.set("Cache-Control", "public, max-age=30");
    res.json({
      id: dep.id,
      name: dep.name,
      description: dep.description,
      runtime: dep.runtime,
      specialties: safeJsonParse(dep.specialties, []),
      bio: dep.bio,
      showcasePrompts: safeJsonParse(dep.showcasePrompts, []),
      forkCount: dep.forkCount,
      forkedFromId: dep.forkedFromId,
      featuredAt: dep.featuredAt,
      forkabilityScore: computeForkabilityScore(forkabilityInput),
      installedServices: installedServices.map((s) => s.serviceName),
      domainScores: scores,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Agent profile query failed");
    res.status(500).json({ error: "Agent profile query failed" });
  }
});

/** Safely parse a JSON string, returning fallback on failure */
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
