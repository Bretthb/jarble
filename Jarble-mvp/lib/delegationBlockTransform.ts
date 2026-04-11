/**
 * Delegation block transform / strip helpers.
 *
 * The bot emits delegation tool calls as fenced code blocks:
 *
 *     ```jarble_delegate
 *     { "to": "analyst", "task": "Summarize Q1 revenue", "context": "..." }
 *     ```
 *
 * The frontend must convert these blocks into human-readable text (for chat
 * bubbles) OR strip them entirely (for conversation previews) before the
 * raw JSON is rendered to users.
 *
 * Previously this was implemented as three separate inline `.replace()` chains
 * in `MarkdownMessage.tsx`, `Deployments.tsx`, and `ConversationHistoryPanel.tsx`.
 * Each used the same regex pattern and each had the same three holes:
 *
 *   1. Field ORDER — the regex required `"to"` to appear before `"task"`.
 *      If an LLM emits `{"task":"...","to":"..."}` (task first), the block
 *      leaks raw to the UI.
 *   2. Braces in task content — `[^}]*` cannot match `}`, so a task string
 *      containing `"render {foo: bar}"` breaks the match.
 *   3. Escaped quotes — `"([^"]*)"` stops at the first literal `"`, so a
 *      task containing `\"quoted\"` breaks the match.
 *
 * This module parses the fenced body with `JSON.parse` rather than regex
 * extraction, so field order and nested content work correctly. See Cycle 11
 * of the 2026-04-11 bot teams QA marathon.
 */

// ── Outer-fence matchers ────────────────────────────────────────────────────
//
// We match the opening fence + language tag + closing fence pair greedily
// enough to cover all whitespace variants the bot emits. The body is
// captured and JSON-parsed downstream — we do NOT try to extract fields
// from the body via regex.

const DELEGATE_FENCE =
  /```jarble_delegate\s*\n?([\s\S]*?)\n?```/g;

// Legacy format: some older specialist prompts still emit
//   ```json
//   { "tool": "delegate_to_X", "task": "..." }
//   ```
// We accept both as input and normalize to the same transform output.
const LEGACY_JSON_DELEGATE_FENCE =
  /```json\s*\n?([\s\S]*?)\n?```/g;

// ── Parsed shape ────────────────────────────────────────────────────────────

export interface ParsedDelegationCall {
  to: string;
  task: string;
  context?: string;
}

/**
 * Parse a fenced `jarble_delegate` body (or legacy `delegate_to_X` json body)
 * into a normalized `{ to, task, context? }` shape. Returns null if the body
 * is not valid JSON or doesn't contain the required fields.
 *
 * This is the key improvement over regex extraction: field order is
 * irrelevant, nested braces are fine, escaped quotes work.
 */
export function parseDelegationBody(body: string): ParsedDelegationCall | null {
  let parsed: any;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // Primary format: { to, task, context? }
  if (typeof parsed.to === "string" && typeof parsed.task === "string") {
    return {
      to: parsed.to,
      task: parsed.task,
      context: typeof parsed.context === "string" ? parsed.context : undefined,
    };
  }

  // Legacy format: { tool: "delegate_to_X", task: "..." }
  if (
    typeof parsed.tool === "string" &&
    parsed.tool.startsWith("delegate_to_") &&
    typeof parsed.task === "string"
  ) {
    return {
      to: parsed.tool.replace(/^delegate_to_/, ""),
      task: parsed.task,
      context: typeof parsed.context === "string" ? parsed.context : undefined,
    };
  }

  return null;
}

// ── Transforms ──────────────────────────────────────────────────────────────

type FormatKind = "blockquote" | "inline";

export interface TransformOptions {
  /** Display style. "blockquote" produces a Markdown `>` prefix. */
  format?: FormatKind;
  /** Max characters of the task string to inline into the display text. */
  maxTaskChars?: number;
}

/**
 * Replace any `jarble_delegate` / legacy `delegate_to_X` fenced blocks with
 * human-readable text. Non-delegation content is passed through unchanged.
 *
 * Malformed or unparseable blocks are still stripped (replaced with an empty
 * line) rather than leaked — the failure mode is "the user sees nothing"
 * rather than "the user sees raw JSON". This is the correct fallback because
 * the delegation is still dispatched via SSE delegation.start/end events on
 * a separate channel, so the user will still see a status pill.
 */
export function transformDelegationBlocks(
  text: string,
  opts: TransformOptions = {},
): string {
  const { format = "inline", maxTaskChars = 120 } = opts;

  const render = (parsed: ParsedDelegationCall): string => {
    const suffix = parsed.task.length > maxTaskChars ? "…" : "";
    const truncated = parsed.task.slice(0, maxTaskChars) + suffix;
    if (format === "blockquote") {
      return `> **Delegating to ${parsed.to}:** ${truncated}\n`;
    }
    return `Delegating to ${parsed.to}: ${truncated}`;
  };

  return text
    .replace(DELEGATE_FENCE, (_full, body) => {
      const parsed = parseDelegationBody(body);
      return parsed ? render(parsed) : "";
    })
    .replace(LEGACY_JSON_DELEGATE_FENCE, (_full, body) => {
      const parsed = parseDelegationBody(body);
      return parsed ? render(parsed) : _full; // leave generic ```json blocks alone
    });
}

/**
 * Strip `jarble_delegate` / legacy `delegate_to_X` fenced blocks entirely.
 * Used by the conversation history sidebar where preview text should not
 * include any delegation mechanics at all.
 *
 * Only strips blocks that are actually delegation blocks (validated via
 * JSON.parse) — generic ```json blocks are preserved so users can still
 * see code samples in their preview text.
 */
export function stripDelegationBlocks(text: string): string {
  return text
    .replace(DELEGATE_FENCE, "")
    .replace(LEGACY_JSON_DELEGATE_FENCE, (full, body) => {
      const parsed = parseDelegationBody(body);
      return parsed ? "" : full;
    });
}
