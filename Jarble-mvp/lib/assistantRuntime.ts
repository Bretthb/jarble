"use client";

/**
 * Jarble Runtime Adapter for assistant-ui.
 *
 * Wraps our existing useCanvasChat hook with assistant-ui's ExternalStoreRuntime
 * so the Thread primitives can render messages, handle input, and provide
 * edit / regenerate / copy-to-clipboard features for free.
 */

import { useMemo, useCallback } from "react";
import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ChatMessage } from "@/hooks/useCanvasChat";

interface JarbleRuntimeOptions {
  messages: ChatMessage[];
  streamingText: string;
  streamingReasoning?: string;
  isStreaming: boolean;
  sendMessage: (text: string, displayText?: string) => Promise<void>;
  suggestions?: Array<{ prompt: string }>;
  stopGeneration?: () => void;
  editMessage?: (messageId: string, newText: string) => Promise<void>;
}

function convertMessage(msg: ChatMessage): ThreadMessageLike {
  // Build content parts — include reasoning before text if available
  const contentParts: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string }
  > = [];

  if (msg.reasoning) {
    contentParts.push({ type: "reasoning" as const, text: msg.reasoning });
  }
  contentParts.push({ type: "text" as const, text: msg.displayText || msg.content });

  return {
    role: msg.role,
    content: contentParts,
    id: msg.id,
    createdAt: new Date(msg.createdAt),
    // Action relay messages are shown as compact user messages
    ...(msg.isActionRelay
      ? {
          metadata: {
            custom: { isActionRelay: true, displayText: msg.displayText },
          },
        }
      : {}),
  };
}

export function useJarbleRuntime({
  messages,
  streamingText,
  streamingReasoning = "",
  isStreaming,
  sendMessage,
  suggestions = [],
  stopGeneration,
  editMessage,
}: JarbleRuntimeOptions) {
  // Build display messages: stored messages + optional streaming-in-progress message
  // Deduplicate by id to prevent assistant-ui MessageRepository crashes from
  // stale localStorage data containing duplicate message IDs.
  const displayMessages = useMemo(() => {
    const seen = new Set<string>();
    const deduped: typeof messages = [];
    for (const msg of messages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        deduped.push(msg);
      }
    }
    if (streamingText || streamingReasoning) {
      deduped.push({
        id: "streaming-in-progress",
        role: "assistant",
        content: streamingText,
        createdAt: Date.now(),
        ...(streamingReasoning ? { reasoning: streamingReasoning } : {}),
      });
    }
    return deduped;
  }, [messages, streamingText, streamingReasoning]);

  const onNew = useCallback(
    async (message: { content: readonly { type: string; text?: string }[] }) => {
      const text = message.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) await sendMessage(text);
    },
    [sendMessage],
  );

  const onCancel = useCallback(async () => {
    stopGeneration?.();
  }, [stopGeneration]);

  const onEdit = useCallback(
    async (message: { parentId?: string | null; content: readonly { type: string; text?: string }[] }) => {
      if (!editMessage || !message.parentId) return;
      const text = message.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) await editMessage(message.parentId, text);
    },
    [editMessage],
  );

  return useExternalStoreRuntime<ChatMessage>({
    messages: displayMessages,
    convertMessage,
    isRunning: isStreaming,
    onNew,
    onCancel,
    suggestions,
    ...(editMessage ? { onEdit } : {}),
  });
}
