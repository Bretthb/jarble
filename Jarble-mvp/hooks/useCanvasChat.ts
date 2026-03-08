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
import type { CanvasAction, CanvasCard, CanvasState, LayoutHint } from "@/components/workspace/types";
import { findOpenPosition, getDefaultSize, getContainerSize } from "@/components/workspace/autoLayout";
import { useComponentCatalog } from "@/components/ComponentCatalogProvider";
import type { ClassifiedChatError } from "@/components/workspace/ChatErrorCard";

const isDev = process.env.NODE_ENV === "development";

/** Chat message for the thread (not a canvas card) */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Optional friendly text shown in chat instead of raw content (e.g. action relay messages) */
  displayText?: string;
  /** If true, this message is an action relay — styled more compactly in chat */
  isActionRelay?: boolean;
  /** Accumulated thinking/reasoning text from the LLM */
  thinkingText?: string;
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
      isDev && console.log(`[Jarble:Chat] Chat history expired for ${deploymentId}, clearing`);
      localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${deploymentId}`);
      return [];
    }
    isDev && console.log(`[Jarble:Chat] Loaded ${(messages || []).length} messages from localStorage`);
    return messages || [];
  } catch (err) {
    isDev && console.warn(`[Jarble:Chat] Failed to load chat history: ${err instanceof Error ? err.message : String(err)}`);
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
    isDev && console.log(`[Jarble:Chat] Saved ${trimmed.length} messages to localStorage`);
  } catch (err) {
    isDev && console.warn(`[Jarble:Chat] Failed to save chat history: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface UIBlockPending {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
  layoutHint?: LayoutHint;
}

