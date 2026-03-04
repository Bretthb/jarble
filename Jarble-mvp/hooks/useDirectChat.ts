"use client";

/**
 * useDirectChat — Slim streaming hook for direct bot chat via SSE.
 *
 * Handles text deltas and UI blocks from the pod proxy.
 * No tool call handling (management goes through Tambo).
 */

import { useState, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

const isDev = process.env.NODE_ENV === "development";

export interface UIBlock {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
}

export interface DirectChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  uiBlocks?: UIBlock[];
  /** Optional friendly text shown in chat instead of raw content (e.g. action relay messages) */
  displayText?: string;
  /** If true, this message is an action relay — styled more compactly in chat */
  isActionRelay?: boolean;
}

/** Regex to strip ```jarble_ui ... ``` and ```jarble_ui_update ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui(?:_update)?\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

const MAX_HISTORY = 50; // Cap sent history to prevent unbounded context growth

export function useDirectChat(deploymentId: string) {
  const { getAccessTokenSilently } = useAuth0();
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Ref-based guards to keep sendMessage deps stable
  const isStreamingRef = useRef(false);
  const messagesRef = useRef<DirectChatMessage[]>([]);
  messagesRef.current = messages;

  const sendMessage = useCallback(
    async (text: string, displayText?: string) => {
      if (!text.trim() || isStreamingRef.current) return;

      const userMsg: DirectChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        ...(displayText ? { displayText, isActionRelay: true } : {}),
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: DirectChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      isStreamingRef.current = true;
      setIsStreaming(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const streamStart = Date.now();
      let eventCount = 0;
      let textContentCount = 0;

      try {
        const token = await getAccessTokenSilently();
        // Use messagesRef.current for the latest messages (avoids stale closure on rapid sends)
        // Cap history to prevent unbounded context window growth
        const historyForApi = [...messagesRef.current, userMsg]
          .slice(-MAX_HISTORY)
          .map((m) => ({ role: m.role, content: m.content }));

        const url = `${API_URL}/api/tambo-agent`;
        isDev && console.log(`[Jarble:DirectChat] SSE connecting to ${url} for deployment ${deploymentId}`);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ deploymentId, messages: historyForApi }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          console.error(`[Jarble:DirectChat] SSE error: HTTP ${res.status} — ${errText.slice(0, 200)}`);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: `Error: ${errText}` } : m
            )
          );
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        isDev && console.log("[Jarble:DirectChat] SSE connected, streaming...");
        const decoder = new TextDecoder();
        let buffer = "";
        const pendingBlocks = new Map<string, UIBlock>();

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
                if (isDev && textContentCount % 5 === 0) {
                  console.log(`[Jarble:DirectChat] SSE event: TEXT_MESSAGE_CONTENT (x${textContentCount})`);
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + event.delta } : m
                  )
                );
              } else if (isDev && event.type !== "TEXT_MESSAGE_CONTENT") {
                console.log(`[Jarble:DirectChat] SSE event: ${event.type}`);
              }

              // ── AG-UI TOOL_CALL events (component rendering as tool calls) ──
              if (event.type === "TOOL_CALL_START" && event.toolCallName?.startsWith("show_")) {
                const component = event.toolCallName.slice(5); // "show_chart" -> "chart"
                const blockId = event.toolCallId;
                pendingBlocks.set(blockId, {
                  id: `card-${blockId}`,
                  component,
                  props: {},
                  ...(event.editable ? { editable: true } : {}),
                  ...(event.fileId ? { fileId: event.fileId } : {}),
                  ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
                });
              }

              if (event.type === "TOOL_CALL_ARGS" && event.toolCallId) {
                const block = pendingBlocks.get(event.toolCallId);
                if (block && event.delta) {
                  try {
                    block.props = JSON.parse(event.delta);
                  } catch {
                    isDev && console.warn(`[Jarble:DirectChat] Failed to parse TOOL_CALL_ARGS delta`);
                  }
                }
              }

              if (event.type === "TOOL_CALL_END" && event.toolCallId) {
                const block = pendingBlocks.get(event.toolCallId);
                if (block) {
                  const completed = { ...block };
                  isDev && console.log(`[Jarble:DirectChat] UI block completed: ${block.id} (${block.component})`);
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantId) return m;
                      return {
                        ...m,
                        content: stripUIMarkers(m.content),
                        uiBlocks: [...(m.uiBlocks || []), completed],
                      };
                    })
                  );
                  pendingBlocks.delete(event.toolCallId);
                }
              }

              // ── AG-UI CUSTOM events ──
              if (event.type === "CUSTOM" && event.name === "jarble.card.update" && event.value) {
                const { cardId, props, merge, component } = event.value;
                isDev && console.log(`[Jarble:DirectChat] Card updated: ${cardId} (merge=${merge ?? true})`);
                setMessages((prev) =>
                  prev.map((m) => {
                    if (!m.uiBlocks) return m;
                    const hasTarget = m.uiBlocks.some((b) => b.id === cardId);
                    if (!hasTarget) return m;
                    return {
                      ...m,
                      uiBlocks: m.uiBlocks.map((b) => {
                        if (b.id !== cardId) return b;
                        const newProps = (merge ?? true) ? { ...b.props, ...props } : props;
                        return {
                          ...b,
                          props: newProps,
                          ...(component ? { component } : {}),
                        };
                      }),
                    };
                  })
                );
              }

              if (event.type === "RUN_FINISHED") break outer;
            } catch {
              isDev && console.warn(`[Jarble:DirectChat] Failed to parse SSE event data: ${trimmed.slice(0, 200)}`);
            }
          }
        }

        isDev && console.log(`[Jarble:DirectChat] SSE stream ended (${eventCount} events, ${Date.now() - streamStart}ms)`);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          isDev && console.log(`[Jarble:DirectChat] SSE aborted after ${Date.now() - streamStart}ms`);
          return;
        }
        console.error(`[Jarble:DirectChat] SSE error: ${err instanceof Error ? err.message : String(err)}`);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Something went wrong. Please try again." }
              : m
          )
        );
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    },
    // Stable deps — isStreaming replaced by isStreamingRef, messages replaced by messagesRef
    [deploymentId, getAccessTokenSilently]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isStreaming, sendMessage, clearMessages };
}
