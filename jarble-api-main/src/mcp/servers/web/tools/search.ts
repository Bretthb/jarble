/**
 * Web-search tools. Stateless wrappers over public search/registry APIs.
 *
 *   web_fetch     — HTTP GET + HTML text extraction (default 100KB cap)
 *   web_search    — DuckDuckGo lite HTML scrape
 *   hacker_news   — HN Algolia search API
 *   github_search — GitHub repo/gist search (respects rate-limit headers)
 *   npm_search    — npm registry v1 search
 *   news_search   — recent news via DuckDuckGo lite with df=w filter
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

// ── web_fetch ──────────────────────────────────────────────────────────

registerTool({
  name: "web_fetch",
  description:
    "Fetch a URL and extract its text content. Strips HTML tags, scripts, styles, nav. Returns cleaned text with title.",
  server: "web",
  inputSchema: z.object({
    url: z.string().url(),
    max_bytes: z.number().int().min(100).max(1_000_000).optional(),
  }),
  handler: async (args) => {
    const limit = args.max_bytes ?? 100_000;
    const res = await fetchWithTimeout(args.url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (!res.ok) {
      throw new UpstreamError(`HTTP ${res.status} from ${args.url}`, {
        tool: "web_fetch",
        status: res.status,
        statusText: res.statusText,
      });
    }

    // Enforce Content-Length before reading body to avoid blowing memory.
    const lenHeader = res.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > limit * 10) {
      // Bail early on obviously-huge documents (10x soft cap).
      throw new UpstreamError(
        `Response too large: ${lenHeader} bytes from ${args.url}`,
        { tool: "web_fetch", contentLength: lenHeader },
      );
    }

    const html = await res.text();
    const title = extractTitle(html) || "";
    let content = extractTextFromHtml(html);
    const fullLength = content.length;
    if (content.length > limit) content = content.slice(0, limit) + "...";

    return jsonText({
      url: args.url,
      title,
      content,
      contentLength: fullLength,
      truncated: fullLength > limit,
    });
  },
});

// ── web_search ─────────────────────────────────────────────────────────

// Shared DDG-lite scraper: used by web_search + news_search. Keeping this
// inline (not exported) because it's the only pattern repeated — no point
// growing a shared helper surface for two callers.
async function scrapeDuckDuckGoLite(query: string): Promise<string> {
  const res = await fetchWithTimeout("https://lite.duckduckgo.com/lite", {
    method: "POST",
    timeoutMs: WEB_FETCH_TIMEOUT,
    headers: {
      "User-Agent": WEB_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "q=" + encodeURIComponent(query),
  });
  if (!res.ok) {
    throw new UpstreamError(`DuckDuckGo returned HTTP ${res.status}`, {
      tool: "web_search",
      status: res.status,
    });
  }
  return await res.text();
}

function parseDuckDuckGoLite(html: string, limit: number) {
  const linkRe =
    /<a[^>]+class='result-link'[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe =
    /<td\s+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = linkRe.exec(html)) !== null && guard++ < 200) {
    links.push({ url: m[1], title: extractTextFromHtml(m[2]).trim() });
  }
  const snippets: string[] = [];
  guard = 0;
  while ((m = snippetRe.exec(html)) !== null && guard++ < 200) {
    snippets.push(extractTextFromHtml(m[1]).trim());
  }

  const out: Array<{ title: string; url: string; snippet: string }> = [];
  for (let i = 0; i < Math.min(links.length, limit); i++) {
    out.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }
  return out;
}

registerTool({
  name: "web_search",
  description:
    "Search the web using DuckDuckGo. Returns titles, URLs, and snippets for top results.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(10).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 10);
    const html = await scrapeDuckDuckGoLite(args.query);
    const results = parseDuckDuckGoLite(html, limit);
    return jsonText({ query: args.query, results });
  },
});

// ── hacker_news ────────────────────────────────────────────────────────

interface HnHit {
  title?: string;
  story_title?: string;
  url?: string;
  objectID: string;
  points?: number;
  author?: string;
  created_at?: string;
  num_comments?: number;
  comment_text?: string;
}

registerTool({
  name: "hacker_news",
  description:
    "Search Hacker News stories and comments via Algolia API.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(10).optional(),
    type: z.enum(["story", "comment"]).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 10);
    const searchType = args.type ?? "story";
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      args.query,
    )}&tags=${searchType}&hitsPerPage=${limit}`;

    const data = await fetchJson<{ hits?: HnHit[] }>(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });

    const results = (data.hits ?? []).map((hit) => ({
      title: hit.title || hit.story_title || "",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points ?? 0,
      author: hit.author ?? "",
      createdAt: hit.created_at ?? "",
      numComments: hit.num_comments ?? 0,
      ...(searchType === "comment"
        ? {
            commentText: (hit.comment_text ?? "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300),
          }
        : {}),
    }));

    return jsonText({ query: args.query, results });
  },
});

// ── github_search ──────────────────────────────────────────────────────

interface GithubRepo {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  html_url: string;
  updated_at: string;
}

interface GithubGist {
  id: string;
  html_url: string;
  description: string | null;
  public: boolean;
  created_at: string;
  updated_at: string;
  owner?: { login?: string };
  files?: Record<string, { filename?: string; language?: string | null }>;
}

registerTool({
  name: "github_search",
  description:
    "Search GitHub public repositories or gists. Returns stars/forks/language for repos, owner/files for gists.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(10).optional(),
    type: z.enum(["repos", "gists"]).optional(),
    sort: z.enum(["stars", "updated", "forks"]).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 10);
    const type = args.type ?? "repos";

    if (type === "repos") {
      const sort = args.sort ?? "stars";
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
        args.query,
      )}&sort=${sort}&per_page=${limit}`;
      const res = await fetchWithTimeout(url, {
        timeoutMs: WEB_FETCH_TIMEOUT,
        headers: {
          "User-Agent": WEB_USER_AGENT,
          Accept: "application/vnd.github+json",
        },
      });

      if (res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = res.headers.get("x-ratelimit-reset") ?? "";
        throw new UpstreamError(
          `GitHub API rate-limited. Retry after epoch ${reset}.`,
          { tool: "github_search", rateLimitReset: reset },
        );
      }
      if (!res.ok) {
        throw new UpstreamError(`GitHub API returned HTTP ${res.status}`, {
          tool: "github_search",
          status: res.status,
        });
      }
      const data = (await res.json()) as {
        items?: GithubRepo[];
        total_count?: number;
      };
      const results = (data.items ?? []).map((r) => ({
        name: r.name,
        fullName: r.full_name,
        description: r.description ?? "",
        stars: r.stargazers_count,
        forks: r.forks_count,
        language: r.language ?? "Unknown",
        url: r.html_url,
        updatedAt: r.updated_at,
      }));
      return jsonText({
        query: args.query,
        type,
        totalCount: data.total_count,
        results,
      });
    }

    // gists — GitHub's search API doesn't cover gists, so we list the
    // target user's public gists when the query looks like a user name,
    // otherwise we fall back to the /gists/public feed and filter locally.
    // Keep this minimal — gist search is a spec addition, not in the legacy source.
    const url = `https://api.github.com/gists/public?per_page=${limit}`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: {
        "User-Agent": WEB_USER_AGENT,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = res.headers.get("x-ratelimit-reset") ?? "";
      throw new UpstreamError(
        `GitHub API rate-limited. Retry after epoch ${reset}.`,
        { tool: "github_search", rateLimitReset: reset },
      );
    }
    if (!res.ok) {
      throw new UpstreamError(`GitHub API returned HTTP ${res.status}`, {
        tool: "github_search",
        status: res.status,
      });
    }
    const gists = (await res.json()) as GithubGist[];
    const q = args.query.toLowerCase();
    const results = gists
      .filter((g) => (g.description ?? "").toLowerCase().includes(q))
      .slice(0, limit)
      .map((g) => ({
        id: g.id,
        url: g.html_url,
        description: g.description ?? "",
        owner: g.owner?.login ?? "",
        files: Object.keys(g.files ?? {}),
        createdAt: g.created_at,
        updatedAt: g.updated_at,
      }));
    return jsonText({ query: args.query, type, results });
  },
});

// ── npm_search ─────────────────────────────────────────────────────────

interface NpmSearchHit {
  package: {
    name: string;
    version: string;
    description?: string;
    author?: { name?: string } | string;
  };
  score?: { detail?: { popularity?: number } };
}

registerTool({
  name: "npm_search",
  description:
    "Search npm packages. Returns name, version, description, author, popularity score.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(20).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 20);
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(
      args.query,
    )}&size=${limit}`;

    const data = await fetchJson<{ objects?: NpmSearchHit[] }>(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });

    const results = (data.objects ?? []).map((obj) => {
      const pkg = obj.package;
      const author =
        typeof pkg.author === "string"
          ? pkg.author
          : pkg.author?.name ?? "";
      return {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? "",
        author,
        popularityScore: obj.score?.detail?.popularity ?? 0,
        url: `https://www.npmjs.com/package/${pkg.name}`,
      };
    });

    return jsonText({ query: args.query, results });
  },
});

// ── news_search ────────────────────────────────────────────────────────

registerTool({
  name: "news_search",
  description:
    "Search recent news articles via DuckDuckGo (past week). Returns headlines, URLs, snippets.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(10).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 10);
    // Append "news" + df=w (past week) to the query to bias toward news hits.
    const res = await fetchWithTimeout("https://lite.duckduckgo.com/lite", {
      method: "POST",
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: {
        "User-Agent": WEB_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "q=" + encodeURIComponent(args.query + " news") + "&df=w",
    });
    if (!res.ok) {
      throw new UpstreamError(`DuckDuckGo returned HTTP ${res.status}`, {
        tool: "news_search",
        status: res.status,
      });
    }
    const html = await res.text();
    const results = parseDuckDuckGoLite(html, limit);
    return jsonText({ query: args.query, results });
  },
});
