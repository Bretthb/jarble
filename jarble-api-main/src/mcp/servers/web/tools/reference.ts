/**
 * Reference-data tools. All free public APIs, no credentials needed.
 *
 *   wikipedia         — REST summary endpoint with opensearch fallback
 *   dictionary        — dictionaryapi.dev
 *   currency_exchange — Frankfurter (ECB rates)
 *   timezone          — WorldTimeAPI
 *   country_info      — REST Countries v3.1
 *   open_library      — Open Library search
 */

import { z } from "zod";
import { registerTool } from "../register.js";
import { fetchWithTimeout, fetchJson } from "../../../shared/http.js";
import { NotFoundError, UpstreamError } from "../../../shared/errors.js";
import { WEB_USER_AGENT, WEB_FETCH_TIMEOUT, jsonText } from "./_html.js";

// ── wikipedia ──────────────────────────────────────────────────────────

interface WikiSummary {
  title?: string;
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string };
}

function truncateSentences(text: string, maxSentences: number): string {
  const matches = [...text.matchAll(/[.!?]\s+/g)];
  if (matches.length > maxSentences && matches[maxSentences - 1]) {
    const idx = matches[maxSentences - 1].index;
    if (typeof idx === "number") return text.slice(0, idx + 1);
  }
  return text;
}

registerTool({
  name: "wikipedia",
  description:
    "Search and read Wikipedia articles. Returns article summary, thumbnail, related topics.",
  server: "web",
  // Accept both `sentences` (legacy) and `limit` (spec) for summary length.
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional(),
    sentences: z.number().int().min(1).max(20).optional(),
  }),
  handler: async (args) => {
    const numSentences = Math.min(args.sentences ?? args.limit ?? 5, 20);
    const articleTitle = args.query.replace(/\s+/g, "_");
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      articleTitle,
    )}`;

    // Direct article lookup first.
    const res = await fetchWithTimeout(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });

    if (res.ok) {
      const data = (await res.json()) as WikiSummary;
      const summary = truncateSentences(data.extract ?? "", numSentences);
      return jsonText({
        title: data.title || args.query,
        summary,
        url:
          data.content_urls?.desktop?.page ||
          `https://en.wikipedia.org/wiki/${articleTitle}`,
        thumbnail: data.thumbnail?.source ?? null,
        description: data.description ?? "",
      });
    }

    // Fallback to opensearch.
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
      args.query,
    )}&limit=5&format=json`;
    const openSearch = await fetchJson<[string, string[], string[], string[]]>(
      searchUrl,
      {
        timeoutMs: WEB_FETCH_TIMEOUT,
        headers: { "User-Agent": WEB_USER_AGENT },
      },
    );

    const titles = openSearch[1] ?? [];
    const descriptions = openSearch[2] ?? [];
    const urls = openSearch[3] ?? [];
    if (titles.length === 0) {
      throw new NotFoundError(`No Wikipedia article found for "${args.query}".`);
    }

    const firstUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      titles[0].replace(/\s+/g, "_"),
    )}`;
    const firstRes = await fetchWithTimeout(firstUrl, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });

    if (firstRes.ok) {
      const data = (await firstRes.json()) as WikiSummary;
      const summary = truncateSentences(data.extract ?? "", numSentences);
      const relatedTopics = titles.slice(1).map((t, i) => ({
        title: t,
        url: urls[i + 1] ?? "",
      }));
      return jsonText({
        title: data.title || titles[0],
        summary,
        url: data.content_urls?.desktop?.page || urls[0],
        thumbnail: data.thumbnail?.source ?? null,
        relatedTopics,
      });
    }

    // Last-ditch: return opensearch descriptions only.
    return jsonText({
      title: titles[0],
      summary: descriptions[0] ?? "",
      url: urls[0] ?? "",
      thumbnail: null,
      relatedTopics: titles.slice(1).map((t, i) => ({
        title: t,
        url: urls[i + 1] ?? "",
      })),
    });
  },
});

// ── dictionary ─────────────────────────────────────────────────────────

interface DictEntry {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{
    partOfSpeech: string;
    definitions: Array<{ definition: string; example?: string }>;
  }>;
}

registerTool({
  name: "dictionary",
  description:
    "Look up English word definitions, phonetics, and examples via Free Dictionary API.",
  server: "web",
  inputSchema: z.object({
    word: z.string().min(1),
  }),
  handler: async (args) => {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
      args.word.toLowerCase(),
    )}`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (res.status === 404) {
      throw new NotFoundError(`Word "${args.word}" not found in dictionary.`);
    }
    if (!res.ok) {
      throw new UpstreamError(`Dictionary API returned HTTP ${res.status}`, {
        tool: "dictionary",
        status: res.status,
      });
    }

    const data = (await res.json()) as DictEntry[];
    if (!Array.isArray(data) || data.length === 0) {
      throw new NotFoundError(`No definitions found for "${args.word}".`);
    }
    const entry = data[0];
    return jsonText({
      word: entry.word,
      phonetic: entry.phonetic || entry.phonetics?.[0]?.text || "",
      meanings: (entry.meanings ?? []).map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions ?? []).slice(0, 3).map((d) => ({
          definition: d.definition,
          example: d.example,
        })),
      })),
    });
  },
});

// ── currency_exchange ──────────────────────────────────────────────────

interface FrankfurterResponse {
  base?: string;
  date?: string;
  amount?: number;
  rates?: Record<string, number>;
}

registerTool({
  name: "currency_exchange",
  description:
    "Get live currency exchange rates from Frankfurter (ECB). Convert between currencies.",
  server: "web",
  inputSchema: z.object({
    from: z.string().min(3).max(3),
    to: z.string().min(3).max(3).optional(),
    amount: z.number().positive().optional(),
  }),
  handler: async (args) => {
    const fromCode = args.from.toUpperCase();
    let url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCode)}`;
    if (args.to) url += `&to=${encodeURIComponent(args.to.toUpperCase())}`;
    if (args.amount !== undefined) {
      url += `&amount=${encodeURIComponent(String(args.amount))}`;
    }
    const data = await fetchJson<FrankfurterResponse>(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    return jsonText({
      from: data.base || fromCode,
      date: data.date,
      rates: data.rates ?? {},
      ...(args.amount !== undefined ? { amount: args.amount } : {}),
    });
  },
});

