/**
 * Deployment capability introspection tools.
 *
 * Lets an agent see its own capability manifest (runtime, subagents,
 * skills, LLM summary) and, with ownership scoping, peek at a teammate
 * deployment's manifest. Backed by `services/deploymentCapabilities.ts`.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { tables } from "../../../../db/index.js";
import { registerTool } from "../register.js";
import { jsonResult } from "../_helpers.js";
import { NotFoundError, ForbiddenError } from "../../../shared/errors.js";
import { getDeploymentCapabilities } from "../../../../services/deploymentCapabilities.js";

// ── get_my_capabilities ─────────────────────────────────────────────────────

registerTool({
  name: "get_my_capabilities",
  description:
    "Return the capabilities manifest for the calling deployment: runtime, subagent list, installed skills, and a short LLM summary.",
  server: "platform",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const caps = await getDeploymentCapabilities(ctx.deploymentId);
    if (!caps) {
      throw new NotFoundError("Deployment not found");
    }
    return jsonResult(caps);
  },
});

// ── discover_deployment_capabilities ────────────────────────────────────────

registerTool({
  name: "discover_deployment_capabilities",
  description:
    "Introspect another deployment's capabilities manifest. The caller must own the target deployment, otherwise the call is rejected.",
  server: "platform",
  inputSchema: z.object({
    deploymentId: z.string().min(1).max(255),
  }),
  handler: async (args, ctx) => {
    // Ownership check — the caller can only inspect deployments they own.
    const target = await ctx.db.query.deployments.findFirst({
      where: and(
        eq(tables.deployments.id, args.deploymentId),
        eq(tables.deployments.userId, ctx.userId),
      ),
      columns: { id: true },
    });
    if (!target) {
      // Deliberately use Forbidden (not NotFound) when the id exists but is
      // owned by someone else. We can't cheaply tell the two apart without a
      // second query, so we return Forbidden for both — no IDOR leak.
      throw new ForbiddenError(
        "Deployment not found or not owned by the calling user",
      );
    }

    const caps = await getDeploymentCapabilities(args.deploymentId);
    if (!caps) {
      throw new NotFoundError("Deployment not found");
    }
    return jsonResult(caps);
  },
});
