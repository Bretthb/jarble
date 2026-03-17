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
import { toast } from "sonner";
import { API_URL } from "@/lib/trpc";
import type { CanvasAction, CanvasCard, CanvasState, LayoutHint } from "@/components/workspace/types";
import { MAX_CANVAS_CARDS } from "@/components/workspace/types";
import { findOpenPosition, getDefaultSize, getContainerSize } from "@/components/workspace/autoLayout";
import { useComponentCatalog } from "@/components/ComponentCatalogProvider";
import type { ClassifiedChatError } from "@/components/workspace/ChatErrorCard";
import type { ConversationMeta } from "@/lib/conversationStorage";
import {
  loadConversationIndex,
  saveConversationIndex,
  loadConversationMessages,
  saveConversationMessages,
  deleteConversation as deleteConv,
  createConversation,
  migrateFromLegacy,
} from "@/lib/conversationStorage";

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
  /** Reasoning / thinking content from the LLM (shown as collapsible "Thought process") */
  reasoning?: string;
}


interface UIBlockPending {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
  layoutHint?: LayoutHint;
  dashboardId?: string;
  dashboardTitle?: string;
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
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [lastChatError, setLastChatError] = useState<ClassifiedChatError | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ prompt: string }>>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedHistory = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeConvRef = useRef<string | null>(null);
  activeConvRef.current = activeConversationId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Track streaming card animation timers so we can clear them on unmount
  const cardTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Keep a live ref to state so the SSE handler always reads the latest cards (avoids stale closure)
  const stateRef = useRef(state);
  stateRef.current = state;
  // Ref-based streaming guard — avoids stale closure when isStreaming is in useCallback deps
  const isStreamingRef = useRef(false);
  // Generation counter — detects when a new request supersedes an aborted one in finally
  const generationRef = useRef(0);
  // Typewriter reveal: target text accumulates instantly, displayed text catches up
  // by revealing CHARS_PER_FRAME characters per animation frame (~60fps)
  const targetTextRef = useRef<string>("");
  const displayedLenRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const targetReasoningRef = useRef<string>("");
  const displayedReasoningLenRef = useRef<number>(0);
  const reasoningRafIdRef = useRef<number | null>(null);
  const CHARS_PER_FRAME = 8; // ~480 chars/sec at 60fps — fast but visible
  // Track current run's LLM provider/model from RUN_STARTED event (ref avoids stale closure)
  const currentLlmRef = useRef<{ provider?: string; model?: string }>({});
  // Track which card was selected when the user sent the message (for provenance linking)
  const selectedCardRef = useRef<string | null>(null);
  // Track edit mode — when set, the next TOOL_CALL_END with matching component type
  // updates the card in-place instead of creating a new one
  const editModeRef = useRef<{ cardId: string; component: string } | null>(null);

  const flushMessages = useCallback((convId: string | null, msgs: ChatMessage[]) => {
    if (!convId || msgs.length === 0) return;
    saveConversationMessages(deploymentId, convId, msgs);
    const index = loadConversationIndex(deploymentId);
    const meta = index.conversations.find((c) => c.id === convId);
    if (meta) {
      meta.messageCount = msgs.length;
      meta.updatedAt = Date.now();
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) meta.preview = lastAssistant.content.slice(0, 80);
      saveConversationIndex(deploymentId, index);
      setConversations([...index.conversations]);
    }
  }, [deploymentId]);

  // Load conversation index + migrate legacy on mount
  useEffect(() => {
    if (hasLoadedHistory.current) return;
    hasLoadedHistory.current = true;
    migrateFromLegacy(deploymentId);
    let index = loadConversationIndex(deploymentId);
    if (index.conversations.length === 0) {
      createConversation(deploymentId);
      index = loadConversationIndex(deploymentId);
    }
    setConversations(index.conversations);
    const activeId = index.activeId ?? index.conversations[0]?.id ?? null;
    setActiveConversationId(activeId);
    if (activeId) {
      const saved = loadConversationMessages(deploymentId, activeId);
      if (saved.length > 0) setMessages(saved);
    }
  }, [deploymentId]);

  // Debounced save messages to conversation storage
  useEffect(() => {
    if (!hasLoadedHistory.current || messages.length === 0 || !activeConversationId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushMessages(activeConvRef.current, messages);
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        flushMessages(activeConvRef.current, messages);
      }
    };
  }, [deploymentId, messages, activeConversationId, flushMessages]);

  // Clear card animation timers and rAF on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      cardTimersRef.current.forEach(clearTimeout);
      cardTimersRef.current = [];
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (reasoningRafIdRef.current !== null) {
        cancelAnimationFrame(reasoningRafIdRef.current);
        reasoningRafIdRef.current = null;
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string, displayText?: string, mode?: "edit" | "branch") => {
      if (!text.trim()) return;

      // If already streaming, abort the current generation so the new message can proceed
      if (isStreamingRef.current) {
        abortRef.current?.abort();
        // Wait a microtick for the abort to propagate and clear streaming state
        await new Promise((r) => setTimeout(r, 0));
      }

      // Skip card reference prepend for action/error messages — these already contain card context
      const isActionMessage = text.startsWith("[UI_ACTION]") || text.startsWith("[SANDBOX_ERROR]") || text.startsWith("[COMPONENT_ERROR]") || text.startsWith("[PUBLISH_SERVICE]");

      // Use stateRef.current for selectedCard and canvas state — keeps deps stable
      const currentState = stateRef.current;

      // If a card is selected, prepend a clear reference so the bot knows which card to update
      let messageToSend = text;
      const selectedCard = currentState.cards.find((c) => c.selected);
      // Track selected card ID so new cards rendered during this stream can be linked as children
      selectedCardRef.current = selectedCard?.id ?? null;
      // Reset edit mode — will be set below only for "edit" mode
      editModeRef.current = null;
      if (selectedCard && !isActionMessage) {
        const title = selectedCard.title || selectedCard.component.replace(/_/g, " ");
        // Include the card's current content so the bot knows what the user sees/edited
        const contentSnapshot = getCardContentSnapshot(selectedCard);
        if (mode === "branch") {
          const ref = `[BRANCH ${selectedCard.id} "${title}"]`;
          messageToSend = `${ref}${contentSnapshot}\n${text}`;
        } else {
          const ref = `[EDITING ${selectedCard.id} "${title}"]`;
          messageToSend = `${ref}${contentSnapshot}\n${text}`;
          editModeRef.current = { cardId: selectedCard.id, component: selectedCard.component };
        }
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
            const meta = summarizeCardProps(c);
            return `- ${c.id}: ${c.component} "${title}"${meta ? ` (${meta})` : ""}`;
          });
          canvasBlock = `[CANVAS_STATE]\nCards on canvas (${currentState.cards.length}):\n${cardLines.join("\n")}\n[/CANVAS_STATE]\n`;
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
      setStreamingReasoning("");
      targetTextRef.current = "";
      displayedLenRef.current = 0;
      targetReasoningRef.current = "";
      displayedReasoningLenRef.current = 0;
      setLastChatError(null);
      setLastUserMessage(text);
      setSuggestions([]); // Clear suggestions when user sends a new message
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const messageId = `msg-${Date.now()}`;
      let accumulatedText = "";
      let reasoningText = "";
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

      // Auto-title: update conversation title from first user message
      if (activeConvRef.current) {
        const index = loadConversationIndex(deploymentId);
        const meta = index.conversations.find((c) => c.id === activeConvRef.current);
        if (meta && meta.title === "New Conversation") {
          meta.title = text.slice(0, 50);
          saveConversationIndex(deploymentId, index);
          setConversations([...index.conversations]);
        }
      }

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
            conversationId: activeConvRef.current,
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
        // Track when each block's TOOL_CALL_START arrived — used to detect orphaned blocks
        const blockStartTimes = new Map<string, number>();
        const BLOCK_TIMEOUT_MS = 10_000; // 10 seconds — generous for slow LLM responses
        // Track cards added during this stream so findOpenPosition can see them
        // even before React re-renders and updates stateRef.current.cards.
        const cardsAddedThisStream: CanvasCard[] = [];
        let textContentCount = 0;

        // Typewriter reveal: target accumulates instantly, displayed catches up per frame
        function scheduleTextUpdate(text: string) {
          targetTextRef.current = text;
          if (rafIdRef.current === null) {
            function tick() {
              const target = targetTextRef.current;
              if (displayedLenRef.current < target.length) {
                displayedLenRef.current = Math.min(displayedLenRef.current + CHARS_PER_FRAME, target.length);
                setStreamingText(target.slice(0, displayedLenRef.current));
                rafIdRef.current = requestAnimationFrame(tick);
              } else {
                rafIdRef.current = null;
              }
            }
            rafIdRef.current = requestAnimationFrame(tick);
          }
        }

        function scheduleReasoningUpdate(text: string) {
          targetReasoningRef.current = text;
          if (reasoningRafIdRef.current === null) {
            function tick() {
              const target = targetReasoningRef.current;
              if (displayedReasoningLenRef.current < target.length) {
                displayedReasoningLenRef.current = Math.min(displayedReasoningLenRef.current + CHARS_PER_FRAME, target.length);
                setStreamingReasoning(target.slice(0, displayedReasoningLenRef.current));
                reasoningRafIdRef.current = requestAnimationFrame(tick);
              } else {
                reasoningRafIdRef.current = null;
              }
            }
            reasoningRafIdRef.current = requestAnimationFrame(tick);
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

              if (event.type === "RUN_STARTED") {
                currentLlmRef.current = {
                  provider: event.llmProvider,
                  model: event.llmModel,
                };
              }

              // ── Reasoning / thinking events ──
              if (event.type === "REASONING_START") {
                reasoningText = "";
              }
              if (event.type === "REASONING_CONTENT" && event.delta) {
                reasoningText += event.delta;
                scheduleReasoningUpdate(reasoningText);
              }
              // REASONING_END is handled implicitly — reasoning text already accumulated

              // ── AG-UI TOOL_CALL events (new — component rendering as tool calls) ──
              if (event.type === "TOOL_CALL_START" && event.toolCallName?.startsWith("show_")) {
                const component = event.toolCallName.slice(5); // "show_chart" -> "chart"
                const blockId = event.toolCallId;
                blockStartTimes.set(blockId, Date.now());
                pendingBlocks.set(blockId, {
                  id: blockId,
                  component,
                  props: {},
                  ...(event.editable ? { editable: true } : {}),
                  ...(event.fileId ? { fileId: event.fileId } : {}),
                  ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
                  ...(event.layoutHint ? { layoutHint: event.layoutHint } : {}),
                  ...(event.dashboardId ? { dashboardId: event.dashboardId } : {}),
                  ...(event.dashboardTitle ? { dashboardTitle: event.dashboardTitle } : {}),
                });
                setStreamingCardIds((prev) => new Set(prev).add(`card-${blockId}`));
              }

              if (event.type === "TOOL_CALL_ARGS" && event.toolCallId) {
                const block = pendingBlocks.get(event.toolCallId);
                if (block && event.delta) {
                  try {
                    block.props = JSON.parse(event.delta);
                  } catch {
                    isDev && console.warn(`[Jarble:Chat] Failed to parse TOOL_CALL_ARGS delta`);
                  }
                }
              }

              if (event.type === "TOOL_CALL_END" && event.toolCallId) {
                const block = pendingBlocks.get(event.toolCallId);
                if (block) {
                  blockStartTimes.delete(event.toolCallId);

                  // Edit mode: update existing card in-place if component type matches
                  if (editModeRef.current && block.component === editModeRef.current.component) {
                    const targetId = editModeRef.current.cardId;
                    isDev && console.log(`[Jarble:Chat] Edit-in-place: updating ${targetId} (${block.component})`);
                    dispatch({
                      type: "UPDATE_CARD_PROPS",
                      id: targetId,
                      props: block.props,
                      merge: false,
                    });
                    editModeRef.current = null; // Only update once per response
                  } else {
                    // Branch mode or component type differs: create new card
                    const card = addComponentCard(block, messageId, stateRef.current, dispatch, cardsAddedThisStream, currentLlmRef.current, selectedCardRef.current);
                    if (card) cardsAddedThisStream.push(card);
                  }

                  pendingBlocks.delete(event.toolCallId);
                  const cardId = `card-${block.id}`;
                  isDev && console.log(`[Jarble:Chat] Card processed: ${cardId} (${block.component})`);
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

              // ── AG-UI CUSTOM events ──
              if (event.type === "CUSTOM") {
                if (event.name === "jarble.card.update" && event.value) {
                  const { cardId, props, merge, component } = event.value;
                  isDev && console.log(`[Jarble:Chat] Card updated (AG-UI): ${cardId} (merge=${merge ?? true})`);
                  dispatch({
                    type: "UPDATE_CARD_PROPS",
                    id: cardId,
                    props: props ?? {},
                    merge: merge ?? true,
                    component,
                  });
                }
                if (event.name === "jarble.component.defined" && event.value) {
                  isDev && console.log(`[Jarble:Chat] Component defined (AG-UI): ${event.value.name}`);
                  registerComponent({
                    name: event.value.name,
                    description: event.value.description,
                    layout: event.value.layout ?? [],
                  });
                }
                if (event.name === "jarble.chat.error" && event.value?.error) {
                  isDev && console.log(`[Jarble:Chat] CHAT_ERROR (AG-UI): ${event.value.error.code}`);
                  setLastChatError(event.value.error as ClassifiedChatError);
                }
                if (event.name === "jarble.dashboard.created" && event.value) {
                  const { dashboardId, title, cardIds } = event.value;
                  isDev && console.log(`[Jarble:Chat] Dashboard created: "${title}" (${cardIds.length} cards)`);
                  dispatch({
                    type: "CREATE_DASHBOARD_GROUP",
                    groupId: dashboardId,
                    title,
                    cardIds,
                  });
                }
                if (event.name === "jarble.artifact.updated" && event.value) {
                  const { id, component, props } = event.value;
                  isDev && console.log(`[Jarble:Chat] Artifact updated (AG-UI): ${id}`);
                  dispatch({
                    type: "UPDATE_CARD_PROPS",
                    id,
                    props,
                    merge: true,
                    component,
                  });
                }
                if (event.name === "jarble.sse.error" && event.value) {
                  console.error(`[Jarble:Chat] SSE serialization error from server: ${event.value.message}`);
                }
                if (event.name === "jarble.suggestions" && event.value?.suggestions) {
                  isDev && console.log(`[Jarble:Chat] Suggestions received: ${event.value.suggestions.length}`);
                  // assistant-ui needs { prompt, title } — title is what SuggestionPrimitive.Title renders
                  const normalized = (event.value.suggestions as Array<{ prompt: string; title?: string }>).map(s => ({
                    prompt: s.prompt,
                    title: s.title || s.prompt,
                  }));
                  setSuggestions(normalized);
                }
                if (event.name === "jarble.theme.updated") {
                  // Theme was changed by the bot — trigger a deployment refetch
                  // so useDeploymentTheme picks up the new themeConfig from the DB
                  window.dispatchEvent(new CustomEvent("jarble:theme-updated", { detail: event.value }));
                }
              }

              // Break both the for loop and the outer while loop cleanly
              if (event.type === "RUN_FINISHED") break outer;
            } catch {
              isDev && console.warn(`[Jarble:Chat] Failed to parse SSE event data: ${trimmed.slice(0, 200)}`);
            }
          }
        }

        isDev && console.log(`[Jarble:Chat] SSE stream ended (${eventCount} events, ${Date.now() - streamStart}ms)`);

        // Clean up orphaned pending blocks — these had TOOL_CALL_START but never got TOOL_CALL_END
        if (pendingBlocks.size > 0) {
          const now = Date.now();
          for (const [blockId, block] of pendingBlocks) {
            const startTime = blockStartTimes.get(blockId) ?? now;
            const elapsed = now - startTime;
            console.warn(
              `[Jarble:Chat] Orphaned block "${blockId}" (${block.component}) — ` +
              `TOOL_CALL_START received ${elapsed}ms ago but TOOL_CALL_END never arrived. ` +
              `Discarding to prevent memory leak.`
            );
            // Clean up the streaming animation for this card
            setStreamingCardIds((prev) => {
              const next = new Set(prev);
              next.delete(`card-${blockId}`);
              return next;
            });
          }
          pendingBlocks.clear();
          blockStartTimes.clear();
        }

        // Cancel any pending rAF and flush the final text immediately
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        if (reasoningRafIdRef.current !== null) {
          cancelAnimationFrame(reasoningRafIdRef.current);
          reasoningRafIdRef.current = null;
        }
        setStreamingText(stripUIMarkers(accumulatedText));
        setStreamingReasoning(reasoningText);

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
              ...(reasoningText ? { reasoning: reasoningText } : {}),
            },
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          isDev && console.log(`[Jarble:Chat] SSE aborted after ${Date.now() - streamStart}ms`);
          const cleanText = stripUIMarkers(accumulatedText);
          if (cleanText) {
            setMessages((prev) => [
              ...prev,
              {
                id: `${messageId}-assistant`,
                role: "assistant",
                content: cleanText,
                createdAt: Date.now(),
                ...(reasoningText ? { reasoning: reasoningText } : {}),
              },
            ]);
          }
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
          if (reasoningRafIdRef.current !== null) {
            cancelAnimationFrame(reasoningRafIdRef.current);
            reasoningRafIdRef.current = null;
          }
          isStreamingRef.current = false;
          editModeRef.current = null;
          setIsStreaming(false);
          setStreamingText("");
          setStreamingReasoning("");
          setStreamingCardIds(new Set());
        }
      }
    },
    // Stable deps — isStreaming replaced by isStreamingRef, state replaced by stateRef.current.
    // registerComponent is safe to omit: created with useCallback(fn, []) in ComponentCatalogProvider
    // so it is referentially stable for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deploymentId, getAccessTokenSilently, dispatch]
  );

  const clearChatError = useCallback(() => setLastChatError(null), []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const editMessage = useCallback(
    async (messageId: string, newText: string) => {
      if (isStreamingRef.current) {
        abortRef.current?.abort();
        await new Promise((r) => setTimeout(r, 0));
      }
      // Use setter callback to avoid stale messages closure
      let found = false;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx === -1) return prev;
        found = true;
        return prev.slice(0, idx);
      });
      if (found) await sendMessage(newText);
    },
    [sendMessage]
  );

  const switchConversation = useCallback((id: string) => {
    if (isStreamingRef.current || id === activeConvRef.current) return;
    flushMessages(activeConvRef.current, messagesRef.current);
    const saved = loadConversationMessages(deploymentId, id);
    setMessages(saved);
    setActiveConversationId(id);
    const index = loadConversationIndex(deploymentId);
    index.activeId = id;
    saveConversationIndex(deploymentId, index);
    dispatch({ type: "CLEAR_CANVAS" });
  }, [deploymentId, dispatch, flushMessages]);

  const newConversation = useCallback(() => {
    if (isStreamingRef.current) return;
    flushMessages(activeConvRef.current, messagesRef.current);
    const meta = createConversation(deploymentId);
    const index = loadConversationIndex(deploymentId);
    setConversations([...index.conversations]);
    setActiveConversationId(meta.id);
    setMessages([]);
    dispatch({ type: "CLEAR_CANVAS" });
  }, [deploymentId, dispatch, flushMessages]);

  const removeConversation = useCallback((id: string) => {
    if (isStreamingRef.current) return;
    deleteConv(deploymentId, id);
    const index = loadConversationIndex(deploymentId);
    if (index.conversations.length === 0) {
      const meta = createConversation(deploymentId);
      const updated = loadConversationIndex(deploymentId);
      setConversations([...updated.conversations]);
      setActiveConversationId(meta.id);
      setMessages([]);
    } else {
      setConversations([...index.conversations]);
      if (activeConvRef.current === id) {
        const newActive = index.activeId ?? index.conversations[0]?.id ?? null;
        setActiveConversationId(newActive);
        if (newActive) {
          setMessages(loadConversationMessages(deploymentId, newActive));
        } else {
          setMessages([]);
        }
      }
    }
    dispatch({ type: "CLEAR_CANVAS" });
  }, [deploymentId, dispatch]);

  return {
    sendMessage,
    isStreaming,
    streamingCardIds,
    messages,
    streamingText,
    streamingReasoning,
    lastChatError,
    lastUserMessage,
    clearChatError,
    suggestions,
    stopGeneration,
    editMessage,
    conversations,
    activeConversationId,
    switchConversation,
    newConversation,
    deleteConversation: removeConversation,
  };
}

