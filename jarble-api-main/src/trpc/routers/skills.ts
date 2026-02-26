import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { syncConfigsToPvc } from "../../services/configSync.js";

const { deployments, skillsCatalog, deploymentSkills } = tables;

export const skillsRouter = router({
  // List all skills in the global marketplace catalog
  listCatalog: protectedProcedure
    .input(z.object({
      runtime: z.string().optional(), // filter by runtime slug (e.g. "openclaw")
    }).optional())
    .query(async ({ ctx, input }) => {
      const all = await ctx.db.query.skillsCatalog.findMany();

      if (input?.runtime) {
        return all.filter((s) => s.runtime === input.runtime);
      }

      return all;
    }),

  // List skills installed on a specific deployment
  listForDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const installed = await ctx.db.query.deploymentSkills.findMany({
        where: eq(deploymentSkills.deploymentId, input.deploymentId),
      });

      // Resolve full skill details for each installed skill
      const skillIds = installed.map((ds) => ds.skillId);
      if (skillIds.length === 0) return [];

      const skills = await ctx.db.query.skillsCatalog.findMany();
      const skillMap = new Map(skills.map((s) => [s.id, s]));

      return installed.map((ds) => ({
        installId: ds.id,
        installedAt: ds.installedAt,
        skill: skillMap.get(ds.skillId) ?? null,
      })).filter((entry) => entry.skill !== null);
    }),

  // Install a skill on a deployment
  install: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      skillId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Verify skill exists
      const skill = await ctx.db.query.skillsCatalog.findFirst({
        where: eq(skillsCatalog.id, input.skillId),
      });

      if (!skill) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }

      // Check not already installed
      const existing = await ctx.db.query.deploymentSkills.findFirst({
        where: and(
          eq(deploymentSkills.deploymentId, input.deploymentId),
          eq(deploymentSkills.skillId, input.skillId),
        ),
      });

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Skill already installed on this deployment" });
      }

      await ctx.db.insert(deploymentSkills).values({
        id: nanoid(12),
        deploymentId: input.deploymentId,
        skillId: input.skillId,
      });

      logger.info({ deploymentId: input.deploymentId, skillId: input.skillId, skillName: skill.name }, "Skill installed");

      // Sync updated skills config to PVC if deployment is running
      if (deployment.status === "running") {
        void syncConfigsToPvc(input.deploymentId);
      }

      return { success: true };
    }),

  // Uninstall a skill from a deployment
  uninstall: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      skillId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const existing = await ctx.db.query.deploymentSkills.findFirst({
        where: and(
          eq(deploymentSkills.deploymentId, input.deploymentId),
          eq(deploymentSkills.skillId, input.skillId),
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill is not installed on this deployment" });
      }

      await ctx.db.delete(deploymentSkills)
        .where(and(
          eq(deploymentSkills.deploymentId, input.deploymentId),
          eq(deploymentSkills.skillId, input.skillId),
        ));

      logger.info({ deploymentId: input.deploymentId, skillId: input.skillId }, "Skill uninstalled");

      // Sync updated skills config to PVC if deployment is running
      if (deployment.status === "running") {
        void syncConfigsToPvc(input.deploymentId);
      }

      return { success: true };
    }),
});
