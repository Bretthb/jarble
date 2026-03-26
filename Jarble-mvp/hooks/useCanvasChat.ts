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
  scheduleSyncToServer,
  mergeServerSessions,
} from "@/lib/conversationStorage";
import { trpc } from "@/lib/trpc";

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
const JARBLE_UI_FENCE = /```jarble_(?:ui(?:_update|_define)?|suggestions|design_context)\s*\n[\s\S]*?```/g;

/** Regex to strip raw component JSON that leaked into text (e.g. on abort before TOOL_CALL_END) */
const RAW_COMPONENT_JSON = /\{"component"\s*:\s*"[a-z_]+"\s*,\s*"props"\s*:\s*\{[\s\S]{50,}\}\s*\}/g;

/** Strip "Request was aborted." and similar gateway error messages from chat text */
const ABORT_MESSAGE_RE = /Request was aborted\.?\s*/gi;

function stripUIMarkers(text: string): string {
  return text
    .replace(JARBLE_UI_FENCE, "")
    .replace(RAW_COMPONENT_JSON, "")
    .replace(ABORT_MESSAGE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function useCanvasChat(
  deploymentId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>,
  liveStatus?: string,
  onStreamEnd?: () => void,
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
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [activeAgentCall, setActiveAgentCall] = useState<{ serviceId: string; skillName: string; agentName?: string } | null>(null);
  const [orchestrationSteps, setOrchestrationSteps] = useState<Array<import("@/components/chat/OrchestrationSteps").OrchestrationStep>>([]);
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
  // reasoningRafIdRef removed — merged into single rafIdRef loop
  // Resolve function: called by the typewriter tick when it catches up to the
  // final target text after the stream has ended. This lets the typewriter finish
  // its reveal animation instead of jumping to the end. The corresponding Promise
  // is awaited in finally{} so streaming state isn't cleared prematurely.
  const typewriterDoneRef = useRef<(() => void) | null>(null);
  // Design intent tracking — persists style choices across the session
  const designContextRef = useRef<Record<string, unknown> | null>(null);
  const CHARS_PER_FRAME = 8; // ~480 chars/sec at 60fps — fast but visible
  // Track current run's LLM provider/model from RUN_STARTED event (ref avoids stale closure)
  const currentLlmRef = useRef<{ provider?: string; model?: string }>({});
  // Track which card was selected when the user sent the message (for provenance linking)
  const selectedCardRef = useRef<string | null>(null);
  // Track edit mode — when set, the next TOOL_CALL_END with matching component type
  // updates the card in-place instead of creating a new one
  const editModeRef = useRef<{ cardId: string; component: string } | null>(null);

  // Server sync mutation (fire-and-forget — localStorage is the fast path)
  const syncMutation = trpc.deployment.syncChatSession.useMutation();
  const syncToServer = useCallback(async (sessionId: string, title: string, msgs: ChatMessage[]) => {
    try {
      await syncMutation.mutateAsync({
        deploymentId,
        sessionId,
        title,
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          thinkingText: m.reasoning,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      isDev && console.warn("[ChatSync] Server sync failed:", err);
    }
  }, [deploymentId, syncMutation]);

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
    // Schedule debounced server sync
    scheduleSyncToServer(deploymentId, convId, syncToServer);
  }, [deploymentId, syncToServer]);

  // Server sessions query — fetches once on mount for merge
  const serverSessionsQuery = trpc.deployment.listChatSessions.useQuery(
    { deploymentId },
    { staleTime: Infinity, refetchOnWindowFocus: false }
  );

  // Server messages query — refetches when activeConversationId changes
  const serverMessagesQuery = trpc.deployment.getChatMessages.useQuery(
    { sessionId: activeConversationId!, deploymentId },
    {
      enabled: !!activeConversationId && !!deploymentId,
      staleTime: 5_000, // Short stale time so server responses appear quickly after disconnect
      refetchOnWindowFocus: true, // Refetch when user returns to the tab
      refetchInterval: 10_000, // Poll every 10s to catch bot responses that completed while away
    }
  );

  // Load conversation index + migrate legacy on mount.
  // If localStorage is empty, wait for server sessions before creating a new conversation.
  // This prevents generating a new session key when conversations exist server-side
  // (which would cause OpenClaw to lose its memory/workspace).
  const serverSessionsLoaded = serverSessionsQuery.isSuccess;
  useEffect(() => {
    if (hasLoadedHistory.current) return;
    migrateFromLegacy(deploymentId);
    let index = loadConversationIndex(deploymentId);

    if (index.conversations.length === 0) {
      // No local conversations — check if server has any before creating new
      if (!serverSessionsLoaded) return; // Wait for server query to resolve

      const serverSessions = serverSessionsQuery.data || [];
      if (serverSessions.length > 0) {
        // Server has conversations — merge them into localStorage first
        const merged = mergeServerSessions(deploymentId, serverSessions as unknown as Array<{ id: string; title: string; createdAt: string; updatedAt: string }>);
        index = merged;
      } else {
        // Neither local nor server has conversations — create a fresh one
        createConversation(deploymentId);
        index = loadConversationIndex(deploymentId);
      }
    }

    hasLoadedHistory.current = true;
    setConversations(index.conversations);
    const activeId = index.activeId ?? index.conversations[0]?.id ?? null;
    setActiveConversationId(activeId);
    if (activeId) {
      const saved = loadConversationMessages(deploymentId, activeId);
      if (saved.length > 0) {
        setMessages(saved);
        messagesRef.current = saved;
        // If the last message is from the user and recent (< 5 min), the bot may still
        // be generating a response server-side. Show the pulsating cursor until the
        // server merge brings in the assistant response.
        const lastMsg = saved[saved.length - 1];
        if (lastMsg?.role === "user" && Date.now() - lastMsg.createdAt < 5 * 60 * 1000) {
          setIsStreaming(true);
          isStreamingRef.current = true;
        }
      }
    }
  }, [deploymentId, serverSessionsLoaded, serverSessionsQuery.data]);

  // Merge server messages when they arrive — server is source of truth for messages
  // that completed after client disconnect. Show localStorage immediately (above),
  // then merge server data if it has more messages.
  const lastMergedConvRef = useRef<string | null>(null);
  useEffect(() => {
    const convId = activeConversationId;
    if (!convId || !serverMessagesQuery.data || isStreamingRef.current) return;
    // Only merge once per conversation per fetch (avoid re-merging on every render)
    const mergeKey = `${convId}:${serverMessagesQuery.dataUpdatedAt}`;
    if (lastMergedConvRef.current === mergeKey) return;
    lastMergedConvRef.current = mergeKey;

    const serverMsgs = serverMessagesQuery.data;
    if (serverMsgs.length === 0) return;

    // Convert server messages to ChatMessage format
    // Strip [CANVAS_STATE]...[/CANVAS_STATE] prefix from user messages — it's metadata
    // for the bot, not meant for display.
    const stripCanvasState = (text: string) =>
      text.replace(/\[CANVAS_STATE\][\s\S]*?\[\/CANVAS_STATE\]\s*/g, "").trim();

    const converted: ChatMessage[] = serverMsgs.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.role === "user" ? stripCanvasState(m.content) : m.content,
      createdAt: new Date(m.createdAt).getTime(),
      ...(m.thinkingText ? { reasoning: m.thinkingText } : {}),
    }));

    // Use the LONGER of server vs current messages — server may have a bot response
    // that completed after the client disconnected
    const currentMsgs = messagesRef.current;
    if (converted.length > currentMsgs.length) {
      isDev && console.log(
        `[Jarble:Chat] Server has ${converted.length} messages vs ${currentMsgs.length} local — using server`
      );

      // Extract component blocks from new assistant messages and render on canvas.
      // During live streaming, SSE TOOL_CALL events handle this. For persisted messages
      // loaded from the server, we parse the raw text for component JSON blocks.
      const newMsgs = converted.slice(currentMsgs.length);
      for (const msg of newMsgs) {
        if (msg.role !== "assistant") continue;
        const componentMatches = msg.content.matchAll(/\{"component"\s*:\s*"([a-z_]+)"\s*,\s*"props"\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*"layout_hint"\s*:\s*"([^"]*)")?\s*\}/g);
        for (const match of componentMatches) {
          try {
            const parsed = JSON.parse(match[0]);
            const block = {
              id: `server-${msg.id}-${parsed.component}`,
              component: parsed.component,
              props: parsed.props || {},
              layoutHint: parsed.layout_hint,
            };
            addComponentCard(
              block as any,
              msg.id,
              stateRef.current,
              dispatch,
              [],
              currentLlmRef.current,
            );
          } catch { /* skip unparseable blocks */ }
        }
        // Strip component JSON from displayed text
        msg.content = stripUIMarkers(msg.content);
      }

      setMessages(converted);
      messagesRef.current = converted;
      // Update localStorage so it's in sync with server
      saveConversationMessages(deploymentId, convId, converted);
      // If we were showing the pulsating cursor (waiting for server response),
      // clear it now that the bot response has arrived
      if (isStreamingRef.current && !abortRef.current) {
        setIsStreaming(false);
        isStreamingRef.current = false;
      }
    }

    // If still showing the "waiting" cursor but the last server message is from the user
    // and it's been > 5 min, stop waiting (bot timed out or failed)
    if (isStreamingRef.current && !abortRef.current) {
      const lastServerMsg = converted[converted.length - 1];
      if (lastServerMsg?.role === "user" && Date.now() - lastServerMsg.createdAt > 5 * 60 * 1000) {
        setIsStreaming(false);
        isStreamingRef.current = false;
      }
    }
  }, [deploymentId, activeConversationId, serverMessagesQuery.data, serverMessagesQuery.dataUpdatedAt]);

  // Merge server sessions after they load (runs once)
  const hasMergedServer = useRef(false);
  useEffect(() => {
    if (hasMergedServer.current || !serverSessionsQuery.data) return;
    hasMergedServer.current = true;
    const serverSessions = serverSessionsQuery.data;
    if (serverSessions.length === 0) return;
    const merged = mergeServerSessions(deploymentId, serverSessions as unknown as Array<{ id: string; title: string; createdAt: string; updatedAt: string }>);
    setConversations(merged.conversations);
  }, [deploymentId, serverSessionsQuery.data]);

  // Debounced save messages to conversation storage.
  // On unmount: also captures any in-flight streaming text as an assistant message
  // so the bot's response survives page navigation mid-stream.
  useEffect(() => {
    if (!hasLoadedHistory.current || messages.length === 0 || !activeConversationId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushMessages(activeConvRef.current, messages);
    }, 500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      // Build the final message list — append in-flight streaming text if active
      let finalMessages = messagesRef.current;
      if (isStreamingRef.current && targetTextRef.current) {
        const cleanText = stripUIMarkers(targetTextRef.current);
        if (cleanText) {
          finalMessages = [
            ...finalMessages,
            {
              id: `unmount-${Date.now()}`,
              role: "assistant" as const,
              content: cleanText,
              createdAt: Date.now(),
              ...(targetReasoningRef.current ? { reasoning: targetReasoningRef.current } : {}),
            },
          ];
          isDev && console.log(`[Jarble:Chat] Unmount: capturing in-flight response (${cleanText.length} chars)`);
        }
      }

      const convId = activeConvRef.current;
      if (convId && finalMessages.length > 0) {
        saveConversationMessages(deploymentId, convId, finalMessages);
      }
    };
  }, [deploymentId, messages, activeConversationId, flushMessages]);

  // Clear card animation timers and rAF on unmount, abort in-flight requests
  useEffect(() => {
    return () => {
      cardTimersRef.current.forEach(clearTimeout);
      cardTimersRef.current = [];
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      abortRef.current?.abort();
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

      // Debug intent detection: if user is asking about debugging + card is selected,
      // append structured debug context so the bot can call debug_component
      const DEBUG_INTENT_RE = /\b(debug|diagnose|fix|broken|not working|won'?t render|fails?|error|what'?s wrong|why isn'?t)\b/i;
      if (selectedCard && DEBUG_INTENT_RE.test(text)) {
        const debugLines = [`[DEBUG_CONTEXT cardId=${selectedCard.id} component=${selectedCard.component}]`];
        // Include props (truncated to 2KB)
        const propsJson = JSON.stringify(selectedCard.props);
        debugLines.push(`Props: ${propsJson.length > 2048 ? propsJson.slice(0, 2048) + "..." : propsJson}`);
        if (selectedCard.lastRenderError) {
          debugLines.push(`Render Error: ${selectedCard.lastRenderError}`);
        }
        if (selectedCard.cspViolations?.length) {
          debugLines.push(`CSP Violations: ${JSON.stringify(selectedCard.cspViolations)}`);
        }
        messageToSend += `\n${debugLines.join("\n")}`;
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

        // Include design context if the bot has established style preferences
        if (designContextRef.current && Object.keys(designContextRef.current).length > 0) {
          const dcJson = JSON.stringify(designContextRef.current);
          messageToSend = `[DESIGN_CONTEXT]\n${dcJson}\n[/DESIGN_CONTEXT]\n${messageToSend}`;
        }
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
      setToolStatus(null); // Clear tool status from previous run
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

      // Predictive orchestration: detect component-like requests and show agent steps
      // immediately so the user sees activity during the 10-60s bot generation time
      const COMPONENT_INTENT_RE = /\b(create|make|build|generate|render|show|drop|design|compose)\b.*\b(landing\s*page|dashboard|chart|table|form|card|component|widget|page|visualization|3d|graph|site|website|app|layout|sandbox)\b/i;
      const DASHBOARD_INTENT_RE = /\b(dashboard|analytics|overview|report|metrics|kpi)\b/i;
      if (!isActionMessage && COMPONENT_INTENT_RE.test(text)) {
        const isDashboard = DASHBOARD_INTENT_RE.test(text);
        const steps: typeof orchestrationSteps = [
          { id: "think", label: "Analyzing request", status: "running", agent: "planner" },
        ];
        if (isDashboard) {
          steps.push({ id: "plan", label: "Planning dashboard layout", status: "pending", agent: "planner" });
          steps.push({ id: "gen", label: "Generating components", status: "pending", agent: "component" });
          steps.push({ id: "qa", label: "Running QA validation", status: "pending", agent: "qa" });
        } else {
          steps.push({ id: "gen", label: "Generating component", status: "pending", agent: "component" });
          steps.push({ id: "render", label: "Rendering on canvas", status: "pending", agent: "tool" });
        }
        setOrchestrationSteps(steps);

        // Progress the steps over time to show activity
        const t1 = setTimeout(() => {
          setOrchestrationSteps((prev) => prev.map((s) =>
            s.id === "think" ? { ...s, status: "complete" as const, duration: 2000 } :
            s.id === "plan" || s.id === "gen" ? { ...s, status: "running" as const } : s
          ));
        }, 2000);
        const t2 = setTimeout(() => {
          setOrchestrationSteps((prev) => prev.map((s) =>
            s.id === "plan" ? { ...s, status: "complete" as const, duration: 3000 } :
            s.id === "gen" ? { ...s, status: "running" as const } : s
          ));
        }, 5000);
        cardTimersRef.current.push(t1, t2);
      }

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

        // Capture canvas screenshot if cards or strokes exist (bot can see what's rendered)
        let canvasImage: string | undefined;
        if (!isActionMessage && (currentState.cards.length > 0 || currentState.strokes.length > 0)) {
          try {
            // Dynamic import to avoid loading html2canvas until needed
            const el = document.querySelector("[data-jarble-canvas]") as HTMLElement | null;
            if (el) {
              const { default: html2canvas } = await import("html2canvas");
              const canvas = await html2canvas(el, {
                useCORS: true,
                allowTaint: false,
                scale: 0.4, // Low resolution to keep image small for LLM
                logging: false,
                backgroundColor: null,
              });
              canvasImage = canvas.toDataURL("image/jpeg", 0.6);
              isDev && console.log(`[Jarble:Chat] Captured canvas screenshot (${Math.round(canvasImage.length / 1024)}KB)`);
            }
          } catch (err) {
            isDev && console.warn("[Jarble:Chat] Canvas screenshot capture failed:", err);
          }
        }

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
            ...(canvasImage ? { canvasImage } : {}),
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

        // Merged typewriter reveal: single rAF loop advances both text + reasoning
        // React 18+ batches setState calls within the same synchronous scope into one render,
        // so this halves renders from ~120/sec to ~60/sec when both streams are active.
        function scheduleTypewriter() {
          if (rafIdRef.current !== null) return; // already scheduled
          function tick() {
            let needsMore = false;

            // Advance text
            const textTarget = targetTextRef.current;
            if (displayedLenRef.current < textTarget.length) {
              displayedLenRef.current = Math.min(displayedLenRef.current + CHARS_PER_FRAME, textTarget.length);
              setStreamingText(textTarget.slice(0, displayedLenRef.current));
              needsMore = displayedLenRef.current < textTarget.length;
            }

            // Advance reasoning
            const reasoningTarget = targetReasoningRef.current;
            if (displayedReasoningLenRef.current < reasoningTarget.length) {
              displayedReasoningLenRef.current = Math.min(displayedReasoningLenRef.current + CHARS_PER_FRAME, reasoningTarget.length);
              setStreamingReasoning(reasoningTarget.slice(0, displayedReasoningLenRef.current));
              needsMore = needsMore || displayedReasoningLenRef.current < reasoningTarget.length;
            }

            if (needsMore) {
              rafIdRef.current = requestAnimationFrame(tick);
            } else {
              rafIdRef.current = null;
              // If the stream has ended and the typewriter has caught up, fire the done callback
              if (typewriterDoneRef.current) {
                const cb = typewriterDoneRef.current;
                typewriterDoneRef.current = null;
                cb();
              }
            }
          }
          rafIdRef.current = requestAnimationFrame(tick);
        }

        function scheduleTextUpdate(text: string) {
          targetTextRef.current = text;
          scheduleTypewriter();
        }

        function scheduleReasoningUpdate(text: string) {
          targetReasoningRef.current = text;
          scheduleTypewriter();
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

              // ── Orchestration tracking for multi-agent tools ──
              if (event.type === "TOOL_CALL_START" && event.toolCallName) {
                const toolName = event.toolCallName;
                const toolId = event.toolCallId || toolName;

                if (toolName === "compose_dashboard") {
                  // Derive steps from tool args (components array)
                  const steps: typeof orchestrationSteps = [
                    { id: `${toolId}-plan`, label: "Planning dashboard layout", status: "running", agent: "planner" },
                  ];
                  // Parse component intents from args if available
                  try {
                    const args = event.argsPreview ? JSON.parse(event.argsPreview) : null;
                    if (args?.components && Array.isArray(args.components)) {
                      for (let ci = 0; ci < args.components.length; ci++) {
                        const intent = args.components[ci].intent || `Component ${ci + 1}`;
                        steps.push({
                          id: `${toolId}-comp-${ci}`,
                          label: intent.length > 50 ? intent.slice(0, 47) + "..." : intent,
                          status: "pending",
                          agent: "component",
                        });
                      }
                    }
                  } catch { /* args not available yet */ }
                  steps.push({ id: `${toolId}-qa`, label: "Running QA validation", status: "pending", agent: "qa" });
                  setOrchestrationSteps(steps);

                  // Simulate step progression (planner ~2s, then components parallel ~5s, then QA)
                  const planTimer = setTimeout(() => {
                    setOrchestrationSteps((prev) => prev.map((s) =>
                      s.id === `${toolId}-plan`
                        ? { ...s, status: "complete", duration: 2500 }
                        : s.agent === "component" ? { ...s, status: "running" } : s
                    ));
                  }, 2500);
                  const compTimer = setTimeout(() => {
                    setOrchestrationSteps((prev) => prev.map((s) =>
                      s.agent === "component" ? { ...s, status: "complete", duration: 4000 } :
                      s.agent === "qa" ? { ...s, status: "running" } : s
                    ));
                  }, 6500);
                  const qaTimer = setTimeout(() => {
                    setOrchestrationSteps((prev) => prev.map((s) =>
                      s.agent === "qa" ? { ...s, status: "complete", duration: 200 } : s
                    ));
                  }, 7000);
                  cardTimersRef.current.push(planTimer, compTimer, qaTimer);

                } else if (toolName === "create_component") {
                  setOrchestrationSteps([
                    { id: `${toolId}-create`, label: "Component Agent generating...", status: "running", agent: "component",
                      detail: event.argsPreview ? (JSON.parse(event.argsPreview).intent || "").slice(0, 60) : undefined },
                  ]);

                } else if (toolName === "debug_component") {
                  setOrchestrationSteps([
                    { id: `${toolId}-debug`, label: "Diagnosing component", status: "running", agent: "debug" },
                  ]);

                } else if (toolName === "test_dashboard") {
                  setOrchestrationSteps([
                    { id: `${toolId}-test`, label: "Testing all dashboard components", status: "running", agent: "qa" },
                  ]);
                }
              }

              // Mark orchestration steps as complete on each TOOL_CALL_END
              if (event.type === "TOOL_CALL_END" && event.toolCallId) {
                setOrchestrationSteps((prev) => {
                  if (prev.length === 0) return prev;
                  const updated = prev.map((s) =>
                    s.id === `render-${event.toolCallId}` ? { ...s, status: "complete" as const } :
                    s.id === "render" ? { ...s, status: "complete" as const, duration: Date.now() - streamStart } : s
                  );
                  // If all steps complete, clear after delay
                  if (updated.every((s) => s.status === "complete")) {
                    const clearTimer = setTimeout(() => setOrchestrationSteps([]), 3000);
                    cardTimersRef.current.push(clearTimer);
                  }
                  return updated;
                });
              }

              // ── AG-UI TOOL_CALL events (component rendering as tool calls) ──
              if (event.type === "TOOL_CALL_START" && event.toolCallName?.startsWith("show_")) {
                const component = event.toolCallName.slice(5); // "show_chart" -> "chart"
                const blockId = event.toolCallId;
                blockStartTimes.set(blockId, Date.now());
                // Transition predictive orchestration: gen→complete, render→running
                setOrchestrationSteps((prev) => {
                  if (prev.length === 0) return prev;
                  return prev.map((s) =>
                    s.id === "gen" ? { ...s, status: "complete" as const, duration: Date.now() - streamStart } :
                    s.id === "render" ? { ...s, status: "running" as const } :
                    s.id === "qa" && s.status === "pending" as any ? { ...s, status: "complete" as const, duration: 200 } : s
                  );
                });
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
                    if (card) {
                      cardsAddedThisStream.push(card);
                      // Auto-open page components in fullscreen
                      if (block.component === "page") {
                        dispatch({ type: "OPEN_PAGE_FULLSCREEN", id: card.id });
                      }
                    }
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
                // Orchestration steps from the API (exec path — blocks about to render)
                if (event.name === "jarble.orchestration.steps" && event.value?.steps) {
                  const steps = (event.value.steps as Array<{ id: string; label: string; status: string; agent: string }>).map((s, i) => ({
                    ...s,
                    status: "running" as const,
                    agent: (s.agent || "tool") as any,
                  }));
                  setOrchestrationSteps(steps);
                  isDev && console.log(`[Jarble:Chat] Orchestration: ${steps.length} steps`);
                }
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
                if (event.name === "jarble.tool.status" && event.value?.status) {
                  isDev && console.log(`[Jarble:Chat] Tool status: ${event.value.status}`);
                  setToolStatus(event.value.status as string);
                }
                if (event.name === "jarble.agent.call.start" && event.value) {
                  isDev && console.log(`[Jarble:Chat] Agent call started: ${event.value.skillName} on ${event.value.serviceId}`);
                  setActiveAgentCall({
                    serviceId: event.value.serviceId as string,
                    skillName: event.value.skillName as string,
                    agentName: event.value.agentName as string | undefined,
                  });
                }
                if (event.name === "jarble.agent.call.end" && event.value) {
                  isDev && console.log(`[Jarble:Chat] Agent call ended: ${event.value.skillName} (${event.value.creditsCharged} credits)`);
                  setActiveAgentCall(null);
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
                if (event.name === "jarble.design.context" && event.value) {
                  isDev && console.log("[Jarble:Chat] Design context updated:", event.value);
                  designContextRef.current = event.value as Record<string, unknown>;
                }
                if (event.name === "jarble.clear_chat") {
                  // /clear command — reset messages and canvas
                  setMessages([]);
                  messagesRef.current = [];
                  dispatch({ type: "CLEAR_CANVAS" });
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

        // Let the typewriter finish its reveal animation before finalizing.
        // If text arrived in a few large chunks, the rAF loop may still be
        // animating. We create a promise that resolves once the typewriter
        // catches up, then await it in finally{} so streaming state isn't
        // cleared before the user sees the full progressive text reveal.
        const cleanText = stripUIMarkers(accumulatedText);
        const addAssistantMessage = () => {
          if (cleanText) {
            const assistantMsg: ChatMessage = {
              id: `${messageId}-assistant`,
              role: "assistant",
              content: cleanText,
              createdAt: Date.now(),
              ...(reasoningText ? { reasoning: reasoningText } : {}),
            };
            // Write to ref synchronously so unmount cleanup always has the latest messages
            // (React's setMessages is batched — may not flush before cleanup runs on navigate)
            messagesRef.current = [...messagesRef.current, assistantMsg];
            setMessages((prev) => [...prev, assistantMsg]);
          }
        };

        if (rafIdRef.current !== null) {
          // Typewriter is still animating — wait for it to catch up.
          // The tick() function calls typewriterDoneRef.current when needsMore becomes false.
          await new Promise<void>((resolve) => {
            typewriterDoneRef.current = resolve;
          });
        }
        // Typewriter caught up — flush final text and add the message
        setStreamingText(cleanText);
        setStreamingReasoning(reasoningText);
        addAssistantMessage();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          isDev && console.log(`[Jarble:Chat] SSE aborted after ${Date.now() - streamStart}ms`);
          const cleanText = stripUIMarkers(accumulatedText);
          if (cleanText) {
            const assistantMsg: ChatMessage = {
              id: `${messageId}-assistant`,
              role: "assistant",
              content: cleanText,
              createdAt: Date.now(),
              ...(reasoningText ? { reasoning: reasoningText } : {}),
            };
            messagesRef.current = [...messagesRef.current, assistantMsg];
            setMessages((prev) => [...prev, assistantMsg]);
          }
          return;
        }
        console.error(`[Jarble:Chat] SSE error: ${err instanceof Error ? err.message : String(err)}`);
        const errorMsg: ChatMessage = {
          id: `${messageId}-error`,
          role: "assistant",
          content: "Something went wrong. Please try again.",
          createdAt: Date.now(),
        };
        messagesRef.current = [...messagesRef.current, errorMsg];
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        // Only clear streaming state if this is still the active request.
        // The generation check prevents the abort race: when request A is aborted
        // and request B starts, A's finally must not clear B's streaming state.
        if (generationRef.current === generation) {
          // In the happy path the typewriter has already finished (we awaited
          // its promise in the try block). In error/abort paths it may still
          // be running — cancel it to prevent stale updates.
          typewriterDoneRef.current = null;
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }
          isStreamingRef.current = false;
          editModeRef.current = null;
          setIsStreaming(false);
          setStreamingText("");
          setStreamingReasoning("");
          setStreamingCardIds(new Set());
          setToolStatus(null);
          setActiveAgentCall(null);
          setOrchestrationSteps([]);
          onStreamEnd?.();
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

  // Auto-diagnose when a diagnosable chat error occurs — inject result as chat message
  const hasDiagnosedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastChatError?.canDiagnose) return;
    // Only diagnose once per error instance
    if (hasDiagnosedRef.current === lastChatError.code + lastChatError.message) return;
    hasDiagnosedRef.current = lastChatError.code + lastChatError.message;

    // Add a "diagnosing..." message immediately
    const diagMsgId = `diag-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: diagMsgId,
        role: "assistant",
        content: "🔍 Running diagnostics...",
        createdAt: Date.now(),
      },
    ]);

    (async () => {
      try {
        const token = await getAccessTokenSilently();
        const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/diagnose`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Format diagnosis as a readable chat message
        const healthEmoji = data.overallHealth === "healthy" ? "✅" : data.overallHealth === "degraded" ? "⚠️" : "❌";
        const lines = [`${healthEmoji} **Diagnosis: ${data.overallHealth}**`, ""];
        for (const check of data.checks) {
          const icon = check.status === "ok" ? "✅" : check.status === "warning" ? "⚠️" : check.status === "error" ? "❌" : "⏭️";
          lines.push(`${icon} **${check.name}**: ${check.detail}`);
          if (check.suggestion) lines.push(`   → ${check.suggestion}`);
        }

        // Replace the "diagnosing..." message with results
        setMessages((prev) =>
          prev.map((m) =>
            m.id === diagMsgId
              ? { ...m, content: lines.join("\n") }
              : m
          )
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === diagMsgId
              ? { ...m, content: `Diagnosis failed: ${err instanceof Error ? err.message : String(err)}` }
              : m
          )
        );
      }
    })();
  }, [lastChatError, deploymentId, getAccessTokenSilently]);

  // Auto-diagnose after bot lifecycle transitions (restart/start → running)
  const prevStatusRef = useRef<string | undefined>(liveStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = liveStatus;

    // Only trigger on transitions TO "running" FROM a non-running state
    if (liveStatus !== "running" || prev === "running" || !prev) return;

    const action = prev === "restarting" || prev === "reloading" ? "restarted" : prev === "stopped" || prev === "creating" ? "started" : "recovered";

    // Wait for the pod to settle before diagnosing
    const diagMsgId = `lifecycle-diag-${Date.now()}`;
    setMessages((msgs) => [
      ...msgs,
      {
        id: diagMsgId,
        role: "assistant",
        content: `🔄 Bot ${action}. Checking health...`,
        createdAt: Date.now(),
      },
    ]);
    // Also clear any previous error since the bot is now running
    setLastChatError(null);

    const timer = setTimeout(async () => {
      try {
        const token = await getAccessTokenSilently();
        const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/diagnose`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const healthEmoji = data.overallHealth === "healthy" ? "✅" : data.overallHealth === "degraded" ? "⚠️" : "❌";
        const lines = [`🔄 Bot ${action}. ${healthEmoji} **Health: ${data.overallHealth}**`, ""];

        // Only show non-ok checks to keep it concise
        const issues = data.checks.filter((c: any) => c.status !== "ok");
        if (issues.length === 0) {
          lines.push("All systems operational — your bot is ready to go.");
        } else {
          for (const check of issues) {
            const icon = check.status === "warning" ? "⚠️" : "❌";
            lines.push(`${icon} **${check.name}**: ${check.detail}`);
            if (check.suggestion) lines.push(`   → ${check.suggestion}`);
          }
        }

        setMessages((msgs) =>
          msgs.map((m) => m.id === diagMsgId ? { ...m, content: lines.join("\n") } : m)
        );
      } catch {
        setMessages((msgs) =>
          msgs.map((m) => m.id === diagMsgId ? { ...m, content: `🔄 Bot ${action}. Health check unavailable.` } : m)
        );
      }
    }, 3000); // 3s delay to let pod settle

    return () => clearTimeout(timer);
  }, [liveStatus, deploymentId, getAccessTokenSilently]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const editMessage = useCallback(
    async (messageId: string, newText: string) => {
      if (isStreamingRef.current) {
        abortRef.current?.abort();
        await new Promise((r) => setTimeout(r, 0));
      }
      // Compute truncated list directly and update ref before sendMessage
      const current = messagesRef.current;
      const idx = current.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      const truncated = current.slice(0, idx);
      messagesRef.current = truncated;
      setMessages(truncated);
      await sendMessage(newText);
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
    // Canvas save/restore handled by useCanvasPersistence on conversationId change
  }, [deploymentId, flushMessages]);

  const newConversation = useCallback(() => {
    if (isStreamingRef.current) return;
    flushMessages(activeConvRef.current, messagesRef.current);
    const meta = createConversation(deploymentId);
    const index = loadConversationIndex(deploymentId);
    setConversations([...index.conversations]);
    setActiveConversationId(meta.id);
    setMessages([]);
    // Canvas save/restore handled by useCanvasPersistence on conversationId change
  }, [deploymentId, flushMessages]);

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
    toolStatus,
    activeAgentCall,
    orchestrationSteps,
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
