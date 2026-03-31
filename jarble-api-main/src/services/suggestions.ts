/**
 * Suggestion Engine - generates follow-up prompts via a cheap secondary model call.
 *
 * Fires after the main bot response completes. Uses GPT-4o-mini (via OpenRouter)
 * to generate 3-4 contextual suggestions. Cost: ~$0.00009 per call.
 *
 * This is the same pattern used by ChatGPT, Claude.ai, and Gemini -
 * suggestions are an infrastructure concern, not a prompt engineering problem.
 */

import { createModuleLogger } from "../utils/logger.js";
import { env } from "../utils/env.js";

const log = createModuleLogger("suggestions");

const SUGGESTION_MODEL = "openai/gpt-4o-mini";
const SUGGESTION_TIMEOUT_MS = 5_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You generate short follow-up prompts for a chat interface. Given the conversation context, produce 3-4 suggestions the user might want to ask or do next.

Rules:
- Each suggestion: 2-8 words, action-oriented
- Match the conversation's tone and topic
- Mix: 1 deepening question, 1 related topic, 1 creative/fun option
- If the bot rendered UI (charts, tables, etc.), suggest modifications
- Return ONLY a JSON array of strings, no other text`;

/**
 * Generate follow-up suggestions based on conversation context.
 * Returns an empty array on failure (non-fatal).
 */
export async function generateSuggestions(
  userMessage: string,
  botResponse: string,
): Promise<string[]> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "sk-test-key") return [];

  // Truncate to keep input tokens low
  const userSnippet = userMessage.slice(0, 200);
  const botSnippet = botResponse.slice(0, 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.FRONTEND_URL,
        "X-Title": "Jarble Suggestions",
      },
      body: JSON.stringify({
        model: SUGGESTION_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `User said: "${userSnippet}"\n\nBot responded: "${botSnippet}"`,
          },
        ],
        max_tokens: 120,
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.warn({ status: res.status }, "Suggestion API call failed");
      return [];
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    // Parse - handle both raw array and { suggestions: [...] } wrapper
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed.prompts || []);

    // Validate and clean
    const suggestions = arr
      .filter((s: unknown) => typeof s === "string" && s.length > 0 && s.length < 100)
      .slice(0, 5);

    log.debug({ count: suggestions.length }, "Generated suggestions");
    return suggestions;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      log.debug("Suggestion call timed out (non-fatal)");
    } else {
      log.warn({ err }, "Suggestion generation failed (non-fatal)");
    }
    return [];
  }
}
