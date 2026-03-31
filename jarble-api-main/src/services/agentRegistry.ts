/**
 * Agent Registry - maps agent names to their configs.
 *
 * Each agent is a stateless specialist that uses a specific system prompt
 * and (typically cheap) LLM model. The bot delegates tasks to the right
 * agent via MCP tools like `delegate_to_component_agent`.
 *
 * The Component Agent is the first entry; future agents include
 * data-agent, analysis-agent, workflow-agent, etc.
 */

export interface AgentConfig {
  name: string;
  description: string;
  /** System prompt - imported from prompts/ directory */
  systemPromptModule: string;
  /** Default model (can be overridden per-request) */
  defaultModel: string;
  /** MCP tool name the bot uses to invoke this agent */
  toolName: string;
  /** MCP tool description shown to the bot */
  toolDescription: string;
  /** JSON Schema for the MCP tool's input */
  toolInputSchema: Record<string, unknown>;
}

export const AGENT_REGISTRY: AgentConfig[] = [
  {
    name: "component",
    description: "Creates production-quality sandbox HTML/CSS/JS components",
    systemPromptModule: "componentAgent",
    defaultModel: "anthropic/claude-sonnet-4-20250514",
    toolName: "create_component",
    toolDescription: "Delegate complex component creation to the Component Agent. Use when the user needs a custom interactive visualization, dashboard, game, or widget that goes beyond the built-in components.",
    toolInputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "What the component should do (e.g. 'interactive stock chart with real-time data')" },
        data: { description: "Data to embed or visualize in the component" },
        theme: { type: "string", description: "Preferred visual theme (e.g. 'dark', 'minimal', 'corporate')" },
        constraints: { type: "string", description: "Additional constraints or requirements" },
      },
      required: ["intent"],
    },
  },
  {
    name: "data",
    description: "Analyzes datasets, runs statistics, and produces structured insights",
    systemPromptModule: "dataAgent",
    defaultModel: "anthropic/claude-haiku-4-5-20251001",
    toolName: "delegate_to_data_agent",
    toolDescription: "Delegate data analysis tasks to the Data Agent. Use for CSV parsing, statistical analysis, data cleaning, trend detection, and producing structured summaries.",
    toolInputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to analyze or compute (e.g. 'find the top 5 products by revenue')" },
        data: { description: "The dataset to analyze (JSON array, CSV text, or structured object)" },
        outputFormat: { type: "string", enum: ["json", "markdown", "chart_data"], description: "Desired output format" },
      },
      required: ["task"],
    },
  },
  {
    name: "workflow",
    description: "Plans and coordinates multi-step workflows across services",
    systemPromptModule: "workflowAgent",
    defaultModel: "anthropic/claude-haiku-4-5-20251001",
    toolName: "delegate_to_workflow_agent",
    toolDescription: "Delegate workflow planning to the Workflow Agent. Use when a task requires orchestrating multiple service calls, data transformations, or conditional logic.",
    toolInputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The end goal of the workflow" },
        availableServices: {
          type: "array",
          items: { type: "string" },
          description: "Names of installed services that can be used",
        },
        constraints: { type: "string", description: "Constraints like time budget, cost limits, etc." },
      },
      required: ["goal"],
    },
  },
];

/** Look up an agent by name. */
export function getAgent(name: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find((a) => a.name === name);
}

/** Look up an agent by its MCP tool name. */
export function getAgentByToolName(toolName: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find((a) => a.toolName === toolName);
}

/** Get MCP tool definitions for all registered agents. */
export function getAgentToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return AGENT_REGISTRY.map((a) => ({
    name: a.toolName,
    description: a.toolDescription,
    inputSchema: a.toolInputSchema,
  }));
}
