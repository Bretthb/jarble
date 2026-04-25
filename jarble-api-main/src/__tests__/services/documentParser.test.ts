/**
 * Unit tests for documentParser.ts.
 *
 * documentParser is the ingestion layer for the platform's RAG /
 * Knowledge Base. Every uploaded file flows through `parseDocument`
 * and the chunks it returns become the searchable unit downstream.
 * Three contracts are worth pinning:
 *
 *   1. Format detection by extension is the entry-point switch — a
 *      regression that routed `.csv` through plain text would lose
 *      the per-row `section: "rows N-M"` metadata that the UI shows.
 *
 *   2. Chunk IDs are stable SHA-256 hashes of `(source, index, text)`.
 *      The same file uploaded twice MUST produce identical chunk IDs
 *      so the dedup layer downstream actually dedups. A regression
 *      that swapped to a random nonce would balloon the index.
 *
 *   3. Chunk size is bounded — MIN_CHUNK_CHARS=100 floor, MAX=3200
 *      ceiling, with OVERLAP=200 chars prepended from the previous
 *      chunk. Tests verify the bounds and that overlap is actually
 *      content from the prior chunk's tail.
 */

import { describe, it, expect } from "vitest";
import { parseDocument, type DocumentChunk } from "../../services/documentParser.js";

// ── Format detection ────────────────────────────────────────────────────────

describe("parseDocument — format detection", () => {
  it("detects .md and .markdown as markdown", () => {
    expect(parseDocument("# heading\nbody text".repeat(20), "x.md").detectedType).toBe("markdown");
    expect(parseDocument("# heading\nbody text".repeat(20), "x.markdown").detectedType).toBe("markdown");
  });

  it("detects .json as json", () => {
    expect(parseDocument('{"k":"v"}', "x.json").detectedType).toBe("json");
  });

  it("detects .csv as csv", () => {
    expect(parseDocument("a,b\n1,2", "x.csv").detectedType).toBe("csv");
  });

  it("treats .txt and unknown extensions as text", () => {
    expect(parseDocument("plain text body".repeat(20), "x.txt").detectedType).toBe("text");
    expect(parseDocument("plain text body".repeat(20), "x.unknown").detectedType).toBe("text");
    expect(parseDocument("plain text body".repeat(20), "noextension").detectedType).toBe("text");
  });

  it("is case-insensitive about the extension", () => {
    expect(parseDocument("# heading\nbody".repeat(20), "X.MD").detectedType).toBe("markdown");
    expect(parseDocument("a,b\n1,2", "X.CSV").detectedType).toBe("csv");
  });

  it("preserves the original filename in the result and chunk metadata", () => {
    const r = parseDocument("hello world hello world hello world".repeat(10), "Notes-2026.txt");
    expect(r.filename).toBe("Notes-2026.txt");
    for (const c of r.chunks) {
      expect(c.metadata.source).toBe("Notes-2026.txt");
    }
  });
});

// ── Chunk shape + stability ─────────────────────────────────────────────────

describe("parseDocument — chunk shape", () => {
  it("returns a non-empty chunks array with 16-char hex ids and sequential chunkIndex", () => {
    // Build content long enough to fill several chunks.
    const content = (
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
    ).repeat(80);
    const r = parseDocument(content, "doc.txt");

    expect(r.chunks.length).toBeGreaterThan(0);
    for (let i = 0; i < r.chunks.length; i++) {
      expect(r.chunks[i].metadata.chunkIndex).toBe(i);
      expect(r.chunks[i].id).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof r.chunks[i].text).toBe("string");
      expect(r.chunks[i].text.length).toBeGreaterThan(0);
    }
  });

  it("produces stable chunk ids across runs (no nonces — re-upload dedup works)", () => {
    const content = "Same body text".repeat(200);
    const a = parseDocument(content, "stable.txt");
    const b = parseDocument(content, "stable.txt");
    expect(a.chunks.map((c) => c.id)).toEqual(b.chunks.map((c) => c.id));
  });

  it("produces different chunk ids when the source filename differs (source is part of the hash)", () => {
    const content = "Same body text".repeat(200);
    const a = parseDocument(content, "fileA.txt");
    const b = parseDocument(content, "fileB.txt");
    // Same chunk count, but different ids because filename is hashed in.
    expect(a.chunks.length).toBe(b.chunks.length);
    expect(a.chunks[0].id).not.toBe(b.chunks[0].id);
  });

  it("respects MAX_CHUNK_CHARS — no chunk exceeds 3200 chars beyond the prepended overlap (200)", () => {
    // A single 100k-char paragraph forces sentence-level splitting.
    const sentence = "This is a sentence with several words. ";
    const content = sentence.repeat(2000); // ~80k chars
    const r = parseDocument(content, "long.txt");

    // Each merged chunk is at most ~MAX (3200) + OVERLAP (200) = 3400.
    // We give a tiny slack for sentence-boundary slop.
    for (const c of r.chunks) {
      expect(c.text.length).toBeLessThanOrEqual(3500);
    }
  });
});

// ── Overlap semantics ───────────────────────────────────────────────────────

describe("parseDocument — overlap", () => {
  it("prepends the tail of the previous chunk onto every subsequent chunk", () => {
    // Two distinguishable paragraphs that won't fit in one chunk.
    const blockA = "AAAA ".repeat(800); // 4000 chars of A
    const blockB = "BBBB ".repeat(800); // 4000 chars of B
    const r = parseDocument(`${blockA}\n\n${blockB}`, "overlap.txt");

    // First chunk has no overlap, subsequent chunks should contain
    // the tail of the prior chunk as a prefix.
    expect(r.chunks.length).toBeGreaterThanOrEqual(2);
    const second = r.chunks[1].text;
    const firstTail = r.chunks[0].text.slice(-100);
    expect(second.includes(firstTail.slice(0, 50))).toBe(true);
  });
});

