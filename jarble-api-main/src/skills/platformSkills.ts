/**
 * Platform skills - the authoritative source for bot skills.
 *
 * Pods fetch these from GET /debug/platform-skills on boot and cache to PVC.
 * The MCP server (jarble-ui-server.js) has a baked-in copy as fallback,
 * but this file is the single source of truth after API redeployment.
 *
 * To update skills: edit this file → redeploy API → pods fetch on next restart.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Current skills version - bump when making changes so pods know to update
const SKILLS_VERSION = 2;
const SKILLS_UPDATED_AT = "2026-03-06T00:00:00Z";

/**
 * Returns the platform skills by extracting BOT_SKILLS from the MCP server file.
 * This ensures the API endpoint always serves whatever's in jarble-ui-server.js
 * without maintaining a duplicate copy.
 */
export function getPlatformSkills(): {
  version: number;
  updatedAt: string;
  skills: Record<string, { description: string; content: string }>;
} {
  try {
    // Read the MCP server file and extract BOT_SKILLS
    // Resolve relative to this file (__dirname) so the path works both in local
    // dev (src/skills/) and in the Docker container (dist/.../skills/).
    const mcpPath = resolve(__dirname, "../mcp/jarble-ui-server.js");
    const mcpSource = readFileSync(mcpPath, "utf-8");

    // Find BOT_SKILLS object boundaries
    const startMarker = "const BOT_SKILLS = {";
    const startIdx = mcpSource.indexOf(startMarker);
    if (startIdx === -1) throw new Error("BOT_SKILLS not found in jarble-ui-server.js");

    // Find the closing }; by tracking brace depth
    let depth = 0;
    let endIdx = startIdx + startMarker.length - 1; // position of opening {
    let inString = false;
    let stringChar = "";
    let escaped = false;

    for (let i = endIdx; i < mcpSource.length; i++) {
      const ch = mcpSource[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (inString) {
        if (ch === stringChar) inString = false;
        continue;
      }

      if (ch === "`" || ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    const skillsSource = mcpSource.slice(startIdx + "const BOT_SKILLS = ".length, endIdx);

    // Evaluate the object (it uses template literals with \` escapes)
    // We can't JSON.parse because it has template literals, so use Function constructor
    const skills = new Function(`return ${skillsSource}`)();

    return {
      version: SKILLS_VERSION,
      updatedAt: SKILLS_UPDATED_AT,
      skills,
    };
  } catch (err) {
    // Fallback: return minimal skill set if extraction fails
    console.error("Failed to extract platform skills:", err);
    return {
      version: SKILLS_VERSION,
      updatedAt: SKILLS_UPDATED_AT,
      skills: {},
    };
  }
}
