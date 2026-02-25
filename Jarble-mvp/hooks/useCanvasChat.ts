"use client";

/**
 * useCanvasChat — Streaming hook that dispatches ADD_CARD to the canvas reducer.
 *
 * Evolution of useDirectChat: same SSE consumption, but instead of maintaining
 * a messages array it creates CanvasCards for each bot response.
 *
 * Text-only responses → "text_message" card.
 * UI blocks → card with their declared component type.
 *
 * Does NOT maintain conversation history (Option C — bot handles it via
 * OpenClaw session storage on PVC).
 */

import { useCallback, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasAction, CanvasCard, CanvasState } from "@/components/workspace/types";
import { findOpenPosition, getDefaultSize, getContainerSize } from "@/components/workspace/autoLayout";

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
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      setIsStreaming(true);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const messageId = `msg-${Date.now()}`;
      let accumulatedText = "";
      const emittedBlocks = new Set<string>();

      try {
        const token = await getAccessTokenSilently();

        // Option C: don't send history — bot manages it via session
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
          addTextCard(
            `Error: ${errText}`,
            text,
            messageId,
            state,
            dispatch
          );
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
                // Mark card as streaming
                setStreamingCardIds((prev) => new Set(prev).add(`card-${event.blockId}`));
              }

              if (event.type === "UI_BLOCK_PROPS") {
                const block = pendingBlocks.get(event.blockId);
                if (block) block.props = event.props;
              }

              if (event.type === "UI_BLOCK_END") {
                const block = pendingBlocks.get(event.blockId);
                if (block) {
                  emittedBlocks.add(block.id);
                  addComponentCard(block, messageId, state, dispatch);
                  pendingBlocks.delete(event.blockId);
                  // Unmark card streaming after a short delay (let render settle)
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

        // After streaming ends: if we got text (beyond UI markers), create a text card
        const cleanText = stripUIMarkers(accumulatedText);
        if (cleanText) {
          addTextCard(cleanText, text, messageId, state, dispatch);
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        addTextCard(
          "Something went wrong. Please try again.",
          text,
          messageId,
          state,
          dispatch
        );
      } finally {
        setIsStreaming(false);
        setStreamingCardIds(new Set());
      }
    },
    [deploymentId, getAccessTokenSilently, isStreaming, state, dispatch]
  );

  return { sendMessage, isStreaming, streamingCardIds };
}

// ── Helpers: create cards ─────────────────────────────────────────────────────

function addTextCard(
  botText: string,
  userText: string,
  messageId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>
) {
  const size = getDefaultSize("text_message");
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
    id: `card-text-${Date.now()}`,
    component: "text_message",
    props: { botText, userText },
    position,
    size,
    zIndex: 0, // reducer will assign
    minimized: false,
    createdAt: Date.now(),
    sourceMessageId: messageId,
    title: userText.slice(0, 40) || "Message",
  };

  dispatch({ type: "ADD_CARD", card });
}

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
