"use client";

/**
 * useDirectChat — Slim streaming hook for direct bot chat via SSE.
 *
 * Handles text deltas and UI blocks from the pod proxy.
 * No tool call handling (management goes through Tambo).
 * ~100 lines vs the 337 in useAgentChat.
 */

import { useState, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

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
}

/** Regex to strip ```jarble_ui ... ``` and ```jarble_ui_update ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui(?:_update)?\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function useDirectChat(deploymentId: string) {
  const { getAccessTokenSilently } = useAuth0();
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: DirectChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };
      const assistantId = `assistant-${Date.now()}`;
      const assistantMsg: DirectChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getAccessTokenSilently();
        const historyForApi = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch(`${API_URL}/api/tambo-agent`, {
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
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: `Error: ${errText}` } : m
            )
          );
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";
        const pendingBlocks = new Map<string, UIBlock>();

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
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + event.delta } : m
                  )
                );
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
              }
              if (event.type === "UI_BLOCK_PROPS") {
                const block = pendingBlocks.get(event.blockId);
                if (block) block.props = event.props;
              }
              if (event.type === "UI_BLOCK_END") {
                const block = pendingBlocks.get(event.blockId);
                if (block) {
                  const completed = { ...block };
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
                  pendingBlocks.delete(event.blockId);
                }
              }

              if (event.type === "UI_BLOCK_UPDATE") {
                const { cardId, props, merge, component } = event;
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

              if (event.type === "RUN_FINISHED") break;
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Something went wrong. Please try again." }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [deploymentId, getAccessTokenSilently, isStreaming, messages]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isStreaming, sendMessage, clearMessages };
}
