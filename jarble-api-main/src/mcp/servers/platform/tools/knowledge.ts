/**
 * Knowledge base platform tools.
 *
 * The knowledge pipeline today is a chunk-on-disk store
 * (`routes/knowledge.ts`) without a vector backend. We expose list/get
 * over the chunk manifest so agents can at least enumerate and pull raw
 * chunks, but `search_knowledge` is a clean NOT_IMPLEMENTED until a real
 * RAG backend lands. No fake results.
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerTool } from "../register.js";
import { jsonResult } from "../_helpers.js";
import { NotFoundError, McpError } from "../../../shared/errors.js";
import { env } from "../../../../utils/env.js";

interface CollectionRef {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
  detectedType: string;
  fileSize: number;
}

interface Manifest {
  collections: CollectionRef[];
}

function knowledgeDir(deploymentId: string): string {
  const base =
    env.NODE_ENV === "development"
      ? join(process.cwd(), "data", "knowledge")
      : join("/tmp", "knowledge");
  return join(base, deploymentId);
}

function readManifest(dir: string): Manifest {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return { collections: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  } catch {
    return { collections: [] };
  }
}

// ── list_knowledge_docs ─────────────────────────────────────────────────────

registerTool({
  name: "list_knowledge_docs",
  description:
    "List knowledge-base documents (collections) indexed for the calling deployment. Returns each collection's ID, filename, chunk count, and upload timestamp.",
  server: "platform",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const dir = knowledgeDir(ctx.deploymentId);
    const manifest = readManifest(dir);
    return jsonResult({ collections: manifest.collections });
  },
});

// ── get_knowledge_doc ───────────────────────────────────────────────────────

registerTool({
  name: "get_knowledge_doc",
  description:
    "Retrieve a specific knowledge collection by ID. Returns the full chunk list. Use sparingly — collections can be large.",
  server: "platform",
  inputSchema: z.object({
    collectionId: z.string().min(1),
  }),
  handler: async (args, ctx) => {
    const dir = knowledgeDir(ctx.deploymentId);
    const manifest = readManifest(dir);
    const ref = manifest.collections.find((c) => c.id === args.collectionId);
    if (!ref) {
      throw new NotFoundError(
        `Knowledge collection "${args.collectionId}" not found for this deployment`,
      );
    }
    const chunkPath = join(dir, "chunks", `${ref.id}.json`);
    if (!existsSync(chunkPath)) {
      throw new NotFoundError(
        `Chunk file for collection "${args.collectionId}" is missing from disk`,
      );
    }
    let chunks: unknown;
    try {
      chunks = JSON.parse(readFileSync(chunkPath, "utf-8"));
    } catch (err) {
      throw new McpError(
        "INTERNAL",
        `Failed to parse chunk file for collection "${args.collectionId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return jsonResult({
      collectionId: ref.id,
      filename: ref.filename,
      detectedType: ref.detectedType,
      chunkCount: ref.chunkCount,
      uploadedAt: ref.uploadedAt,
      chunks,
    });
  },
});

// ── search_knowledge ────────────────────────────────────────────────────────

registerTool({
  name: "search_knowledge",
  description:
    "Semantic search across the deployment's knowledge base. NOT YET IMPLEMENTED — the current knowledge pipeline stores raw chunks on disk without a vector backend. Use list_knowledge_docs + get_knowledge_doc today, or wait for the RAG backend to ship.",
  server: "platform",
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  }),
  handler: async (_args, _ctx) => {
    throw new McpError(
      "NOT_IMPLEMENTED",
      "Semantic knowledge search is not yet wired on the platform. Current backend (routes/knowledge.ts) stores chunks on disk without vector indexing. Use list_knowledge_docs + get_knowledge_doc to enumerate and fetch raw chunks.",
    );
  },
});
