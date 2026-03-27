/**
 * Parallel Dashboard Composition — 3-phase mixed-type pipeline.
 *
 * POST /api/pod/compose
 * Auth: authenticatePod (X-Deployment-Id + X-Gateway-Token)
 * Body: { title, components: [{ intent, style?, data? }], theme?, mode? }
 *
 * Phase 1 — PLAN:   Single LLM call decomposes the request into typed slots
 * Phase 2 — GENERATE: Parallel fan-out — native slots get JSON props, sandbox slots get HTML
 * Phase 3 — SYNTHESIZE: Validate native props, autofix, order, assign dashboardId
 *
 * mode: "auto" (default) — uses planner for mixed native+sandbox
 *       "sandbox-only" — legacy behavior, all sandbox HTML
 */
import { Router, Request, Response } from "express";
import { collectLlmCompletion, LlmMessage } from "../services/llmProxy.js";
import { COMPONENT_AGENT_SYSTEM_PROMPT } from "../prompts/componentAgent.js";
import { DASHBOARD_PLANNER_SYSTEM_PROMPT } from "../prompts/dashboardPlanner.js";
import { NATIVE_COMPONENT_AGENT_SYSTEM_PROMPT } from "../prompts/nativeComponentAgent.js";
import { resolveThemeTokens, tokensToCss } from "../prompts/themeTokens.js";
import { validateJsonSchema, autofixNativeProps } from "../utils/jsonSchemaValidator.js";
import { runPipelineQA, type QAReport } from "../utils/qaValidators.js";
import { env } from "../utils/env.js";
import { createModuleLogger } from "../utils/logger.js";
import { emitOrchestrationStart, emitOrchestrationEnd, type OrchestrationStepEvent } from "../utils/agentCallEvents.js";
import * as fs from "fs";
import * as path from "path";

const logger = createModuleLogger("compose");

const MAX_COMPONENTS = 8;
const GENERATE_TIMEOUT_MS = 45_000;
const PLANNER_TIMEOUT_MS = 15_000;

export const composeRouter = Router();

// ── Load component JSON schemas for native validation ─────────────────────────

let componentSchemas: Record<string, Record<string, unknown>> = {};

