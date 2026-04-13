/**
 * Input sanitization utilities.
 *
 * Strips HTML tags from user-facing name/label fields to prevent stored XSS.
 * React escapes on render (primary defense), but these prevent XSS in
 * non-React contexts (emails via Resend, admin panels, log viewers).
 */

/** Strip HTML tags from a string. Preserves & < > as text if not part of a tag. */
export function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

/**
 * Zod refinement: rejects strings containing HTML tags.
 * Use on name/label fields where HTML is never valid input.
 */
export function noHtmlTags(val: string): boolean {
  return !/<[a-zA-Z/]/.test(val);
}

export const NO_HTML_MESSAGE = "HTML tags are not allowed in this field";

/**
 * Zod refinement: blocks dangerous HTML/JS patterns in freeform text fields
 * like systemPrompt where XML-like tags (e.g. <think>, <tool_use>) are
 * legitimate but executable HTML (script, event handlers) is not.
 */
const DANGEROUS_HTML_RE =
  /<\s*(script|iframe|embed|object|form|svg|math)\b/i;
const EVENT_HANDLER_RE = /\bon\w+\s*=/i;

export function noDangerousHtml(val: string): boolean {
  return !DANGEROUS_HTML_RE.test(val) && !EVENT_HANDLER_RE.test(val);
}

export const NO_DANGEROUS_HTML_MESSAGE =
  "Script tags, iframes, and event handlers are not allowed";
