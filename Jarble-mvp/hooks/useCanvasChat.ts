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

import { useCallback, useRef, useState, useEffect } from "react";
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

const CHAT_STORAGE_PREFIX = "jarble-chat-";
const CHAT_MAX_MESSAGES = 100; // Keep last 100 messages
const CHAT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadChatHistory(deploymentId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${CHAT_STORAGE_PREFIX}${deploymentId}`);
    if (!raw) return [];
    const { messages, savedAt } = JSON.parse(raw);
    // Check expiry
    if (Date.now() - savedAt > CHAT_EXPIRY_MS) {
      localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${deploymentId}`);
      return [];
    }
    return messages || [];
  } catch {
    return [];
  }
}

function saveChatHistory(deploymentId: string, messages: ChatMessage[]): void {
  try {
    // Keep only the last N messages
    const trimmed = messages.slice(-CHAT_MAX_MESSAGES);
    localStorage.setItem(
      `${CHAT_STORAGE_PREFIX}${deploymentId}`,
      JSON.stringify({ messages: trimmed, savedAt: Date.now() })
    );
  } catch {
    // localStorage full or unavailable
  }
}

interface UIBlockPending {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
}

/** Regex to strip ```jarble_ui ... ``` and ```jarble_ui_update ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui(?:_update)?\s*\n[\s\S]*?```/g;

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
  const hasLoadedHistory = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load chat history from localStorage on mount
  useEffect(() => {
    if (hasLoadedHistory.current) return;
    hasLoadedHistory.current = true;
    const saved = loadChatHistory(deploymentId);
    if (saved.length > 0) {
      setMessages(saved);
    }
  }, [deploymentId]);

  // Debounced save chat history when messages change (500ms delay)
  useEffect(() => {
    if (!hasLoadedHistory.current || messages.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChatHistory(deploymentId, messages);
    }, 500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [deploymentId, messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      // If a card is selected, prepend a reference so the bot knows which card to update
      let messageToSend = text;
      const selectedCard = state.cards.find((c) => c.selected);
      if (selectedCard) {
        const ref = `@[${selectedCard.title || selectedCard.component}](card:${selectedCard.id})`;
        messageToSend = `${ref} ${text}`;
        dispatch({ type: "DESELECT_CARD" });
      }

      setIsStreaming(true);
      setStreamingText("");
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const messageId = `msg-${Date.now()}`;
      let accumulatedText = "";

      // Add user message to chat immediately (show the original text to the user, not the reference-prepended one)
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
            messages: [{ role: "user", content: messageToSend }],
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
        let lastStreamUpdate = 0;
        const STREAM_THROTTLE_MS = 50; // Throttle streaming updates to 20fps

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
                // Throttle streaming text updates to reduce re-renders
                const now = Date.now();
                if (now - lastStreamUpdate >= STREAM_THROTTLE_MS) {
                  lastStreamUpdate = now;
                  setStreamingText(stripUIMarkers(accumulatedText));
                }
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

              if (event.type === "UI_BLOCK_UPDATE") {
                const { cardId, props, merge, component } = event;
                dispatch({
                  type: "UPDATE_CARD_PROPS",
                  id: cardId,
                  props: props ?? {},
                  merge: merge ?? true,
                  component,
                });
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
