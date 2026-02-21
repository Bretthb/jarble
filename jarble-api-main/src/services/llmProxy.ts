/**
 * Multi-provider LLM streaming proxy.
 *
 * Calls the user's configured LLM (Anthropic, OpenAI, OpenRouter, Google)
 * with streaming enabled and emits deltas for text and tool calls.
 *
 * Uses the same provider URLs validated in openrouter.ts:validateProviderKey.
 */
import { logger } from "../utils/logger.js";

export interface LlmToolCall {
  id: string;
  name: string;
  args: string; // JSON string
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;       // For role: "tool" — which tool call this result is for
  toolCalls?: LlmToolCall[]; // For role: "assistant" — tool calls the model made
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamLlmOptions {
  provider: "anthropic" | "openai" | "openrouter" | "google";
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  onChunk: (delta: string) => void;
  onToolCall: (id: string, name: string, args: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
  signal?: AbortSignal;
}

/**
 * Stream a chat completion from the user's LLM provider.
 */
export async function streamLlmCompletion(opts: StreamLlmOptions): Promise<void> {
  const { provider, apiKey, model, messages, tools, onChunk, onToolCall, onDone, onError, signal } = opts;

  try {
    if (provider === "anthropic") {
      await streamAnthropic(apiKey, model, messages, tools, onChunk, onToolCall, onDone, onError, signal);
    } else if (provider === "google") {
      await streamGoogle(apiKey, model, messages, onChunk, onDone, onError, signal);
    } else {
      // OpenAI and OpenRouter share the same API format
      const baseUrl = provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "https://api.openai.com/v1";
      await streamOpenAI(baseUrl, apiKey, model, messages, tools, onChunk, onToolCall, onDone, onError, signal);
    }
  } catch (err: any) {
    if (err.name === "AbortError") return;
    logger.error({ err, provider, model }, "LLM proxy stream error");
    onError(err.message || "LLM streaming failed");
  }
}

// ─── OpenAI / OpenRouter ────────────────────────────────────────────────────

async function streamOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  tools: LlmToolDefinition[] | undefined,
  onChunk: (delta: string) => void,
  onToolCall: (id: string, name: string, args: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
) {
  const body: Record<string, unknown> = {
    model,
    messages: serializeMessagesForOpenAI(messages),
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    onError(`LLM API error ${res.status}: ${text.substring(0, 200)}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { onError("No response body"); return; }

  const decoder = new TextDecoder();
  let buffer = "";
  // Track tool call arg accumulation (index → { id, name, args })
  const toolCallArgs: Record<string, { id: string; name: string; args: string }> = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          const choice = data.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            onChunk(delta.content);
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = String(tc.index ?? 0);
              if (tc.id) {
                toolCallArgs[idx] = { id: tc.id, name: tc.function?.name || "", args: "" };
              }
              if (tc.function?.name && toolCallArgs[idx]) {
                toolCallArgs[idx].name = tc.function.name;
              }
              if (tc.function?.arguments && toolCallArgs[idx]) {
                toolCallArgs[idx].args += tc.function.arguments;
              }
            }
          }

          // When finish_reason is "tool_calls" or "stop", emit accumulated tool calls
          if (choice.finish_reason === "tool_calls" || (choice.finish_reason === "stop" && Object.keys(toolCallArgs).length > 0)) {
            for (const [, tc] of Object.entries(toolCallArgs)) {
              onToolCall(tc.id, tc.name, tc.args);
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onDone();
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

async function streamAnthropic(
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  tools: LlmToolDefinition[] | undefined,
  onChunk: (delta: string) => void,
  onToolCall: (id: string, name: string, args: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
) {
  // Separate system message from conversation
  const systemMessage = messages.find((m) => m.role === "system");
  const conversationMessages = serializeMessagesForAnthropic(
    messages.filter((m) => m.role !== "system")
  );

  // Anthropic requires alternating user/assistant. Ensure first message is user.
  if (conversationMessages.length === 0 || (conversationMessages[0] as any).role !== "user") {
    conversationMessages.unshift({ role: "user", content: "Hello" });
  }

  const body: Record<string, unknown> = {
    model,
    messages: conversationMessages,
    max_tokens: 4096,
    stream: true,
  };

  if (systemMessage) {
    body.system = systemMessage.content;
  }

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  // Claude Max OAuth tokens (sk-ant-oat*) use Bearer auth
  const isOAuth = apiKey.startsWith("sk-ant-oat");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    onError(`Anthropic API error ${res.status}: ${text.substring(0, 200)}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { onError("No response body"); return; }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentToolId = "";
  let currentToolName = "";
  let currentToolArgs = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));

          switch (data.type) {
            case "content_block_start":
              if (data.content_block?.type === "tool_use") {
                currentToolId = data.content_block.id || `tc_${Date.now()}`;
                currentToolName = data.content_block.name || "";
                currentToolArgs = "";
              }
              break;

            case "content_block_delta":
              if (data.delta?.type === "text_delta") {
                onChunk(data.delta.text);
              } else if (data.delta?.type === "input_json_delta") {
                currentToolArgs += data.delta.partial_json || "";
              }
              break;

            case "content_block_stop":
              if (currentToolName) {
                onToolCall(currentToolId, currentToolName, currentToolArgs);
                currentToolId = "";
                currentToolName = "";
                currentToolArgs = "";
              }
              break;

            case "message_stop":
              break;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onDone();
}

// ─── Google (Gemini) ────────────────────────────────────────────────────────

async function streamGoogle(
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  onChunk: (delta: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
) {
  // Convert messages to Gemini format
  const systemInstruction = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
  }

  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    onError(`Google API error ${res.status}: ${text.substring(0, 200)}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { onError("No response body"); return; }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          const parts = data.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) {
                onChunk(part.text);
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onDone();
}

// ─── Message Serialization Helpers ───────────────────────────────────────────

/**
 * Convert LlmMessage[] to OpenAI API format.
 * Handles tool result messages and assistant messages with tool_calls.
 */
function serializeMessagesForOpenAI(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.args },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * Convert non-system LlmMessage[] to Anthropic API format.
 * Tool results become user messages with tool_result content blocks.
 * Assistant messages with toolCalls get tool_use content blocks.
 */
function serializeMessagesForAnthropic(messages: LlmMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      // Anthropic: tool results are user messages with tool_result blocks.
      // Merge consecutive tool results into a single user message.
      const lastMsg = result[result.length - 1] as any;
      const block = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };

      if (lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.content)) {
        lastMsg.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
    } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const content: Record<string, unknown>[] = [];
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      for (const tc of m.toolCalls) {
        let input: unknown;
        try { input = JSON.parse(tc.args); } catch { input = {}; }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input,
        });
      }
      result.push({ role: "assistant", content });
    } else {
      result.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
    }
  }

  return result;
}

// ─── Buffered Completion (for multi-turn tool calling) ───────────────────────

export interface LlmCompletionResult {
  text: string;
  toolCalls: LlmToolCall[];
}

/**
 * Run a non-streaming LLM completion that collects the full response.
 * Used by the multi-turn tool calling loop in tamboAgent.ts.
 *
 * Internally uses the streaming providers but buffers the output.
 */
export async function collectLlmCompletion(opts: {
  provider: "anthropic" | "openai" | "openrouter" | "google";
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  signal?: AbortSignal;
}): Promise<LlmCompletionResult> {
  const { provider, apiKey, model, messages, tools, signal } = opts;

  let text = "";
  const toolCalls: LlmToolCall[] = [];

  return new Promise((resolve, reject) => {
    streamLlmCompletion({
      provider,
      apiKey,
      model,
      messages,
      tools,
      signal,
      onChunk: (delta) => { text += delta; },
      onToolCall: (id, name, args) => { toolCalls.push({ id, name, args }); },
      onDone: () => { resolve({ text, toolCalls }); },
      onError: (err) => { reject(new Error(err)); },
    });
  });
}
