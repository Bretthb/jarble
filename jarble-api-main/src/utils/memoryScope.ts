/**
 * Conversation-Scoped Bot Memory — shared helpers.
 *
 * The deployments table stores `memory_scope` as a string with three valid
 * values: "global" | "session" | "off". See docs/audits/memory-scoping-decision.md
 * for the rationale.
 *
 * This module centralises:
 *   1. The MemoryScope type and constants.
 *   2. `normalizeMemoryScope()` — coerce arbitrary input from the DB or API
 *      to a valid MemoryScope, falling back to "global" when missing/invalid.
 *      Used by configSync.buildDeploymentFields() so a stale/null DB row
 *      always behaves like "global".
 *   3. `renderMemoryPromptSection()` — a generic soul.md memory section for
 *      unit-testing the wording in isolation. Note: the OpenClaw runtime
 *      handler (openclaw.ts) uses its own inline prompt strings that are
 *      more specific to the OpenClaw tool surface (mcporter, native tools);
 *      this function is not called by the handler directly.
 *   4. `renderMemoryStateLine()` — short "Memory: <mode> · Session: <id>"
 *      line injected into the per-message [CANVAS_STATE] block.
 *   5. `injectMemoryStateLine()` — merges the memory state line into the
 *      user message's [CANVAS_STATE] block. Called by tamboAgent.ts and
 *      flowChat.ts on every chat turn.
 */

export const MEMORY_SCOPES = ["global", "session", "off"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

const VALID_SCOPES = new Set<string>(MEMORY_SCOPES);

/**
 * Coerce arbitrary input to a valid MemoryScope.
 * Unknown values fall back to "global" so a row written before the
 * migration ran behaves identically to existing deployments.
 */
export function normalizeMemoryScope(value: unknown): MemoryScope {
  if (typeof value === "string" && VALID_SCOPES.has(value)) {
    return value as MemoryScope;
  }
  return "global";
}

/**
 * The memory section appended to soul.md by the OpenClaw runtime handler.
 * The wording is intentionally explicit so the LLM cannot misinterpret it.
 *
 * - "global": current behavior, advertise cross-platform memory.
 * - "session": tell the bot to scope memories per [SESSION_ID] and never
 *   recall a memory from a different session.
 * - "off": tell the bot the memory tools are disabled and to stop calling
 *   them. Combined with the per-turn [CANVAS_STATE] line, this is the
 *   strongest signal we can send through the prompt layer.
 */
export function renderMemoryPromptSection(scope: MemoryScope): string {
  if (scope === "off") {
    return (
      `## Memory: DISABLED\n` +
      `Long-term memory is **OFF** for this deployment. Do NOT call ` +
      `\`store_memory\`, \`recall_memory\`, \`list_memories\`, or \`forget_memory\` ` +
      `— they are no-ops in this configuration. If the user asks you to ` +
      `remember something, tell them memory is disabled and they can enable it ` +
      `from the deployment configuration panel.`
    );
  }

  if (scope === "session") {
    return (
      `## Memory: SESSION-SCOPED\n` +
      `Long-term memory is partitioned **per chat session** for this deployment. ` +
      `The current session ID is provided in the \`[CANVAS_STATE]\` block on every ` +
      `turn as \`Session: <id>\`. Treat each session as an isolated workspace.\n\n` +
      `Rules:\n` +
      `1. When you call \`store_memory\`, \`recall_memory\`, \`list_memories\`, or ` +
      `   \`forget_memory\`, you **MUST** include \`scope_id\` set to the exact ` +
      `   session id from the \`[CANVAS_STATE]\` \`Session:\` line. Calls without ` +
      `   \`scope_id\` in this mode are rejected by the platform.\n` +
      `2. You will only see memories you saved in **this** session. Memories from ` +
      `   previous sessions (same or different platform) are invisible to you here.\n` +
      `3. **Never claim to remember something from another session.** If the user ` +
      `   says "we talked about X yesterday" and \`recall_memory\` returns nothing, ` +
      `   tell them this is a fresh session and ask them to share the context again.\n` +
      `4. Any native memory-recall mechanism that surfaces entries from other ` +
      `   sessions must be ignored — they are out of scope for this conversation.\n` +
      `5. Memory still persists across reloads of the **same** session.`
    );
  }

  return (
    `## Memory: GLOBAL (cross-session)\n` +
    `Long-term memory is **shared across every chat session** for this ` +
    `deployment, including the web dashboard, Telegram, Discord, WhatsApp, ` +
    `and Slack. Anything you save with \`store_memory\` will be recallable ` +
    `from any other conversation with this same bot, by the same user.\n\n` +
    `The user has been informed of this in the chat UI. You may proactively ` +
    `\`recall_memory\` at the start of a conversation to greet returning users.`
  );
}

/**
 * Single-line "Memory: ..." entry injected into the [CANVAS_STATE] block on
 * every chat turn. Keeps the per-turn signal short and machine-friendly.
 */
export function renderMemoryStateLine(
  scope: MemoryScope,
  sessionId: string | null | undefined,
): string {
  if (scope === "off") {
    return `Memory: off`;
  }
  if (scope === "session") {
    const id = sessionId && sessionId.length > 0 ? sessionId : "unknown";
    return `Memory: session-scoped\nSession: ${id}`;
  }
  return `Memory: global (persists across all sessions and platforms)`;
}

/**
 * Inject a memory state line into the first line of an existing
 * `[CANVAS_STATE]...[/CANVAS_STATE]` block in `message`, merging with any
 * pre-existing canvas context. If no block exists, a minimal one is
 * prepended so the LLM sees the memory signal on every turn.
 *
 * Exported so both the web chat route (tamboAgent) and the flow chat route
 * can share identical injection behavior — and so we can unit-test it.
 */
export function injectMemoryStateLine(message: string, memoryLine: string): string {
  const canvasBlockRegex = /\[CANVAS_STATE\]([\s\S]*?)\[\/CANVAS_STATE\]/;
  if (canvasBlockRegex.test(message)) {
    return message.replace(
      canvasBlockRegex,
      (_, inner) => `[CANVAS_STATE]\n${memoryLine}${inner}[/CANVAS_STATE]`,
    );
  }
  return `[CANVAS_STATE]\n${memoryLine}\n[/CANVAS_STATE]\n${message}`;
}
