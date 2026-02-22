"use client";

import { useState, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  args: string; // JSON string
}

export interface UIBlock {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  uiBlocks?: UIBlock[];
}

export interface UseAgentChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnecting: boolean;
  sendMessage: (text: string) => Promise<void>;
  invokeTool: (tool: string, params?: Record<string, unknown>) => Promise<void>;
}

// ─── SSE Stream Parser ──────────────────────────────────────────────────────

/**
 * Shared SSE parsing logic used by both sendMessage and invokeTool.
 * Reads an SSE response body and updates assistant message state.
 */
/** Regex to strip ```jarble_ui ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui\s*\n[\s\S]*?```/g;

/** Strip jarble_ui fenced blocks and clean up extra blank lines */
function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  assistantMsgId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsConnecting: React.Dispatch<React.SetStateAction<boolean>>
) {
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingTools = new Map<string, ToolCall>();
  const pendingUIBlocks = new Map<string, UIBlock>();
  let hasUIBlocks = false;

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
          setIsConnecting(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + event.delta }
                : m
            )
          );
        }

        // Tool call events
        if (event.type === "TOOL_CALL_START") {
          setIsConnecting(false);
          pendingTools.set(event.toolCallId, {
            id: event.toolCallId,
            name: event.toolCallName,
            args: "",
          });
        }
        if (event.type === "TOOL_CALL_ARGS") {
          const tc = pendingTools.get(event.toolCallId);
          if (tc) tc.args += event.delta;
        }
        if (event.type === "TOOL_CALL_END") {
          const tc = pendingTools.get(event.toolCallId);
          if (tc) {
            const completedTc = { ...tc };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, toolCalls: [...(m.toolCalls || []), completedTc] }
                  : m
              )
            );
            pendingTools.delete(event.toolCallId);
          }
        }

        // UI block events
        if (event.type === "UI_BLOCK_START") {
          pendingUIBlocks.set(event.blockId, {
            id: event.blockId,
            component: event.component,
            props: {},
            ...(event.editable ? { editable: true } : {}),
            ...(event.fileId ? { fileId: event.fileId } : {}),
            ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
          });
        }
        if (event.type === "UI_BLOCK_PROPS") {
          const block = pendingUIBlocks.get(event.blockId);
          if (block) block.props = event.props;
        }
        if (event.type === "UI_BLOCK_END") {
          const block = pendingUIBlocks.get(event.blockId);
          if (block) {
            hasUIBlocks = true;
            const completedBlock = { ...block };
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                // Strip jarble_ui markers from text now that we have real blocks
                const cleanContent = stripUIMarkers(m.content);
                return {
                  ...m,
                  content: cleanContent,
                  uiBlocks: [...(m.uiBlocks || []), completedBlock],
                };
              })
            );
            pendingUIBlocks.delete(event.blockId);
          }
        }

        // RUN_FINISHED — stream done
        if (event.type === "RUN_FINISHED") {
          break;
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAgentChat(deploymentId: string): UseAgentChatReturn {
  const { getAccessTokenSilently } = useAuth0();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      // Append user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };

      // Create placeholder assistant message
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setIsConnecting(true);

      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getAccessTokenSilently();

        // Build message history for the API (exclude the empty assistant placeholder)
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
          body: JSON.stringify({
            deploymentId,
            messages: historyForApi,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: `Error: ${errText}` }
                : m
            )
          );
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setIsStreaming(false);
          return;
        }

        await parseSSEStream(reader, assistantMsg.id, setMessages, setIsConnecting);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: "Something went wrong. Please try again." }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        setIsConnecting(false);
      }
    },
    [deploymentId, getAccessTokenSilently, isStreaming, messages]
  );

  const invokeTool = useCallback(
    async (tool: string, params?: Record<string, unknown>) => {
      if (isStreaming) return;

      // Create placeholder assistant message for the tool response
      const assistantMsg: ChatMessage = {
        id: `tool-${Date.now()}`,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsStreaming(true);
      setIsConnecting(true);

      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getAccessTokenSilently();

        const res = await fetch(`${API_URL}/api/tools/invoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            deploymentId,
            tool,
            params: params || {},
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: `Error: ${errText}` }
                : m
            )
          );
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setIsStreaming(false);
          return;
        }

        await parseSSEStream(reader, assistantMsg.id, setMessages, setIsConnecting);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: "Something went wrong. Please try again." }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        setIsConnecting(false);
      }
    },
    [deploymentId, getAccessTokenSilently, isStreaming]
  );

  return { messages, isStreaming, isConnecting, sendMessage, invokeTool };
}
