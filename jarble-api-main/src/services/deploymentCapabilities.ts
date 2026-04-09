/**
 * ═══════════════════════════════════════════════════════════════════════
 * Deployment Capabilities Service
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Compute-on-read function that assembles a deployment's capabilities
 * manifest from its subagents, skills, and runtime info. The manifest
 * includes a deterministic natural-language summary (`llmSummary`) that
 * can be injected into delegation prompts without requiring an LLM call.
 *
 * All user-provided strings (names, descriptions) are sanitized to
 * prevent prompt injection before inclusion in the manifest.
 */

import { db, tables } from "../db/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("deploymentCapabilities");

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeploymentCapabilities {
  deploymentId: string;
  runtime: string;
  supportsSubagents: boolean;

  subagents: Array<{
    slug: string;
    name: string;
    source: "platform" | "custom" | "delegation";
    description: string | null;
    tags: string[];
  }>;

  skills: Array<{
    name: string;
    description: string | null;
  }>;

  /** Deterministic natural-language summary for LLM consumption, max ~150 chars */
  llmSummary: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip control characters and backticks from user-provided strings to
 * prevent prompt injection, and limit length.
 */
function sanitize(s: string | null | undefined, maxLen = 100): string {
  if (!s) return "";
  return s.replace(/[\x00-\x1f\x7f`]/g, "").slice(0, maxLen);
}

/** Map a platform subagent slug to semantic tags. */
function deriveSubagentTags(
  source: string,
  slug: string,
): string[] {
  if (source === "platform") {
    switch (slug) {
      case "component_agent":
        return ["ui-generation", "visualization"];
      case "data_agent":
        return ["data-analysis", "statistics"];
      case "workflow_agent":
        return ["workflow-planning", "coordination"];
      default:
        return [];
    }
  }
  if (source === "delegation") return ["team-delegation"];
  if (source === "custom") return ["custom"];
  return [];
}

/** Detect runtime-level capability flags. */
function detectSupportsSubagents(runtime: string): boolean {
  return runtime === "openclaw";
}

/**
 * Build a deterministic natural-language summary from the capabilities
 * manifest. No LLM call — purely template-based.
 */
function buildLlmSummary(caps: DeploymentCapabilities): string {
  const parts: string[] = [];
  if (caps.subagents.length > 0) {
    const names = caps.subagents.map((s) => s.name).join(", ");
    parts.push(`Has ${caps.subagents.length} internal agents (${names})`);
  }
  if (caps.skills.length > 0) {
    parts.push(`${caps.skills.length} skills`);
  }
  if (!caps.supportsSubagents) {
    parts.push("single-agent mode (no internal specialists)");
  }
  return parts.join(". ") + ".";
}

// ── Single Deployment ───────────────────────────────────────────────────────

/**
 * Fetch and assemble the capabilities manifest for a single deployment.
 * Returns `null` if the deployment does not exist.
 */
export async function getDeploymentCapabilities(
  deploymentId: string,
): Promise<DeploymentCapabilities | null> {
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, deploymentId),
    columns: { id: true, runtime: true, name: true },
  });

  if (!deployment) {
    log.warn({ deploymentId }, "Deployment not found");
    return null;
  }

  const [subagentRows, skillRows] = await Promise.all([
    db.query.deploymentSubagents.findMany({
      where: and(
        eq(tables.deploymentSubagents.deploymentId, deploymentId),
        eq(tables.deploymentSubagents.enabled, true),
      ),
      orderBy: (s: any, { asc }: any) => [asc(s.sortOrder)],
    }),
    db.query.deploymentSkills.findMany({
      where: eq(tables.deploymentSkills.deploymentId, deploymentId),
      with: { skill: true },
    }),
  ]);

  const runtime = deployment.runtime ?? "unknown";

  const caps: DeploymentCapabilities = {
    deploymentId,
    runtime,
    supportsSubagents: detectSupportsSubagents(runtime),
    subagents: subagentRows.map((row: any) => ({
      slug: row.slug,
      name: sanitize(row.name),
      source: row.source as "platform" | "custom" | "delegation",
      description: row.description ? sanitize(row.description) : null,
      tags: deriveSubagentTags(row.source, row.slug),
    })),
    skills: skillRows.map((row: any) => ({
      name: sanitize((row as any).skill?.name ?? row.skillId),
      description: (row as any).skill?.description
        ? sanitize((row as any).skill.description)
        : null,
    })),
    llmSummary: "", // filled below
  };

  caps.llmSummary = buildLlmSummary(caps);

  return caps;
}

// ── Batch Version ───────────────────────────────────────────────────────────

/**
 * Fetch capabilities for multiple deployments in batched queries (avoids N+1).
 * Deployments that don't exist are silently omitted from the result map.
 */
export async function getDeploymentCapabilitiesBatch(
  deploymentIds: string[],
): Promise<Map<string, DeploymentCapabilities>> {
  const result = new Map<string, DeploymentCapabilities>();
  if (deploymentIds.length === 0) return result;

  // Deduplicate input IDs
  const uniqueIds = [...new Set(deploymentIds)];

  // Batch all three queries in parallel
  const [deploymentRows, subagentRows, skillRows] = await Promise.all([
    db.query.deployments.findMany({
      where: inArray(tables.deployments.id, uniqueIds),
      columns: { id: true, runtime: true, name: true },
    }),
    db.query.deploymentSubagents.findMany({
      where: and(
        inArray(tables.deploymentSubagents.deploymentId, uniqueIds),
        eq(tables.deploymentSubagents.enabled, true),
      ),
    }),
    db.query.deploymentSkills.findMany({
      where: inArray(tables.deploymentSkills.deploymentId, uniqueIds),
      with: { skill: true },
    }),
  ]);

  // Index subagents and skills by deploymentId
  const subagentsByDeployment = new Map<string, any[]>();
  for (const row of subagentRows) {
    const list = subagentsByDeployment.get(row.deploymentId) ?? [];
    list.push(row);
    subagentsByDeployment.set(row.deploymentId, list);
  }

  const skillsByDeployment = new Map<string, any[]>();
  for (const row of skillRows) {
    const list = skillsByDeployment.get(row.deploymentId) ?? [];
    list.push(row);
    skillsByDeployment.set(row.deploymentId, list);
  }

  // Assemble capabilities for each deployment
  for (const deployment of deploymentRows) {
    const id = deployment.id;
    const runtime = deployment.runtime ?? "unknown";
    const depSubagents = subagentsByDeployment.get(id) ?? [];
    const depSkills = skillsByDeployment.get(id) ?? [];

    // Sort subagents by sortOrder (batch query doesn't guarantee order)
    depSubagents.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const caps: DeploymentCapabilities = {
      deploymentId: id,
      runtime,
      supportsSubagents: detectSupportsSubagents(runtime),
      subagents: depSubagents.map((row: any) => ({
        slug: row.slug,
        name: sanitize(row.name),
        source: row.source as "platform" | "custom" | "delegation",
        description: row.description ? sanitize(row.description) : null,
        tags: deriveSubagentTags(row.source, row.slug),
      })),
      skills: depSkills.map((row: any) => ({
        name: sanitize((row as any).skill?.name ?? row.skillId),
        description: (row as any).skill?.description
          ? sanitize((row as any).skill.description)
          : null,
      })),
      llmSummary: "", // filled below
    };

    caps.llmSummary = buildLlmSummary(caps);
    result.set(id, caps);
  }

  log.debug(
    { requested: uniqueIds.length, found: result.size },
    "Batch capabilities lookup complete",
  );

  return result;
}
