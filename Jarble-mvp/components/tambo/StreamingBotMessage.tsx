"use client";

/**
 * StreamingBotMessage — Tambo component that streams bot responses via SSE.
 *
 * On mount, connects to POST /api/tambo-agent, parses SSE events,
 * and renders text + UI blocks progressively. Replaces the blocking
 * chat_with_bot MCP tool path for Tambo chat.
 *
 * Supports interactive UI blocks: when the user clicks a button/option,
 * the action is sent as a follow-up message to the bot and the response
 * is appended below.
 *
 * StrictMode safety: uses a `cancelled` flag so the first (doomed) effect
 * run silently drops its state updates; only the second run renders.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import MarkdownMessage from "@/components/MarkdownMessage";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import type { UIBlock } from "@/components/canvas/CanvasRenderer";
import type { CanvasAction } from "@/components/canvas/CanvasActionContext";
import { useDeploymentId } from "@/components/DeploymentTamboProvider";

/** Regex to strip ```jarble_ui ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Parse SSE events from a ReadableStream, updating state accumulators. */
async function consumeSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (fullText: string) => void,
  onBlock: (block: UIBlock) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
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
          fullText += event.delta;
          onText(stripUIMarkers(fullText));
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
            onBlock({ ...block });
            onText(stripUIMarkers(fullText));
            pendingBlocks.delete(event.blockId);
          }
        }

        if (event.type === "RUN_FINISHED") break;
      } catch {
        // Skip malformed JSON lines
      }
    }
  }
}

interface StreamingBotMessageProps {
  message: string;
  deploymentId?: string; // accepted from Tambo but overridden by context
}

export default function StreamingBotMessage({
  message,
  deploymentId: _deploymentIdProp,
}: StreamingBotMessageProps) {
  const { getAccessTokenSilently } = useAuth0();
  // Always use the real deploymentId from React context — Tambo LLM
  // may hallucinate the prop value.
  const deploymentId = useDeploymentId() || _deploymentIdProp || "";
  const [text, setText] = useState("");
  const [uiBlocks, setUiBlocks] = useState<UIBlock[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ref to track follow-up text separately (appended after initial response)
  const followUpTextRef = useRef("");

  /** Send a message to the bot via SSE and accumulate results into state. */
  const sendToBot = useCallback(
    async (msg: string, opts?: { append?: boolean }) => {
      setIsStreaming(true);
      setError(null);

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
            messages: [{ role: "user", content: msg }],
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          setError(errText);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError("No response stream");
          return;
        }

        if (opts?.append) {
          // For follow-ups, append a separator
          followUpTextRef.current += "\n\n---\n\n";
        }

        await consumeSSE(
          reader,
          (fullText) => {
            if (opts?.append) {
              setText(followUpTextRef.current + fullText);
            } else {
              setText(fullText);
              followUpTextRef.current = fullText;
            }
          },
          (block) => {
            setUiBlocks((prev) => [...prev, block]);
          },
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Something went wrong. Please try again.");
      } finally {
        setIsStreaming(false);
      }
    },
    [deploymentId, getAccessTokenSilently],
  );

  /** Handle interactive UI block actions (button clicks, option selects). */
  const handleAction = useCallback(
    (action: CanvasAction) => {
      if (isStreaming) return; // ignore clicks while streaming
      const actionMsg = `[UI_ACTION] blockId=${action.blockId} component=${action.component} action=${action.action}\n${JSON.stringify(action.payload)}`;
      sendToBot(actionMsg, { append: true });
    },
    [sendToBot, isStreaming],
  );

  // Initial message on mount
  useEffect(() => {
    let cancelled = false;

    sendToBot(message).then(() => {
      // noop — state already updated inside sendToBot
    }).catch(() => {
      if (!cancelled) setError("Something went wrong. Please try again.");
    });

    return () => {
      cancelled = true;
    };
  }, [message, sendToBot]);

  // Error state
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  // Thinking state — no text yet
  if (isStreaming && !text && uiBlocks.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-1">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
        </div>
        Thinking...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Streaming text */}
      {text && (
        <div className="text-sm">
          <MarkdownMessage content={text} />
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      )}

      {/* Rendered UI blocks */}
      {uiBlocks.map((block) => {
        const isEditable = block.editable !== false;
        return isEditable ? (
          <EditableCanvas
            key={block.id}
            block={{ ...block, saveMethod: block.saveMethod || "mcp" }}
            deploymentId={deploymentId}
            onAction={handleAction}
          />
        ) : (
          <CanvasRenderer key={block.id} block={block} onAction={handleAction} />
        );
      })}

      {/* Loading indicator for follow-up actions */}
      {isStreaming && (text || uiBlocks.length > 0) && (
        <div className="flex items-center gap-2 text-muted-foreground text-xs py-1">
          <div className="flex gap-1">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}
