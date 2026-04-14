/**
 * Long-term memory tools (pod-local).
 *
 * Ported from jarble-ui-server.js (executeStoreMemory / executeRecallMemory /
 * executeListMemories / executeForgetMemory). State lives on the PVC at
 * {pvcMount}/memory/store.json.
 *
 * Embeddings degrade gracefully: if no OpenAI / OpenRouter / Google key is in
 * the pod env, the store silently falls back to a local bag-of-words hash
 * embedding plus jaccard word overlap. This keeps `recall_memory` working on
 * Anthropic-only deployments without silently failing the tool.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { registerTool } from "../register.js";
import {
  ensureDir,
  pvcRoot,
  readJsonOrDefault,
  textResult,
} from "../_helpers.js";
import { UpstreamError } from "../../../shared/errors.js";

// ── Constants ─────────────────────────────────────────────────────────

const EMBEDDING_DIMS = 512;
const MEMORY_VERSION = 1;
const SIMILARITY_THRESHOLD = 0.82; // neural
const LOCAL_SIMILARITY_THRESHOLD = 0.45; // local bag-of-words
const MAX_MEMORIES = 10_000;

function memoryDir(): string {
  return process.env.JARBLE_MEMORY_DIR || path.join(pvcRoot(), "memory");
}

function memoryFile(): string {
  return path.join(memoryDir(), "store.json");
}

// ── Scope helpers ─────────────────────────────────────────────────────

type MemoryScope = "global" | "session" | "off";

function getMemoryScope(): MemoryScope {
  const raw = (process.env.JARBLE_MEMORY_SCOPE || "global").toLowerCase();
  if (raw === "off" || raw === "session") return raw;
  return "global";
}

function resolveEffectiveSessionId(arg?: string): string | null {
  if (typeof arg === "string" && arg.trim().length > 0) return arg.trim();
  const env = process.env.JARBLE_CURRENT_SESSION_ID;
  if (typeof env === "string" && env.trim().length > 0) return env.trim();
  return null;
}

function requireSessionId(
  arg?: string,
): { ok: true; effective: string | null } | { ok: false; message: string } {
  if (getMemoryScope() !== "session") return { ok: true, effective: null };
  const effective = resolveEffectiveSessionId(arg);
  if (effective !== null) return { ok: true, effective };
  return {
    ok: false,
    message:
      "Memory is in session mode for this deployment — you MUST pass session_id on this call. " +
      "Use your current conversation's session id. Memories stored/recalled without session_id " +
      "would leak across chats, so the call was blocked.",
  };
}

function memoryOff(): boolean {
  return getMemoryScope() === "off";
}

function memoryOffResponse() {
  return textResult(
    "Long-term memory is disabled for this deployment (memory_scope=off). Ask the user to re-enable it in the deployment configuration if they want the bot to remember anything.",
    true,
  );
}

// ── Store I/O ─────────────────────────────────────────────────────────

interface StoredMemory {
  id: string;
  text: string;
  category: string;
  embedding: number[];
  createdAt: string;
  updatedAt: string;
  sourcePlatform: string;
  sessionId: string | null;
}

interface MemoryStore {
  version: number;
  embeddingModel: string;
  dims: number;
  memories: StoredMemory[];
}

function emptyStore(): MemoryStore {
  return {
    version: MEMORY_VERSION,
    embeddingModel: "text-embedding-3-small",
    dims: EMBEDDING_DIMS,
    memories: [],
  };
}

async function loadStore(): Promise<MemoryStore> {
  const raw = await readJsonOrDefault<MemoryStore | null>(memoryFile(), null);
  if (!raw || raw.version !== MEMORY_VERSION) return emptyStore();
  return raw;
}

async function saveStore(store: MemoryStore): Promise<void> {
  await ensureDir(memoryDir());
  // Memory file can get large; use a plain write (not pretty-printed) for speed.
  const tmp = memoryFile() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(store), "utf8");
  await fs.rename(tmp, memoryFile());
}

function generateId(): string {
  return Date.now().toString(36) + randomBytes(4).toString("hex");
}

// ── Embedding provider (optional — degrades to local) ─────────────────

interface EmbedConfig {
  url: string;
  key: string;
  model: string;
  authHeader: "Bearer" | null;
  isGoogle?: boolean;
}

function getEmbedConfig(): EmbedConfig | null {
  if (process.env.OPENAI_API_KEY) {
    return {
      url: "https://api.openai.com/v1/embeddings",
      key: process.env.OPENAI_API_KEY,
      model: "text-embedding-3-small",
      authHeader: "Bearer",
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      url: "https://openrouter.ai/api/v1/embeddings",
      key: process.env.OPENROUTER_API_KEY,
      model: "openai/text-embedding-3-small",
      authHeader: "Bearer",
    };
  }
  if (process.env.GOOGLE_API_KEY) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_API_KEY}`,
      key: process.env.GOOGLE_API_KEY,
      model: "text-embedding-004",
      authHeader: null,
      isGoogle: true,
    };
  }
  return null;
}

/** Local bag-of-words + trigram hash fallback. */
function localEmbed(text: string): number[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const vec = new Float64Array(EMBEDDING_DIMS);

  for (const word of words) {
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = ((h << 5) - h + word.charCodeAt(i)) | 0;
    }
    vec[Math.abs(h) % EMBEDDING_DIMS] += 1;
    for (let i = 0; i <= word.length - 3; i++) {
      const tri = word.slice(i, i + 3);
      let th = 0;
      for (let j = 0; j < 3; j++) th = ((th << 5) - th + tri.charCodeAt(j)) | 0;
      vec[Math.abs(th) % EMBEDDING_DIMS] += 0.5;
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_DIMS; i++) vec[i] /= norm;
  return Array.from(vec);
}

