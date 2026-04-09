/**
 * Model pricing lookup service (Cost Transparency Phase 1).
 *
 * Calculates the real token cost of each delegation hop so
 * `creditsCharged` in agent_calls reflects actual LLM spend
 * instead of the hardcoded value of 1.
 *
 * Pricing source: OpenRouter /api/v1/models API.
 * Cache: in-memory Map with 1h TTL. No external dependencies.
 * Fallback: hardcoded conservative estimates for top models.
 */

import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("modelPricing");

interface ModelPricing {
  promptPricePerToken: number;   // USD per token
  completionPricePerToken: number;
  cachedReadPricePerToken: number;
  fetchedAt: number;
}

// 1-hour cache TTL
const CACHE_TTL_MS = 60 * 60 * 1000;
const priceCache = new Map<string, ModelPricing>();
let lastBulkFetchAt = 0;

// Conservative fallback pricing (USD per 1M tokens → per token)
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4": { promptPricePerToken: 3 / 1_000_000, completionPricePerToken: 15 / 1_000_000, cachedReadPricePerToken: 0.3 / 1_000_000, fetchedAt: 0 },
  "anthropic/claude-sonnet-4-6": { promptPricePerToken: 3 / 1_000_000, completionPricePerToken: 15 / 1_000_000, cachedReadPricePerToken: 0.3 / 1_000_000, fetchedAt: 0 },
  "anthropic/claude-opus-4": { promptPricePerToken: 15 / 1_000_000, completionPricePerToken: 75 / 1_000_000, cachedReadPricePerToken: 1.5 / 1_000_000, fetchedAt: 0 },
  "anthropic/claude-opus-4-6": { promptPricePerToken: 15 / 1_000_000, completionPricePerToken: 75 / 1_000_000, cachedReadPricePerToken: 1.5 / 1_000_000, fetchedAt: 0 },
  "anthropic/claude-haiku-4-5": { promptPricePerToken: 0.8 / 1_000_000, completionPricePerToken: 4 / 1_000_000, cachedReadPricePerToken: 0.08 / 1_000_000, fetchedAt: 0 },
  "openai/gpt-4o": { promptPricePerToken: 2.5 / 1_000_000, completionPricePerToken: 10 / 1_000_000, cachedReadPricePerToken: 1.25 / 1_000_000, fetchedAt: 0 },
  "openai/gpt-4o-mini": { promptPricePerToken: 0.15 / 1_000_000, completionPricePerToken: 0.6 / 1_000_000, cachedReadPricePerToken: 0.075 / 1_000_000, fetchedAt: 0 },
  "google/gemini-2.5-pro": { promptPricePerToken: 1.25 / 1_000_000, completionPricePerToken: 10 / 1_000_000, cachedReadPricePerToken: 0, fetchedAt: 0 },
  "google/gemini-2.5-flash": { promptPricePerToken: 0.15 / 1_000_000, completionPricePerToken: 0.6 / 1_000_000, cachedReadPricePerToken: 0, fetchedAt: 0 },
};

/**
 * Fetch model pricing from OpenRouter and populate the cache.
 * Best-effort: if the API is down, the cache keeps stale values
 * and new lookups fall back to FALLBACK_PRICING.
 */
async function bulkFetchPricing(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.debug("No OPENROUTER_API_KEY — using fallback pricing only");
    return;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.warn({ status: res.status }, "OpenRouter models API returned non-200");
      return;
    }

    const body = await res.json() as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
    const models = body.data || [];

    for (const model of models) {
      if (model.pricing?.prompt && model.pricing?.completion) {
        priceCache.set(model.id, {
          promptPricePerToken: parseFloat(model.pricing.prompt),
          completionPricePerToken: parseFloat(model.pricing.completion),
          cachedReadPricePerToken: parseFloat(model.pricing.prompt) * 0.1, // estimate: 10% of prompt price
          fetchedAt: Date.now(),
        });
      }
    }

    lastBulkFetchAt = Date.now();
    log.info({ modelCount: models.length, cachedCount: priceCache.size }, "Model pricing cache refreshed from OpenRouter");
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, "Failed to fetch model pricing from OpenRouter (using stale cache / fallback)");
  }
}

/**
 * Get pricing for a specific model. Returns fallback if the model
 * isn't in the cache or if the API is unreachable.
 */
export async function getModelPricing(modelId: string): Promise<ModelPricing> {
  // Normalize model ID (strip version suffixes, handle aliases)
  const normalized = modelId.toLowerCase().replace(/[-_]\d{8}$/, "");

  // Check cache
  const cached = priceCache.get(normalized) || priceCache.get(modelId);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached;
  }

  // Cache miss or stale — try bulk fetch if we haven't recently
  if (Date.now() - lastBulkFetchAt > CACHE_TTL_MS) {
    await bulkFetchPricing();
  }

  // Re-check after fetch
  const refreshed = priceCache.get(normalized) || priceCache.get(modelId);
  if (refreshed) return refreshed;

  // Fall back to hardcoded pricing
  const fallback = FALLBACK_PRICING[normalized] || FALLBACK_PRICING[modelId];
  if (fallback) return fallback;

  // Unknown model — use a conservative default (Claude Sonnet pricing)
  log.debug({ modelId }, "Unknown model pricing — using conservative default");
  return FALLBACK_PRICING["anthropic/claude-sonnet-4"]!;
}

/**
 * Calculate the cost of a single delegation hop in cents.
 */
export function calculateHopCostCents(
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
  pricing: ModelPricing,
): number {
  const inputCost = tokenUsage.inputTokens * pricing.promptPricePerToken;
  const outputCost = tokenUsage.outputTokens * pricing.completionPricePerToken;
  const cacheCost = (tokenUsage.cacheReadTokens ?? 0) * pricing.cachedReadPricePerToken;
  // Cache writes are typically charged at full prompt price
  const cacheWriteCost = (tokenUsage.cacheWriteTokens ?? 0) * pricing.promptPricePerToken;

  const totalUsd = inputCost + outputCost + cacheCost + cacheWriteCost;
  // Convert to cents, round up to nearest cent
  return Math.max(1, Math.ceil(totalUsd * 100));
}
