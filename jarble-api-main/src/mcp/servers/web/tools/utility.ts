/**
 * Utility tools: metadata extraction, RSS parsing, academic search.
 *
 *   url_metadata     — OpenGraph + favicon regex extraction
 *   rss_reader       — RSS/Atom parser via regex (no external deps)
 *   academic_search  — arXiv Atom feed, optional Semantic Scholar backend
 */

import { z } from "zod";
import { registerTool } from "../register.js";
import { fetchWithTimeout, fetchJson } from "../../../shared/http.js";
import { UpstreamError } from "../../../shared/errors.js";
import {
  WEB_USER_AGENT,
  WEB_FETCH_TIMEOUT,
  extractTextFromHtml,
  extractTitle,
  jsonText,
} from "./_html.js";

// ── url_metadata ───────────────────────────────────────────────────────

function getMetaContent(html: string, nameOrProp: string): string {
  // Try `property=|name=` first ... content second ...
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const m1 = html.match(re1);
  if (m1) return m1[1];
  // ... and also the reverse ordering.
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${nameOrProp}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : "";
}

registerTool({
  name: "url_metadata",
  description:
    "Extract Open Graph metadata, title, description, favicon from a URL.",
  server: "web",
  inputSchema: z.object({
    url: z.string().url(),
  }),
  handler: async (args) => {
    const res = await fetchWithTimeout(args.url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (!res.ok) {
      throw new UpstreamError(`HTTP ${res.status} from ${args.url}`, {
        tool: "url_metadata",
        status: res.status,
      });
    }
    const html = await res.text();

    const title = extractTitle(html) || "";
    const ogTitle = getMetaContent(html, "og:title");
    const ogDesc = getMetaContent(html, "og:description");
    const ogImage = getMetaContent(html, "og:image");
    const ogSiteName = getMetaContent(html, "og:site_name");
    const ogType = getMetaContent(html, "og:type");
    const metaDesc = getMetaContent(html, "description");

    const faviconM = html.match(
      /<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']*)["']/i,
    );
    let favicon = faviconM ? faviconM[1] : "";
    if (favicon && !favicon.startsWith("http")) {
      try {
        favicon = new URL(favicon, args.url).href;
      } catch {
        // keep relative URL as-is if we can't resolve
      }
    }

    return jsonText({
      url: args.url,
      title: ogTitle || title,
      description: ogDesc || metaDesc,
      image: ogImage,
      siteName: ogSiteName,
      type: ogType,
      favicon,
    });
  },
});

// ── rss_reader ─────────────────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  description: string;
  publishedAt: string;
}

