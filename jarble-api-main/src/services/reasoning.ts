/**
 * Reasoning Engine — generates "thinking" content via a cheap secondary model.
 *
 * Fires BEFORE the main bot response streams. Uses GPT-4o-mini (via OpenRouter)
 * or Claude Haiku (via Anthropic API) as fallback.
 *
 * This is the same approach used by Claude.ai, ChatGPT, and Perplexity —
 * the "thinking" UX is an infrastructure concern, not a prompt problem.
 * Since OpenClaw's 41k system prompt makes <think> tag instructions unreliable,
 * we generate reasoning externally for consistent UX.
 */

import { createModuleLogger } from "../utils/logger.js";
import { env } from "../utils/env.js";

const log = createModuleLogger("reasoning");

const REASONING_TIMEOUT_MS = 4_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a reasoning engine. Given a user's message to an AI assistant, generate a brief internal reasoning summary — what the assistant would think before responding.

Rules:
- 1-3 sentences max. Be concise.
- Write in first person ("I should...", "The user wants...", "Let me...")
- For simple greetings/chat: 1 sentence ("Casual greeting — I'll respond warmly.")
- For questions: note the topic and approach ("User asks about X. I'll explain Y.")
- For tasks with UI: mention tool/component choices ("I'll search for data first, then render a chart.")
- Match the tone — casual for casual, technical for technical
- Return ONLY the reasoning text, no tags or formatting`;

/**
 * Generate reasoning/thinking content for a user message.
 * Returns empty string on failure (non-fatal — response proceeds without thinking block).
 *
 * Provider priority:
 * 1. OpenRouter (GPT-4o-mini) — cheapest, ~$0.00005/call
 * 2. Anthropic (Haiku) — fallback using AGENT_LLM_API_KEY
 */
export async function generateReasoning(
  userMessage: string,
): Promise<string> {
  const openrouterKey = env.OPENROUTER_API_KEY;
  const anthropicKey = env.AGENT_LLM_API_KEY;

  if (openrouterKey && openrouterKey !== "sk-test-key") {
    return callOpenRouter(userMessage, openrouterKey);
  }
  if (anthropicKey) {
    return callAnthropic(userMessage, anthropicKey);
  }

  log.debug("No API key available for reasoning — skipping");
  return "";
}

async function callOpenRouter(userMessage: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REASONING_TIMEOUT_MS);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://jarble.ai",
        "X-Title": "Jarble Reasoning",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage.slice(0, 300) },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) {
      log.warn({ status: res.status }, "Reasoning (OpenRouter) failed");
      return "";
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return "";

    log.debug({ length: content.length, provider: "openrouter" }, "Generated reasoning");
    return content;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      log.debug("Reasoning (OpenRouter) timed out");
    } else {
      log.warn({ err }, "Reasoning (OpenRouter) failed");
    }
    return "";
  }
}

async function callAnthropic(userMessage: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REASONING_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: userMessage.slice(0, 300) },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) {
      log.warn({ status: res.status }, "Reasoning (Anthropic) failed");
      return "";
    }

    const data: any = await res.json();
    const content = data.content?.[0]?.text?.trim();
    if (!content) return "";

    log.debug({ length: content.length, provider: "anthropic" }, "Generated reasoning");
    return content;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      log.debug("Reasoning (Anthropic) timed out");
    } else {
      log.warn({ err }, "Reasoning (Anthropic) failed");
    }
    return "";
  }
}
