import DOMPurify from "dompurify";

/**
 * Sanitize HTML string to prevent XSS.
 *
 * On the client: uses DOMPurify with the browser's DOM.
 * On the server: strips all HTML tags as a safe fallback since DOMPurify
 * requires a DOM environment. Sandbox iframes always run on the client
 * anyway, but this prevents any server-rendered path from passing through
 * unsanitized HTML.
 */
export function sanitizeHtml(dirty: string): string {
  if (typeof window === "undefined") {
    // Server-side: strip all HTML tags as a safe fallback.
    // This is conservative but safe - better to lose formatting than allow XSS.
    return dirty.replace(/<[^>]*>/g, "");
  }
  return DOMPurify.sanitize(dirty, {
    ADD_TAGS: ["canvas"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
  });
}
