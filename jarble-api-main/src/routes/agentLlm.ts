/**
 * Agent LLM endpoints - delegates tasks to specialist LLM agents.
 *
 * POST /api/pod/agent/component  - Component Agent (legacy, preserved)
 * POST /api/pod/agent/:agentName - Generalized agent dispatch
 *
 * Auth: authenticatePod middleware (X-Deployment-Id + X-Gateway-Token)
 *
 * Dynamic subagents: If :agentName is not a static platform agent,
 * we fall back to a DB lookup for user-configured subagents by slug.
 */
import { Router, Request, Response } from "express";
import { collectLlmCompletion, LlmMessage } from "../services/llmProxy.js";
import { COMPONENT_AGENT_SYSTEM_PROMPT } from "../prompts/componentAgent.js";
import { DATA_AGENT_SYSTEM_PROMPT } from "../prompts/dataAgent.js";
import { WORKFLOW_AGENT_SYSTEM_PROMPT } from "../prompts/workflowAgent.js";
import { getAgent } from "../services/agentRegistry.js";
import { db, tables } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { env } from "../utils/env.js";
import { createModuleLogger } from "../utils/logger.js";
import { emitOrchestrationStart, emitOrchestrationEnd, type OrchestrationStepEvent } from "../utils/agentCallEvents.js";

const logger = createModuleLogger("agentLlm");

/** Map agent name -> system prompt (loaded at startup) */
const AGENT_PROMPTS: Record<string, string> = {
  component: COMPONENT_AGENT_SYSTEM_PROMPT,
  data: DATA_AGENT_SYSTEM_PROMPT,
  workflow: WORKFLOW_AGENT_SYSTEM_PROMPT,
};

export const agentRouter = Router();

// ── Legacy component endpoint (preserved for backward compatibility) ──────

