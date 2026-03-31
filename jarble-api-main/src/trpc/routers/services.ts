import { z } from "zod";
import crypto from "crypto";
import { router, publicProcedure, protectedProcedure } from "../middleware.js";
import { tables, dbDate } from "../../db/index.js";
import type { InferSelectModel } from "drizzle-orm";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createModuleLogger } from "../../utils/logger.js";
import {
  syncMarketplaceComponent,
  syncConfigsToPvc,
} from "../../services/configSync.js";
import { validatePropsSchema } from "../../utils/schemaValidation.js";
import { isAdmin } from "../../utils/admin.js";
import { serviceCardSchema, type ServiceCard } from "../../services/serviceCard.js";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption.js";
import { generateSigningSecret, signRequest } from "../../utils/hmac.js";
import { performInstallHandshake } from "../../services/serviceHandshake.js";

const logger = createModuleLogger("services");

const {
  deployments,
  creatorProfiles,
  marketplaceComponents,
  componentVersions,
  componentInstalls,
  skillsCatalog,
  deploymentSkills,
  marketplaceServices,
  serviceComponents,
  serviceSkills,
  serviceInstalls,
  serviceCredentials,
  serviceUsage,
} = tables;

type ServiceRow = InferSelectModel<typeof marketplaceServices>;

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function assertAdmin(userId: string): void {
  if (!isAdmin(userId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
}

/**
 * Build a component definition in define_component format from a marketplace
 * component row. Used when syncing components to pod PVC.
 */
function buildComponentDefinition(comp: { name: string; description: string; botDescription: string | null; tier: string; exampleProps: string | null }): Record<string, unknown> | null {
  if (!comp.exampleProps) return null;
  try {
    const parsed = JSON.parse(comp.exampleProps);
    if (comp.tier === "template" && Array.isArray(parsed.layout)) {
      return { name: comp.name, description: comp.botDescription || comp.description, layout: parsed.layout };
    }
    if (comp.tier === "sandbox" && typeof parsed.html === "string") {
      return {
        name: comp.name, description: comp.botDescription || comp.description,
        layout: [{ component: "sandbox", props: { html: parsed.html, css: parsed.css || "", js: parsed.js || "", title: "{{title}}", libraries: parsed.libraries || [] } }],
      };
    }
  } catch { /* non-fatal */ }
  return null;
}

/**
 * Send a signed webhook to a creator's API endpoint.
 *
 * Signs the JSON body using HMAC-SHA256 (via `signRequest`) and includes
 * the standard `X-Jarble-Signature` / `X-Jarble-Timestamp` headers.
 *
 * @param endpoint - Creator API base URL (from ServiceCard).
 * @param path     - Webhook path to append, e.g. "/jarble/uninstall".
 * @param body     - JSON-serializable payload.
 * @param secret   - Plaintext HMAC-SHA256 signing secret.
 * @param timeoutMs - Request timeout in milliseconds (default 15s).
 */
async function sendSignedWebhook(
  endpoint: string,
  path: string,
  body: Record<string, unknown>,
  secret: string,
  timeoutMs = 15_000,
): Promise<Response> {
  const url = `${endpoint.replace(/\/+$/, "")}${path}`;
  const bodyStr = JSON.stringify(body);
  const timestamp = Date.now();
  const signature = signRequest(secret, timestamp, bodyStr);

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Jarble-Signature": signature,
      "X-Jarble-Timestamp": String(timestamp),
    },
    body: bodyStr,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export const servicesRouter = router({
  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      hostingModel: z.enum(["self_hosted", "remote", "hybrid"]).optional(),
      pricingModel: z.enum(["free", "paid", "freemium"]).optional(),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const allPackages = await ctx.db.query.marketplaceServices.findMany({
        where: eq(marketplaceServices.status, "published"),
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

      const items: Array<{
        id: string; name: string; displayName: string; description: string | null;
        hostingModel: string; status: string; pricingModel: string; priceUsdCents: number;
        totalInstalls: number; avgRating: string | null; componentCount: number; skillCount: number;
        creator: { id: string; displayName: string } | null; createdAt: Date;
      }> = [];
      for (const pkg of page) {
        const compCount = (await ctx.db.query.serviceComponents.findMany({
          where: eq(serviceComponents.packageId, pkg.id),
        })).length;
        const skillCount = (await ctx.db.query.serviceSkills.findMany({
          where: eq(serviceSkills.packageId, pkg.id),
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
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }

      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, pkg.id),
      });
      const components: Array<{
        id: string; name: string; displayName: string; description: string; tier: string; category: string;
      }> = [];
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

      const pkgSkills = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, pkg.id),
      });
      const skills: Array<{ id: string; name: string; description: string | null }> = [];
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
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: and(
          eq(marketplaceServices.id, input.serviceId),
          eq(marketplaceServices.status, "published"),
        ),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found or not published" });
      }

      const existingInstall = await ctx.db.query.serviceInstalls.findFirst({
        where: and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (existingInstall) {
        throw new TRPCError({ code: "CONFLICT", message: "Service is already installed on this deployment" });
      }

      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, pkg.id),
      });
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, pkg.id),
      });

      // Validate component compatibility with deployment runtime.
      // Marketplace components rely on the MCP UI server which is only
      // available on openclaw-based runtimes. Warn for non-openclaw runtimes.
      if (pkgComps.length > 0 && deployment.runtime !== "openclaw") {
        logger.warn({
          deploymentId: input.deploymentId,
          runtime: deployment.runtime,
          componentCount: pkgComps.length,
        }, "Service contains UI components but deployment runtime is not openclaw - components may not render");
      }

      // Verify all service components are still published
      for (const pc of pkgComps) {
        const comp = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, pc.componentId),
        });
        if (!comp || (comp.status !== "published" && comp.status !== "approved")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Component ${pc.componentId} is no longer available (status: ${comp?.status ?? "missing"})`,
          });
        }
      }

      // Create package install record
      const installId = generateId("pki");
      await ctx.db.insert(serviceInstalls).values({
        id: installId,
        packageId: input.serviceId,
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
        .update(marketplaceServices)
        .set({ totalInstalls: sql`${marketplaceServices.totalInstalls} + 1` as any })
        .where(eq(marketplaceServices.id, input.serviceId));

      logger.info({
        packageId: input.serviceId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        installedComponents: installedComponents.length,
        installedSkills: installedSkills.length,
      }, "Service installed");

      // ── Remote/Hybrid package handshake ──────────────────────────────────
      // For remote or hybrid packages, parse the ServiceCard, generate an HMAC
      // signing secret, store encrypted credentials, and perform the install
      // handshake with the creator's API endpoint.
      let handshakeStatus: "completed" | "failed" | "skipped" = "skipped";
      const isRemote = pkg.hostingModel === "remote" || pkg.hostingModel === "hybrid";

      if (isRemote) {
        // Parse and validate the ServiceCard from the stored JSON
        let card: ServiceCard | null = null;
        const rawConfig = (pkg as Record<string, unknown>).remoteApiConfig as string | null;
        if (rawConfig) {
          const parsed = serviceCardSchema.safeParse(JSON.parse(rawConfig));
          if (parsed.success) {
            card = parsed.data;
          } else {
            logger.warn({ packageId: input.serviceId, errors: parsed.error.issues },
              "packages.install: invalid remoteApiConfig (non-fatal)");
          }
        }

        if (card) {
          // Generate HMAC-SHA256 signing secret
          const signingSecret = generateSigningSecret();

          // Store encrypted credentials
          const credId = generateId("pkc");
          await ctx.db.insert(serviceCredentials).values({
            id: credId,
            packageInstallId: installId,
            deploymentId: input.deploymentId,
            packageId: input.serviceId,
            signingSecret: encryptApiKey(signingSecret),
            handshakeStatus: "pending",
            createdAt: dbDate(),
            updatedAt: dbDate(),
          } as any);

          // Perform the install handshake (fire-and-forget, only for services with an endpoint)
          if (card!.endpoint) void (async () => {
            try {
              const result = await performInstallHandshake({
                endpoint: card!.endpoint!,
                serviceId: input.serviceId,
                deploymentId: input.deploymentId,
                signingSecret,
              });

              await ctx.db
                .update(serviceCredentials)
                .set({
                  handshakeStatus: "completed",
                  remoteInstallId: result.remoteInstallId ?? null,
                  updatedAt: dbDate(),
                } as any)
                .where(eq(serviceCredentials.id, credId));

              handshakeStatus = "completed";
              logger.info({ packageId: input.serviceId, credId }, "Remote handshake completed");
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : "Unknown error";
              await ctx.db
                .update(serviceCredentials)
                .set({
                  handshakeStatus: "failed",
                  handshakeError: errorMsg.slice(0, 500),
                  updatedAt: dbDate(),
                } as any)
                .where(eq(serviceCredentials.id, credId));

              handshakeStatus = "failed";
              logger.warn({ packageId: input.serviceId, credId, err },
                "packages.install: remote handshake failed (non-fatal)");
            }
          })();
        }
      }

      // Fire-and-forget: sync components + configs to pod
      // Always sync configs when a package is installed - packageSnippets need to
      // be appended to soul.md, and skills need config files on the PVC.
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
            comp.name,
            {
              name: comp.name, displayName: comp.displayName,
              description: comp.description, tier: comp.tier,
              category: comp.category,
              propsSchema: comp.propsSchema ? JSON.parse(comp.propsSchema) : null,
              version: latestVersion?.version ?? "1.0.0",
            },
            buildComponentDefinition(comp),
            comp.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error({ err, componentId: compId, deploymentId: input.deploymentId },
              "packages.install: failed to sync component (non-fatal)")
          );
        }

        // Sync configs to PVC - writes skill files + rebuilds soul.md with packageSnippets
        void syncConfigsToPvc(input.deploymentId).catch((err) =>
          logger.error({ err, deploymentId: input.deploymentId },
            "packages.install: failed to sync configs (non-fatal)")
        );
      }

      return {
        success: true as const,
        installedComponents: installedComponents.length,
        installedSkills: installedSkills.length,
        handshakeStatus,
      };
    }),

  uninstall: protectedProcedure
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const install = await ctx.db.query.serviceInstalls.findFirst({
        where: and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service is not installed on this deployment" });
      }

      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, input.serviceId),
      });
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, input.serviceId),
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

          // Decrement totalInstalls (floor at 0)
          await ctx.db
            .update(marketplaceComponents)
            .set({ totalInstalls: sql`MAX(${marketplaceComponents.totalInstalls} - 1, 0)` as any })
            .where(eq(marketplaceComponents.id, pc.componentId));

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

      // ── Remote/Hybrid uninstall webhook ──────────────────────────────────
      // For remote/hybrid packages, notify the creator's API BEFORE deleting
      // the credentials (we need the signing secret to authenticate the request).
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      const isRemote = pkg?.hostingModel === "remote" || pkg?.hostingModel === "hybrid";

      if (isRemote && pkg) {
        const cred = await ctx.db.query.serviceCredentials.findFirst({
          where: and(
            eq(serviceCredentials.deploymentId, input.deploymentId),
            eq(serviceCredentials.packageId, input.serviceId),
          ),
        });

        if (cred) {
          // Parse the ServiceCard to get the endpoint
          const rawConfig = (pkg as Record<string, unknown>).remoteApiConfig as string | null;
          if (rawConfig) {
            const parsed = serviceCardSchema.safeParse(JSON.parse(rawConfig));
            if (parsed.success && parsed.data.endpoint) {
              const uninstallBody = {
                action: "uninstall" as const,
                serviceId: input.serviceId,
                deploymentId: input.deploymentId,
                timestamp: new Date().toISOString(),
              };

              try {
                const secret = decryptApiKey(cred.signingSecret);
                const res = await sendSignedWebhook(
                  parsed.data.endpoint,
                  "/jarble/uninstall",
                  uninstallBody,
                  secret,
                );
                if (!res.ok) {
                  logger.warn(
                    { packageId: input.serviceId, status: res.status },
                    "Creator uninstall webhook returned non-OK (proceeding with uninstall)",
                  );
                } else {
                  logger.info(
                    { packageId: input.serviceId, deploymentId: input.deploymentId },
                    "Creator uninstall webhook acknowledged",
                  );
                }
              } catch (err) {
                // Fire-and-forget: don't fail the uninstall if the webhook fails
                logger.warn(
                  { packageId: input.serviceId, deploymentId: input.deploymentId, err },
                  "Creator uninstall webhook failed (proceeding with uninstall)",
                );
              }
            }
          }

          // Delete the credentials AFTER sending the webhook
          await ctx.db.delete(serviceCredentials)
            .where(eq(serviceCredentials.id, cred.id));
        }
      }

      await ctx.db.delete(serviceInstalls)
        .where(and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ));

      // Decrement service totalInstalls (floor at 0)
      await ctx.db
        .update(marketplaceServices)
        .set({ totalInstalls: sql`MAX(${marketplaceServices.totalInstalls} - 1, 0)` as any })
        .where(eq(marketplaceServices.id, input.serviceId));

      logger.info({
        packageId: input.serviceId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        removedComponents,
        removedSkills,
      }, "Service uninstalled");

      // Always sync configs on uninstall - removes package snippet from soul.md
      // and cleans up skill config files from PVC
      if (deployment.status === "running") {
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

      const installs = await ctx.db.query.serviceInstalls.findMany({
        where: eq(serviceInstalls.deploymentId, input.deploymentId),
      });

      const results: Array<{
        installId: string; installedAt: Date;
        package: { id: string; name: string; displayName: string; description: string | null; hostingModel: string };
      }> = [];
      for (const inst of installs) {
        const pkg = await ctx.db.query.marketplaceServices.findFirst({
          where: eq(marketplaceServices.id, inst.packageId),
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
      name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Service name must be lowercase alphanumeric with hyphens"),
      displayName: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      hostingModel: z.enum(["self_hosted", "remote", "hybrid"]),
      instructionSnippet: z.string().max(5000).optional(),
      remoteApiEndpoint: z.string().url().max(500).optional(),
      remoteApiConfig: z.string().optional(), // JSON string of ServiceCard (required for remote/hybrid)
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
          message: "You must create a creator profile before publishing services",
        });
      }

      const existing = await ctx.db.query.marketplaceServices.findFirst({
        where: and(
          eq(marketplaceServices.creatorId, profile.id),
          eq(marketplaceServices.name, input.name),
        ),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a service with this name" });
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
        // Validate component has a valid JSON Schema for its props
        if (comp.propsSchema) {
          try {
            validatePropsSchema(comp.propsSchema);
          } catch (err) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Component "${comp.name}" has invalid propsSchema: ${(err as Error).message}`,
            });
          }
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
          message: "Service must contain at least one component or skill",
        });
      }

      // Validate remoteApiConfig for remote/hybrid packages
      if (
        (input.hostingModel === "remote" || input.hostingModel === "hybrid") &&
        input.remoteApiConfig
      ) {
        try {
          serviceCardSchema.parse(JSON.parse(input.remoteApiConfig));
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid ServiceCard config: ${err instanceof Error ? err.message : "parse error"}`,
          });
        }
      }

      const serviceId = generateId("pkg");
      await ctx.db.insert(marketplaceServices).values({
        id: serviceId,
        creatorId: profile.id,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        hostingModel: input.hostingModel,
        instructionSnippet: input.instructionSnippet ?? null,
        remoteApiEndpoint: input.remoteApiEndpoint ?? null,
        remoteApiConfig: input.remoteApiConfig ?? null,
        status: "pending_review",
        pricingModel: input.pricingModel,
        priceUsdCents: input.priceUsdCents,
        createdAt: dbDate(),
        updatedAt: dbDate(),
      });

      for (const compId of input.componentIds) {
        await ctx.db.insert(serviceComponents).values({
          id: generateId("pkc"), packageId: serviceId, componentId: compId,
        });
      }

      for (const skillId of input.skillIds) {
        await ctx.db.insert(serviceSkills).values({
          id: generateId("pks"), packageId: serviceId, skillId,
        });
      }

      logger.info({
        serviceId, name: input.name,
        components: input.componentIds.length,
        skills: input.skillIds.length,
        userId: ctx.user.id,
      }, "Service submitted for review");

      return { serviceId };
    }),

  listByCreator: publicProcedure
    .input(z.object({ creatorId: z.string() }))
    .query(async ({ ctx, input }) => {
      const packages = await ctx.db.query.marketplaceServices.findMany({
        where: and(
          eq(marketplaceServices.creatorId, input.creatorId),
          eq(marketplaceServices.status, "published"),
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

  // ── Package Status & Upgrade ─────────────────────────────────────────────

  getServiceStatus: protectedProcedure
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Look up serviceInstalls for this deployment+package
      const install = await ctx.db.query.serviceInstalls.findFirst({
        where: and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        return { installed: false as const };
      }

      // 3. Look up the package itself
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }

      // 4. Look up serviceCredentials (if remote/hybrid)
      const creds = await ctx.db.query.serviceCredentials.findFirst({
        where: and(
          eq(serviceCredentials.packageId, input.serviceId),
          eq(serviceCredentials.deploymentId, input.deploymentId),
        ),
      });

      // 5. Look up which components are in the package and how many are installed
      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, input.serviceId),
      });
      let installedComponentCount = 0;
      for (const pc of pkgComps) {
        const compInstall = await ctx.db.query.componentInstalls.findFirst({
          where: and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, input.deploymentId),
          ),
        });
        if (compInstall) installedComponentCount++;
      }

      // 6. Look up which skills are in the package and how many are installed
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, input.serviceId),
      });
      let installedSkillCount = 0;
      for (const ps of pkgSkillRows) {
        const skillInstall = await ctx.db.query.deploymentSkills.findFirst({
          where: and(
            eq(deploymentSkills.skillId, ps.skillId),
            eq(deploymentSkills.deploymentId, input.deploymentId),
          ),
        });
        if (skillInstall) installedSkillCount++;
      }

      // 7. Return comprehensive status
      return {
        installed: true as const,
        installedAt: install.installedAt,
        package: {
          id: pkg.id,
          name: pkg.name,
          displayName: pkg.displayName,
          hostingModel: pkg.hostingModel,
        },
        handshake: creds
          ? {
              status: creds.handshakeStatus,
              error: creds.handshakeError ?? null,
            }
          : null,
        components: {
          total: pkgComps.length,
          installed: installedComponentCount,
        },
        skills: {
          total: pkgSkillRows.length,
          installed: installedSkillCount,
        },
        health: pkg.remoteHealth ?? null,
      };
    }),

  checkForUpdates: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Get all installed packages for this deployment
      const installs = await ctx.db.query.serviceInstalls.findMany({
        where: eq(serviceInstalls.deploymentId, input.deploymentId),
      });

      const updates: Array<{
        serviceId: string;
        serviceName: string;
        displayName: string;
        installedAt: string | Date;
        serviceUpdatedAt: string | Date;
        newComponents: number;
        newSkills: number;
      }> = [];

      for (const inst of installs) {
        const pkg = await ctx.db.query.marketplaceServices.findFirst({
          where: eq(marketplaceServices.id, inst.packageId),
        });
        if (!pkg) continue;

        // 3. Check if package has been updated since install
        const pkgUpdatedAt = pkg.updatedAt;
        const installedAt = inst.installedAt;
        const packageWasUpdated =
          new Date(pkgUpdatedAt).getTime() > new Date(installedAt).getTime();

        // 4. Check for new components added since install (not yet installed on this deployment)
        const pkgComps = await ctx.db.query.serviceComponents.findMany({
          where: eq(serviceComponents.packageId, pkg.id),
        });
        let newComponents = 0;
        for (const pc of pkgComps) {
          const compInstall = await ctx.db.query.componentInstalls.findFirst({
            where: and(
              eq(componentInstalls.componentId, pc.componentId),
              eq(componentInstalls.deploymentId, input.deploymentId),
            ),
          });
          if (!compInstall) newComponents++;
        }

        // 5. Check for new skills added since install (not yet installed on this deployment)
        const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
          where: eq(serviceSkills.packageId, pkg.id),
        });
        let newSkills = 0;
        for (const ps of pkgSkillRows) {
          const skillInstall = await ctx.db.query.deploymentSkills.findFirst({
            where: and(
              eq(deploymentSkills.skillId, ps.skillId),
              eq(deploymentSkills.deploymentId, input.deploymentId),
            ),
          });
          if (!skillInstall) newSkills++;
        }

        // Only include if there is actually something to update
        if (packageWasUpdated || newComponents > 0 || newSkills > 0) {
          updates.push({
            serviceId: pkg.id,
            serviceName: pkg.name,
            displayName: pkg.displayName,
            installedAt,
            serviceUpdatedAt: pkgUpdatedAt,
            newComponents,
            newSkills,
          });
        }
      }

      return { updates };
    }),

  upgradeService: protectedProcedure
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Verify the package is installed
      const install = await ctx.db.query.serviceInstalls.findFirst({
        where: and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Service is not installed on this deployment",
        });
      }

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }

      // 3. Get current package components and skills
      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, pkg.id),
      });
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, pkg.id),
      });

      // 4. Install missing components (same logic as install but skip existing)
      const newlyInstalledComponents: string[] = [];
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

        const sorted = versions.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
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

        newlyInstalledComponents.push(pc.componentId);
      }

      // 5. Install missing skills (same logic as install but skip existing)
      const newlyInstalledSkills: string[] = [];
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

        newlyInstalledSkills.push(ps.skillId);
      }

      // 6. Update serviceInstalls.installedAt to now (marks as "up to date")
      await ctx.db
        .update(serviceInstalls)
        .set({ installedAt: dbDate() } as any)
        .where(
          and(
            eq(serviceInstalls.packageId, input.serviceId),
            eq(serviceInstalls.deploymentId, input.deploymentId),
          ),
        );

      logger.info(
        {
          packageId: input.serviceId,
          deploymentId: input.deploymentId,
          userId: ctx.user.id,
          newComponents: newlyInstalledComponents.length,
          newSkills: newlyInstalledSkills.length,
        },
        "Service upgraded",
      );

      // 7. Sync components + configs to pod if running
      if (deployment.status === "running") {
        for (const compId of newlyInstalledComponents) {
          const comp = await ctx.db.query.marketplaceComponents.findFirst({
            where: eq(marketplaceComponents.id, compId),
          });
          if (!comp) continue;

          const versions = await ctx.db.query.componentVersions.findMany({
            where: eq(componentVersions.componentId, compId),
          });
          const latestVersion = versions.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];

          void syncMarketplaceComponent(
            input.deploymentId,
            compId,
            comp.name,
            {
              name: comp.name,
              displayName: comp.displayName,
              description: comp.description,
              tier: comp.tier,
              category: comp.category,
              propsSchema: comp.propsSchema ? JSON.parse(comp.propsSchema) : null,
              version: latestVersion?.version ?? "1.0.0",
            },
            buildComponentDefinition(comp),
            comp.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error(
              { err, componentId: compId, deploymentId: input.deploymentId },
              "packages.upgrade: failed to sync component (non-fatal)",
            ),
          );
        }

        // Sync configs to PVC - writes skill files + rebuilds soul.md with packageSnippets
        if (newlyInstalledComponents.length > 0 || newlyInstalledSkills.length > 0) {
          void syncConfigsToPvc(input.deploymentId).catch((err) =>
            logger.error(
              { err, deploymentId: input.deploymentId },
              "packages.upgrade: failed to sync configs (non-fatal)",
            ),
          );
        }
      }

      return {
        success: true as const,
        newlyInstalledComponents: newlyInstalledComponents.length,
        newlyInstalledSkills: newlyInstalledSkills.length,
      };
    }),

  // ── Hosted Services Dashboard ─────────────────────────────────────────────

  /** List all services hosted by a specific deployment (creatorDeploymentId match) */
  listHostedByDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify user owns the deployment
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Find services linked to this deployment
      const services = await ctx.db.query.marketplaceServices.findMany({
        where: eq(marketplaceServices.creatorDeploymentId, input.deploymentId),
      });

      if (services.length === 0) return [];

      // For each service, get install count + monthly request count
      const results = await Promise.all(
        services.map(async (svc) => {
          // Count installs
          const installs = await ctx.db.query.serviceInstalls.findMany({
            where: eq(serviceInstalls.packageId, svc.id),
          });

          // Sum request counts for current month
          const now = new Date();
          const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          let monthlyRequests = 0;
          const usage = await (ctx.db.query as any).serviceUsage?.findMany?.({
            where: eq(serviceUsage.packageId, svc.id),
          }) ?? [];
          for (const u of usage as any[]) {
            if (u.billingCycleStart === currentMonth) {
              monthlyRequests += u.requestCount || 0;
            }
          }

          return {
            id: svc.id,
            name: svc.name,
            displayName: svc.displayName,
            status: svc.status,
            hostingModel: svc.hostingModel,
            remoteHealth: svc.remoteHealth,
            remoteLastCheck: svc.remoteLastCheck,
            totalInstalls: installs.length,
            monthlyRequests,
            pricingModel: svc.pricingModel,
            priceUsdCents: svc.priceUsdCents,
          };
        }),
      );

      return results;
    }),

  /** Detailed stats for a single hosted service (installs, usage by month, per-skill breakdown) */
  hostedServiceStats: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get the service
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });

      // Verify ownership via creatorDeploymentId → deployment → user
      if (pkg.creatorDeploymentId) {
        const deployment = await ctx.db.query.deployments.findFirst({
          where: and(
            eq(deployments.id, pkg.creatorDeploymentId),
            eq(deployments.userId, ctx.user.id),
          ),
        });
        if (!deployment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not the service host" });
        }
      } else {
        // Fallback: check creator profile
        const creator = await ctx.db.query.creatorProfiles.findFirst({
          where: eq(creatorProfiles.userId, ctx.user.id),
        });
        if (!creator || creator.id !== pkg.creatorId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not the service creator" });
        }
      }

      // Get installs with deployment names
      const installRows = await ctx.db.query.serviceInstalls.findMany({
        where: eq(serviceInstalls.packageId, input.serviceId),
      });

      const installs = await Promise.all(
        installRows.slice(0, 50).map(async (i) => {
          const dep = await ctx.db.query.deployments.findFirst({
            where: eq(deployments.id, i.deploymentId),
          });
          return {
            id: i.id,
            deploymentId: i.deploymentId,
            deploymentName: dep?.name ?? "Unknown",
            installedAt: i.installedAt,
          };
        }),
      );

      // Get usage data (last 6 months)
      const usage = await (ctx.db.query as any).serviceUsage?.findMany?.({
        where: eq(serviceUsage.packageId, input.serviceId),
      }) ?? [];

      // Aggregate by month
      const byMonth: Record<string, number> = {};
      const bySkill: Record<string, number> = {};
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      for (const u of usage as any[]) {
        byMonth[u.billingCycleStart] = (byMonth[u.billingCycleStart] || 0) + (u.requestCount || 0);
        if (u.billingCycleStart === currentMonth) {
          bySkill[u.skillName] = (bySkill[u.skillName] || 0) + (u.requestCount || 0);
        }
      }

      // Sort months and take last 6
      const monthlyUsage = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, requests]) => ({ month, requests }));

      const skillBreakdown = Object.entries(bySkill)
        .sort(([, a], [, b]) => b - a)
        .map(([skill, requests]) => ({ skill, requests }));

      return {
        service: {
          id: pkg.id,
          name: pkg.name,
          displayName: pkg.displayName,
          description: pkg.description,
          status: pkg.status,
          hostingModel: pkg.hostingModel,
          remoteHealth: pkg.remoteHealth,
          remoteLastCheck: pkg.remoteLastCheck,
          pricingModel: pkg.pricingModel,
          priceUsdCents: pkg.priceUsdCents,
        },
        totalInstalls: installRows.length,
        totalRequests: Object.values(byMonth).reduce((a, b) => a + b, 0),
        monthlyUsage,
        skillBreakdown,
        installs,
      };
    }),

  // ── Creator Dashboard ────────────────────────────────────────────────────

  creatorInstalls: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify the caller owns this package (is the creator)
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND" });

      const creator = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!creator || creator.id !== pkg.creatorId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the service creator" });
      }

      // Return install list with deployment IDs and timestamps
      const installs = await ctx.db.query.serviceInstalls.findMany({
        where: eq(serviceInstalls.packageId, input.serviceId),
      });

      return {
        totalInstalls: installs.length,
        installs: installs.map((i) => ({
          id: i.id,
          deploymentId: i.deploymentId,
          installedAt: i.installedAt,
        })),
      };
    }),

  creatorUsage: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND" });

      const creator = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!creator || creator.id !== pkg.creatorId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the service creator" });
      }

      // Query package_usage for this package
      const usage = await (ctx.db.query as any).serviceUsage?.findMany?.({
        where: eq(serviceUsage.packageId, input.serviceId),
      }) ?? [];

      // Aggregate by billing cycle
      const byMonth: Record<string, number> = {};
      for (const u of usage as any[]) {
        byMonth[u.billingCycleStart] = (byMonth[u.billingCycleStart] || 0) + (u.requestCount || 0);
      }

      return {
        totalRequests: Object.values(byMonth).reduce((a, b) => a + b, 0),
        byMonth,
      };
    }),

  // ── Key Rotation ────────────────────────────────────────────────────────

  rotateSigningSecret: protectedProcedure
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Look up serviceCredentials for this deployment+package
      const cred = await ctx.db.query.serviceCredentials.findFirst({
        where: and(
          eq(serviceCredentials.deploymentId, input.deploymentId),
          eq(serviceCredentials.packageId, input.serviceId),
        ),
      });
      if (!cred) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No credentials found for this service installation",
        });
      }

      // 3. Decrypt the old signing secret before generating the new one
      const oldSecret = decryptApiKey(cred.signingSecret);

      // 4. Generate new signing secret
      const newSecret = generateSigningSecret();

      // 5. Encrypt and update the credentials row with the new secret.
      //    Store the old secret with a 5-minute grace period so that
      //    in-flight requests signed with the old secret still succeed.
      const gracePeriodMs = 5 * 60 * 1000; // 5 minutes
      const expiresAt = new Date(Date.now() + gracePeriodMs).toISOString();

      await ctx.db
        .update(serviceCredentials)
        .set({
          signingSecret: encryptApiKey(newSecret),
          previousSigningSecret: cred.signingSecret, // already encrypted
          previousSecretExpiresAt: expiresAt,
          updatedAt: dbDate(),
        } as any)
        .where(eq(serviceCredentials.id, cred.id));

      logger.info(
        { packageId: input.serviceId, deploymentId: input.deploymentId, credId: cred.id },
        "Signing secret rotated",
      );

      // 6. Notify the creator's API via POST {endpoint}/jarble/rotate
      //    Sign with the OLD secret so the creator can verify the request.
      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });

      if (pkg) {
        const rawConfig = (pkg as Record<string, unknown>).remoteApiConfig as string | null;
        if (rawConfig) {
          const parsed = serviceCardSchema.safeParse(JSON.parse(rawConfig));
          if (parsed.success && parsed.data.endpoint) {
            const rotateBody = {
              action: "rotate" as const,
              serviceId: input.serviceId,
              deploymentId: input.deploymentId,
              signingSecret: newSecret,
              timestamp: new Date().toISOString(),
            };

            // Fire-and-forget: notify creator with OLD secret for authentication
            void sendSignedWebhook(
              parsed.data.endpoint,
              "/jarble/rotate",
              rotateBody,
              oldSecret,
            ).then((res) => {
              if (!res.ok) {
                logger.warn(
                  { packageId: input.serviceId, status: res.status },
                  "Creator rotate webhook returned non-OK (local secret already updated)",
                );
              } else {
                logger.info(
                  { packageId: input.serviceId },
                  "Creator rotate webhook acknowledged",
                );
              }
            }).catch((err) => {
              // If the creator's endpoint is down, the local credential is still updated.
              // The creator will need to use an out-of-band mechanism to resync.
              logger.warn(
                { packageId: input.serviceId, err },
                "Creator rotate webhook failed (local secret already updated)",
              );
            });
          }
        }
      }

      // 7. Return success
      return { success: true as const };
    }),

  // ── Draft & Testing ──────────────────────────────────────────────────────

  /** Create a service in draft status for testing before submitting for review. */
  createDraft: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Service name must be lowercase alphanumeric with hyphens"),
      displayName: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      hostingModel: z.enum(["self_hosted", "remote", "hybrid"]),
      instructionSnippet: z.string().max(5000).optional(),
      remoteApiEndpoint: z.string().url().max(500).optional(),
      remoteApiConfig: z.string().optional(),
      pricingModel: z.enum(["free", "paid", "freemium"]).default("free"),
      priceUsdCents: z.number().int().min(0).default(0),
      componentIds: z.array(z.string()).default([]),
      skillIds: z.array(z.string()).default([]),
      creatorDeploymentId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You must create a creator profile before creating services",
        });
      }

      // Check uniqueness
      const existing = await ctx.db.query.marketplaceServices.findFirst({
        where: and(
          eq(marketplaceServices.creatorId, profile.id),
          eq(marketplaceServices.name, input.name),
        ),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a service with this name" });
      }

      // Validate components if provided (relaxed: allow draft to have invalid refs)
      for (const compId of input.componentIds) {
        const comp = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, compId),
        });
        if (!comp) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Component ${compId} not found` });
        }
      }

      // Validate skills if provided
      for (const skillId of input.skillIds) {
        const skill = await ctx.db.query.skillsCatalog.findFirst({
          where: eq(skillsCatalog.id, skillId),
        });
        if (!skill) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Skill ${skillId} not found` });
        }
      }

      // Validate remoteApiConfig if provided
      if ((input.hostingModel === "remote" || input.hostingModel === "hybrid") && input.remoteApiConfig) {
        try {
          serviceCardSchema.parse(JSON.parse(input.remoteApiConfig));
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid ServiceCard config: ${err instanceof Error ? err.message : "parse error"}`,
          });
        }
      }

      // Validate creatorDeploymentId ownership if provided
      if (input.creatorDeploymentId) {
        const dep = await ctx.db.query.deployments.findFirst({
          where: and(eq(deployments.id, input.creatorDeploymentId), eq(deployments.userId, ctx.user.id)),
        });
        if (!dep) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Host deployment not found or not owned by you" });
        }
      }

      const serviceId = generateId("pkg");
      await ctx.db.insert(marketplaceServices).values({
        id: serviceId,
        creatorId: profile.id,
        name: input.name,
        displayName: input.displayName,
        description: input.description ?? null,
        hostingModel: input.hostingModel,
        instructionSnippet: input.instructionSnippet ?? null,
        remoteApiEndpoint: input.remoteApiEndpoint ?? null,
        remoteApiConfig: input.remoteApiConfig ?? null,
        creatorDeploymentId: input.creatorDeploymentId ?? null,
        status: "draft",
        pricingModel: input.pricingModel,
        priceUsdCents: input.priceUsdCents,
        createdAt: dbDate(),
        updatedAt: dbDate(),
      });

      for (const compId of input.componentIds) {
        await ctx.db.insert(serviceComponents).values({
          id: generateId("pkc"), packageId: serviceId, componentId: compId,
        });
      }

      for (const skillId of input.skillIds) {
        await ctx.db.insert(serviceSkills).values({
          id: generateId("pks"), packageId: serviceId, skillId,
        });
      }

      logger.info({
        serviceId, name: input.name, userId: ctx.user.id,
        components: input.componentIds.length, skills: input.skillIds.length,
      }, "Draft service created");

      return { serviceId };
    }),

  /** Update a draft (or rejected) service. Re-syncs to any test-installed deployments. */
  updateDraft: protectedProcedure
    .input(z.object({
      serviceId: z.string(),
      displayName: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).optional(),
      hostingModel: z.enum(["self_hosted", "remote", "hybrid"]).optional(),
      instructionSnippet: z.string().max(5000).optional(),
      remoteApiEndpoint: z.string().url().max(500).optional(),
      remoteApiConfig: z.string().optional(),
      pricingModel: z.enum(["free", "paid", "freemium"]).optional(),
      priceUsdCents: z.number().int().min(0).optional(),
      componentIds: z.array(z.string()).optional(),
      skillIds: z.array(z.string()).optional(),
      creatorDeploymentId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Creator profile required" });
      }

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }
      if (pkg.creatorId !== profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this service" });
      }
      if (pkg.status !== "draft" && pkg.status !== "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft or rejected services can be edited" });
      }

      // Build update set
      const updateSet: Record<string, unknown> = { updatedAt: dbDate() };
      if (input.displayName !== undefined) updateSet.displayName = input.displayName;
      if (input.description !== undefined) updateSet.description = input.description;
      if (input.hostingModel !== undefined) updateSet.hostingModel = input.hostingModel;
      if (input.instructionSnippet !== undefined) updateSet.instructionSnippet = input.instructionSnippet;
      if (input.remoteApiEndpoint !== undefined) updateSet.remoteApiEndpoint = input.remoteApiEndpoint;
      if (input.remoteApiConfig !== undefined) updateSet.remoteApiConfig = input.remoteApiConfig;
      if (input.pricingModel !== undefined) updateSet.pricingModel = input.pricingModel;
      if (input.priceUsdCents !== undefined) updateSet.priceUsdCents = input.priceUsdCents;
      if (input.creatorDeploymentId !== undefined) updateSet.creatorDeploymentId = input.creatorDeploymentId;

      await ctx.db.update(marketplaceServices).set(updateSet as any).where(eq(marketplaceServices.id, input.serviceId));

      // Replace components if provided
      if (input.componentIds !== undefined) {
        await ctx.db.delete(serviceComponents).where(eq(serviceComponents.packageId, input.serviceId));
        for (const compId of input.componentIds) {
          await ctx.db.insert(serviceComponents).values({
            id: generateId("pkc"), packageId: input.serviceId, componentId: compId,
          });
        }
      }

      // Replace skills if provided
      if (input.skillIds !== undefined) {
        await ctx.db.delete(serviceSkills).where(eq(serviceSkills.packageId, input.serviceId));
        for (const skillId of input.skillIds) {
          await ctx.db.insert(serviceSkills).values({
            id: generateId("pks"), packageId: input.serviceId, skillId,
          });
        }
      }

      // Re-sync to any test-installed deployments
      let resynced = 0;
      const testInstalls = await ctx.db.query.serviceInstalls.findMany({
        where: eq(serviceInstalls.packageId, input.serviceId),
      });

      for (const inst of testInstalls) {
        const dep = await ctx.db.query.deployments.findFirst({
          where: eq(deployments.id, inst.deploymentId),
        });
        if (dep?.status === "running") {
          void syncConfigsToPvc(inst.deploymentId).catch((err) =>
            logger.error({ err, deploymentId: inst.deploymentId }, "updateDraft: resync failed (non-fatal)")
          );
          resynced++;
        }
      }

      logger.info({ serviceId: input.serviceId, resynced, userId: ctx.user.id }, "Draft service updated");
      return { success: true as const, resynced };
    }),

  /** Install a draft service on the creator's own deployment for testing. */
  testInstall: protectedProcedure
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Verify service ownership + draft/rejected status
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Creator profile required" });
      }

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }
      if (pkg.creatorId !== profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only test-install your own services" });
      }
      if (pkg.status !== "draft" && pkg.status !== "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft or rejected services can be test-installed" });
      }

      // Check not already installed
      const existingInstall = await ctx.db.query.serviceInstalls.findFirst({
        where: and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (existingInstall) {
        throw new TRPCError({ code: "CONFLICT", message: "Service is already installed on this deployment" });
      }

      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, pkg.id),
      });
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, pkg.id),
      });

      // Create install record
      const installId = generateId("pki");
      await ctx.db.insert(serviceInstalls).values({
        id: installId,
        packageId: input.serviceId,
        deploymentId: input.deploymentId,
        userId: ctx.user.id,
        installedAt: dbDate(),
      });

      // Install components (skip already installed, no totalInstalls increment for tests)
      const installedComponents: string[] = [];
      for (const pc of pkgComps) {
        const existing = await ctx.db.query.componentInstalls.findFirst({
          where: and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, input.deploymentId),
          ),
        });
        if (existing) continue;

        const comp = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, pc.componentId),
        });
        if (!comp) continue;

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

        installedComponents.push(pc.componentId);
      }

      // Install skills (skip already installed)
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

      // NOTE: No totalInstalls increment for test installs
      // NOTE: No remote handshake for test installs

      logger.info({
        packageId: input.serviceId, deploymentId: input.deploymentId,
        userId: ctx.user.id, installedComponents: installedComponents.length,
        installedSkills: installedSkills.length, isTest: true,
      }, "Service test-installed");

      // Sync to pod if running
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
            input.deploymentId, compId, comp.name,
            {
              name: comp.name, displayName: comp.displayName,
              description: comp.description, tier: comp.tier,
              category: comp.category,
              propsSchema: comp.propsSchema ? JSON.parse(comp.propsSchema) : null,
              version: latestVersion?.version ?? "1.0.0",
            },
            buildComponentDefinition(comp),
            comp.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error({ err, componentId: compId, deploymentId: input.deploymentId },
              "testInstall: failed to sync component (non-fatal)")
          );
        }

        void syncConfigsToPvc(input.deploymentId).catch((err) =>
          logger.error({ err, deploymentId: input.deploymentId },
            "testInstall: failed to sync configs (non-fatal)")
        );
      }

      return {
        success: true as const,
        installedComponents: installedComponents.length,
        installedSkills: installedSkills.length,
      };
    }),

  /** Remove a test-installed draft service from a deployment. */
  testUninstall: protectedProcedure
    .input(z.object({ serviceId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Creator profile required" });
      }

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }
      if (pkg.creatorId !== profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only test-uninstall your own services" });
      }

      const install = await ctx.db.query.serviceInstalls.findFirst({
        where: and(
          eq(serviceInstalls.packageId, input.serviceId),
          eq(serviceInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service is not installed on this deployment" });
      }

      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, input.serviceId),
      });
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, input.serviceId),
      });

      // Remove components
      let removedComponents = 0;
      for (const pc of pkgComps) {
        const compInstall = await ctx.db.query.componentInstalls.findFirst({
          where: and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, input.deploymentId),
          ),
        });
        if (compInstall) {
          await ctx.db.delete(componentInstalls).where(and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, input.deploymentId),
          ));
          // NOTE: No totalInstalls decrement for test uninstalls
          removedComponents++;
        }
      }

      // Remove skills
      let removedSkills = 0;
      for (const ps of pkgSkillRows) {
        const skillInstall = await ctx.db.query.deploymentSkills.findFirst({
          where: and(
            eq(deploymentSkills.skillId, ps.skillId),
            eq(deploymentSkills.deploymentId, input.deploymentId),
          ),
        });
        if (skillInstall) {
          await ctx.db.delete(deploymentSkills).where(and(
            eq(deploymentSkills.skillId, ps.skillId),
            eq(deploymentSkills.deploymentId, input.deploymentId),
          ));
          removedSkills++;
        }
      }

      // NOTE: No remote webhook for test uninstalls
      // Delete credentials if any exist
      await ctx.db.delete(serviceCredentials).where(and(
        eq(serviceCredentials.deploymentId, input.deploymentId),
        eq(serviceCredentials.packageId, input.serviceId),
      ));

      await ctx.db.delete(serviceInstalls).where(and(
        eq(serviceInstalls.packageId, input.serviceId),
        eq(serviceInstalls.deploymentId, input.deploymentId),
      ));

      // NOTE: No totalInstalls decrement for test uninstalls

      logger.info({
        packageId: input.serviceId, deploymentId: input.deploymentId,
        userId: ctx.user.id, removedComponents, removedSkills, isTest: true,
      }, "Service test-uninstalled");

      if (deployment.status === "running") {
        void syncConfigsToPvc(input.deploymentId).catch((err) =>
          logger.error({ err, deploymentId: input.deploymentId },
            "testUninstall: failed to sync config (non-fatal)")
        );
      }

      return { success: true as const, removedComponents, removedSkills };
    }),

  /** Move a draft service to pending_review. Validates completeness. */
  submitForReview: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Creator profile required" });
      }

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }
      if (pkg.creatorId !== profile.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this service" });
      }
      if (pkg.status !== "draft" && pkg.status !== "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft or rejected services can be submitted for review" });
      }

      // Validate completeness
      const pkgComps = await ctx.db.query.serviceComponents.findMany({
        where: eq(serviceComponents.packageId, input.serviceId),
      });
      const pkgSkillRows = await ctx.db.query.serviceSkills.findMany({
        where: eq(serviceSkills.packageId, input.serviceId),
      });

      if (pkgComps.length === 0 && pkgSkillRows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Service must contain at least one component or skill before submitting for review",
        });
      }

      // Validate all components are still published
      for (const pc of pkgComps) {
        const comp = await ctx.db.query.marketplaceComponents.findFirst({
          where: eq(marketplaceComponents.id, pc.componentId),
        });
        if (!comp || (comp.status !== "published" && comp.status !== "approved")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Component ${pc.componentId} is not published (status: ${comp?.status ?? "missing"})`,
          });
        }
      }

      // Validate remoteApiConfig for remote/hybrid
      if ((pkg.hostingModel === "remote" || pkg.hostingModel === "hybrid") && pkg.remoteApiConfig) {
        try {
          serviceCardSchema.parse(JSON.parse(pkg.remoteApiConfig));
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Service has invalid remote API config: ${err instanceof Error ? err.message : "parse error"}`,
          });
        }
      }

      // Clean up test installs
      const testInstalls = await ctx.db.query.serviceInstalls.findMany({
        where: eq(serviceInstalls.packageId, input.serviceId),
      });

      for (const inst of testInstalls) {
        // Remove components installed via this service
        for (const pc of pkgComps) {
          await ctx.db.delete(componentInstalls).where(and(
            eq(componentInstalls.componentId, pc.componentId),
            eq(componentInstalls.deploymentId, inst.deploymentId),
          ));
        }
        // Remove skills installed via this service
        for (const ps of pkgSkillRows) {
          await ctx.db.delete(deploymentSkills).where(and(
            eq(deploymentSkills.skillId, ps.skillId),
            eq(deploymentSkills.deploymentId, inst.deploymentId),
          ));
        }
        // Clean up credentials
        await ctx.db.delete(serviceCredentials).where(and(
          eq(serviceCredentials.deploymentId, inst.deploymentId),
          eq(serviceCredentials.packageId, input.serviceId),
        ));
        // Delete install record
        await ctx.db.delete(serviceInstalls).where(eq(serviceInstalls.id, inst.id));

        // Re-sync deployment to remove service from pod
        const dep = await ctx.db.query.deployments.findFirst({
          where: eq(deployments.id, inst.deploymentId),
        });
        if (dep?.status === "running") {
          void syncConfigsToPvc(inst.deploymentId).catch((err) =>
            logger.error({ err, deploymentId: inst.deploymentId },
              "submitForReview: resync failed (non-fatal)")
          );
        }
      }

      // Transition to pending_review
      await ctx.db.update(marketplaceServices)
        .set({ status: "pending_review", updatedAt: dbDate() } as any)
        .where(eq(marketplaceServices.id, input.serviceId));

      logger.info({
        serviceId: input.serviceId, userId: ctx.user.id,
        cleanedUpInstalls: testInstalls.length,
      }, "Service submitted for review");

      return { success: true as const };
    }),

  /** List all services created by the current user (all statuses). */
  listMyServices: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "pending_review", "published", "rejected"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!profile) {
        return { items: [] };
      }

      const allServices = await ctx.db.query.marketplaceServices.findMany({
        where: eq(marketplaceServices.creatorId, profile.id),
      });

      let filtered = [...allServices];
      if (input?.status) {
        filtered = filtered.filter((s) => s.status === input.status);
      }

      filtered.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      const items: Array<{
        id: string; name: string; displayName: string; description: string | null;
        hostingModel: string; status: string; pricingModel: string; priceUsdCents: number;
        componentCount: number; skillCount: number; testInstallCount: number;
        creatorDeploymentId: string | null; createdAt: Date; updatedAt: Date;
      }> = [];
      for (const svc of filtered) {
        const compCount = (await ctx.db.query.serviceComponents.findMany({
          where: eq(serviceComponents.packageId, svc.id),
        })).length;
        const skillCount = (await ctx.db.query.serviceSkills.findMany({
          where: eq(serviceSkills.packageId, svc.id),
        })).length;
        const testInstallCount = (await ctx.db.query.serviceInstalls.findMany({
          where: eq(serviceInstalls.packageId, svc.id),
        })).length;

        items.push({
          id: svc.id,
          name: svc.name,
          displayName: svc.displayName,
          description: svc.description,
          hostingModel: svc.hostingModel,
          status: svc.status,
          pricingModel: svc.pricingModel,
          priceUsdCents: svc.priceUsdCents,
          componentCount: compCount,
          skillCount: skillCount,
          testInstallCount: testInstallCount,
          creatorDeploymentId: svc.creatorDeploymentId,
          createdAt: svc.createdAt,
          updatedAt: svc.updatedAt,
        });
      }

      return { items };
    }),

  // ── Admin Moderation ──────────────────────────────────────────────────────

  adminList: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["pending_review", "draft", "rejected"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);

      const statusFilter = input?.status ?? "pending_review";

      const packages = await ctx.db.query.marketplaceServices.findMany({
        where: eq(marketplaceServices.status, statusFilter),
      });

      return packages.map((p) => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        hostingModel: p.hostingModel,
        status: p.status,
        pricingModel: p.pricingModel,
        priceUsdCents: p.priceUsdCents,
        creatorId: p.creatorId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
    }),

  adminApprove: protectedProcedure
    .input(z.object({ serviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }

      await ctx.db
        .update(marketplaceServices)
        .set({
          status: "published",
          updatedAt: dbDate(),
        } as any)
        .where(eq(marketplaceServices.id, input.serviceId));

      logger.info(
        {
          packageId: input.serviceId,
          adminUserId: ctx.user.id,
          previousStatus: pkg.status,
        },
        "Service approved by admin",
      );

      return { success: true as const };
    }),

  adminReject: protectedProcedure
    .input(
      z.object({
        serviceId: z.string(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);

      const pkg = await ctx.db.query.marketplaceServices.findFirst({
        where: eq(marketplaceServices.id, input.serviceId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
      }

      await ctx.db
        .update(marketplaceServices)
        .set({
          status: "rejected",
          updatedAt: dbDate(),
        } as any)
        .where(eq(marketplaceServices.id, input.serviceId));

      logger.info(
        {
          packageId: input.serviceId,
          adminUserId: ctx.user.id,
          previousStatus: pkg.status,
          reason: input.reason ?? null,
        },
        "Service rejected by admin",
      );

      return { success: true as const };
    }),

  // ── Deployment Component/Skill Browsing ───────────────────────────────────

  listDeploymentComponents: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const installs = await ctx.db.query.componentInstalls.findMany({
        where: eq(componentInstalls.deploymentId, input.deploymentId),
        with: { component: true },
      });

      return installs
        .filter((i) => i.component?.status === "published")
        .map((i) => ({
          id: i.component!.id,
          name: i.component!.name,
          displayName: i.component!.displayName,
          description: i.component!.description,
          category: i.component!.category,
          tier: i.component!.tier,
        }));
    }),

  listDeploymentSkills: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const installs = await ctx.db.query.deploymentSkills.findMany({
        where: eq(deploymentSkills.deploymentId, input.deploymentId),
        with: { skill: true },
      });

      return installs.map((i) => ({
        id: i.skill.id,
        name: i.skill.name,
        description: i.skill.description,
        category: i.skill.runtime,
        isOfficial: i.skill.isOfficial,
      }));
    }),
});
