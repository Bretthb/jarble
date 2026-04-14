/**
 * Shared HTML helpers for web-scope tools.
 *
 * Kept internal (leading underscore) — not a tool module, just pure-function
 * regex utilities used by web_fetch, url_metadata, news_search etc. Matches
 * the behavior of the legacy `extractTextFromHtml` / `extractTitle` in
 * `jarble-ui-server.js` so migrated tools produce identical output.
 */

/** User-Agent header applied to every outbound call from web tools. */
export const WEB_USER_AGENT = "Jarble/1.0";

/** Default timeout for web-tool HTTP calls (ms). */
export const WEB_FETCH_TIMEOUT = 10_000;

/**
 * Strip scripts/styles/nav/HTML tags, decode common entities, collapse
 * whitespace. Returns clean readable text.
 */
export function extractTextFromHtml(html: string): string {
  let text = html;
  text = text.replace(
    /<(script|style|nav|header|footer|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " ",
  );
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** Extract the <title> element content from an HTML document. */
export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
}

/** Standard JSON-text result envelope for web tools. */
export function jsonText(payload: unknown): {
  content: [{ type: "text"; text: string }];
} {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}
