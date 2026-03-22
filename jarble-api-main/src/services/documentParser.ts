/**
 * Document Parser — Simple document ingestion for RAG / Knowledge Base
 *
 * Accepts text content + filename, detects type from extension,
 * splits into semantic chunks with overlap, returns chunk array.
 *
 * Supported formats: .txt, .md, .json, .csv
 * No external dependencies — uses only Node.js built-ins.
 */

import { createHash } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  source: string;       // Original filename
  section?: string;     // Heading or section name (for .md)
  chunkIndex: number;   // Position within document
}

export interface DocumentChunk {
  id: string;           // SHA-256 hash of content (first 16 chars)
  text: string;
  metadata: ChunkMetadata;
}

export interface ParseResult {
  chunks: DocumentChunk[];
  filename: string;
  detectedType: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const MIN_CHUNK_CHARS = 100;   // ~25 tokens
const MAX_CHUNK_CHARS = 3200;  // ~800 tokens
const OVERLAP_CHARS = 200;     // ~50 tokens

// ── Helpers ──────────────────────────────────────────────────────────────

function hashChunk(text: string, source: string, index: number): string {
  return createHash("sha256")
    .update(`${source}:${index}:${text}`)
    .digest("hex")
    .slice(0, 16);
}

/** Split text on sentence boundaries (period, !, ?, followed by space/newline) */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter((s) => s.trim().length > 0);
}

/** Split text into paragraphs (double newline) */
function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

// ── Chunking ─────────────────────────────────────────────────────────────

/**
 * Core chunking logic:
 * 1. Split on paragraphs first
 * 2. If paragraph is too long, split on sentences
 * 3. Merge small consecutive chunks
 * 4. Add overlap between chunks
 */
function chunkText(text: string, source: string): DocumentChunk[] {
  const paragraphs = splitParagraphs(text);
  const rawChunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= MAX_CHUNK_CHARS) {
      rawChunks.push(para.trim());
    } else {
      // Paragraph too long — split on sentences
      const sentences = splitSentences(para);
      let current = "";
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
          rawChunks.push(current.trim());
          current = sentence;
        } else {
          current = current ? current + " " + sentence : sentence;
        }
      }
      if (current.trim()) {
        rawChunks.push(current.trim());
      }
    }
  }

  // Merge very small chunks with the next one
  const merged: string[] = [];
  let accumulator = "";
  for (const chunk of rawChunks) {
    if (accumulator.length + chunk.length + 1 < MIN_CHUNK_CHARS) {
      accumulator = accumulator ? accumulator + "\n\n" + chunk : chunk;
    } else {
      if (accumulator) {
        merged.push(accumulator);
      }
      accumulator = chunk;
    }
  }
  if (accumulator) merged.push(accumulator);

  // Add overlap between chunks
  const result: DocumentChunk[] = [];
  for (let i = 0; i < merged.length; i++) {
    let chunkText = merged[i];

    // Prepend overlap from previous chunk
    if (i > 0 && OVERLAP_CHARS > 0) {
      const prevText = merged[i - 1];
      const overlapText = prevText.slice(-OVERLAP_CHARS);
      chunkText = overlapText + "\n\n" + chunkText;
    }

    result.push({
      id: hashChunk(chunkText, source, i),
      text: chunkText,
      metadata: {
        source,
        chunkIndex: i,
      },
    });
  }

  return result;
}

// ── Format-specific parsers ──────────────────────────────────────────────

function parseMarkdown(content: string, filename: string): DocumentChunk[] {
  // Extract sections by headings for metadata
  const lines = content.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n") });
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n") });
  }

  // Chunk each section independently
  const allChunks: DocumentChunk[] = [];
  for (const section of sections) {
    const trimmed = section.content.trim();
    if (!trimmed) continue;

    const chunks = chunkText(trimmed, filename);
    for (const chunk of chunks) {
      if (section.heading) {
        chunk.metadata.section = section.heading;
      }
    }
    allChunks.push(...chunks);
  }

  // Re-index chunk IDs after merging sections
  return allChunks.map((chunk, i) => ({
    ...chunk,
    id: hashChunk(chunk.text, filename, i),
    metadata: { ...chunk.metadata, chunkIndex: i },
  }));
}

function parseJson(content: string, filename: string): DocumentChunk[] {
  try {
    const parsed = JSON.parse(content);
    // Pretty-print for readability, then chunk like text
    const prettyJson = JSON.stringify(parsed, null, 2);
    return chunkText(prettyJson, filename);
  } catch {
    // If invalid JSON, treat as plain text
    return chunkText(content, filename);
  }
}

function parseCsv(content: string, filename: string): DocumentChunk[] {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const header = lines[0];
  const dataLines = lines.slice(1);

  // Group rows into chunks (~10-20 rows per chunk for context)
  const ROWS_PER_CHUNK = 15;
  const chunks: DocumentChunk[] = [];

  for (let i = 0; i < dataLines.length; i += ROWS_PER_CHUNK) {
    const rowSlice = dataLines.slice(i, i + ROWS_PER_CHUNK);
    const chunkContent = [header, ...rowSlice].join("\n");
    chunks.push({
      id: hashChunk(chunkContent, filename, Math.floor(i / ROWS_PER_CHUNK)),
      text: chunkContent,
      metadata: {
        source: filename,
        section: `rows ${i + 1}-${Math.min(i + ROWS_PER_CHUNK, dataLines.length)}`,
        chunkIndex: Math.floor(i / ROWS_PER_CHUNK),
      },
    });
  }

  return chunks;
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Parse document content into searchable chunks.
 *
 * @param content - Raw text content of the file
 * @param filename - Original filename (used for type detection and metadata)
 * @returns Parsed chunks with IDs and metadata
 */
export function parseDocument(content: string, filename: string): ParseResult {
  const ext = filename.toLowerCase().split(".").pop() || "txt";
  let chunks: DocumentChunk[];
  let detectedType: string;

  switch (ext) {
    case "md":
    case "markdown":
      chunks = parseMarkdown(content, filename);
      detectedType = "markdown";
      break;
    case "json":
      chunks = parseJson(content, filename);
      detectedType = "json";
      break;
    case "csv":
      chunks = parseCsv(content, filename);
      detectedType = "csv";
      break;
    case "txt":
    default:
      chunks = chunkText(content, filename);
      detectedType = "text";
      break;
  }

  return { chunks, filename, detectedType };
}
