import type { TeamDef } from "./types.js";

/** Pre-configured team preset (without tasks — user fills those in) */
export interface TeamPreset {
  name: string;
  description: string;
  agentType?: string;
  defaultBudget: number;
  scope: string[];
  permissionMode: TeamDef["permissionMode"];
  exampleTasks: Array<{ name: string; description: string; touchesFiles: string[] }>;
}

export const TEAM_PRESETS: Record<string, TeamPreset> = {
  schema: {
    name: "schema",
    description: "Database schema changes — tables, columns, relations, seeds across all 3 schema files",
    agentType: "drizzle-db-schema",
    defaultBudget: 8,
    scope: ["jarble-api-main/src/db/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "add-tables", description: "Add new tables to all 3 schema files", touchesFiles: ["jarble-api-main/src/db/schema.sqlite.ts", "jarble-api-main/src/db/schema.ts", "jarble-api-main/src/db/schema.pg.ts", "jarble-api-main/src/db/index.ts"] },
      { name: "seed-data", description: "Add seed data for new tables", touchesFiles: ["jarble-api-main/src/db/init.ts"] },
    ],
  },

  backend: {
    name: "backend",
    description: "API backend — tRPC routers, services, routes, middleware",
    defaultBudget: 15,
    scope: ["jarble-api-main/src/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "trpc-router", description: "Create tRPC router with procedures", touchesFiles: ["jarble-api-main/src/trpc/routers/", "jarble-api-main/src/trpc/index.ts"] },
      { name: "service-layer", description: "Implement business logic service", touchesFiles: ["jarble-api-main/src/services/"] },
    ],
  },

  frontend: {
    name: "frontend",
    description: "Next.js frontend — pages, components, hooks, styles",
    defaultBudget: 15,
    scope: ["Jarble-mvp/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "page", description: "Create Next.js page", touchesFiles: ["Jarble-mvp/app/"] },
      { name: "components", description: "Build React components", touchesFiles: ["Jarble-mvp/components/"] },
    ],
  },

  mcp: {
    name: "mcp",
    description: "MCP server — tools, component rendering, skill references",
    agentType: "mcp-server",
    defaultBudget: 8,
    scope: ["jarble-api-main/src/mcp/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "add-tool", description: "Add new MCP tool", touchesFiles: ["jarble-api-main/src/mcp/jarble-ui-server.js"] },
    ],
  },

  canvas: {
    name: "canvas",
    description: "Canvas components — new interactive UI components for bot rendering",
    defaultBudget: 10,
    scope: ["Jarble-mvp/components/canvas/", "shared/component-manifest/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "component", description: "Create canvas component", touchesFiles: ["Jarble-mvp/components/canvas/components/"] },
      { name: "manifest", description: "Register in shared manifest", touchesFiles: ["shared/component-manifest/components/", "shared/component-manifest/index.ts"] },
    ],
  },

  infra: {
    name: "infra",
    description: "Infrastructure — Terraform, K8s configs, deployment scripts",
    agentType: "terraform-infra",
    defaultBudget: 8,
    scope: ["infrastructure/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "terraform-change", description: "Modify Terraform resources", touchesFiles: ["infrastructure/"] },
    ],
  },

  tests: {
    name: "tests",
    description: "Test writing — unit tests, integration tests, E2E tests",
    agentType: "test-writer",
    defaultBudget: 10,
    scope: ["jarble-api-main/src/", "Jarble-mvp/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "backend-tests", description: "Write API/service tests", touchesFiles: ["jarble-api-main/src/__tests__/"] },
      { name: "frontend-tests", description: "Write component/page tests", touchesFiles: ["Jarble-mvp/__tests__/"] },
    ],
  },

  runtime: {
    name: "runtime",
    description: "Bot runtimes — OpenClaw/ZeroClaw handlers, config rendering, secret mapping",
    agentType: "runtime-handler",
    defaultBudget: 8,
    scope: ["jarble-api-main/src/runtimes/", "runtimes/"],
    permissionMode: "acceptEdits",
    exampleTasks: [
      { name: "handler", description: "Modify or create runtime handler", touchesFiles: ["jarble-api-main/src/runtimes/handlers/"] },
    ],
  },
};

/** Auto-wiring dependency rules between team presets */
const DEPENDENCY_RULES: Record<string, string[]> = {
  schema: [],
  backend: ["schema"],
  frontend: ["schema"],
  mcp: ["schema"],
  canvas: ["schema", "frontend"],
  infra: [],
  tests: ["backend", "frontend"],
  runtime: ["schema"],
};

/** Get a team preset by name */
export function getTeamPreset(name: string): TeamPreset | undefined {
  return TEAM_PRESETS[name];
}

/** List all available team preset names */
export function listTeamPresets(): string[] {
  return Object.keys(TEAM_PRESETS);
}

/** Get auto-wired dependencies for a team, filtered to only teams present in the selection */
export function getAutoWiredDeps(teamName: string, selectedTeams: string[]): string[] {
  const rules = DEPENDENCY_RULES[teamName] || [];
  return rules.filter(dep => selectedTeams.includes(dep));
}
