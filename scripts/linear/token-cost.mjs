#!/usr/bin/env node
// Best-effort token accounting from a Claude Code transcript (jsonl).
// Used by the Stop hook to add a cost footer to the Linear comment.
// Never throws — returns zeroed-out totals on parse failure.
//
// Pricing last updated: 2026-04 (USD per 1M tokens). Adjust RATES when Anthropic changes prices.

import { existsSync, readFileSync } from "node:fs";

const RATES = {
  "claude-opus-4":    { in: 15.00, out: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4":  { in:  3.00, out: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  "claude-haiku-4":   { in:  0.80, out:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
};

const FALLBACK = RATES["claude-sonnet-4"];

function rateForModel(model) {
  if (!model) return FALLBACK;
  for (const key of Object.keys(RATES)) {
    if (model.startsWith(key)) return RATES[key];
  }
  return FALLBACK;
}

/**
 * Parse a Claude Code jsonl transcript and return tokens + cost.
 * Returns: { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd, models }
 */
export function summarizeTranscript(transcriptPath) {
  const zero = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0, models: [] };
  if (!transcriptPath || !existsSync(transcriptPath)) return zero;

  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return zero;
  }

  const totals = { ...zero };
  const models = new Set();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = evt?.message;
    const usage = msg?.usage;
    if (!usage) continue;
    const model = msg?.model || evt?.model;
    if (model) models.add(model);
    const rate = rateForModel(model);

    const inT  = usage.input_tokens || 0;
    const outT = usage.output_tokens || 0;
    const cwT  = usage.cache_creation_input_tokens || 0;
    const crT  = usage.cache_read_input_tokens || 0;

    totals.inputTokens      += inT;
    totals.outputTokens     += outT;
    totals.cacheWriteTokens += cwT;
    totals.cacheReadTokens  += crT;
    totals.costUsd += (inT  * rate.in)         / 1_000_000;
    totals.costUsd += (outT * rate.out)        / 1_000_000;
    totals.costUsd += (cwT  * rate.cacheWrite) / 1_000_000;
    totals.costUsd += (crT  * rate.cacheRead)  / 1_000_000;
  }

  totals.models = [...models];
  return totals;
}

export function formatFooter({ totals, handle, runtimeMs }) {
  if (!totals || (totals.inputTokens + totals.outputTokens === 0)) return "";
  const tokensIn  = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const tokensOut = totals.outputTokens;
  const k = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
    return String(n);
  };
  const cost = `$${totals.costUsd.toFixed(4)}`;
  const runtime = runtimeMs ? ` • Runtime: ${Math.round(runtimeMs / 1000)}s` : "";
  const who = handle ? ` • Run by: @${handle}` : "";
  return `_Tokens: ${k(tokensIn)} in / ${k(tokensOut)} out • Cost: ${cost}${runtime}${who}_`;
}