registerTool({
  name: "rss_reader",
  description:
    "Read RSS or Atom feed. Returns feed title and recent items with title, link, description, publish date.",
  server: "web",
  inputSchema: z.object({
    url: z.string().url(),
    max_items: z.number().int().min(1).max(50).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_items ?? 10, 50);
    const res = await fetchWithTimeout(args.url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (!res.ok) {
      throw new UpstreamError(`HTTP ${res.status} from ${args.url}`, {
        tool: "rss_reader",
        status: res.status,
      });
    }
    const xml = await res.text();
    const isAtom = /<feed\b/i.test(xml);
    const items: FeedItem[] = [];

    let feedTitle = "";
    if (isAtom) {
      const ftM = xml.match(
        /<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i,
      );
      feedTitle = ftM ? ftM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    } else {
      const ftM = xml.match(
        /<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i,
      );
      feedTitle = ftM ? ftM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    }

    if (isAtom) {
      const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
      let match: RegExpExecArray | null;
      while ((match = entryRe.exec(xml)) !== null && items.length < limit) {
        const e = match[1];
        const titleM = e.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const linkM = e.match(/<link[^>]+href=["']([^"']*)["']/i);
        const summaryM =
          e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
          e.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
        const publishedM =
          e.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
          e.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
        items.push({
          title: titleM
            ? titleM[1]
                .replace(/<!\[CDATA\[|\]\]>/g, "")
                .replace(/<[^>]+>/g, "")
                .trim()
            : "",
          link: linkM ? linkM[1] : "",
          description: summaryM
            ? extractTextFromHtml(
                (summaryM[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, ""),
              ).slice(0, 300)
            : "",
          publishedAt: publishedM ? (publishedM[1] ?? "").trim() : "",
        });
      }
    } else {
      const itemRe = /<item>([\s\S]*?)<\/item>/gi;
      let match: RegExpExecArray | null;
      while ((match = itemRe.exec(xml)) !== null && items.length < limit) {
        const e = match[1];
        const titleM = e.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const linkM = e.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
        const descM = e.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
        const pubDateM = e.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
        items.push({
          title: titleM
            ? titleM[1]
                .replace(/<!\[CDATA\[|\]\]>/g, "")
                .replace(/<[^>]+>/g, "")
                .trim()
            : "",
          link: linkM
            ? linkM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()
            : "",
          description: descM
            ? extractTextFromHtml(
                descM[1].replace(/<!\[CDATA\[|\]\]>/g, ""),
              ).slice(0, 300)
            : "",
          publishedAt: pubDateM
            ? pubDateM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()
            : "",
        });
      }
    }

    return jsonText({ feedTitle, items });
  },
});

// ── academic_search ────────────────────────────────────────────────────

interface SemanticScholarPaper {
  paperId: string;
  title?: string;
  abstract?: string;
  year?: number;
  authors?: Array<{ name?: string }>;
  url?: string;
  venue?: string;
  citationCount?: number;
}

registerTool({
  name: "academic_search",
  description:
    "Search academic papers via arXiv (default) or Semantic Scholar. Returns titles, authors, abstracts, links.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(20).optional(),
    source: z.enum(["arxiv", "semantic_scholar"]).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 20);
    const source = args.source ?? "arxiv";

    if (source === "semantic_scholar") {
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
        args.query,
      )}&limit=${limit}&fields=title,abstract,year,authors,url,venue,citationCount`;
      const data = await fetchJson<{ data?: SemanticScholarPaper[] }>(url, {
        timeoutMs: WEB_FETCH_TIMEOUT,
        headers: { "User-Agent": WEB_USER_AGENT },
      });
      const results = (data.data ?? []).slice(0, limit).map((p) => ({
        title: p.title ?? "",
        authors: (p.authors ?? [])
          .map((a) => a.name ?? "")
          .filter(Boolean),
        summary: (p.abstract ?? "").slice(0, 500),
        url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
        year: p.year,
        venue: p.venue ?? "",
        citationCount: p.citationCount ?? 0,
      }));
      return jsonText({ query: args.query, source, results });
    }

    // arXiv (default) — returns Atom XML
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
      args.query,
    )}&max_results=${limit}&sortBy=relevance`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (!res.ok) {
      throw new UpstreamError(`arXiv returned HTTP ${res.status}`, {
        tool: "academic_search",
        status: res.status,
      });
    }
    const xml = await res.text();
    const results: Array<{
      title: string;
      authors: string[];
      summary: string;
      url: string;
      published: string;
    }> = [];

    const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
    let entryMatch: RegExpExecArray | null;
    while (
      (entryMatch = entryRe.exec(xml)) !== null &&
      results.length < limit
    ) {
      const entry = entryMatch[1];
      const titleM = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const summaryM = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      const idM = entry.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
      const publishedM = entry.match(
        /<published[^>]*>([\s\S]*?)<\/published>/i,
      );
      const authors: string[] = [];
      const authorRe = /<author>\s*<name>([\s\S]*?)<\/name>/gi;
      let authorMatch: RegExpExecArray | null;
      let guard = 0;
      while ((authorMatch = authorRe.exec(entry)) !== null && guard++ < 50) {
        authors.push(authorMatch[1].trim());
      }
      const title = titleM ? titleM[1].replace(/\s+/g, " ").trim() : "";
      const summary = summaryM
        ? summaryM[1].replace(/\s+/g, " ").trim().slice(0, 500)
        : "";
      const arxivUrl = idM ? idM[1].trim() : "";
      const published = publishedM ? publishedM[1].trim() : "";
      if (title) {
        results.push({ title, authors, summary, url: arxivUrl, published });
      }
    }

    return jsonText({ query: args.query, source, results });
  },
});
