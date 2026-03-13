/**
 * Agent LLM endpoints — delegates tasks to specialist LLM agents.
 *
 * POST /api/pod/agent/component  — Component Agent (legacy, preserved)
 * POST /api/pod/agent/:agentName — Generalized agent dispatch
 *
 * Auth: authenticatePod middleware (X-Deployment-Id + X-Gateway-Token)
 */
import { Router, Request, Response } from "express";
import { collectLlmCompletion, LlmMessage } from "../services/llmProxy.js";
import { COMPONENT_AGENT_SYSTEM_PROMPT } from "../prompts/componentAgent.js";
import { DATA_AGENT_SYSTEM_PROMPT } from "../prompts/dataAgent.js";
import { WORKFLOW_AGENT_SYSTEM_PROMPT } from "../prompts/workflowAgent.js";
import { getAgent } from "../services/agentRegistry.js";
import { env } from "../utils/env.js";
import { createModuleLogger } from "../utils/logger.js";

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

  if (!intent || typeof intent !== "string") {
    res.status(400).json({ error: "Missing required field: intent" });
    return;
  }

  const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
  const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
  const model = env.AGENT_LLM_MODEL ?? "anthropic/claude-haiku-4-5-20251001";

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

    res.json({ html, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, intent, err: message }, "Component Agent: generation failed");
    res.status(500).json({ error: `Component generation failed: ${message}` });
  }
});

// ── Generalized agent endpoint ────────────────────────────────────────────

agentRouter.post("/:agentName", async (req: Request, res: Response) => {
  const { agentName } = req.params;

  // Skip if this is the legacy /component endpoint (already handled above)
  if (agentName === "component") return;

  const agentConfig = getAgent(agentName);
  if (!agentConfig) {
    res.status(404).json({ error: `Unknown agent: ${agentName}` });
    return;
  }

  const systemPrompt = AGENT_PROMPTS[agentName];
  if (!systemPrompt) {
    res.status(500).json({ error: `No system prompt configured for agent: ${agentName}` });
    return;
  }

  // Resolve LLM config
  const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
  const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
  const model = req.body.model || agentConfig.defaultModel;

  if (!apiKey) {
    res.status(500).json({ error: `No LLM API key configured for ${agentName} agent` });
    return;
  }

  // Build user message from request body
  // Each agent expects different fields; construct a generic user message
  const body = req.body;
  let userMessage = "";

  switch (agentName) {
    case "data": {
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
    case "workflow": {
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
      // Generic: serialize the entire body as the message
      userMessage = JSON.stringify(body, null, 2);
    }
  }

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const deploymentId = (req as any).podDeploymentId as string;
  logger.info({ deploymentId, agentName, model }, `${agentName} Agent: processing request`);

  try {
    const result = await collectLlmCompletion({
      provider: provider as any,
      apiKey,
      model,
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

    // Try to parse as JSON for structured agents
    if (agentName === "data" || agentName === "workflow") {
      try {
        const parsed = JSON.parse(text);
        res.json({ result: parsed, model, agent: agentName });
        return;
      } catch {
        // If it's not valid JSON, return as text
      }
    }

    res.json({ result: text, model, agent: agentName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, agentName, err: message }, `${agentName} Agent: failed`);
    res.status(500).json({ error: `Agent ${agentName} failed: ${message}` });
  }
});
