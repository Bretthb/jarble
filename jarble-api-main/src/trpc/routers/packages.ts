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
import { packageCardSchema, type PackageCard } from "../../services/packageCard.js";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption.js";
import { generateSigningSecret, signRequest } from "../../utils/hmac.js";
import { performInstallHandshake } from "../../services/packageHandshake.js";

const logger = createModuleLogger("packages");

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
  packageCredentials,
  packageUsage,
} = tables;

type PackageRow = InferSelectModel<typeof marketplacePackages>;

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// MVP admin check: hardcoded admin user IDs. Replace with role-based check later.
// Must stay in sync with the set in marketplace.ts until a shared admin service is extracted.
const ADMIN_USER_IDS = new Set<string>([
  "admin-user-001",
  // Add additional admin user IDs here, e.g.:
  // "usr_abc123def456",
]);

function assertAdmin(userId: string): void {
  if (!ADMIN_USER_IDS.has(userId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
}

/**
 * Send a signed webhook to a creator's API endpoint.
 *
 * Signs the JSON body using HMAC-SHA256 (via `signRequest`) and includes
 * the standard `X-Jarble-Signature` / `X-Jarble-Timestamp` headers.
 *
 * @param endpoint - Creator API base URL (from PackageCard).
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
      const installId = generateId("pki");
      await ctx.db.insert(packageInstalls).values({
        id: installId,
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

      // ── Remote/Hybrid package handshake ──────────────────────────────────
      // For remote or hybrid packages, parse the PackageCard, generate an HMAC
      // signing secret, store encrypted credentials, and perform the install
      // handshake with the creator's API endpoint.
      let handshakeStatus: "completed" | "failed" | "skipped" = "skipped";
      const isRemote = pkg.hostingModel === "remote" || pkg.hostingModel === "hybrid";

      if (isRemote) {
        // Parse and validate the PackageCard from the stored JSON
        let card: PackageCard | null = null;
        const rawConfig = (pkg as Record<string, unknown>).remoteApiConfig as string | null;
        if (rawConfig) {
          const parsed = packageCardSchema.safeParse(JSON.parse(rawConfig));
          if (parsed.success) {
            card = parsed.data;
          } else {
            logger.warn({ packageId: input.packageId, errors: parsed.error.issues },
              "packages.install: invalid remoteApiConfig (non-fatal)");
          }
        }

        if (card) {
          // Generate HMAC-SHA256 signing secret
          const signingSecret = generateSigningSecret();

          // Store encrypted credentials
          const credId = generateId("pkc");
          await ctx.db.insert(packageCredentials).values({
            id: credId,
            packageInstallId: installId,
            deploymentId: input.deploymentId,
            packageId: input.packageId,
            signingSecret: encryptApiKey(signingSecret),
            handshakeStatus: "pending",
            createdAt: dbDate(),
            updatedAt: dbDate(),
          } as any);

          // Perform the install handshake (fire-and-forget)
          void (async () => {
            try {
              const result = await performInstallHandshake({
                endpoint: card!.endpoint,
                packageId: input.packageId,
                deploymentId: input.deploymentId,
                signingSecret,
              });

              await ctx.db
                .update(packageCredentials)
                .set({
                  handshakeStatus: "completed",
                  remoteInstallId: result.remoteInstallId ?? null,
                  updatedAt: dbDate(),
                } as any)
                .where(eq(packageCredentials.id, credId));

              handshakeStatus = "completed";
              logger.info({ packageId: input.packageId, credId }, "Remote handshake completed");
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : "Unknown error";
              await ctx.db
                .update(packageCredentials)
                .set({
                  handshakeStatus: "failed",
                  handshakeError: errorMsg.slice(0, 500),
                  updatedAt: dbDate(),
                } as any)
                .where(eq(packageCredentials.id, credId));

              handshakeStatus = "failed";
              logger.warn({ packageId: input.packageId, credId, err },
                "packages.install: remote handshake failed (non-fatal)");
            }
          })();
        }
      }

      // Fire-and-forget: sync components + configs to pod
      // Always sync configs when a package is installed — packageSnippets need to
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
            {
              name: comp.name, displayName: comp.displayName,
              description: comp.description, tier: comp.tier,
              category: comp.category,
              propsSchema: comp.propsSchema ? JSON.parse(comp.propsSchema) : null,
              version: latestVersion?.version ?? "1.0.0",
            },
            comp.exampleProps ?? comp.propsSchema ?? "",
            comp.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error({ err, componentId: compId, deploymentId: input.deploymentId },
              "packages.install: failed to sync component (non-fatal)")
          );
        }

        // Sync configs to PVC — writes skill files + rebuilds soul.md with packageSnippets
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

      // ── Remote/Hybrid uninstall webhook ──────────────────────────────────
      // For remote/hybrid packages, notify the creator's API BEFORE deleting
      // the credentials (we need the signing secret to authenticate the request).
      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      const isRemote = pkg?.hostingModel === "remote" || pkg?.hostingModel === "hybrid";

      if (isRemote && pkg) {
        const cred = await ctx.db.query.packageCredentials.findFirst({
          where: and(
            eq(packageCredentials.deploymentId, input.deploymentId),
            eq(packageCredentials.packageId, input.packageId),
          ),
        });

        if (cred) {
          // Parse the PackageCard to get the endpoint
          const rawConfig = (pkg as Record<string, unknown>).remoteApiConfig as string | null;
          if (rawConfig) {
            const parsed = packageCardSchema.safeParse(JSON.parse(rawConfig));
            if (parsed.success) {
              const uninstallBody = {
                action: "uninstall" as const,
                packageId: input.packageId,
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
                    { packageId: input.packageId, status: res.status },
                    "Creator uninstall webhook returned non-OK (proceeding with uninstall)",
                  );
                } else {
                  logger.info(
                    { packageId: input.packageId, deploymentId: input.deploymentId },
                    "Creator uninstall webhook acknowledged",
                  );
                }
              } catch (err) {
                // Fire-and-forget: don't fail the uninstall if the webhook fails
                logger.warn(
                  { packageId: input.packageId, deploymentId: input.deploymentId, err },
                  "Creator uninstall webhook failed (proceeding with uninstall)",
                );
              }
            }
          }

          // Delete the credentials AFTER sending the webhook
          await ctx.db.delete(packageCredentials)
            .where(eq(packageCredentials.id, cred.id));
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

      // Always sync configs on uninstall — removes package snippet from soul.md
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
      remoteApiConfig: z.string().optional(), // JSON string of PackageCard (required for remote/hybrid)
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
          message: "Package must contain at least one component or skill",
        });
      }

      // Validate remoteApiConfig for remote/hybrid packages
      if (
        (input.hostingModel === "remote" || input.hostingModel === "hybrid") &&
        input.remoteApiConfig
      ) {
        try {
          packageCardSchema.parse(JSON.parse(input.remoteApiConfig));
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid PackageCard config: ${err instanceof Error ? err.message : "parse error"}`,
          });
        }
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
        remoteApiConfig: input.remoteApiConfig ?? null,
        status: "pending_review",
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
      }, "Package submitted for review");

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

  // ── Package Status & Upgrade ─────────────────────────────────────────────

  getPackageStatus: protectedProcedure
    .input(z.object({ packageId: z.string(), deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Look up packageInstalls for this deployment+package
      const install = await ctx.db.query.packageInstalls.findFirst({
        where: and(
          eq(packageInstalls.packageId, input.packageId),
          eq(packageInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        return { installed: false as const };
      }

      // 3. Look up the package itself
      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      }

      // 4. Look up packageCredentials (if remote/hybrid)
      const creds = await ctx.db.query.packageCredentials.findFirst({
        where: and(
          eq(packageCredentials.packageId, input.packageId),
          eq(packageCredentials.deploymentId, input.deploymentId),
        ),
      });

      // 5. Look up which components are in the package and how many are installed
      const pkgComps = await ctx.db.query.packageComponents.findMany({
        where: eq(packageComponents.packageId, input.packageId),
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
      const pkgSkillRows = await ctx.db.query.packageSkills.findMany({
        where: eq(packageSkills.packageId, input.packageId),
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
      const installs = await ctx.db.query.packageInstalls.findMany({
        where: eq(packageInstalls.deploymentId, input.deploymentId),
      });

      const updates: Array<{
        packageId: string;
        packageName: string;
        displayName: string;
        installedAt: string | Date;
        packageUpdatedAt: string | Date;
        newComponents: number;
        newSkills: number;
      }> = [];

      for (const inst of installs) {
        const pkg = await ctx.db.query.marketplacePackages.findFirst({
          where: eq(marketplacePackages.id, inst.packageId),
        });
        if (!pkg) continue;

        // 3. Check if package has been updated since install
        const pkgUpdatedAt = pkg.updatedAt;
        const installedAt = inst.installedAt;
        const packageWasUpdated =
          new Date(pkgUpdatedAt).getTime() > new Date(installedAt).getTime();

        // 4. Check for new components added since install (not yet installed on this deployment)
        const pkgComps = await ctx.db.query.packageComponents.findMany({
          where: eq(packageComponents.packageId, pkg.id),
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
        const pkgSkillRows = await ctx.db.query.packageSkills.findMany({
          where: eq(packageSkills.packageId, pkg.id),
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
            packageId: pkg.id,
            packageName: pkg.name,
            displayName: pkg.displayName,
            installedAt,
            packageUpdatedAt: pkgUpdatedAt,
            newComponents,
            newSkills,
          });
        }
      }

      return { updates };
    }),

  upgradePackage: protectedProcedure
    .input(z.object({ packageId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Verify the package is installed
      const install = await ctx.db.query.packageInstalls.findFirst({
        where: and(
          eq(packageInstalls.packageId, input.packageId),
          eq(packageInstalls.deploymentId, input.deploymentId),
        ),
      });
      if (!install) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Package is not installed on this deployment",
        });
      }

      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      }

      // 3. Get current package components and skills
      const pkgComps = await ctx.db.query.packageComponents.findMany({
        where: eq(packageComponents.packageId, pkg.id),
      });
      const pkgSkillRows = await ctx.db.query.packageSkills.findMany({
        where: eq(packageSkills.packageId, pkg.id),
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

      // 6. Update packageInstalls.installedAt to now (marks as "up to date")
      await ctx.db
        .update(packageInstalls)
        .set({ installedAt: dbDate() } as any)
        .where(
          and(
            eq(packageInstalls.packageId, input.packageId),
            eq(packageInstalls.deploymentId, input.deploymentId),
          ),
        );

      logger.info(
        {
          packageId: input.packageId,
          deploymentId: input.deploymentId,
          userId: ctx.user.id,
          newComponents: newlyInstalledComponents.length,
          newSkills: newlyInstalledSkills.length,
        },
        "Package upgraded",
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
            {
              name: comp.name,
              displayName: comp.displayName,
              description: comp.description,
              tier: comp.tier,
              category: comp.category,
              propsSchema: comp.propsSchema ? JSON.parse(comp.propsSchema) : null,
              version: latestVersion?.version ?? "1.0.0",
            },
            comp.exampleProps ?? comp.propsSchema ?? "",
            comp.tier as "template" | "sandbox",
          ).catch((err) =>
            logger.error(
              { err, componentId: compId, deploymentId: input.deploymentId },
              "packages.upgrade: failed to sync component (non-fatal)",
            ),
          );
        }

        // Sync configs to PVC — writes skill files + rebuilds soul.md with packageSnippets
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

  // ── Creator Dashboard ────────────────────────────────────────────────────

  creatorInstalls: protectedProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify the caller owns this package (is the creator)
      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND" });

      const creator = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!creator || creator.id !== pkg.creatorId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the package creator" });
      }

      // Return install list with deployment IDs and timestamps
      const installs = await ctx.db.query.packageInstalls.findMany({
        where: eq(packageInstalls.packageId, input.packageId),
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
    .input(z.object({ packageId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND" });

      const creator = await ctx.db.query.creatorProfiles.findFirst({
        where: eq(creatorProfiles.userId, ctx.user.id),
      });
      if (!creator || creator.id !== pkg.creatorId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the package creator" });
      }

      // Query package_usage for this package
      const usage = await (ctx.db.query as any).packageUsage?.findMany?.({
        where: eq(packageUsage.packageId, input.packageId),
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
    .input(z.object({ packageId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // 2. Look up packageCredentials for this deployment+package
      const cred = await ctx.db.query.packageCredentials.findFirst({
        where: and(
          eq(packageCredentials.deploymentId, input.deploymentId),
          eq(packageCredentials.packageId, input.packageId),
        ),
      });
      if (!cred) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No credentials found for this package installation",
        });
      }

      // 3. Decrypt the old signing secret before generating the new one
      const oldSecret = decryptApiKey(cred.signingSecret);

      // 4. Generate new signing secret
      const newSecret = generateSigningSecret();

      // 5. Encrypt and update the credentials row with the new secret
      await ctx.db
        .update(packageCredentials)
        .set({
          signingSecret: encryptApiKey(newSecret),
          updatedAt: dbDate(),
        } as any)
        .where(eq(packageCredentials.id, cred.id));

      logger.info(
        { packageId: input.packageId, deploymentId: input.deploymentId, credId: cred.id },
        "Signing secret rotated",
      );

      // 6. Notify the creator's API via POST {endpoint}/jarble/rotate
      //    Sign with the OLD secret so the creator can verify the request.
      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });

      if (pkg) {
        const rawConfig = (pkg as Record<string, unknown>).remoteApiConfig as string | null;
        if (rawConfig) {
          const parsed = packageCardSchema.safeParse(JSON.parse(rawConfig));
          if (parsed.success) {
            const rotateBody = {
              action: "rotate" as const,
              packageId: input.packageId,
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
                  { packageId: input.packageId, status: res.status },
                  "Creator rotate webhook returned non-OK (local secret already updated)",
                );
              } else {
                logger.info(
                  { packageId: input.packageId },
                  "Creator rotate webhook acknowledged",
                );
              }
            }).catch((err) => {
              // If the creator's endpoint is down, the local credential is still updated.
              // The creator will need to use an out-of-band mechanism to resync.
              logger.warn(
                { packageId: input.packageId, err },
                "Creator rotate webhook failed (local secret already updated)",
              );
            });
          }
        }
      }

      // 7. Return success
      return { success: true as const };
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

      const packages = await ctx.db.query.marketplacePackages.findMany({
        where: eq(marketplacePackages.status, statusFilter),
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
    .input(z.object({ packageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);

      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      }

      await ctx.db
        .update(marketplacePackages)
        .set({
          status: "published",
          updatedAt: dbDate(),
        } as any)
        .where(eq(marketplacePackages.id, input.packageId));

      logger.info(
        {
          packageId: input.packageId,
          adminUserId: ctx.user.id,
          previousStatus: pkg.status,
        },
        "Package approved by admin",
      );

      return { success: true as const };
    }),

  adminReject: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.id);

      const pkg = await ctx.db.query.marketplacePackages.findFirst({
        where: eq(marketplacePackages.id, input.packageId),
      });
      if (!pkg) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      }

      await ctx.db
        .update(marketplacePackages)
        .set({
          status: "rejected",
          updatedAt: dbDate(),
        } as any)
        .where(eq(marketplacePackages.id, input.packageId));

      logger.info(
        {
          packageId: input.packageId,
          adminUserId: ctx.user.id,
          previousStatus: pkg.status,
          reason: input.reason ?? null,
        },
        "Package rejected by admin",
      );

      return { success: true as const };
    }),
});
