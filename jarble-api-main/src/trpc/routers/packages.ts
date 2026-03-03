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
  syncConfigsToPvc,
} from "../../services/configSync.js";

const {
  deployments,
  creatorProfiles,
  marketplaceComponents,
  componentVersions,
  componentInstalls,
  skillsCatalog,
  deploymentSkills,
  marketplacePackages,
  packageComponents,
  packageSkills,
  packageInstalls,
} = tables;

type PackageRow = InferSelectModel<typeof marketplacePackages>;

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export const packagesRouter = router({
  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      hostingModel: z.enum(["self_hosted", "remote", "hybrid"]).optional(),
      pricingModel: z.enum(["free", "paid", "freemium"]).optional(),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const allPackages = await ctx.db.query.marketplacePackages.findMany({
        where: eq(marketplacePackages.status, "published"),
      });

      let filtered = [...allPackages];
      if (input?.hostingModel) {
        filtered = filtered.filter((p) => p.hostingModel === input.hostingModel);
      }
      if (input?.pricingModel) {
        filtered = filtered.filter((p) => p.pricingModel === input.pricingModel);
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        filtered = filtered.filter((p) =>
          p.name.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q)
        );
      }

      filtered.sort((a, b) =>
        (b.totalInstalls ?? 0) - (a.totalInstalls ?? 0) || a.name.localeCompare(b.name)
      );

      const limit = input?.limit ?? 20;
      let startIdx = 0;
      if (input?.cursor) {
        const idx = filtered.findIndex((p) => p.id === input.cursor);
        if (idx >= 0) startIdx = idx + 1;
      }

      const page = filtered.slice(startIdx, startIdx + limit);
      const nextCursor = page.length === limit ? page[page.length - 1]?.id : undefined;

      const items = [];
      for (const pkg of page) {
        const compCount = (await ctx.db.query.packageComponents.findMany({
          where: eq(packageComponents.packageId, pkg.id),
        })).length;
        const skillCount = (await ctx.db.query.packageSkills.findMany({
          where: eq(packageSkills.packageId, pkg.id),
        })).length;
        const creator = await ctx.db.query.creatorProfiles.findFirst({
          where: eq(creatorProfiles.id, pkg.creatorId),
        });

        items.push({
          id: pkg.id, name: pkg.name, displayName: pkg.displayName,
          description: pkg.description, hostingModel: pkg.hostingModel,
          status: pkg.status, pricingModel: pkg.pricingModel,
          priceUsdCents: pkg.priceUsdCents, totalInstalls: pkg.totalInstalls,
          avgRating: pkg.avgRating, componentCount: compCount, skillCount: skillCount,
          creator: creator ? { id: creator.id, displayName: creator.displayName } : null,
          createdAt: pkg.createdAt,
        });
      }

      return { items, nextCursor };
    }),

  get: publicProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      }

      const pkgComps = await ctx.db.query.packageComponents.findMany({
        where: eq(packageComponents.packageId, pkg.id),
      });
      const components = [];
      for (const pc of pkgComps) {
        const comp = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, pc.componentId),
        });
        if (comp) {
          components.push({
            id: comp.id, name: comp.name, displayName: comp.displayName,
            description: comp.description, tier: comp.tier, category: comp.category,
          });
        }
      }

      const pkgSkills = await ctx.db.query.packageSkills.findMany({
        where: eq(packageSkills.packageId, pkg.id),
      });
      const skills = [];
      for (const ps of pkgSkills) {
        const skill = await ctx.db.query.skillsCatalog.findFirst({
          where: eq(skillsCatalog.id, ps.skillId),
        });
        if (skill) {
          skills.push({ id: skill.id, name: skill.name, description: skill.description });
        }
      }

      const creator = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.id, pkg.creatorId),
      });

      return {
        ...pkg, components, skills,
        creator: creator ? { id: creator.id, displayName: creator.displayName, bio: creator.bio } : null,
      };
    }),

  install: protectedProcedure
    .input(z.object({ packageId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: and(
          eq(marketplacePackages.id, input.packageId),
          eq(marketplacePackages.status, "published"),
        ),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found or not published" });
      }

      const existingInstall = await ctx.db.query.packageInstalls.findFirst({
        where: and(
          eq(packageInstalls.packageId, input.packageId),
          eq(packageInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (existingInstall) {
        throw new TRPCError({ code: "CONFLICT", message: "Package is already installed on this deployment" });
      }

      const pkgComps = await ctx.db.query.packageComponents.findMany({
        where: eq(packageComponents.packageId, pkg.id),
      });
      const pkgSkillRows = await ctx.db.query.packageSkills.findMany({
        where: eq(packageSkills.packageId, pkg.id),
      });

      // Create package install record
      await ctx.db.insert(packageInstalls).values({
        id: generateId("pki"),
        packageId: input.packageId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        installedAt: dbDate(),
      });

      // Install each component (skip if already installed individually)
      const installedComponents: string[] = [];
      for (const pc of pkgComps) {
        const existing = await ctx.db.query.componentInstalls.findFirst({
          where: and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, input.deploymentId),
          ),
        });
        if (existing) continue;

        const versions = await ctx.db.query.componentVersions.findMany({
          where: eq(componentVersions.componentId, pc.componentId),
        });
        if (versions.length === 0) continue;

        const sorted = versions.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        await ctx.db.insert(componentInstalls).values({
          id: generateId("ci"),
          componentId: pc.componentId,
          deploymentId: input.deploymentId,
          versionId: sorted[0].id,
          userId: ctx.user.id,
          installedAt: dbDate(),
        });

        await ctx.db
          .update(marketplaceComponents)
          .set({ totalInstalls: sql`${marketplaceComponents.totalInstalls} + 1` as any })
          .where(eq(marketplaceComponents.id, pc.componentId));

        installedComponents.push(pc.componentId);
      }

      // Install each skill (skip if already installed)
      const installedSkills: string[] = [];
      for (const ps of pkgSkillRows) {
        const existing = await ctx.db.query.deploymentSkills.findFirst({
          where: and(
            eq(deploymentSkills.skillId, ps.skillId),
            eq(deploymentSkills.deploymentId, input.deploymentId),
          ),
        });
        if (existing) continue;

        await ctx.db.insert(deploymentSkills).values({
          id: generateId("ds"),
          skillId: ps.skillId,
          deploymentId: input.deploymentId,
          installedAt: dbDate(),
        });

        installedSkills.push(ps.skillId);
      }

      // Increment package install count
      await ctx.db
        .update(marketplacePackages)
        .set({ totalInstalls: sql`${marketplacePackages.totalInstalls} + 1` as any })
        .where(eq(marketplacePackages.id, input.packageId));

      logger.info({
        packageId: input.packageId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        installedComponents: installedComponents.length,
        installedSkills: installedSkills.length,
      }, "Package installed");

      // Fire-and-forget: sync components + skills to pod
      if (deployment.status === "running") {
        for (const compId of installedComponents) {
          const comp = await ctx.db.query.marketplaceComponents.findFirst({
            where: eq(marketplaceComponents.id, compId),
          });
          if (!comp) continue;

          const versions = await ctx.db.query.componentVersions.findMany({
            where: eq(componentVersions.componentId, compId),
          });
          const latestVersion = versions.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];

          void syncMarketplaceComponent(
            input.deploymentId, compId,
            {
              name: comp.name, displayName: comp.displayName,
              description: comp.description, tier: comp.tier,
              category: comp.category, propsSchema: comp.propsSchema,
              version: latestVersion?.version ?? "1.0.0",
            },
            comp.exampleProps ?? comp.propsSchema ?? "",
            comp.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error({ err, componentId: compId, deploymentId: input.deploymentId },
              "packages.install: failed to sync component (non-fatal)")
          );
        }

        if (installedSkills.length > 0) {
          void syncConfigsToPvc(input.deploymentId).catch((err) =>
            logger.error({ err, deploymentId: input.deploymentId },
              "packages.install: failed to sync skill configs (non-fatal)")
          );
        }
      }

      return {
        success: true as const,
        installedComponents: installedComponents.length,
        installedSkills: installedSkills.length,
      };
    }),

  uninstall: protectedProcedure
    .input(z.object({ packageId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const install = await ctx.db.query.packageInstalls.findFirst({
        where: and(
          eq(packageInstalls.packageId, input.packageId),
          eq(packageInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package is not installed on this deployment" });
      }

      const pkgComps = await ctx.db.query.packageComponents.findMany({
        where: eq(packageComponents.packageId, input.packageId),
      });
      const pkgSkillRows = await ctx.db.query.packageSkills.findMany({
        where: eq(packageSkills.packageId, input.packageId),
      });

      let removedComponents = 0;
      for (const pc of pkgComps) {
        const compInstall = await ctx.db.query.componentInstalls.findFirst({
          where: and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, input.deploymentId),
          ),
        });
        if (compInstall) {
          await ctx.db.delete(componentInstalls)
            .where(and(
              eq(componentInstalls.componentId, pc.componentId),
              eq(componentInstalls.deploymentId, input.deploymentId),
            ));
          removedComponents++;
        }
      }

      let removedSkills = 0;
      for (const ps of pkgSkillRows) {
        const skillInstall = await ctx.db.query.deploymentSkills.findFirst({
          where: and(
            eq(deploymentSkills.skillId, ps.skillId),
            eq(deploymentSkills.deploymentId, input.deploymentId),
          ),
        });
        if (skillInstall) {
          await ctx.db.delete(deploymentSkills)
            .where(and(
              eq(deploymentSkills.skillId, ps.skillId),
              eq(deploymentSkills.deploymentId, input.deploymentId),
            ));
          removedSkills++;
        }
      }

      await ctx.db.delete(packageInstalls)
        .where(and(
          eq(packageInstalls.packageId, input.packageId),
          eq(packageInstalls.deploymentId, input.deploymentId),
        ));

      logger.info({
        packageId: input.packageId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        removedComponents,
        removedSkills,
      }, "Package uninstalled");

      if (deployment.status === "running" && (removedComponents > 0 || removedSkills > 0)) {
        void syncConfigsToPvc(input.deploymentId).catch((err) =>
          logger.error({ err, deploymentId: input.deploymentId },
            "packages.uninstall: failed to sync config after uninstall (non-fatal)")
        );
      }

      return { success: true as const, removedComponents, removedSkills };
    }),

  listInstalled: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const installs = await ctx.db.query.packageInstalls.findMany({
        where: eq(packageInstalls.deploymentId, input.deploymentId),
      });

      const results = [];
      for (const inst of installs) {
        const pkg = await ctx.db.query.marketplacePackages.findFirst({
          where: eq(marketplacePackages.id, inst.packageId),
        });
        if (!pkg) continue;
        results.push({
          installId: inst.id, installedAt: inst.installedAt,
          package: {
            id: pkg.id, name: pkg.name, displayName: pkg.displayName,
            description: pkg.description, hostingModel: pkg.hostingModel,
          },
        });
      }

      return results;
    }),

  publish: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Package name must be lowercase alphanumeric with hyphens"),
      displayName: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      hostingModel: z.enum(["self_hosted", "remote", "hybrid"]),
      instructionSnippet: z.string().max(5000).optional(),
      remoteApiEndpoint: z.string().url().max(500).optional(),
      pricingModel: z.enum(["free", "paid", "freemium"]).default("free"),
      priceUsdCents: z.number().int().min(0).default(0),
      componentIds: z.array(z.string()).default([]),
      skillIds: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You must create a creator profile before publishing packages",
        });
      }

      const existing = await ctx.db.query.marketplacePackages.findFirst({
        where: and(
          eq(marketplacePackages.creatorId, profile.id),
          eq(marketplacePackages.name, input.name),
        ),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a package with this name" });
      }

      for (const compId of input.componentIds) {
        const comp = await ctx.db.query.marketplaceComponents.findFirst({
          where: and(
            eq(marketplaceComponents.id, compId),
            eq(marketplaceComponents.status, "published"),
          ),
        });
        if (!comp) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Component ${compId} not found or not published` });
        }
      }

      for (const skillId of input.skillIds) {
        const skill = await ctx.db.query.skillsCatalog.findFirst({
          where: eq(skillsCatalog.id, skillId),
        });
        if (!skill) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Skill ${skillId} not found` });
        }
      }

      if (input.componentIds.length === 0 && input.skillIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Package must contain at least one component or skill",
        });
      }

      const packageId = generateId("pkg");
      await ctx.db.insert(marketplacePackages).values({
        id: packageId,
        creatorId: profile.id,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        hostingModel: input.hostingModel,
        instructionSnippet: input.instructionSnippet ?? null,
        remoteApiEndpoint: input.remoteApiEndpoint ?? null,
        status: "published",
        pricingModel: input.pricingModel,
        priceUsdCents: input.priceUsdCents,
        createdAt: dbDate(),
        updatedAt: dbDate(),
      });

      for (const compId of input.componentIds) {
        await ctx.db.insert(packageComponents).values({
          id: generateId("pkc"), packageId, componentId: compId,
        });
      }

      for (const skillId of input.skillIds) {
        await ctx.db.insert(packageSkills).values({
          id: generateId("pks"), packageId, skillId,
        });
      }

      logger.info({
        packageId, name: input.name,
        components: input.componentIds.length,
        skills: input.skillIds.length,
        userId: ctx.user.id,
      }, "Package published");

      return { packageId };
    }),

  listByCreator: publicProcedure
    .input(z.object({ creatorId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await ctx.db.query.marketplacePackages.findMany({
        where: and(
          eq(marketplacePackages.creatorId, input.creatorId),
          eq(marketplacePackages.status, "published"),
        ),
      });

      return packages.map((p) => ({
        id: p.id, name: p.name, displayName: p.displayName,
        description: p.description, hostingModel: p.hostingModel,
        pricingModel: p.pricingModel, priceUsdCents: p.priceUsdCents,
        totalInstalls: p.totalInstalls, avgRating: p.avgRating,
        createdAt: p.createdAt,
      }));
    }),
});