/** Regex to strip ```jarble_ui ... ```, ```jarble_ui_update ... ```, and ```jarble_ui_define ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui(?:_update|_define)?\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function useCanvasChat(
  deploymentId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>
) {
  const { getAccessTokenSilently } = useAuth0();
  const { registerComponent } = useComponentCatalog();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingCardIds, setStreamingCardIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [lastChatError, setLastChatError] = useState<ClassifiedChatError | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedHistory = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track streaming card animation timers so we can clear them on unmount
  const cardTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Keep a live ref to state so the SSE handler always reads the latest cards (avoids stale closure)
  const stateRef = useRef(state);
  stateRef.current = state;
  // Ref-based streaming guard — avoids stale closure when isStreaming is in useCallback deps
  const isStreamingRef = useRef(false);
  // Generation counter — detects when a new request supersedes an aborted one in finally
  const generationRef = useRef(0);
  // rAF-based throttle for streaming text updates — coalesces rapid deltas into
  // a single React re-render per animation frame (~16ms / 60fps)
  const pendingTextRef = useRef<string>("");
  const rafIdRef = useRef<number | null>(null);

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
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        // Flush synchronously on cleanup so messages aren't lost when
        // the component unmounts or deploymentId changes
        saveChatHistory(deploymentId, messages);
      }
    };
  }, [deploymentId, messages]);

  // Clear card animation timers and rAF on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      cardTimersRef.current.forEach(clearTimeout);
      cardTimersRef.current = [];
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string, displayText?: string) => {
      // Use ref guard — keeps sendMessage stable without isStreaming in deps
      if (!text.trim() || isStreamingRef.current) return;

      // Skip card reference prepend for action/error messages — these already contain card context
      const isActionMessage = text.startsWith("[UI_ACTION]") || text.startsWith("[SANDBOX_ERROR]") || text.startsWith("[COMPONENT_ERROR]");

      // Use stateRef.current for selectedCard and canvas state — keeps deps stable
      const currentState = stateRef.current;

      // If a card is selected, prepend a clear reference so the bot knows which card to update
      let messageToSend = text;
      const selectedCard = currentState.cards.find((c) => c.selected);
      if (selectedCard && !isActionMessage) {
        const title = selectedCard.title || selectedCard.component.replace(/_/g, " ");
        const ref = `[EDITING ${selectedCard.id} "${title}"]`;
        messageToSend = `${ref}\n${text}`;
        dispatch({ type: "DESELECT_CARD" });
      }

      // Build canvas state summary — skip for action/error messages since they already carry
      // cardId context and the extra tokens are wasteful for every interaction relay.
      // Always send [CANVAS_STATE] (even when empty) so the bot knows it's on the web dashboard.
      if (!isActionMessage) {
        let canvasBlock: string;
        if (currentState.cards.length > 0) {
          const cardLines = currentState.cards.map((c) => {
            const title = c.title || c.component.replace(/_/g, " ");
            return `- ${c.id}: ${c.component} (title: "${title}")`;
          });
          canvasBlock = `[CANVAS_STATE]\nCards on canvas:\n${cardLines.join("\n")}\n[/CANVAS_STATE]\n`;
        } else {
          canvasBlock = `[CANVAS_STATE]\nNo cards on canvas.\n[/CANVAS_STATE]\n`;
        }
        messageToSend = `${canvasBlock}${messageToSend}`;
        isDev && console.log(`[Jarble:Chat] Prepended canvas state with ${currentState.cards.length} card(s)`);
      }

      // Track this request's generation — used in finally to avoid the abort race where
      // the old request's finally fires after the new request has already set isStreaming=true
      const generation = ++generationRef.current;
      isStreamingRef.current = true;
      setIsStreaming(true);
      setStreamingText("");
      setLastChatError(null);
      setLastUserMessage(text);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const messageId = `msg-${Date.now()}`;
      let accumulatedText = "";
      const streamStart = Date.now();
      let eventCount = 0;

      // Add user message to chat immediately (show the original text to the user, not the reference-prepended one)
      const userMessage: ChatMessage = {
        id: `${messageId}-user`,
        role: "user",
        content: text,
        createdAt: Date.now(),
        ...(displayText ? { displayText, isActionRelay: true } : {}),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const token = await getAccessTokenSilently();
        const url = `${API_URL}/api/tambo-agent`;
        isDev && console.log(`[Jarble:Chat] SSE connecting to ${url} for deployment ${deploymentId}`);

        const res = await fetch(url, {
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
          console.error(`[Jarble:Chat] SSE error: HTTP ${res.status} — ${errText.slice(0, 200)}`);
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

        isDev && console.log("[Jarble:Chat] SSE connected, streaming...");
        const decoder = new TextDecoder();
        let buffer = "";
        const pendingBlocks = new Map<string, UIBlockPending>();
        // Track cards added during this stream so findOpenPosition can see them
        // even before React re-renders and updates stateRef.current.cards.
        const cardsAddedThisStream: CanvasCard[] = [];
        let textContentCount = 0;

        // rAF-based throttle: coalesce rapid text deltas into one setState per frame
        function scheduleTextUpdate(text: string) {
          pendingTextRef.current = text;
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
              setStreamingText(pendingTextRef.current);
              rafIdRef.current = null;
            });
          }
        }

        // Labeled outer loop so RUN_FINISHED can break out of both loops cleanly
        outer: while (true) {
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
              eventCount++;

              if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
                textContentCount++;
                // Log every 5th TEXT_MESSAGE_CONTENT to avoid spam
                if (isDev && textContentCount % 5 === 0) {
                  console.log(`[Jarble:Chat] SSE event: TEXT_MESSAGE_CONTENT (x${textContentCount}, ${accumulatedText.length} chars total)`);
                }
                accumulatedText += event.delta;
                // Schedule rAF-throttled update — coalesces rapid deltas into one render per frame
                scheduleTextUpdate(stripUIMarkers(accumulatedText));
              } else if (isDev && event.type !== "TEXT_MESSAGE_CONTENT") {
                console.log(`[Jarble:Chat] SSE event: ${event.type}`);
              }

              if (event.type === "UI_BLOCK_START") {
                pendingBlocks.set(event.blockId, {
                  id: event.blockId,
                  component: event.component,
                  props: {},
                  ...(event.editable ? { editable: true } : {}),
                  ...(event.fileId ? { fileId: event.fileId } : {}),
                  ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
                  ...(event.layoutHint ? { layoutHint: event.layoutHint } : {}),
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
                  // Pass cardsAddedThisStream so findOpenPosition can see cards
                  // dispatched earlier in this stream but not yet reflected in stateRef
                  // (React batches useReducer updates, so stateRef is stale within a tick)
                  const card = addComponentCard(block, messageId, stateRef.current, dispatch, cardsAddedThisStream);
                  if (card) cardsAddedThisStream.push(card);
                  pendingBlocks.delete(event.blockId);
                  const cardId = `card-${block.id}`;
                  isDev && console.log(`[Jarble:Chat] Card created: ${cardId} (${block.component})`);
                  const timer = setTimeout(() => {
                    setStreamingCardIds((prev) => {
                      const next = new Set(prev);
                      next.delete(cardId);
                      return next;
                    });
                  }, 600);
                  cardTimersRef.current.push(timer);
                }
              }

              if (event.type === "UI_BLOCK_UPDATE") {
                const { cardId, props, merge, component } = event;
                isDev && console.log(`[Jarble:Chat] Card updated: ${cardId} (merge=${merge ?? true})`);
                dispatch({
                  type: "UPDATE_CARD_PROPS",
                  id: cardId,
                  props: props ?? {},
                  merge: merge ?? true,
                  component,
                });
              }

              if (event.type === "COMPONENT_DEFINED") {
                isDev && console.log(`[Jarble:Chat] Component defined: ${event.name} (${event.layout?.length ?? 0} children)`);
                registerComponent({
                  name: event.name,
                  description: event.description,
                  layout: event.layout ?? [],
                });
              }

              if (event.type === "CHAT_ERROR" && event.error) {
                isDev && console.log(`[Jarble:Chat] CHAT_ERROR: ${event.error.code} — ${event.error.message}`);
                setLastChatError(event.error as ClassifiedChatError);
              }

              // Break both the for loop and the outer while loop cleanly
              if (event.type === "RUN_FINISHED") break outer;
            } catch {
              isDev && console.warn(`[Jarble:Chat] Failed to parse SSE event data: ${trimmed.slice(0, 200)}`);
            }
          }
        }

        isDev && console.log(`[Jarble:Chat] SSE stream ended (${eventCount} events, ${Date.now() - streamStart}ms)`);

        // Cancel any pending rAF and flush the final text immediately
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setStreamingText(stripUIMarkers(accumulatedText));

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
        if (err instanceof Error && err.name === "AbortError") {
          isDev && console.log(`[Jarble:Chat] SSE aborted after ${Date.now() - streamStart}ms`);
          return;
        }
        console.error(`[Jarble:Chat] SSE error: ${err instanceof Error ? err.message : String(err)}`);
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
        // Only clear streaming state if this is still the active request.
        // The generation check prevents the abort race: when request A is aborted
        // and request B starts, A's finally must not clear B's streaming state.
        if (generationRef.current === generation) {
          // Cancel any pending rAF to prevent stale updates
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          isStreamingRef.current = false;
          setIsStreaming(false);
          setStreamingText("");
          setStreamingCardIds(new Set());
        }
      }
    },
    // Stable deps — isStreaming replaced by isStreamingRef, state replaced by stateRef.current
    [deploymentId, getAccessTokenSilently, dispatch]
  );

  const clearChatError = useCallback(() => setLastChatError(null), []);

  return { sendMessage, isStreaming, streamingCardIds, messages, streamingText, lastChatError, lastUserMessage, clearChatError };
}

// ── Helper: create canvas card for UI blocks only ────────────────────────────

function addComponentCard(
  block: UIBlockPending,
  messageId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>,
  extraCards: CanvasCard[] = []
): CanvasCard {
  const size = getDefaultSize(block.component);
  const container = getContainerSize();
  // Merge state.cards with any cards added during the same stream tick that
  // haven't been reflected in state yet (React batches useReducer dispatches)
  const allCards = [...state.cards, ...extraCards];
  const position = findOpenPosition(
    allCards,
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
    layoutHint: block.layoutHint,
  };

  dispatch({ type: "ADD_CARD", card });
  return card;
}