// ── timezone ───────────────────────────────────────────────────────────

interface WorldTimeResponse {
  timezone: string;
  datetime: string;
  utc_offset: string;
  day_of_week: number;
  week_number: number;
}

registerTool({
  name: "timezone",
  description:
    "Get current time in an IANA timezone, or pass 'list' to see all available zones.",
  server: "web",
  inputSchema: z.object({
    // Accept spec name `zone` and legacy `timezone` for compatibility.
    zone: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  }),
  handler: async (args) => {
    const zone = args.zone ?? args.timezone;
    if (!zone) {
      throw new UpstreamError(
        "Missing 'zone' parameter for timezone tool.",
        { tool: "timezone" },
      );
    }

    if (zone.toLowerCase() === "list") {
      const zones = await fetchJson<string[]>(
        "https://worldtimeapi.org/api/timezone",
        {
          timeoutMs: WEB_FETCH_TIMEOUT,
          headers: { "User-Agent": WEB_USER_AGENT },
        },
      );
      return jsonText({ timezones: zones });
    }

    const url = `https://worldtimeapi.org/api/timezone/${encodeURIComponent(zone)}`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (res.status === 404) {
      throw new NotFoundError(
        `Timezone "${zone}" not found. Use zone "list" to see available timezones.`,
      );
    }
    if (!res.ok) {
      throw new UpstreamError(`WorldTimeAPI returned HTTP ${res.status}`, {
        tool: "timezone",
        status: res.status,
      });
    }
    const data = (await res.json()) as WorldTimeResponse;
    return jsonText({
      timezone: data.timezone,
      datetime: data.datetime,
      utcOffset: data.utc_offset,
      dayOfWeek: data.day_of_week,
      weekNumber: data.week_number,
    });
  },
});

// ── country_info ───────────────────────────────────────────────────────

interface RestCountry {
  name?: { common?: string; official?: string };
  capital?: string[];
  population?: number;
  region?: string;
  subregion?: string;
  currencies?: Record<string, { name?: string; symbol?: string }>;
  languages?: Record<string, string>;
  flags?: { emoji?: string; png?: string };
  timezones?: string[];
  area?: number;
}

registerTool({
  name: "country_info",
  description:
    "Look up country information: capital, population, region, currencies, languages, flag, timezones, area.",
  server: "web",
  inputSchema: z.object({
    // Accept spec `country` and legacy `name`.
    country: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  }),
  handler: async (args) => {
    const q = args.country ?? args.name;
    if (!q) {
      throw new UpstreamError("Missing 'country' parameter.", {
        tool: "country_info",
      });
    }
    const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(q)}?fields=name,capital,population,region,subregion,currencies,languages,flags,timezones,area`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    if (res.status === 404) {
      throw new NotFoundError(`Country "${q}" not found.`);
    }
    if (!res.ok) {
      throw new UpstreamError(`REST Countries returned HTTP ${res.status}`, {
        tool: "country_info",
        status: res.status,
      });
    }
    const data = (await res.json()) as RestCountry[];
    if (!Array.isArray(data) || data.length === 0) {
      throw new NotFoundError(`No country found for "${q}".`);
    }
    const c = data[0];
    const currencies = c.currencies
      ? Object.entries(c.currencies).map(([code, v]) => ({
          code,
          name: v.name ?? "",
          symbol: v.symbol ?? "",
        }))
      : [];
    const languages = c.languages ? Object.values(c.languages) : [];
    return jsonText({
      name: c.name?.common ?? q,
      officialName: c.name?.official ?? "",
      capital: Array.isArray(c.capital) ? c.capital : [],
      population: c.population,
      region: c.region,
      subregion: c.subregion ?? "",
      currencies,
      languages,
      flag: c.flags?.emoji || c.flags?.png || "",
      timezones: c.timezones ?? [],
      area: c.area,
    });
  },
});

// ── open_library ───────────────────────────────────────────────────────

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  subject?: string[];
}

registerTool({
  name: "open_library",
  description:
    "Search for books via Open Library. Returns title, author, publication year, ISBN, cover image URL.",
  server: "web",
  inputSchema: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(20).optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(args.max_results ?? 5, 20);
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(args.query)}&limit=${limit}`;
    const data = await fetchJson<{ docs?: OpenLibraryDoc[] }>(url, {
      timeoutMs: WEB_FETCH_TIMEOUT,
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    const results = (data.docs ?? []).slice(0, limit).map((doc) => ({
      title: doc.title ?? "",
      author: Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "",
      firstPublished: doc.first_publish_year ?? null,
      isbn: Array.isArray(doc.isbn) ? doc.isbn[0] : null,
      coverUrl: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : null,
      subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 5) : [],
    }));
    return jsonText({ query: args.query, results });
  },
});