// ── Helper: create canvas card for UI blocks only ────────────────────────────

function addComponentCard(
  block: UIBlockPending,
  messageId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>,
  extraCards: CanvasCard[] = [],
  llmInfo: { provider?: string; model?: string } = {},
  parentCardId?: string | null
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
    llmProvider: llmInfo.provider,
    llmModel: llmInfo.model,
    groupId: block.dashboardId || undefined,
    parentCardId: parentCardId || undefined,
  };

  if (state.cards.length >= MAX_CANVAS_CARDS) {
    toast("Oldest card removed to stay within limit", { duration: 3000 });
  }

  dispatch({ type: "ADD_CARD", card });
  return card;
}

// ── Helper: summarize card props for rich canvas context ──────────────────────

/** Generate a concise metadata summary of a card's props for the bot's canvas context.
 *  Keeps output short (~20-60 chars per card) to avoid token bloat. */
function summarizeCardProps(card: CanvasCard): string {
  const p = card.props;
  const parts: string[] = [];

  switch (card.component) {
    case "chart": {
      if (p.type) parts.push(`type: ${p.type}`);
      if (Array.isArray(p.dataKeys)) parts.push(`keys: ${(p.dataKeys as string[]).join("/")}`);
      if (p.xAxisKey) parts.push(`x: ${p.xAxisKey}`);
      if (Array.isArray(p.data)) parts.push(`${p.data.length} points`);
      break;
    }
    case "data_table": {
      if (Array.isArray(p.columns)) parts.push(`cols: ${(p.columns as string[]).join("/")}`);
      if (Array.isArray(p.rows)) parts.push(`${p.rows.length} rows`);
      break;
    }
    case "metric_card":
    case "statistic": {
      if (p.label) parts.push(`label: ${p.label}`);
      if (p.value != null) parts.push(`value: ${p.value}`);
      break;
    }
    case "stat_grid": {
      if (Array.isArray(p.stats)) {
        const labels = (p.stats as Array<{ label?: string }>).map(s => s.label).filter(Boolean);
        parts.push(`stats: ${labels.join(", ")}`);
      }
      break;
    }
    case "card": {
      if (typeof p.body === "string" && p.body.length > 0) {
        parts.push(`${p.body.length} chars`);
      }
      break;
    }
    case "sandbox": {
      if (Array.isArray(p.libraries) && p.libraries.length > 0) {
        parts.push(`libs: ${(p.libraries as string[]).slice(0, 3).join(", ")}`);
      }
      if (p.moduleJs) parts.push("module");
      break;
    }
    case "list": {
      if (Array.isArray(p.items)) parts.push(`${p.items.length} items`);
      break;
    }
    case "progress": {
      if (p.value != null) parts.push(`${p.value}%`);
      break;
    }
    case "form": {
      if (Array.isArray(p.fields)) parts.push(`${p.fields.length} fields`);
      break;
    }
    case "tabs": {
      if (Array.isArray(p.tabs)) {
        const labels = (p.tabs as Array<{ label?: string }>).map(t => t.label).filter(Boolean);
        parts.push(`tabs: ${labels.join(", ")}`);
      }
      break;
    }
    default:
      break;
  }

  return parts.join(", ");
}

