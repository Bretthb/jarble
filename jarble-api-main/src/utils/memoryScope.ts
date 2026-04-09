/**
 * Memory scope helpers for deployment-level memory scoping.
 *
 * Three modes:
 *   - "global"  (default) — memory shared across all sessions and platforms
 *   - "session" — memory partitioned per conversation/session key
 *   - "off"     — memory tools disabled entirely
 */

export type MemoryScope = "global" | "session" | "off";

export const MEMORY_SCOPES: readonly MemoryScope[] = ["global", "session", "off"] as const;

export function isValidMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === "string" && MEMORY_SCOPES.includes(value as MemoryScope);
}

/**
 * Render the memory-scope section appended to soul.md.
 * Tells the bot how memory works for this deployment so it can set user expectations.
 */
export function renderMemoryPromptSection(scope: MemoryScope): string {
  switch (scope) {
    case "session":
      return `## Memory Scope: Per-Conversation
Memory is scoped to individual conversations. Anything you store with \`store_memory\` is only visible within the current chat session. Other conversations and platforms cannot see it.
The session_id is managed automatically. Do not pass it explicitly.`;

    case "off":
      return `## Memory: DISABLED
Long-term memory is disabled for this deployment. Do NOT call \`store_memory\`, \`recall_memory\`, \`list_memories\`, or \`forget_memory\`. If a user asks you to remember something, explain that memory is turned off and suggest they enable it in the deployment settings.`;

    case "global":
    default:
      return `## Memory Scope: Global
Memory is shared across all your conversations and platforms (Jarble dashboard, Telegram, Discord, WhatsApp, etc.). Information stored in one conversation can be recalled in any other. This is the default behavior.`;
  }
}
