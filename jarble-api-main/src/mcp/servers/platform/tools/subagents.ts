/**
 * Subagent platform tools.
 *
 * Exposes subagent metadata stored in `deploymentSubagents`. Spawn is
 * stubbed until the spawn/execute service lands — today the invocation
 * path goes through OpenClaw's internal dispatch, not a platform service.
 */

import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { tables } from "../../../../db/index.js";
import { registerTool } from "../register.js";
import { jsonResult } from "../_helpers.js";
import { NotFoundError, McpError } from "../../../shared/errors.js";

// ── list_subagents ──────────────────────────────────────────────────────────

registerTool({
  name: "list_subagents",
  description:
    "List the subagents (internal specialists) configured on the calling deployment. Returns slug, name, description, triggerType, and enabled flag for each.",
  server: "platform",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const rows = await ctx.db.query.deploymentSubagents?.findMany?.({
      where: eq(tables.deploymentSubagents.deploymentId, ctx.deploymentId),
      orderBy: [asc(tables.deploymentSubagents.sortOrder)],
    });

    return jsonResult({
      subagents: (rows ?? []).map((r: any) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description ?? null,
        model: r.model ?? null,
        triggerType: r.triggerType,
        enabled: r.enabled,
        source: r.source ?? "custom",
      })),
    });
  },
});

// ── get_subagent ────────────────────────────────────────────────────────────

registerTool({
  name: "get_subagent",
  description:
    "Fetch a single subagent by ID. The subagent must belong to the calling deployment.",
  server: "platform",
  inputSchema: z.object({
    id: z.string().min(1),
  }),
  handler: async (args, ctx) => {
    const row = await ctx.db.query.deploymentSubagents?.findFirst?.({
      where: and(
        eq(tables.deploymentSubagents.id, args.id),
        eq(tables.deploymentSubagents.deploymentId, ctx.deploymentId),
      ),
    });
    if (!row) {
      throw new NotFoundError("Subagent not found on this deployment");
    }
    return jsonResult({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? null,
      systemPrompt: row.systemPrompt,
      model: row.model ?? null,
      triggerType: row.triggerType,
      triggerConfig: row.triggerConfig ?? null,
      tools: row.tools ?? null,
      enabled: row.enabled,
      source: row.source ?? "custom",
    });
  },
});

// ── spawn_subagent ──────────────────────────────────────────────────────────

registerTool({
  name: "spawn_subagent",
  description:
    "Run a subagent with a task. NOT YET IMPLEMENTED at the platform layer — OpenClaw runtimes currently dispatch subagents internally. Calling this tool returns a NOT_IMPLEMENTED error until a platform-side subagent executor ships.",
  server: "platform",
  inputSchema: z.object({
    id: z.string().min(1),
    task: z.string().min(1),
  }),
  handler: async (_args, _ctx) => {
    throw new McpError(
      "NOT_IMPLEMENTED",
      "spawn_subagent is not yet implemented at the platform layer. Subagents currently run inside the OpenClaw runtime and cannot be invoked via MCP from outside the pod. Track this in the infrastructure roadmap.",
    );
  },
});