// ── Helper: extract current content from a card for bot context ───────────────

/** Get a snapshot of the card's current content to include when the user references it.
 *  For code/sandbox components, includes the full code. For others, includes key props.
 *  Truncates to avoid token bloat (max ~2000 chars). */
function getCardContentSnapshot(card: CanvasCard): string {
  const p = card.props;
  const MAX_CONTENT = 2000;

  switch (card.component) {
    case "code_block":
    case "code_editor": {
      const code = (p.code as string) || "";
      if (!code) return "";
      const truncated = code.length > MAX_CONTENT ? code.slice(0, MAX_CONTENT) + "\n...(truncated)" : code;
      const lang = (p.language as string) || "";
      return `\nCurrent code${lang ? ` (${lang})` : ""}:\n\`\`\`${lang}\n${truncated}\n\`\`\``;
    }
    case "sandbox": {
      const parts: string[] = [];
      const html = (p.html as string) || "";
      const css = (p.css as string) || "";
      const js = (p.moduleJs as string) || (p.js as string) || "";
      if (html) parts.push(`HTML:\n\`\`\`html\n${html.slice(0, MAX_CONTENT / 3)}\n\`\`\``);
      if (css) parts.push(`CSS:\n\`\`\`css\n${css.slice(0, MAX_CONTENT / 3)}\n\`\`\``);
      if (js) parts.push(`JS:\n\`\`\`javascript\n${js.slice(0, MAX_CONTENT / 3)}\n\`\`\``);
      return parts.length > 0 ? `\nCurrent content:\n${parts.join("\n")}` : "";
    }
    case "card": {
      const body = (p.body as string) || "";
      if (!body) return "";
      return `\nCurrent content:\n${body.slice(0, MAX_CONTENT)}`;
    }
    case "form": {
      // Include current field values if present
      const fields = p.fields as Array<{ name?: string; value?: unknown }> | undefined;
      if (!fields?.length) return "";
      const fieldSummary = fields
        .filter(f => f.value != null && f.value !== "")
        .map(f => `${f.name}: ${String(f.value).slice(0, 100)}`)
        .join(", ");
      return fieldSummary ? `\nCurrent values: ${fieldSummary}` : "";
    }
    default: {
      // For other components, include a compact JSON of props (truncated)
      const json = JSON.stringify(p);
      if (json.length <= 200) return `\nCurrent props: ${json}`;
      return "";
    }
  }
}
