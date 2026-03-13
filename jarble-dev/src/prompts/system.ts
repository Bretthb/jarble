/** System prompt fragments for generated agent instructions */

export const REPO_CONTEXT = `
You are working in the Jarble platform monorepo. Key packages:
- Jarble-mvp/ — Next.js 15 frontend (App Router, React 19, Tailwind v4, shadcn/ui)
- jarble-api-main/ — Express + tRPC API (Drizzle ORM, 3 DB providers)
- shared/component-manifest/ — Shared types and schemas

Important patterns:
- Database: 3-schema sync (schema.sqlite.ts, schema.ts, schema.pg.ts) + db/index.ts registration
- tRPC: Routers in src/trpc/routers/, registered in src/trpc/index.ts
- Frontend: Zod v4. API: Zod v3. Don't cross the boundary.
- Canvas components: components/canvas/components/Canvas*.tsx, registered in shared manifest
- MCP tools: jarble-api-main/src/mcp/jarble-ui-server.js

Do NOT run npm install in this worktree. node_modules is already linked.
Always commit your changes when done.
`.trim();

export const TASK_WRAPPER = (taskName: string, taskPrompt: string, touchesFiles: string[]) => `
# Task: ${taskName}

${taskPrompt}

## Files in scope
${touchesFiles.length > 0 ? touchesFiles.map(f => `- ${f}`).join("\n") : "- Determine as needed based on the task"}

## Instructions
- Read existing code before modifying
- Follow existing patterns in the codebase
- Do NOT add unnecessary comments, docstrings, or type annotations to unchanged code
- Do NOT run npm install — node_modules is already linked
- Commit your changes with a descriptive message when done
`.trim();

export const RETRY_CONTEXT = (previousErrors: string[]) => `
## Previous Attempt Failed
This task was attempted before and failed. Here are the errors from the previous attempt:

${previousErrors.map((e, i) => `### Attempt ${i + 1}\n${e}`).join("\n\n")}

Fix these issues in your implementation. Pay special attention to:
- TypeScript type errors that were flagged
- Test failures that occurred
- Any runtime crashes or timeout details
`.trim();

export const CONFLICT_RESOLUTION_PROMPT = (
  branch: string,
  targetBranch: string,
  conflictFiles: string[],
) => `
# Merge Conflict Resolution

Branch "${branch}" has conflicts when merging into "${targetBranch}".

## Conflicted files:
${conflictFiles.map(f => `- ${f}`).join("\n")}

## Instructions
1. Read each conflicted file — they contain Git conflict markers (<<<<<<< HEAD, =======, >>>>>>> branch)
2. Resolve each conflict by keeping the correct code from both sides
3. The goal is to preserve the intent of BOTH branches
4. After resolving, run \`git add\` on each resolved file
5. Run \`git commit --no-edit\` to complete the merge

## Guidelines
- If both sides add different things to the same location, include both additions
- If one side modifies a function and the other renames it, apply the modification to the renamed version
- When in doubt, prefer the incoming branch (the feature) over the target (base)
- Run typecheck after resolving to verify correctness
`.trim();