async function embed(text: string): Promise<number[]> {
  const config = getEmbedConfig();
  if (!config) return localEmbed(text);

  try {
    if (config.isGoogle) {
      const res = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!res.ok) throw new UpstreamError(`Google embedding ${res.status}`);
      const data = (await res.json()) as { embedding?: { values?: number[] } };
      const values = data.embedding?.values;
      if (!values) throw new UpstreamError("No embedding in Google response");
      return values.slice(0, EMBEDDING_DIMS);
    }

    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `${config.authHeader} ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: text,
        dimensions: EMBEDDING_DIMS,
      }),
    });
    if (!res.ok) throw new UpstreamError(`Embedding API ${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const emb = data.data?.[0]?.embedding;
    if (!emb) throw new UpstreamError("No embedding in API response");
    return emb;
  } catch {
    // Any provider failure -> degrade to local. Better than dropping the call.
    return localEmbed(text);
  }
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function wordOverlap(a: string, b: string): number {
  const aw = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  const bw = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  const intersection = [...aw].filter((w) => bw.has(w) && w.length > 2);
  const union = new Set([...aw, ...bw]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

// ── store_memory ──────────────────────────────────────────────────────

registerTool({
  name: "store_memory",
  description:
    "Store a fact in long-term memory. Checks for similar memories and updates or inserts as appropriate. Memory persists across sessions on the pod PVC. SESSION MODE: when memory_scope=session, you MUST pass session_id.",
  server: "local",
  inputSchema: z.object({
    text: z.string().min(1).max(5000),
    category: z.string().optional(),
    source_platform: z.string().optional(),
    session_id: z.string().optional(),
  }),
  handler: async (args) => {
    if (memoryOff()) return memoryOffResponse();
    const guard = requireSessionId(args.session_id);
    if (!guard.ok) return textResult(guard.message, true);

    const store = await loadStore();
    const platform = args.source_platform || process.env.RUNTIME || "unknown";
    const writeSessionId = guard.effective;
    const fact = args.text.trim();
    const hasEmbedAPI = !!getEmbedConfig();
    const simThreshold = hasEmbedAPI ? SIMILARITY_THRESHOLD : LOCAL_SIMILARITY_THRESHOLD;

    const factEmb = await embed(fact);

    // Session isolation
    let bestSim = 0;
    let bestIdx = -1;
    for (let i = 0; i < store.memories.length; i++) {
      if (getMemoryScope() === "session" && store.memories[i].sessionId !== writeSessionId) continue;
      let sim = cosineSim(factEmb, store.memories[i].embedding);
      if (!hasEmbedAPI) sim = sim * 0.5 + wordOverlap(fact, store.memories[i].text) * 0.5;
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestSim >= simThreshold && bestIdx >= 0) {
      // Update in place — simple REPLACE strategy (no LLM compactor on pod).
      const existing = store.memories[bestIdx];
      store.memories[bestIdx] = {
        ...existing,
        text: fact,
        embedding: factEmb,
        updatedAt: new Date().toISOString(),
        sourcePlatform: platform,
        sessionId: writeSessionId,
      };
      await saveStore(store);
      return textResult(`Updated existing memory (sim=${bestSim.toFixed(2)}): "${fact.slice(0, 80)}"`);
    }

    if (store.memories.length >= MAX_MEMORIES) {
      // Evict oldest
      store.memories.sort(
        (a, b) =>
          new Date(a.updatedAt || a.createdAt).getTime() -
          new Date(b.updatedAt || b.createdAt).getTime(),
      );
      store.memories.shift();
    }

    const now = new Date().toISOString();
    store.memories.push({
      id: generateId(),
      text: fact,
      category: args.category || "general",
      embedding: factEmb,
      createdAt: now,
      updatedAt: now,
      sourcePlatform: platform,
      sessionId: writeSessionId,
    });
    await saveStore(store);
    return textResult(`Stored: "${fact.slice(0, 80)}" (${store.memories.length} total)`);
  },
});

// ── recall_memory ─────────────────────────────────────────────────────

registerTool({
  name: "recall_memory",
  description:
    "Search long-term memory for information relevant to a query. Returns the most relevant memories ranked by semantic similarity. SESSION MODE: pass session_id to scope to the current conversation.",
  server: "local",
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
    threshold: z.number().min(0).max(1).optional(),
    session_id: z.string().optional(),
  }),
  handler: async (args) => {
    if (memoryOff()) return memoryOffResponse();
    const guard = requireSessionId(args.session_id);
    if (!guard.ok) return textResult(guard.message, true);

    const store = await loadStore();
    if (store.memories.length === 0) return textResult("No memories stored yet.");

    const candidates =
      getMemoryScope() === "session"
        ? store.memories.filter((m) => m.sessionId === guard.effective)
        : store.memories;

    if (candidates.length === 0) {
      return textResult("No memories stored for this conversation yet.");
    }

    const maxResults = Math.min(args.limit ?? 10, 50);
    const minScore = args.threshold ?? 0.3;

    const queryEmb = await embed(args.query);
    const hasEmbedAPI = !!getEmbedConfig();

    const scored = candidates.map((m) => {
      let sim = cosineSim(queryEmb, m.embedding);
      if (!hasEmbedAPI) sim = sim * 0.5 + wordOverlap(args.query, m.text) * 0.5;
      return { ...m, score: sim };
    });
    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter((m) => m.score > minScore).slice(0, maxResults);

    if (relevant.length === 0) return textResult("No relevant memories found for this query.");

    const lines = relevant.map(
      (m, i) =>
        `${i + 1}. [${(m.score * 100).toFixed(0)}%] ${m.text} (${m.category}, via ${m.sourcePlatform}, ${m.updatedAt?.split("T")[0] ?? "unknown"})`,
    );
    return textResult(`Found ${relevant.length} relevant memory/memories:\n${lines.join("\n")}`);
  },
});

// ── list_memories ─────────────────────────────────────────────────────

registerTool({
  name: "list_memories",
  description:
    "List stored memories, sorted by most recently updated. Optionally filter by category. SESSION MODE: pass session_id to scope to the current conversation.",
  server: "local",
  inputSchema: z.object({
    category: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
    session_id: z.string().optional(),
    sessionId: z.string().optional(),
  }),
  handler: async (args) => {
    if (memoryOff()) return memoryOffResponse();
    const sessionArg = args.session_id ?? args.sessionId;
    const guard = requireSessionId(sessionArg);
    if (!guard.ok) return textResult(guard.message, true);

    const store = await loadStore();
    let memories = store.memories;
    if (getMemoryScope() === "session") {
      memories = memories.filter((m) => m.sessionId === guard.effective);
    }
    if (args.category) memories = memories.filter((m) => m.category === args.category);

    memories = [...memories].sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).getTime() -
        new Date(a.updatedAt || a.createdAt).getTime(),
    );
    const limit = Math.min(args.limit ?? 50, 200);
    memories = memories.slice(0, limit);

    if (memories.length === 0) {
      return textResult(
        args.category ? `No memories in category "${args.category}".` : "No memories stored yet.",
      );
    }

    const lines = memories.map(
      (m, i) =>
        `${i + 1}. [${m.id}] ${m.text} (${m.category}, via ${m.sourcePlatform}, updated ${m.updatedAt?.split("T")[0] ?? "unknown"})`,
    );
    return textResult(
      `${store.memories.length} total memories (showing ${memories.length}${args.category ? ` in "${args.category}"` : ""}):\n${lines.join("\n")}`,
    );
  },
});