try {
  // Resolve via @jarble/component-manifest package — its index.ts is in shared/component-manifest/
  // The generated JSON sits alongside it in generated/component-data.json
  const manifestDir = path.resolve(__dirname, "../../..", "shared", "component-manifest");
  const schemaPath = path.join(manifestDir, "generated", "component-data.json");
  const raw = fs.readFileSync(schemaPath, "utf-8");
  const data = JSON.parse(raw);
  componentSchemas = data.schemas || {};
  logger.info({ schemaCount: Object.keys(componentSchemas).length }, "Loaded component JSON schemas for native validation");
} catch (err) {
  logger.warn({ err: (err as Error).message }, "Could not load component-data.json schemas — native validation will be skipped");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComponentSpec {
  intent: string;
  style?: string;
  data?: unknown;
}

interface ComposeBody {
  title: string;
  components: ComponentSpec[];
  theme?: string;
  mode?: "auto" | "sandbox-only";
}

interface PlannerSlot {
  type: "native" | "sandbox";
  component?: string;
  intent: string;
  colSpan?: number;
  data?: unknown;
  style?: string;
}

interface DashboardPlan {
  title: string;
  layout: { columns: number; rows: Array<{ slots: PlannerSlot[] }> };
  themeHint?: string;
  sharedContext?: string;
}

// ── Phase 1: Planner Agent ────────────────────────────────────────────────────

async function callPlannerAgent(
  title: string,
  components: ComponentSpec[],
  theme: string | undefined,
  provider: string,
  apiKey: string,
  model: string,
): Promise<DashboardPlan | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);

  try {
    const userMessage = JSON.stringify({
      title,
      components: components.map((c) => ({
        intent: c.intent,
        style: c.style,
        hasData: c.data !== undefined,
      })),
      theme: theme || "dark",
    });

    const messages: LlmMessage[] = [
      { role: "system", content: DASHBOARD_PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const result = await collectLlmCompletion({
      provider: provider as any,
      apiKey,
      model,
      messages,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Parse JSON — strip markdown fences if the LLM wrapped it
    let jsonText = result.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const plan = JSON.parse(jsonText) as DashboardPlan;

    // Basic validation
    if (!plan.layout?.rows || !Array.isArray(plan.layout.rows)) return null;

    // Flatten slots and attach original data/style from component specs
    let slotIndex = 0;
    for (const row of plan.layout.rows) {
      if (!Array.isArray(row.slots)) continue;
      for (const slot of row.slots) {
        // Match slot back to original component spec by index
        if (slotIndex < components.length) {
          if (components[slotIndex].data !== undefined) {
            slot.data = components[slotIndex].data;
          }
          if (components[slotIndex].style) {
            slot.style = components[slotIndex].style;
          }
        }
        slotIndex++;
      }
    }

    return plan;
  } catch (err) {
    clearTimeout(timeout);
    logger.warn({ err }, "Planner agent failed — falling back to sandbox-only");
    return null;
  }
}

// ── Phase 2a: Sandbox Agent (existing) ────────────────────────────────────────

async function callSandboxAgent(
  spec: { intent: string; style?: string; data?: unknown },
  themeCss: string,
  sharedContext: string | undefined,
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
  if (sharedContext) {
    userMessage += `\n\nDashboard context: ${sharedContext}`;
  }
  userMessage += `\n\nUse these CSS custom properties for visual consistency with other dashboard components:\n${themeCss}`;

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
  if (html.startsWith("```")) {
    html = html.replace(/^```(?:html)?\n?/, "").replace(/\n?```$/, "");
  }
  return html;
}

// ── Phase 2b: Native Component Agent ──────────────────────────────────────────

async function callNativeAgent(
  componentName: string,
  intent: string,
  data: unknown | undefined,
  chartPalette: string[],
  sharedContext: string | undefined,
  provider: string,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<{ component: string; props: Record<string, unknown> }> {
  // Get the JSON Schema for this component
  const schema = componentSchemas[componentName];
  const schemaStr = schema ? JSON.stringify(schema, null, 2) : "No schema available — use your best judgment.";

  let userMessage = `Component: ${componentName}\nIntent: ${intent}`;
  if (data !== undefined) {
    userMessage += `\n\nData to include:\n${JSON.stringify(data, null, 2)}`;
  }
  if (sharedContext) {
    userMessage += `\n\nDashboard context: ${sharedContext}`;
  }
  userMessage += `\n\nChart palette: ${JSON.stringify(chartPalette)}`;
  userMessage += `\n\nJSON Schema for "${componentName}":\n${schemaStr}`;

  const messages: LlmMessage[] = [
    { role: "system", content: NATIVE_COMPONENT_AGENT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const result = await collectLlmCompletion({
    provider: provider as any,
    apiKey,
    model,
    messages,
    signal,
  });

  let jsonText = result.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(jsonText);
  const component = parsed.component || componentName;
  let props = parsed.props || parsed;

  // Remove component key if it leaked into props
  if (props.component) delete props.component;

  // Autofix common LLM errors
  props = autofixNativeProps(component, props);

  // Validate against JSON Schema
  if (schema) {
    const errors = validateJsonSchema(props, schema);
    if (errors.length > 0) {
      logger.warn({ component, errors }, "Native props validation errors (post-autofix)");
      // Still return — frontend autoFixProps will catch remaining issues
    }
  }

  return { component, props };
}

// ── Phase 3: Synthesize ───────────────────────────────────────────────────────

interface GeneratedBlock {
  type: "native" | "sandbox";
  slotIndex: number;
  block: string; // JSON string ready for jarble_ui fence
}

function synthesize(
  blocks: GeneratedBlock[],
  dashboardId: string,
  title: string,
): string[] {
  // Sort by original slot index to maintain layout order
  blocks.sort((a, b) => a.slotIndex - b.slotIndex);
  return blocks.map((b) => b.block);
}

// ── Main Handler ──────────────────────────────────────────────────────────────

composeRouter.post("/", async (req: Request, res: Response) => {
  const { title, components, theme, mode } = req.body as ComposeBody;

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

  for (let i = 0; i < components.length; i++) {
    if (!components[i].intent || typeof components[i].intent !== "string" || components[i].intent.trim() === "") {
      res.status(400).json({ error: `Component ${i + 1}: missing or empty 'intent' string` });
      return;
    }
  }

  const provider = env.AGENT_LLM_PROVIDER ?? "openrouter";
  const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
  const model = env.AGENT_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";
  const plannerModel = env.PLANNER_LLM_MODEL ?? model;

  if (!apiKey) {
    res.status(500).json({ error: "No LLM API key configured for component agent" });
    return;
  }

  const deploymentId = (req as any).podDeploymentId as string;
  const dashboardId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  logger.info(
    { deploymentId, title, componentCount: components.length, dashboardId, model, mode: mode || "auto" },
    "Compose: starting",
  );

  const startTime = Date.now();
  const themeTokens = resolveThemeTokens(theme);
  const themeCss = tokensToCss(themeTokens);

  // ── Sandbox-only mode (legacy) ──────────────────────────────────────────────
  if (mode === "sandbox-only") {
    return runSandboxOnly(
      components, theme, themeCss, provider, apiKey, model,
      deploymentId, dashboardId, title, startTime, res,
    );
  }

  // ── Phase 1: Plan ───────────────────────────────────────────────────────────
  const planStart = Date.now();
  const plan = await callPlannerAgent(title, components, theme, provider, apiKey, plannerModel);
  const planElapsed = Date.now() - planStart;

  if (!plan) {
    logger.info({ deploymentId, planElapsed }, "Compose: planner failed, falling back to sandbox-only");
    return runSandboxOnly(
      components, theme, themeCss, provider, apiKey, model,
      deploymentId, dashboardId, title, startTime, res,
    );
  }

  logger.info(
    { deploymentId, dashboardId, planElapsed, slots: countSlots(plan) },
    "Compose: plan complete",
  );

  // ── Phase 2: Generate (parallel fan-out) ────────────────────────────────────
  const generateStart = Date.now();
  const slots = flattenSlots(plan);
  const generatedBlocks: GeneratedBlock[] = [];
  const errors: string[] = [];

  const results = await Promise.allSettled(
    slots.map((slot, index) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

      const stepEvent: OrchestrationStepEvent = {
        deploymentId,
        stepId: `compose-${dashboardId}-slot-${index}`,
        agentType: "platform",
        agentName: "Component Agent",
        toolName: "create_component",
        task: slot.intent.slice(0, 200),
      };
      emitOrchestrationStart(stepEvent);
      const slotStartTime = Date.now();

      if (slot.type === "native" && slot.component) {
        return callNativeAgent(
          slot.component, slot.intent, slot.data, themeTokens.chartPalette,
          plan.sharedContext, provider, apiKey, model, controller.signal,
        )
          .then(({ component, props }) => {
            clearTimeout(timeout);
            const block = JSON.stringify({
              component,
              props,
              dashboardId,
              dashboardTitle: title,
            });
            emitOrchestrationEnd({
              ...stepEvent,
              success: true,
              durationMs: Date.now() - slotStartTime,
              resultPreview: block.slice(0, 200),
            });
            return {
              type: "native" as const,
              slotIndex: index,
              block,
            };
          })
          .catch((err) => {
            clearTimeout(timeout);
            const message = err instanceof Error ? err.message : String(err);
            emitOrchestrationEnd({
              ...stepEvent,
              success: false,
              durationMs: Date.now() - slotStartTime,
              error: message,
            });
            throw { index, intent: slot.intent, type: "native", message };
          });
      } else {
        return callSandboxAgent(
          { intent: slot.intent, style: slot.style, data: slot.data },
          themeCss, plan.sharedContext, provider, apiKey, model, controller.signal,
        )
          .then((html) => {
            clearTimeout(timeout);
            const block = JSON.stringify({
              component: "sandbox",
              props: { html, title: slot.intent },
              dashboardId,
              dashboardTitle: title,
            });
            emitOrchestrationEnd({
              ...stepEvent,
              success: true,
              durationMs: Date.now() - slotStartTime,
              resultPreview: block.slice(0, 200),
            });
            return {
              type: "sandbox" as const,
              slotIndex: index,
              block,
            };
          })
          .catch((err) => {
            clearTimeout(timeout);
            const message = err instanceof Error ? err.message : String(err);
            emitOrchestrationEnd({
              ...stepEvent,
              success: false,
              durationMs: Date.now() - slotStartTime,
              error: message,
            });
            throw { index, intent: slot.intent, type: "sandbox", message };
          });
      }
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      generatedBlocks.push(result.value);
    } else {
      const reason = result.reason as { index: number; intent: string; type: string; message: string };
      errors.push(`Slot ${reason.index + 1} (${reason.type}: "${reason.intent}"): ${reason.message}`);
      logger.warn(
        { deploymentId, dashboardId, index: reason.index, type: reason.type, intent: reason.intent, error: reason.message },
        "Compose: slot generation failed",
      );
    }
  }

  // ── Phase 3: Synthesize + QA ─────────────────────────────────────────────
  // Run QA validators on generated blocks (synchronous, no LLM cost)
  const qaBlocks = generatedBlocks.map((b) => {
    const parsed = JSON.parse(b.block);
    return {
      type: b.type,
      slotIndex: b.slotIndex,
      component: parsed.component as string,
      props: parsed.props as Record<string, unknown>,
      html: b.type === "sandbox" ? (parsed.props?.html as string) : undefined,
    };
  });
  const qa = runPipelineQA(qaBlocks, componentSchemas);

  // Apply QA auto-fixes back into blocks
  for (let i = 0; i < generatedBlocks.length; i++) {
    const qaBlock = qaBlocks[i];
    const parsed = JSON.parse(generatedBlocks[i].block);
    let modified = false;

    if (qaBlock.type === "sandbox" && qaBlock.html && parsed.props?.html !== qaBlock.html) {
      parsed.props.html = qaBlock.html;
      modified = true;
    }
    if (qaBlock.type === "native" && JSON.stringify(parsed.props) !== JSON.stringify(qaBlock.props)) {
      parsed.props = qaBlock.props;
      modified = true;
    }
    if (modified) {
      generatedBlocks[i].block = JSON.stringify(parsed);
    }
  }

  const blocks = synthesize(generatedBlocks, dashboardId, title);

  const elapsed = Date.now() - startTime;
  const generateElapsed = Date.now() - generateStart;
  const nativeCount = generatedBlocks.filter((b) => b.type === "native").length;
  const sandboxCount = generatedBlocks.filter((b) => b.type === "sandbox").length;

  logger.info(
    { deploymentId, dashboardId, native: nativeCount, sandbox: sandboxCount, failed: errors.length, qaWarnings: qa.totalWarnings, qaFixes: qa.totalFixes, planElapsed, generateElapsed, elapsed },
    "Compose: complete",
  );

  res.json({ blocks, dashboardId, errors, mode: "mixed", plan: { columns: plan.layout.columns, slots: slots.length }, qa });
});

// ── Sandbox-only fallback ─────────────────────────────────────────────────────

async function runSandboxOnly(
  components: ComponentSpec[],
  theme: string | undefined,
  themeCss: string,
  provider: string,
  apiKey: string,
  model: string,
  deploymentId: string,
  dashboardId: string,
  title: string,
  startTime: number,
  res: Response,
) {
  const results = await Promise.allSettled(
    components.map((spec, index) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

      return callSandboxAgent(
        spec, themeCss, undefined, provider, apiKey, model, controller.signal,
      )
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
          props: { html, title: intent },
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
    { deploymentId, dashboardId, succeeded: blocks.length, failed: errors.length, elapsed, mode: "sandbox-only" },
    "Compose: sandbox-only complete",
  );

  res.json({ blocks, dashboardId, errors, mode: "sandbox-only" });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flattenSlots(plan: DashboardPlan): PlannerSlot[] {
  const slots: PlannerSlot[] = [];
  for (const row of plan.layout.rows) {
    if (!Array.isArray(row.slots)) continue;
    for (const slot of row.slots) {
      slots.push(slot);
    }
  }
  return slots.slice(0, MAX_COMPONENTS);
}

function countSlots(plan: DashboardPlan): number {
  return flattenSlots(plan).length;
}
