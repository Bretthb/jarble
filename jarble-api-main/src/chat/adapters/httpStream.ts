/**
 * HttpStreamChatAdapter — generic HTTP + SSE chat transport (JAR-121).
 *
 * Used by runtimes that declare `chatTransport: "http-stream"` (ZeroClaw,
 * LangGraph Server, and most non-OpenClaw candidates from the JAR-115
 * evaluation). Each runtime hits a different endpoint / auth shape, so
 * this adapter is a shared stub — JAR-123 will land the ZeroClaw-specific
 * wiring once we have live upstream access to verify the exact endpoint
 * shape (chat vs. /v1/chat/completions, streaming shape, auth header).
 *
 * The stub exists now so (a) the registry has something to return for
 * `"http-stream"` runtimes, (b) the conformance test can assert every
 * registered runtime has a matching adapter, and (c) JAR-123 can extend
 * this module rather than creating a new one.
 */

import type { ChatAdapter } from "./types.js";

export const httpStreamChatAdapter: ChatAdapter = {
  runtimeSlug: "http-stream",
  transport: "http-stream",
  canHandle(runtimeSlug: string) {
    // Accept any runtime whose handler declares chatTransport: "http-stream".
    // The registry passes this check explicitly; runtimes without handlers
    // will not reach the adapter lookup.
    return true;
  },
};
