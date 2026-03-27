import DOMPurify from "dompurify";

/**
 * Sanitize HTML string to prevent XSS.
 * Only runs on client - returns input unchanged on server.
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof window === "undefined") return dirty;
  return DOMPurify.sanitize(dirty, {
    ADD_TAGS: ["canvas"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
  });
}
