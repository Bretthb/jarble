/**
 * Chat adapter registry (JAR-121).
 *
 * Maps runtime slug → ChatAdapter. Callers that need to chat with a
 * deployment look up the adapter via `getChatAdapter(runtimeSlug)`
 * and invoke its methods; they never know about the runtime-specific
 * transport details.
 *
 * The registry is keyed by the runtime handler's `chatTransport`
 * capability rather than by slug directly, so runtimes with matching
 * transport shapes can share an adapter (all `"http-stream"` runtimes
 * use the same adapter until a runtime needs a per-endpoint shape).
 *
 * JAR-121 lands the registry + OpenClaw + http-stream stub. Route
 * migrations (tamboAgent / flowChat / botAsk) are a follow-up tracked
 * as part of JAR-123 (when we actually need to chat with ZeroClaw and
 * can validate against dev.jarble.ai).
 */

import { getHandlerOrNull } from "../../runtimes/index.js";
import type { ChatAdapter, ChatTransport } from "./types.js";
import { openclawChatAdapter } from "./openclaw.js";
import { httpStreamChatAdapter } from "./httpStream.js";

// Keyed on transport so multiple runtimes can share an adapter.
const ADAPTERS: Record<ChatTransport, ChatAdapter | null> = {
  "openclaw-ws": openclawChatAdapter,
  "http-stream": httpStreamChatAdapter,
  "none": null,
};

/**
 * Resolve the chat adapter for a runtime slug.
 * Returns null when (a) the runtime is unknown, (b) its transport is
 * `"none"`, or (c) the transport has no registered adapter yet.
 */
export function getChatAdapter(runtimeSlug: string): ChatAdapter | null {
  const handler = getHandlerOrNull(runtimeSlug);
  if (!handler) return null;
  const transport = handler.capabilities.chatTransport;
  return ADAPTERS[transport] ?? null;
}

/** For tests / introspection. */
export function listTransports(): ChatTransport[] {
  return Object.keys(ADAPTERS) as ChatTransport[];
}

export type { ChatAdapter, ChatTransport };
