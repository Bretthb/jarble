/**
 * Platform bot skills type and placeholder export.
 *
 * The canonical runtime skills live inside `jarble-api-main/src/mcp/jarble-ui-server.js`
 * (the `BOT_SKILLS` constant). The API extracts them at runtime via
 * `jarble-api-main/src/skills/platformSkills.ts` using brace-depth parsing + `new Function()`.
 *
 * This module provides:
 *  1. A shared TypeScript type for the skill record shape.
 *  2. A static placeholder (`BOT_SKILLS`) so other packages can import the type
 *     without depending on the MCP server file at build time.
 */

export interface BotSkill {
  description: string;
  content: string;
}

/**
 * Static placeholder — empty at build time.
 * Pods and the API populate skills at runtime from the MCP server file.
 */
export const BOT_SKILLS: Record<string, BotSkill> = {};
