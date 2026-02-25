"use client";

/**
 * useCanvasChat — Streaming hook for chat + canvas.
 *
 * Separation of concerns:
 * - Chat messages (user + bot text) → returned in `messages` array for chat panel
 * - UI blocks (charts, tables, etc.) → dispatched as CanvasCards for canvas area
 *
 * Only UI blocks become moveable canvas components. Chat stays in a traditional thread.
 */

import { useCallback, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasAction, CanvasCard, CanvasState } from "@/components/workspace/types";
import { findOpenPosition, getDefaultSize, getContainerSize } from "@/components/workspace/autoLayout";

/** Chat message for the thread (not a canvas card) */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

interface UIBlockPending {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
}

/** Regex to strip ```jarble_ui ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function useCanvasChat(
  deploymentId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>
) {
  const { getAccessTokenSilently } = useAuth0();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingCardIds, setStreamingCardIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      setIsStreaming(true);
      setStreamingText("");
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const messageId = `msg-${Date.now()}`;
      let accumulatedText = "";

      // Add user message to chat immediately
      const userMessage: ChatMessage = {
        id: `${messageId}-user`,
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const token = await getAccessTokenSilently();

        const res = await fetch(`${API_URL}/api/tambo-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            deploymentId,
            messages: [{ role: "user", content: text }],
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          // Add error as assistant message
          setMessages((prev) => [
            ...prev,
            {
              id: `${messageId}-error`,
              role: "assistant",
              content: `Error: ${errText}`,
              createdAt: Date.now(),
            },
          ]);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";
        const pendingBlocks = new Map<string, UIBlockPending>();

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
              const event = JSON.parse(trimmed.slice(6));

              if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
                accumulatedText += event.delta;
                // Update streaming text for live display
                setStreamingText(stripUIMarkers(accumulatedText));
              }

              if (event.type === "UI_BLOCK_START") {
                pendingBlocks.set(event.blockId, {
                  id: event.blockId,
                  component: event.component,
                  props: {},
                  ...(event.editable ? { editable: true } : {}),
                  ...(event.fileId ? { fileId: event.fileId } : {}),
                  ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
                });
                setStreamingCardIds((prev) => new Set(prev).add(`card-${event.blockId}`));
              }

              if (event.type === "UI_BLOCK_PROPS") {
                const block = pendingBlocks.get(event.blockId);
                if (block) block.props = event.props;
              }

              if (event.type === "UI_BLOCK_END") {
                const block = pendingBlocks.get(event.blockId);
                if (block) {
                  // Only UI blocks become canvas cards
                  addComponentCard(block, messageId, state, dispatch);
                  pendingBlocks.delete(event.blockId);
                  const cardId = `card-${block.id}`;
                  setTimeout(() => {
                    setStreamingCardIds((prev) => {
                      const next = new Set(prev);
                      next.delete(cardId);
                      return next;
                    });
                  }, 600);
                }
              }

              if (event.type === "RUN_FINISHED") break;
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // After streaming ends: add bot text to chat messages (NOT canvas)
        const cleanText = stripUIMarkers(accumulatedText);
        if (cleanText) {
          setMessages((prev) => [
            ...prev,
            {
              id: `${messageId}-assistant`,
              role: "assistant",
              content: cleanText,
              createdAt: Date.now(),
            },
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setMessages((prev) => [
          ...prev,
          {
            id: `${messageId}-error`,
            role: "assistant",
            content: "Something went wrong. Please try again.",
            createdAt: Date.now(),
          },
        ]);
      } finally {
        setIsStreaming(false);
        setStreamingText("");
        setStreamingCardIds(new Set());
      }
    },
    [deploymentId, getAccessTokenSilently, isStreaming, state, dispatch]
  );

  return { sendMessage, isStreaming, streamingCardIds, messages, streamingText };
}

// ── Helper: create canvas card for UI blocks only ────────────────────────────

function addComponentCard(
  block: UIBlockPending,
  messageId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>
) {
  const size = getDefaultSize(block.component);
  const container = getContainerSize();
  const position = findOpenPosition(
    state.cards,
    state.viewportOffset,
    state.zoom,
    container.width,
    container.height,
    size
  );

  const card: CanvasCard = {
    id: `card-${block.id}`,
    component: block.component,
    props: block.props,
    position,
    size,
    zIndex: 0,
    minimized: false,
    editable: block.editable,
    fileId: block.fileId,
    saveMethod: block.saveMethod,
    createdAt: Date.now(),
    sourceMessageId: messageId,
    title: (block.props.title as string) || block.component.replace(/_/g, " "),
  };

  dispatch({ type: "ADD_CARD", card });
}
