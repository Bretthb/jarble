/**
 * Parallel Dashboard Composition — fans out N component agent calls concurrently.
 *
 * POST /api/pod/compose
 * Auth: authenticatePod (X-Deployment-Id + X-Gateway-Token)
 * Body: { title, components: [{ intent, style?, data? }], theme? }
 *
 * Each component spec is dispatched to the Component Agent (same system prompt
 * as POST /api/pod/agent/component) in parallel via Promise.allSettled().
 * Results are returned as jarble_ui JSON strings ready for MCP response.
 */
import { Router, Request, Response } from "express";
import { collectLlmCompletion, LlmMessage } from "../services/llmProxy.js";
import { COMPONENT_AGENT_SYSTEM_PROMPT } from "../prompts/componentAgent.js";
import { env } from "../utils/env.js";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("compose");

const MAX_COMPONENTS = 8;
const TIMEOUT_MS = 60_000;

export const composeRouter = Router();

interface ComponentSpec {
  intent: string;
  style?: string;
  data?: unknown;
}

interface ComposeBody {
  title: string;
  components: ComponentSpec[];
  theme?: string;
}

/**
 * Call the Component Agent for a single component spec.
 * Returns the raw HTML string on success.
 */
async function callComponentAgent(
  spec: ComponentSpec,
  theme: string | undefined,
  provider: string,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  let userMessage = `Create a component: ${spec.intent}`;
  if (spec.data !== undefined) {
    userMessage += `\n\nData to embed/visualize:\n${JSON.stringify(spec.data, null, 2)}`;
  }
  if (spec.style) {
    userMessage += `\n\nVisual style: ${spec.style}`;
  }
  if (theme) {
    userMessage += `\n\nPreferred theme: ${theme}`;
  }

  const messages: LlmMessage[] = [
    { role: "system", content: COMPONENT_AGENT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const result = await collectLlmCompletion({
    provider: provider as any,
    apiKey,
    model,
    messages,
    signal,
  });

  let html = result.text.trim();
  // Strip markdown fences if the agent wrapped it
  if (html.startsWith("```")) {
    html = html.replace(/^```(?:html)?\n?/, "").replace(/\n?```$/, "");
  }
  return html;
}

composeRouter.post("/", async (req: Request, res: Response) => {
  const { title, components, theme } = req.body as ComposeBody;

  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "Missing required field: title" });
    return;
  }
  if (!Array.isArray(components) || components.length === 0) {
    res.status(400).json({ error: "Missing or empty components array" });
    return;
  }
  if (components.length > MAX_COMPONENTS) {
    res.status(400).json({ error: `Maximum ${MAX_COMPONENTS} components per compose call` });
    return;
  }

  // Validate each component has a non-empty intent
  for (let i = 0; i < components.length; i++) {
    if (!components[i].intent || typeof components[i].intent !== "string" || components[i].intent.trim() === "") {
      res.status(400).json({ error: `Component ${i + 1}: missing or empty 'intent' string` });
      return;
    }
  }

  const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
  const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
  const model = env.AGENT_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";

  if (!apiKey) {
    res.status(500).json({ error: "No LLM API key configured for component agent" });
    return;
  }

  const deploymentId = (req as any).podDeploymentId as string;
  const dashboardId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  logger.info(
    { deploymentId, title, componentCount: components.length, dashboardId, model },
    "Compose: starting parallel component generation",
  );

  const startTime = Date.now();

  // Fan out all component agent calls in parallel with per-call timeout
  const results = await Promise.allSettled(
    components.map((spec, index) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      return callComponentAgent(spec, theme, provider, apiKey, model, controller.signal)
        .then((html) => {
          clearTimeout(timeout);
          return { index, html, intent: spec.intent };
        })
        .catch((err) => {
          clearTimeout(timeout);
          throw { index, intent: spec.intent, message: err instanceof Error ? err.message : String(err) };
        });
    }),
  );

  const blocks: string[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { html, intent } = result.value;
      blocks.push(
        JSON.stringify({
          component: "sandbox",
          props: {
            html,
            title: intent,
          },
          dashboardId,
          dashboardTitle: title,
        }),
      );
    } else {
      const reason = result.reason as { index: number; intent: string; message: string };
      errors.push(`Component ${reason.index + 1} ("${reason.intent}"): ${reason.message}`);
      logger.warn(
        { deploymentId, dashboardId, index: reason.index, intent: reason.intent, error: reason.message },
        "Compose: component generation failed",
      );
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info(
    { deploymentId, dashboardId, succeeded: blocks.length, failed: errors.length, elapsed },
    "Compose: parallel generation complete",
  );

  res.json({ blocks, dashboardId, errors });
});
