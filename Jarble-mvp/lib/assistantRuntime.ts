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
  isStreaming: boolean;
  sendMessage: (text: string, displayText?: string) => Promise<void>;
  suggestions?: Array<{ prompt: string }>;
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
  isStreaming,
  sendMessage,
  suggestions = [],
}: JarbleRuntimeOptions) {
  // Build display messages: stored messages + optional streaming-in-progress message
  const displayMessages = useMemo(() => {
    const all = [...messages];
    if (streamingText) {
      all.push({
        id: "streaming-in-progress",
        role: "assistant",
        content: streamingText,
        createdAt: Date.now(),
      });
    }
    return all;
  }, [messages, streamingText]);

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

  return useExternalStoreRuntime<ChatMessage>({
    messages: displayMessages,
    convertMessage,
    // Show thinking indicator when streaming but no text yet
    isRunning: isStreaming && !streamingText,
    onNew,
    suggestions,
  });
}
