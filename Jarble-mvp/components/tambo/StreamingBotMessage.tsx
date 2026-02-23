"use client";

/**
 * StreamingBotMessage — Tambo component that streams bot responses via SSE.
 *
 * On mount, connects to POST /api/tambo-agent, parses SSE events,
 * and renders text + UI blocks progressively. Replaces the blocking
 * chat_with_bot MCP tool path for Tambo chat.
 */

import { useState, useEffect, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import MarkdownMessage from "@/components/MarkdownMessage";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import type { UIBlock } from "@/components/canvas/CanvasRenderer";

/** Regex to strip ```jarble_ui ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

interface StreamingBotMessageProps {
  message: string;
  deploymentId: string;
}

export default function StreamingBotMessage({
  message,
  deploymentId,
}: StreamingBotMessageProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [text, setText] = useState("");
  const [uiBlocks, setUiBlocks] = useState<UIBlock[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    // Prevent double-fire in StrictMode
    if (hasStarted.current) return;
    hasStarted.current = true;

    const controller = new AbortController();

    async function stream() {
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
            messages: [{ role: "user", content: message }],
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          setError(errText);
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError("No response stream");
          setIsStreaming(false);
          return;
        }

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
                setText(stripUIMarkers(fullText));
              }

              if (event.type === "UI_BLOCK_START") {
                pendingBlocks.set(event.blockId, {
                  id: event.blockId,
                  component: event.component,
                  props: {},
                  ...(event.editable ? { editable: true } : {}),
                  ...(event.fileId ? { fileId: event.fileId } : {}),
                  ...(event.saveMethod
                    ? { saveMethod: event.saveMethod }
                    : {}),
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
                  setUiBlocks((prev) => [...prev, completed]);
                  // Also strip UI markers from accumulated text
                  setText(stripUIMarkers(fullText));
                  pendingBlocks.delete(event.blockId);
                }
              }

              if (event.type === "RUN_FINISHED") break;
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Something went wrong. Please try again.");
      } finally {
        setIsStreaming(false);
      }
    }

    stream();

    return () => {
      controller.abort();
    };
  }, [message, deploymentId, getAccessTokenSilently]);

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
          />
        ) : (
          <CanvasRenderer key={block.id} block={block} />
        );
      })}
    </div>
  );
}