agentRouter.post("/component", async (req: Request, res: Response) => {
  const { intent, data, theme, constraints } = req.body;
  // Block create_component when custom subagents exist — route through subagents instead
  const componentDepId = (req as any).podDeploymentId as string;
  if (componentDepId) {
    try {
      const dsa = (tables as any).deploymentSubagents;
      if (dsa) {
        const hasCustom = await (db.query as any).deploymentSubagents?.findFirst?.({
          where: and(
            eq(dsa.deploymentId, componentDepId),
            eq(dsa.enabled, true),
          ),
        });
        if (hasCustom && hasCustom.source !== "platform") {
          logger.info({ deploymentId: componentDepId }, "create_component blocked — deployment has custom subagents");
          res.status(400).json({
            error: "create_component is disabled for this deployment. Use custom subagents via jarble_delegate.",
          });
          return;
        }
      }
    } catch { /* non-fatal */ }
  }

  if (!intent || typeof intent !== "string") {
    res.status(400).json({ error: "Missing required field: intent" });
    return;
  }

  const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
  const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
  const model = env.AGENT_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";

  if (!apiKey) {
    res.status(500).json({ error: "No LLM API key configured for component agent" });
    return;
  }

  let userMessage = `Create a component: ${intent}`;
  if (data !== undefined) {
    userMessage += `\n\nData to embed/visualize:\n${JSON.stringify(data, null, 2)}`;
  }
  if (theme) {
    userMessage += `\n\nPreferred theme: ${theme}`;
  }
  if (constraints) {
    userMessage += `\n\nAdditional constraints: ${constraints}`;
  }

  const messages: LlmMessage[] = [
    { role: "system", content: COMPONENT_AGENT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const deploymentId = (req as any).podDeploymentId as string;
  logger.info({ deploymentId, intent, model }, "Component Agent: generating component");

  const stepEvent: OrchestrationStepEvent = {
    deploymentId,
    stepId: `platform-component-${Date.now()}`,
    agentType: "platform",
    agentName: "Component Agent",
    toolName: "create_component",
    task: userMessage.slice(0, 200),
  };
  emitOrchestrationStart(stepEvent);
  const startTime = Date.now();

  try {
    const result = await collectLlmCompletion({
      provider: provider as any,
      apiKey,
      model,
      messages,
    });

    let html = result.text.trim();
    if (html.startsWith("```")) {
      html = html.replace(/^```(?:html)?\n?/, "").replace(/\n?```$/, "");
    }

    logger.info(
      { deploymentId, intent, htmlLength: html.length },
      "Component Agent: component generated",
    );

    emitOrchestrationEnd({
      ...stepEvent,
      success: true,
      durationMs: Date.now() - startTime,
      resultPreview: html.slice(0, 200),
    });

    res.json({ html, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, intent, err: message }, "Component Agent: generation failed");
    emitOrchestrationEnd({
      ...stepEvent,
      success: false,
      durationMs: Date.now() - startTime,
      error: message,
    });
    res.status(500).json({ error: `Component generation failed: ${message}` });
  }
});

// ── Generalized agent endpoint ────────────────────────────────────────────
// Unified lookup: DB first (supports customized platform agents + custom subagents),
// then fall back to static AGENT_PROMPTS registry for un-seeded deployments.

agentRouter.post("/:agentName", async (req: Request, res: Response) => {
  const { agentName } = req.params;

  // Skip if this is the legacy /component endpoint (already handled above)
  if (agentName === "component") return;

  const deploymentId = (req as any).podDeploymentId as string;

  // ── Step 1: DB lookup (handles both platform and custom agents) ────────
  const deploymentSubagents = (tables as any).deploymentSubagents;
  let dbAgent: any = null;

  if (deploymentSubagents && deploymentId) {
    try {
      dbAgent = await (db.query as any).deploymentSubagents?.findFirst?.({
        where: and(
          eq(deploymentSubagents.slug, agentName),
          eq(deploymentSubagents.deploymentId, deploymentId),
        ),
      });
    } catch (err) {
      // DB lookup failed - fall through to static registry
      logger.warn({ deploymentId, agentName, err }, "DB agent lookup failed, falling back to static registry");
    }
  }

  // If found in DB but disabled, return 404 (user toggled it off)
  if (dbAgent && !dbAgent.enabled) {
    res.status(404).json({ error: `Agent ${agentName} is disabled for this deployment` });
    return;
  }

  // ── Step 2: Resolve agent config ───────────────────────────────────────
  // DB agent takes priority; fall back to static registry for backward compat
  const agentConfig = getAgent(agentName);
  let resolvedSystemPrompt: string | undefined;
  let resolvedModel: string;
  let agentType: "platform" | "subagent";
  let resolvedAgentName: string;
  let resolvedToolName: string;

  if (dbAgent) {
    // Use DB row (may have been customized by user)
    resolvedSystemPrompt = dbAgent.systemPrompt;
    resolvedModel = req.body.model || dbAgent.model || (agentConfig?.defaultModel) || env.AGENT_LLM_MODEL || "anthropic/claude-sonnet-4-20250514";
    agentType = dbAgent.source === "platform" ? "platform" : "subagent";
    resolvedAgentName = dbAgent.name;
    resolvedToolName = agentConfig?.toolName || `agent_${agentName}`;
  } else if (agentConfig) {
    // Fall back to static registry (un-seeded deployments)
    resolvedSystemPrompt = AGENT_PROMPTS[agentName];
    resolvedModel = req.body.model || agentConfig.defaultModel;
    agentType = "platform";
    resolvedAgentName = agentConfig.name || agentName;
    resolvedToolName = agentConfig.toolName || agentName;
  } else {
    // Not found anywhere
    res.status(404).json({ error: `Unknown agent: ${agentName}` });
    return;
  }

  if (!resolvedSystemPrompt) {
    res.status(404).json({ error: `Unknown agent: ${agentName}` });
    return;
  }

  // ── Step 3: Resolve LLM credentials ────────────────────────────────────
  const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
  const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: `No LLM API key configured for ${agentName} agent` });
    return;
  }

  // ── Step 4: Build user message from request body ───────────────────────
  const body = req.body;
  let userMessage = "";

  switch (agentName) {
    case "data":
    case "data_agent": {
      userMessage = `Task: ${body.task || "Analyze the data"}`;
      if (body.data !== undefined) {
        const dataStr = typeof body.data === "string" ? body.data : JSON.stringify(body.data, null, 2);
        userMessage += `\n\nData:\n${dataStr}`;
      }
      if (body.outputFormat) {
        userMessage += `\n\nOutput format: ${body.outputFormat}`;
      }
      break;
    }
    case "workflow":
    case "workflow_agent": {
      userMessage = `Goal: ${body.goal || "Plan a workflow"}`;
      if (body.availableServices) {
        userMessage += `\n\nAvailable services: ${JSON.stringify(body.availableServices)}`;
      }
      if (body.constraints) {
        userMessage += `\n\nConstraints: ${body.constraints}`;
      }
      break;
    }
    default: {
      // Generic: try structured fields first, then serialize entire body
      userMessage = body.task || body.intent || "";
      if (body.context) {
        userMessage += `\n\nContext:\n${typeof body.context === "string" ? body.context : JSON.stringify(body.context, null, 2)}`;
      }
      if (body.data !== undefined) {
        const dataStr = typeof body.data === "string" ? body.data : JSON.stringify(body.data, null, 2);
        userMessage += `\n\nData:\n${dataStr}`;
      }
      if (!userMessage) {
        userMessage = JSON.stringify(body, null, 2);
      }
    }
  }

  const messages: LlmMessage[] = [
    { role: "system", content: resolvedSystemPrompt },
    { role: "user", content: userMessage },
  ];

  // ── Step 5: Execute LLM call ───────────────────────────────────────────
  logger.info({ deploymentId, agentName, model: resolvedModel, agentType, fromDb: !!dbAgent }, `${agentName} Agent: processing request`);

  const stepEvent: OrchestrationStepEvent = {
    deploymentId,
    stepId: `${agentType}-${agentName}-${Date.now()}`,
    agentType,
    agentName: resolvedAgentName,
    toolName: resolvedToolName,
    task: userMessage.slice(0, 200),
  };
  emitOrchestrationStart(stepEvent);
  const startTime = Date.now();

  try {
    const result = await collectLlmCompletion({
      provider: provider as any,
      apiKey,
      model: resolvedModel,
      messages,
    });

    let text = result.text.trim();

    // Strip markdown fences
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json|html|markdown)?\n?/, "").replace(/\n?```$/, "");
    }

    logger.info(
      { deploymentId, agentName, responseLength: text.length },
      `${agentName} Agent: completed`,
    );

    emitOrchestrationEnd({
      ...stepEvent,
      success: true,
      durationMs: Date.now() - startTime,
      resultPreview: text.slice(0, 200),
    });

    // Try to parse as JSON for structured agents
    try {
      const parsed = JSON.parse(text);
      res.json({ result: parsed, model: resolvedModel, agent: agentName });
      return;
    } catch {
      // Not JSON - return as text
    }

    res.json({ result: text, model: resolvedModel, agent: agentName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, agentName, err: message }, `${agentName} Agent: failed`);
    emitOrchestrationEnd({
      ...stepEvent,
      success: false,
      durationMs: Date.now() - startTime,
      error: message,
    });
    res.status(500).json({ error: `Agent ${agentName} failed: ${message}` });
  }
});