// ── Markdown sections ───────────────────────────────────────────────────────

describe("parseDocument — markdown sections", () => {
  const md = [
    "# Top",
    "Top body. ".repeat(20),
    "",
    "## Subhead",
    "Sub body. ".repeat(20),
    "",
    "### Deeper",
    "Deep body. ".repeat(20),
  ].join("\n");

  it("attaches the nearest heading as section metadata on each chunk", () => {
    const r = parseDocument(md, "doc.md");
    expect(r.chunks.length).toBeGreaterThan(0);
    const sections = new Set(r.chunks.map((c) => c.metadata.section));
    // All three headings should appear in chunk metadata.
    expect(sections.has("Top")).toBe(true);
    expect(sections.has("Subhead")).toBe(true);
    expect(sections.has("Deeper")).toBe(true);
  });

  it("re-indexes chunkIndex sequentially across all sections", () => {
    const r = parseDocument(md, "doc.md");
    for (let i = 0; i < r.chunks.length; i++) {
      expect(r.chunks[i].metadata.chunkIndex).toBe(i);
    }
  });

  it("ignores ATX headings deeper than ###", () => {
    // The regex matches `#{1,3}` only — `####` isn't a section break.
    const content = [
      "# Heading 1",
      "Body 1. ".repeat(20),
      "#### Should be body, not a heading",
      "Body 2. ".repeat(20),
    ].join("\n");
    const r = parseDocument(content, "deep.md");
    // Every chunk in this file should be labeled with "Heading 1" since
    // there is no second valid heading.
    for (const c of r.chunks) {
      expect(c.metadata.section).toBe("Heading 1");
    }
  });
});

// ── JSON ────────────────────────────────────────────────────────────────────

describe("parseDocument — JSON", () => {
  it("pretty-prints valid JSON before chunking", () => {
    const obj = { name: "test", items: [1, 2, 3], nested: { key: "value" } };
    const r = parseDocument(JSON.stringify(obj), "data.json");

    // Pretty-printed output indents keys by 2 spaces.
    const fullText = r.chunks.map((c) => c.text).join("\n");
    expect(fullText).toContain('"name": "test"');
    expect(fullText).toContain('"items"');
  });

  it("falls back to plain-text chunking for malformed JSON", () => {
    // `{not json` is invalid — must not throw, must still return chunks.
    const broken = "{not json " + "filler ".repeat(200);
    const r = parseDocument(broken, "broken.json");
    expect(r.detectedType).toBe("json"); // type is still based on extension
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks[0].text).toContain("not json");
  });
});

// ── CSV ─────────────────────────────────────────────────────────────────────

describe("parseDocument — CSV", () => {
  function buildCsv(rowCount: number): string {
    const header = "id,name,value";
    const rows = Array.from({ length: rowCount }, (_, i) => `${i},name${i},${i * 10}`);
    return [header, ...rows].join("\n");
  }

  it("groups rows into chunks of ~15 with header repeated on each", () => {
    const csv = buildCsv(45); // 45 rows → 3 chunks of 15
    const r = parseDocument(csv, "data.csv");
    expect(r.chunks.length).toBe(3);
    for (const c of r.chunks) {
      // Every chunk starts with the header.
      expect(c.text.startsWith("id,name,value")).toBe(true);
    }
  });

  it("populates `section` metadata as 'rows N-M' for each chunk", () => {
    const csv = buildCsv(45);
    const r = parseDocument(csv, "data.csv");
    expect(r.chunks[0].metadata.section).toBe("rows 1-15");
    expect(r.chunks[1].metadata.section).toBe("rows 16-30");
    expect(r.chunks[2].metadata.section).toBe("rows 31-45");
  });

  it("returns an empty chunks array for a CSV with no data rows", () => {
    // Header alone -> no chunks (split on rows, none exist).
    const r = parseDocument("id,name", "empty.csv");
    expect(r.chunks).toEqual([]);
  });

  it("returns an empty chunks array for a fully empty CSV string", () => {
    const r = parseDocument("", "empty.csv");
    expect(r.chunks).toEqual([]);
  });

  it("clamps the last chunk's row range to the actual row count", () => {
    // 20 rows → first chunk rows 1-15, second chunk rows 16-20 (NOT 16-30).
    const csv = buildCsv(20);
    const r = parseDocument(csv, "data.csv");
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[1].metadata.section).toBe("rows 16-20");
  });
});

// ── Empty / degenerate input ────────────────────────────────────────────────

describe("parseDocument — degenerate inputs", () => {
  it("returns a usable result for an empty .txt file", () => {
    const r = parseDocument("", "empty.txt");
    expect(r.detectedType).toBe("text");
    // Empty input produces no chunks (no paragraphs to merge).
    expect(r.chunks).toEqual([]);
  });

  it("returns a usable result for whitespace-only content", () => {
    const r = parseDocument("   \n\n   \n", "blank.txt");
    expect(r.chunks).toEqual([]);
  });

  it("does not crash on content with only headings (markdown)", () => {
    const r = parseDocument("# H1\n## H2\n### H3", "headings.md");
    // No body content under any heading, so no chunks.
    expect(r.chunks).toEqual([]);
  });
});
