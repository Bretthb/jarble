/**
 * Platform Agent Seeding — seeds default platform agents (component, data, workflow)
 * into the deployment_subagents table when a new deployment is created.
 *
 * These agents are stored as `source: "platform"` rows so the UI can display
 * them as toggleable defaults distinct from user-created custom agents.
 */
import { tables, dbDate, type DbClient } from "../db/index.js";
import { COMPONENT_AGENT_SYSTEM_PROMPT } from "../prompts/componentAgent.js";
import { DATA_AGENT_SYSTEM_PROMPT } from "../prompts/dataAgent.js";
import { WORKFLOW_AGENT_SYSTEM_PROMPT } from "../prompts/workflowAgent.js";
import { AGENT_REGISTRY } from "./agentRegistry.js";
import { nanoid } from "nanoid";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("platformAgents");

/** Default platform agents seeded for every new deployment. */
const PLATFORM_AGENTS = [
  {
    slug: "component_agent",
    name: "Component Agent",
    description: "Creates production-quality sandbox HTML/CSS/JS components with premium styling",
    source: "platform" as const,
    triggerType: "auto",
    systemPrompt: COMPONENT_AGENT_SYSTEM_PROMPT,
    registryName: "component",  // matches AGENT_REGISTRY[].name
    sortOrder: 0,
  },
  {
    slug: "data_agent",
    name: "Data Agent",
    description: "Analyzes datasets, runs statistics, and produces structured insights",
    source: "platform" as const,
    triggerType: "auto",
    systemPrompt: DATA_AGENT_SYSTEM_PROMPT,
    registryName: "data",
    sortOrder: 1,
  },
  {
    slug: "workflow_agent",
    name: "Workflow Agent",
    description: "Plans and coordinates multi-step workflows across services",
    source: "platform" as const,
    triggerType: "auto",
    systemPrompt: WORKFLOW_AGENT_SYSTEM_PROMPT,
    registryName: "workflow",
    sortOrder: 2,
  },
];

/**
 * Seed default platform agents for a new deployment.
 * Non-fatal: if it fails (e.g. table doesn't exist yet), it logs a warning and returns.
 */
export async function seedPlatformAgents(db: DbClient, deploymentId: string): Promise<void> {
  try {
    const deploymentSubagents = (tables as any).deploymentSubagents;
    if (!deploymentSubagents) {
      logger.warn({ deploymentId }, "deploymentSubagents table not available — skipping platform agent seeding");
      return;
    }

    const now = dbDate();
    const rows = PLATFORM_AGENTS.map((agent) => {
      const registryEntry = AGENT_REGISTRY.find((r) => r.name === agent.registryName);
      return {
        id: nanoid(12),
        deploymentId,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        model: registryEntry?.defaultModel || null,
        triggerType: agent.triggerType,
        enabled: true,
        isPublic: false,
        forkCount: 0,
        sortOrder: agent.sortOrder,
        source: agent.source,
        createdAt: now,
        updatedAt: now,
      };
    });

    for (const row of rows) {
      await (db as any).insert(deploymentSubagents).values(row);
    }

    logger.info({ deploymentId, count: rows.length }, "Seeded platform agents for deployment");
  } catch (err) {
    logger.warn({ deploymentId, err }, "Failed to seed platform agents (non-fatal)");
  }
}
