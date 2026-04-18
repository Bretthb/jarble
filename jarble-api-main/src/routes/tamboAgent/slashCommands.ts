/**
 * Slash command dispatcher for POST /api/tambo-agent.
 *
 * Extracted from tamboAgent.ts as part of JAR-107 (sub-ticket of JAR-85).
 * Handles messages that start with "/" before they reach the LLM path:
 *
 *   /commands, /help        — list available commands
 *   /clear                  — signal frontend to clear chat
 *   /reset                  — reset theme/skin to default (DB write + SSE)
 *   /theme <preset> [skin]  — change color preset and/or skin
 *   /color-preset <preset>  — alias for /theme
 *   /skin <skin>            — change chat skin only (delegates to theme handler)
 *
 * Unknown slash commands return `false` so the main handler can pass them
 * through to the pod (some runtimes have their own slash commands, e.g.
 * OpenClaw CLI).
 */

import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, tables } from "../../db/index.js";
import { validateThemeConfig, THEME_PRESET_NAMES, SKIN_NAMES } from "@jarble/component-manifest";
import { CUSTOM } from "../../utils/eventTypes.js";
import { createModuleLogger } from "../../utils/logger.js";
import { sendEvent, sendQuickResponse } from "./sse.js";

const log = createModuleLogger("tamboAgent.slashCommands");

const SKIN_DESCRIPTIONS: Record<string, string> = {
  terminal: "monospace font, CRT scanlines, command-line prompts",
  retro: "8-bit pixel font, NES-style borders, classic gaming aesthetic",
  handdrawn: "hand-drawn sketchy borders, wobbly elements, cursive font",
  neobrutalist: "bold 3px borders, chunky offset shadows, playful rotations",
  glass: "frosted glassmorphism with blur effects and subtle glow",
  minimal: "clean and spacious - hidden avatars, borderless messages",
  win98: "classic Windows 98 - silver gray, 3D beveled borders, blue title bar",
};

/**
 * Handle slash commands. Only triggers when message starts with "/".
 * Returns true if the command was handled (response already sent).
 *
 * Supported commands:
 *   /theme <preset> [skin]  - Change color preset and/or skin
 *   /color-preset <preset>  - Alias for /theme
 *   /skin <skin>            - Change chat skin only
 *   /commands, /help        - List available commands
 *   /clear                  - Signal frontend to clear chat
 *   /reset                  - Reset theme to default
 */
export async function tryHandleSlashCommand(
  userText: string,
  deploymentId: string,
  deployment: any,
  res: any,
  runId: string,
  threadId: string,
): Promise<boolean> {
  const trimmed = userText.trim();
  if (!trimmed.startsWith("/")) return false;

  // Parse command and args
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).map(a => a.toLowerCase());

  // ── /commands or /help ───────────────────────────────────────────────────
  if (command === "/commands" || command === "/help") {
    const presets = THEME_PRESET_NAMES.join(", ");
    const skins = (SKIN_NAMES as readonly string[]).join(", ");
    const text = `## Available Commands

| Command | Description |
|---------|------------|
| \`/theme <preset>\` | Change color preset (${presets}) |
| \`/skin <skin>\` | Change chat skin (${skins}) |
| \`/color-preset <preset>\` | Alias for /theme |
| \`/reset\` | Reset theme & skin to default |
| \`/clear\` | Clear chat history |
| \`/commands\` | Show this help |

**Presets:** ${presets}
**Skins:** ${skins}

*Skin descriptions:*
${Object.entries(SKIN_DESCRIPTIONS).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}`;

    sendQuickResponse(res, runId, threadId, text);
    return true;
  }

  // ── /clear ───────────────────────────────────────────────────────────────
  if (command === "/clear") {
    sendEvent(res, { type: "RUN_STARTED", runId, threadId });
    const mid = nanoid();
    sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: mid, role: "assistant" });
    sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: mid, delta: "Chat cleared." });
    sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: mid });
    sendEvent(res, { type: CUSTOM, name: "jarble.clear_chat", value: {} });
    sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
    res.end();
    return true;
  }

  // ── /reset ───────────────────────────────────────────────────────────────
  if (command === "/reset") {
    await db.update(tables.deployments)
      .set({ themeConfig: null } as any)
      .where(eq(tables.deployments.id, deploymentId));

    sendQuickResponse(res, runId, threadId, "Theme reset to default. Clean slate!", () => {
      sendEvent(res, { type: CUSTOM, name: "jarble.theme.updated", value: null });
    });
    log.info({ deploymentId }, "Slash: theme reset via /reset");
    return true;
  }

  // ── /theme or /color-preset ──────────────────────────────────────────────
  if (command === "/theme" || command === "/color-preset") {
    if (args.length === 0) {
      const presets = THEME_PRESET_NAMES.join(", ");
      sendQuickResponse(res, runId, threadId,
        `Usage: \`${command} <preset> [skin]\`\n\n**Presets:** ${presets}\n\nType \`/commands\` for full list.`);
      return true;
    }
    return handleThemeChange(args, deploymentId, deployment, res, runId, threadId);
  }

  // ── /skin ────────────────────────────────────────────────────────────────
  if (command === "/skin") {
    if (args.length === 0) {
      const skins = (SKIN_NAMES as readonly string[]).join(", ");
      sendQuickResponse(res, runId, threadId,
        `Usage: \`/skin <name>\`\n\n**Skins:** ${skins}\n\nType \`/commands\` for descriptions.`);
      return true;
    }
    return handleThemeChange(args, deploymentId, deployment, res, runId, threadId, true);
  }

  // Unknown slash command - let the pod handle it
  return false;
}

