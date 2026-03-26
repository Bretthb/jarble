/**
 * Orchestration Flows tRPC Router
 *
 * CRUD for orchestration flow definitions and their execution history.
 * Flows are visual DAGs (nodes + edges) that chain deployments, transforms,
 * conditions, and outputs into multi-step agent pipelines.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { db, tables, dbDate } from "../../db/index.js";
import { eq, ne, desc, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createModuleLogger } from "../../utils/logger.js";
import { customAlphabet } from "nanoid";
import { collectLlmCompletion, type LlmMessage } from "../../services/llmProxy.js";
import { env } from "../../utils/env.js";
import { WORKFLOW_AGENT_SYSTEM_PROMPT } from "../../prompts/workflowAgent.js";

const logger = createModuleLogger("flows");

const { orchestrationFlows, flowExecutions } = tables;

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const generateFlowId = () => `flw_${nanoid()}`;
const generateExecutionId = () => `fex_${nanoid()}`;

// ── Zod Schemas ──────────────────────────────────────────────────────────

const FlowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["deployment", "transform", "condition", "output", "waitForInput", "subflow"]),
  deploymentId: z.string().optional(),
  serviceId: z.string().optional(),
  skillName: z.string().optional(),
  label: z.string().min(1),
  // Bot team fields
  role: z.string().optional(),
  goal: z.string().optional(),
  canDelegate: z.boolean().optional(),
  contextScope: z.enum(["task", "summary", "full"]).optional(),
  modelOverride: z.string().optional(),
  isEntryPoint: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  maxIterations: z.number().int().min(1).max(100).optional(),
});

const FlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.enum(["delegates", "reports", "collaborates"]).optional(),
  contextScope: z.enum(["task", "summary", "full"]).optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
});

const FlowDefinitionSchema = z.object({
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
});

// ── Router ───────────────────────────────────────────────────────────────

export const flowsRouter = router({
  /**
   * List the current user's orchestration flows, with optional status filter.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "published", "archived"]).optional(),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { status, includeArchived = false, limit = 50, offset = 0 } = input ?? {};

      const conditions = [eq(orchestrationFlows.userId, userId)];
      if (status) {
        conditions.push(eq(orchestrationFlows.status, status));
      } else if (!includeArchived) {
        conditions.push(ne(orchestrationFlows.status, "archived"));
      }

      const rows = await db
        .select()
        .from(orchestrationFlows)
        .where(and(...conditions))
        .orderBy(desc(orchestrationFlows.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows;
    }),

  /**
   * Get a single flow by ID, including recent execution history.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const flow = await db
        .select()
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.id),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (flow.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      // Fetch recent executions
      const executions = await db
        .select()
        .from(flowExecutions)
        .where(eq(flowExecutions.flowId, input.id))
        .orderBy(desc(flowExecutions.createdAt))
        .limit(20);

      return { ...flow[0], executions };
    }),

  /**
   * Create a new orchestration flow.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        definition: FlowDefinitionSchema,
        status: z.enum(["draft", "published"]).default("draft"),
        entryNodeId: z.string().optional(),
        teamType: z.enum(["hierarchy", "pipeline", "collaborative"]).default("hierarchy"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const id = generateFlowId();
      const now = dbDate();

      await db.insert(orchestrationFlows).values({
        id,
        userId,
        name: input.name,
        description: input.description ?? null,
        definition: JSON.stringify(input.definition),
        status: input.status,
        isPublic: false,
        forkCount: 0,
        forkedFromId: null,
        entryNodeId: input.entryNodeId ?? null,
        teamType: input.teamType,
        createdAt: now,
        updatedAt: now,
      });

      logger.info({ flowId: id, userId }, "Flow created");

      return { id };
    }),

  /**
   * Update an existing flow (name, description, definition, status).
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional(),
        definition: FlowDefinitionSchema.optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        isPublic: z.boolean().optional(),
        entryNodeId: z.string().nullable().optional(),
        teamType: z.enum(["hierarchy", "pipeline", "collaborative"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify ownership
      const existing = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.id),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      const updates: Record<string, unknown> = { updatedAt: dbDate() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.definition !== undefined) updates.definition = JSON.stringify(input.definition);
      if (input.status !== undefined) updates.status = input.status;
      if (input.isPublic !== undefined) updates.isPublic = input.isPublic;
      if (input.entryNodeId !== undefined) updates.entryNodeId = input.entryNodeId;
      if (input.teamType !== undefined) updates.teamType = input.teamType;

      await db
        .update(orchestrationFlows)
        .set(updates)
        .where(eq(orchestrationFlows.id, input.id));

      logger.info({ flowId: input.id, userId }, "Flow updated");

      return { success: true };
    }),

  /**
   * Delete a flow. If `hard` is true, permanently removes it; otherwise archives.
   */
  delete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        hard: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify ownership
      const existing = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.id),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      if (input.hard) {
        // Hard delete — cascade deletes executions via FK
        await db
          .delete(orchestrationFlows)
          .where(eq(orchestrationFlows.id, input.id));
        logger.info({ flowId: input.id, userId }, "Flow hard-deleted");
      } else {
        // Soft delete — archive
        await db
          .update(orchestrationFlows)
          .set({ status: "archived", updatedAt: dbDate() })
          .where(eq(orchestrationFlows.id, input.id));
        logger.info({ flowId: input.id, userId }, "Flow archived");
      }

      return { success: true };
    }),

  /**
   * Duplicate / fork a flow. Copies the definition and sets forkedFromId.
   * Increments the source flow's forkCount.
   */
  duplicate: protectedProcedure
    .input(
      z.object({
        sourceFlowId: z.string(),
        name: z.string().min(1).max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Fetch the source flow — user must own it OR it must be public
      const source = await db
        .select()
        .from(orchestrationFlows)
        .where(eq(orchestrationFlows.id, input.sourceFlowId))
        .limit(1);

      if (source.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source flow not found",
        });
      }

      const sourceFlow = source[0];

      // Must be owner or flow must be public
      if (sourceFlow.userId !== userId && !sourceFlow.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot fork a private flow you do not own",
        });
      }

      const newId = generateFlowId();
      const now = dbDate();

      await db.insert(orchestrationFlows).values({
        id: newId,
        userId,
        name: input.name ?? `${sourceFlow.name} (copy)`,
        description: sourceFlow.description,
        definition: sourceFlow.definition,
        status: "draft",
        isPublic: false,
        forkCount: 0,
        forkedFromId: input.sourceFlowId,
        entryNodeId: sourceFlow.entryNodeId,
        teamType: sourceFlow.teamType,
        createdAt: now,
        updatedAt: now,
      });

      // Increment source fork count
      await db
        .update(orchestrationFlows)
        .set({ forkCount: sql`${orchestrationFlows.forkCount} + 1` })
        .where(eq(orchestrationFlows.id, input.sourceFlowId));

      logger.info({ newFlowId: newId, sourceFlowId: input.sourceFlowId, userId }, "Flow forked");

      return { id: newId };
    }),

  /**
   * List executions for a given flow (paginated).
   */
  listExecutions: protectedProcedure
    .input(
      z.object({
        flowId: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify flow ownership
      const flow = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.flowId),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (flow.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      const executions = await db
        .select()
        .from(flowExecutions)
        .where(eq(flowExecutions.flowId, input.flowId))
        .orderBy(desc(flowExecutions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return executions;
    }),

  /**
   * Generate a flow definition from natural language using the Workflow Agent LLM.
   * Returns an unsaved FlowDefinition that the user can review and then save via `create`.
   */
  generateFromPrompt: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        availableDeployments: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              skills: z.array(z.string()).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = (env.AGENT_LLM_PROVIDER ?? "openrouter") as
        | "anthropic"
        | "openai"
        | "openrouter"
        | "google";
      const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
      const model = env.AGENT_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";

      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No LLM API key configured for flow generation",
        });
      }

      // Build user message with context about available deployments
      let userMessage = `Goal: ${input.prompt}`;

      if (input.availableDeployments && input.availableDeployments.length > 0) {
        userMessage += "\n\nAvailable services/deployments:\n";
        for (const dep of input.availableDeployments) {
          userMessage += `- ${dep.name} (id: ${dep.id})`;
          if (dep.skills && dep.skills.length > 0) {
            userMessage += ` — skills: ${dep.skills.join(", ")}`;
          }
          userMessage += "\n";
        }
      }

      userMessage +=
        "\n\nReturn ONLY valid JSON matching the output format. Do not include markdown fences.";

      const messages: LlmMessage[] = [
        { role: "system", content: WORKFLOW_AGENT_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ];

      logger.info(
        { userId: ctx.user.id, promptLength: input.prompt.length, model },
        "generateFromPrompt: calling LLM"
      );

      try {
        const result = await collectLlmCompletion({
          provider,
          apiKey,
          model,
          messages,
        });

        // Parse the JSON response — strip markdown fences if present
        let jsonText = result.text.trim();
        if (jsonText.startsWith("```")) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }

        let parsed: {
          plan: Array<{
            step: number;
            action: string;
            service?: string;
            skill?: string;
            component?: string;
            args?: Record<string, unknown>;
            props?: Record<string, unknown>;
            description: string;
            dependsOn?: number[];
            outputKey?: string;
          }>;
          summary?: string;
          estimatedSteps?: number;
          parallelizable?: number[][];
        };

        try {
          parsed = JSON.parse(jsonText);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "LLM returned invalid JSON. Please try rephrasing your prompt.",
          });
        }

        if (!parsed.plan || !Array.isArray(parsed.plan)) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "LLM response missing 'plan' array. Please try again.",
          });
        }

        // Convert the plan steps into FlowDefinition nodes + edges
        const NODE_SPACING_X = 280;
        const NODE_SPACING_Y = 0;
        const NODES_PER_ROW = 5;

        const nodes = parsed.plan.map((step, i) => {
          const col = i % NODES_PER_ROW;
          const row = Math.floor(i / NODES_PER_ROW);

          // Map action types to flow node types
          let type: "deployment" | "transform" | "condition" | "output" = "deployment";
          if (step.action === "render_ui" || step.action === "output") type = "output";
          else if (step.action === "transform" || step.action === "filter") type = "transform";
          else if (step.action === "condition" || step.action === "branch") type = "condition";

          // Find the deployment ID if the step references a known service
          let deploymentId: string | undefined;
          if (step.service && input.availableDeployments) {
            const match = input.availableDeployments.find(
              (d) =>
                d.name.toLowerCase() === step.service!.toLowerCase() ||
                d.id === step.service
            );
            if (match) deploymentId = match.id;
          }

          return {
            id: `n${step.step}`,
            type,
            label: step.description || `Step ${step.step}`,
            position: {
              x: col * NODE_SPACING_X,
              y: row * (NODE_SPACING_Y + 150),
            },
            deploymentId,
            skillName: step.skill,
            config: step.args || step.props || undefined,
          };
        });

        // Build edges from dependsOn relationships
        const edges: Array<{
          id: string;
          source: string;
          target: string;
          label?: string;
        }> = [];

        let edgeIdx = 0;
        for (const step of parsed.plan) {
          if (step.dependsOn && step.dependsOn.length > 0) {
            for (const dep of step.dependsOn) {
              edges.push({
                id: `e${edgeIdx++}`,
                source: `n${dep}`,
                target: `n${step.step}`,
              });
            }
          } else if (step.step > 1) {
            // If no explicit dependsOn, chain sequentially from previous step
            edges.push({
              id: `e${edgeIdx++}`,
              source: `n${step.step - 1}`,
              target: `n${step.step}`,
            });
          }
        }

        const definition = { nodes, edges };

        logger.info(
          {
            userId: ctx.user.id,
            nodeCount: nodes.length,
            edgeCount: edges.length,
          },
          "generateFromPrompt: flow generated"
        );

        return {
          definition,
          summary: parsed.summary ?? null,
          estimatedSteps: parsed.estimatedSteps ?? nodes.length,
          parallelizable: parsed.parallelizable ?? null,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { userId: ctx.user.id, err: message },
          "generateFromPrompt: LLM call failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Flow generation failed: ${message}`,
        });
      }
    }),
});
