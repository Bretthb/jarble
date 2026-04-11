/**
 * Detect error-shaped replies that OpenClaw surfaces as pseudo-text payloads
 * when its upstream LLM call failed (bad API key, provider 4xx/5xx, etc.).
 *
 * Without this detection, strings like "401 Missing Authentication header"
 * or "Error: API request failed..." get treated as valid bot responses by
 * `chatViaExec`, streamed as TEXT_MESSAGE_CONTENT deltas, and persisted to
 * the deployment's chat history. From the user's perspective the bot appears
 * to have literally said "401 Missing Authentication header" — which is what
 * the Cycle 1 visit to the Dev deployment captured three times in a row.
 *
 * This detector is intentionally **conservative**:
 *   - Full response must be short (< 200 chars) so legitimate explanations
 *     of HTTP status codes aren't flagged as errors
 *   - Must start with a recognizable error prefix (HTTP status, Error:, etc.)
 *   - False negatives (missed errors) are preferred over false positives
 *     (flagging real bot replies) — a real bot response misclassified as an
 *     error would make the bot look permanently broken to the user
 *
 * See P0-A of the post-marathon follow-up in QA-REPORT-20260411.md for the
 * original Cycle 1 observation.
 */

/** Maximum length of a response that can still be considered "error-shaped". */
const ERROR_SHAPE_MAX_LENGTH = 200;

/**
 * Recognized error-shape prefixes. Each pattern is anchored at the start
 * of the response and must match WITHIN the first few words. Ordered from
 * most-specific to most-generic so the most precise signal is hit first.
 *
 * Tested exhaustively in `botResponseErrorShape.test.ts`.
 */
const ERROR_SHAPE_PATTERNS: RegExp[] = [
  // HTTP status code followed by a short status phrase:
  //   "401 Missing Authentication header"
  //   "403 Forbidden"
  //   "500 Internal Server Error"
  //   "502 Bad Gateway"
  // Must be a 3-digit number, space, then a capital letter to avoid
  // matching things like "100 dollars in savings".
  /^\d{3}\s+[A-Z][A-Za-z0-9 ,.'"!?_-]{2,150}$/,

  // JavaScript error prototypes surfaced as text:
  //   "Error: Request failed with status 401"
  //   "TypeError: Cannot read property..."
  //   "RangeError: ..."
  /^(Error|TypeError|RangeError|SyntaxError|ReferenceError):\s+\S/,

  // Bare authentication failure phrases without HTTP prefix:
  //   "Missing Authentication header"
  //   "Invalid API key"
  //   "Unauthorized"
  //   "Forbidden"
  /^(Missing\s+Authentication|Invalid\s+API\s+[Kk]ey|Unauthorized|Forbidden)\b/,

  // OpenClaw / MCP surfacing upstream 4xx as a short one-liner:
  //   "API request failed with status 401"
  //   "LLM API error 401: ..."
  /^(API\s+request\s+failed|LLM\s+API\s+error)\b/i,
];

/**
 * Returns true when `text` looks like an error that OpenClaw's exec path
 * surfaced as a pseudo-bot-reply rather than a genuine LLM generation.
 *
 * The caller should treat a positive result as equivalent to `chatViaExec`
 * having thrown — route through `classifyError()` for a user-friendly
 * suggestion and do NOT persist the raw text to chat history.
 *
 * Edge cases:
 *   - Empty / whitespace-only input → false (different problem, handled
 *     upstream with a separate "empty response" check)
 *   - Null / undefined → false (defensive)
 *   - Long responses → false (explanations are allowed to mention error
 *     codes in body text)
 *   - Responses starting with prose like "Here are some HTTP codes: 401..."
 *     → false (doesn't match any anchored prefix)
 */
export function isErrorShapedBotReply(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > ERROR_SHAPE_MAX_LENGTH) return false;

  for (const pattern of ERROR_SHAPE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}