// ── forget_memory ─────────────────────────────────────────────────────

registerTool({
  name: "forget_memory",
  description:
    "Delete a memory by exact id or by semantic-search query. Pass one of `id` or `query`. SESSION MODE: deletes are scoped to the current conversation.",
  server: "local",
  inputSchema: z
    .object({
      id: z.string().optional(),
      query: z.string().optional(),
      session_id: z.string().optional(),
    })
    .refine((v) => !!(v.id || v.query), {
      message: "Provide either 'id' or 'query'.",
    }),
  handler: async (args) => {
    if (memoryOff()) return memoryOffResponse();
    const guard = requireSessionId(args.session_id);
    if (!guard.ok) return textResult(guard.message, true);

    const store = await loadStore();

    if (args.id) {
      const idx = store.memories.findIndex((m) => m.id === args.id);
      if (idx === -1) return textResult(`Memory "${args.id}" not found.`, true);
      if (
        getMemoryScope() === "session" &&
        store.memories[idx].sessionId !== guard.effective
      ) {
        return textResult(
          `Memory "${args.id}" is not in the current conversation's scope.`,
          true,
        );
      }
      const removed = store.memories.splice(idx, 1)[0];
      await saveStore(store);
      return textResult(`Deleted memory: "${removed.text.slice(0, 80)}"`);
    }

    // Semantic search
    const queryEmb = await embed(args.query!);
    const hasEmbedAPI = !!getEmbedConfig();
    let bestSim = 0;
    let bestIdx = -1;
    for (let i = 0; i < store.memories.length; i++) {
      if (
        getMemoryScope() === "session" &&
        store.memories[i].sessionId !== guard.effective
      )
        continue;
      let sim = cosineSim(queryEmb, store.memories[i].embedding);
      if (!hasEmbedAPI) sim = sim * 0.5 + wordOverlap(args.query!, store.memories[i].text) * 0.5;
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || bestSim < 0.5) {
      return textResult(`No memory found matching "${args.query}".`, true);
    }
    const removed = store.memories.splice(bestIdx, 1)[0];
    await saveStore(store);
    return textResult(
      `Deleted memory (${(bestSim * 100).toFixed(0)}% match): "${removed.text.slice(0, 80)}"`,
    );
  },
});