/** Apply a theme/skin change from slash command args. */
async function handleThemeChange(
  args: string[],
  deploymentId: string,
  deployment: any,
  res: any,
  runId: string,
  threadId: string,
  skinOnly = false,
): Promise<boolean> {
  let preset: string | undefined;
  let skin: string | undefined;

  for (const arg of args) {
    // When called from /theme: match presets first, only match skin if it's NOT also a preset name
    // When called from /skin: only match skins (skinOnly=true)
    if (!skinOnly && THEME_PRESET_NAMES.includes(arg as any)) {
      preset = arg;
    } else if ((SKIN_NAMES as readonly string[]).includes(arg)) {
      skin = arg;
    }
  }

  if (!preset && !skin) {
    const available = skinOnly
      ? `**Skins:** ${(SKIN_NAMES as readonly string[]).join(", ")}`
      : `**Presets:** ${THEME_PRESET_NAMES.join(", ")}\n**Skins:** ${(SKIN_NAMES as readonly string[]).join(", ")}`;
    sendQuickResponse(res, runId, threadId,
      `Unknown ${skinOnly ? "skin" : "preset"}. ${available}`);
    return true;
  }

  // Build theme config
  const currentConfig = deployment.themeConfig
    ? (() => { try { return JSON.parse(deployment.themeConfig); } catch { return {}; } })()
    : {};

  const newConfig = { ...currentConfig };
  if (preset) newConfig.preset = preset;
  if (skin) newConfig.skin = skin;

  // Validate
  const error = validateThemeConfig(newConfig);
  if (error) {
    sendQuickResponse(res, runId, threadId, `Couldn't set that theme: ${error}`);
    return true;
  }

  // Persist to DB
  await db.update(tables.deployments)
    .set({ themeConfig: JSON.stringify(newConfig) } as any)
    .where(eq(tables.deployments.id, deploymentId));

  // Build response
  const parts: string[] = [];
  if (preset) parts.push(`**Color preset**: ${preset}`);
  if (skin) parts.push(`**Skin**: ${skin}`);
  if (skin && skin !== "default" && SKIN_DESCRIPTIONS[skin]) {
    parts.push(`\n*${SKIN_DESCRIPTIONS[skin]}*`);
  }

  sendQuickResponse(res, runId, threadId, `Theme updated!\n\n${parts.join("\n")}`, () => {
    sendEvent(res, { type: CUSTOM, name: "jarble.theme.updated", value: newConfig });
  });

  log.info({ deploymentId, preset, skin }, "Slash: theme changed via command");
  return true;
}
