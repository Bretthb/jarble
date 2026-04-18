/**
 * SSE write helpers for the POST /api/tambo-agent route.
 *
 * Extracted from tamboAgent.ts as part of JAR-107 so the slashCommands
 * module (and other future sub-modules) can share the two writer
 * primitives without circular imports back into the main handler.
 */

import { nanoid } from "nanoid";
import { createModuleLogger } from "../../utils/logger.js";

const log = createModuleLogger("tamboAgent.sse");

/**
 * Write one SSE `data: ...\n\n` frame and flush so the client receives it
 * immediately (without this, Node.js / compression middleware buffers
 * writes and per-token streaming stalls).
 *
 * Silently no-ops if the response has already ended. On JSON-stringify
 * failure, emits a minimal error frame so the frontend knows the stream
 * hit serialization trouble rather than going quiet.
 */
export function sendEvent(res: any, event: Record<string, unknown>) {
  if (res.writableEnded) return;
  try {
    const json = JSON.stringify(event);
    res.write(`data: ${json}\n\n`);
    if (typeof res.flush === "function") res.flush();
  } catch (err) {
    log.error(
      { eventType: event.type, error: err instanceof Error ? err.message : String(err) },
      "Failed to stringify SSE event"
    );
    try {
      res.write(
        `data: ${JSON.stringify({
          type: "CUSTOM",
          name: "jarble.sse.error",
          value: { message: "Failed to serialize event data" },
        })}\n\n`
      );
    } catch {
      // Connection is doomed — nothing more we can do
    }
  }
}

/**
 * Write a full short-circuit response — RUN_STARTED → TEXT_MESSAGE → RUN_FINISHED
 * → `res.end()` — for cases where we want to respond without going through the
 * LLM path (slash commands, early error paths, etc.). Optional `extra` callback
 * runs between TEXT_MESSAGE_END and RUN_FINISHED so the caller can emit a
 * CUSTOM event in the same frame set (e.g. `jarble.theme.updated`).
 */
export function sendQuickResponse(
  res: any,
  runId: string,
  threadId: string,
  text: string,
  extra?: () => void,
) {
  sendEvent(res, { type: "RUN_STARTED", runId, threadId });
  const mid = nanoid();
  sendEvent(res, { type: "TEXT_MESSAGE_START", messageId: mid, role: "assistant" });
  sendEvent(res, { type: "TEXT_MESSAGE_CONTENT", messageId: mid, delta: text });
  sendEvent(res, { type: "TEXT_MESSAGE_END", messageId: mid });
  if (extra) extra();
  sendEvent(res, { type: "RUN_FINISHED", runId, threadId });
  res.end();
}
