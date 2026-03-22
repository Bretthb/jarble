import type { PlanTemplate } from "./types.js";

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    name: "schema-change",
    description: "Database schema migration — adds columns/tables across all 3 schema files, seeds data, and updates registration",
    plan: {
      name: "Schema Change",
      description: "Add new database tables/columns with proper schema sync",
      tasks: [
        {
          name: "schema-update",
          description: "Add new columns/tables to all 3 schema files and update db/index.ts registration",
          touchesFiles: [
            "jarble-api-main/src/db/schema.sqlite.ts",
            "jarble-api-main/src/db/schema.ts",
            "jarble-api-main/src/db/schema.pg.ts",
            "jarble-api-main/src/db/index.ts",
          ],
          dependsOn: [],
          agentType: "drizzle-db-schema",
          prompt: "TODO: Describe the schema changes needed.\n\nAll 3 schema files must stay in sync. Add relations in db/index.ts.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "seed-data",
          description: "Add seed data for new tables in db/init.ts",
          touchesFiles: ["jarble-api-main/src/db/init.ts"],
          dependsOn: ["schema-update"],
          prompt: "TODO: Describe what seed data to add.\n\nRead the newly added tables from schema.sqlite.ts and add appropriate seed data.",
          maxBudgetUsd: 3,
          permissionMode: "acceptEdits",
        },
      ],
    },
  },
  {
    name: "full-stack-feature",
    description: "End-to-end feature — schema + backend router + frontend UI, all wired together",
    plan: {
      name: "Full-Stack Feature",
      description: "Complete feature implementation across schema, API, and frontend",
      tasks: [
        {
          name: "schema",
          description: "Database schema changes for the new feature",
          touchesFiles: [
            "jarble-api-main/src/db/schema.sqlite.ts",
            "jarble-api-main/src/db/schema.ts",
            "jarble-api-main/src/db/schema.pg.ts",
            "jarble-api-main/src/db/index.ts",
          ],
          dependsOn: [],
          agentType: "drizzle-db-schema",
          prompt: "TODO: Describe the schema changes.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "api-router",
          description: "tRPC router with CRUD procedures for the feature",
          touchesFiles: [
            "jarble-api-main/src/trpc/routers/",
            "jarble-api-main/src/trpc/index.ts",
          ],
          dependsOn: ["schema"],
          prompt: "TODO: Describe the API procedures needed.\n\nRegister the new router in src/trpc/index.ts.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "frontend-ui",
          description: "Frontend page and components for the feature",
          touchesFiles: [
            "Jarble-mvp/app/",
            "Jarble-mvp/components/",
          ],
          dependsOn: ["api-router"],
          prompt: "TODO: Describe the UI components and pages needed.\n\nUse shadcn/ui components and Tailwind v4 for styling. Use tRPC hooks for data fetching.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "tests",
          description: "Write tests for the new feature",
          touchesFiles: [
            "jarble-api-main/src/__tests__/",
            "Jarble-mvp/__tests__/",
          ],
          dependsOn: ["api-router", "frontend-ui"],
          agentType: "test-writer",
          prompt: "TODO: Describe test coverage requirements.\n\nWrite Vitest tests for both backend and frontend.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
      ],
    },
  },
  {
    name: "bugfix",
    description: "Targeted bug fix — investigate, fix, and add regression test",
    plan: {
      name: "Bug Fix",
      description: "Diagnose and fix a bug with regression tests",
      tasks: [
        {
          name: "fix",
          description: "Investigate and fix the bug",
          touchesFiles: [],
          dependsOn: [],
          prompt: "TODO: Describe the bug, symptoms, and reproduction steps.\n\nInvestigate the root cause, apply the minimal fix, and commit.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "regression-test",
          description: "Add a regression test to prevent recurrence",
          touchesFiles: [],
          dependsOn: ["fix"],
          agentType: "test-writer",
          prompt: "TODO: Describe what test to add.\n\nWrite a test that fails without the fix and passes with it.",
          maxBudgetUsd: 3,
          permissionMode: "acceptEdits",
        },
      ],
    },
  },
  {
    name: "canvas-component",
    description: "New canvas component — component implementation + manifest registration + MCP integration",
    plan: {
      name: "Canvas Component",
      description: "Add a new canvas component to the Jarble platform",
      tasks: [
        {
          name: "component-impl",
          description: "Implement the canvas component in React",
          touchesFiles: [
            "Jarble-mvp/components/canvas/components/",
          ],
          dependsOn: [],
          prompt: "TODO: Describe the component, its props, and behavior.\n\nCreate Canvas{Name}.tsx with no wrapper styling (use p-3 h-full). Follow existing component patterns.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "manifest-registration",
          description: "Register the component in the shared manifest",
          touchesFiles: [
            "shared/component-manifest/components/",
            "shared/component-manifest/index.ts",
          ],
          dependsOn: ["component-impl"],
          prompt: "TODO: Describe the component's props schema.\n\nCreate the manifest entry and register it in index.ts. Run npm run check:manifest to verify.",
          maxBudgetUsd: 3,
          permissionMode: "acceptEdits",
        },
      ],
    },
  },
  {
    name: "mcp-tool",
    description: "New MCP tool — add tool to jarble-ui-server.js with executor and prompt integration",
    plan: {
      name: "MCP Tool",
      description: "Add a new MCP tool to the bot's capabilities",
      tasks: [
        {
          name: "tool-impl",
          description: "Implement the MCP tool in jarble-ui-server.js",
          touchesFiles: [
            "jarble-api-main/src/mcp/jarble-ui-server.js",
          ],
          dependsOn: [],
          agentType: "mcp-server",
          prompt: "TODO: Describe the tool's purpose, input schema, and execution logic.\n\nAdd the tool definition and executor to jarble-ui-server.js following existing tool patterns.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
      ],
    },
  },
  {
    name: "refactor",
    description: "Parallel refactoring — multiple independent code improvements that don't conflict",
    plan: {
      name: "Refactor",
      description: "Multiple independent code improvements in parallel",
      tasks: [
        {
          name: "refactor-a",
          description: "First refactoring task",
          touchesFiles: [],
          dependsOn: [],
          prompt: "TODO: Describe refactoring A.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
        {
          name: "refactor-b",
          description: "Second refactoring task (runs in parallel)",
          touchesFiles: [],
          dependsOn: [],
          prompt: "TODO: Describe refactoring B.",
          maxBudgetUsd: 5,
          permissionMode: "acceptEdits",
        },
      ],
    },
  },
];
