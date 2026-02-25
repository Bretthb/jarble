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
 * StrictMode safety: uses an AbortController so the first (doomed) effect
 * run's fetch is aborted on cleanup; only the second run streams.
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

/** Regex to strip ```jarble_ui ... ``` and ```jarble_ui_update ... ``` fenced blocks from displayed text */
const JARBLE_UI_FENCE = /```jarble_ui(?:_update)?\s*\n[\s\S]*?```/g;

function stripUIMarkers(text: string): string {
  return text.replace(JARBLE_UI_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** UI block update descriptor received via UI_BLOCK_UPDATE SSE event */
interface UIBlockUpdate {
  cardId: string;
  props: Record<string, unknown>;
  merge: boolean;
  component?: string;
}

/** Parse SSE events from a ReadableStream, updating state accumulators. */
async function consumeSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (fullText: string) => void,
  onBlock: (block: UIBlock) => void,
  signal: AbortSignal,
  onUpdate?: (update: UIBlockUpdate) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let eventCount = 0;
  let textChunks = 0;
  const pendingBlocks = new Map<string, UIBlock>();

  console.log("[Jarble:SSE] consumeSSE started");

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      console.log("[Jarble:SSE] Stream reader done — total events:", eventCount, "text chunks:", textChunks);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let finished = false;
    for (const line of lines) {
      if (signal.aborted) {
        console.log("[Jarble:SSE] Aborted mid-parse");
        break;
      }

      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const event = JSON.parse(trimmed.slice(6));
        eventCount++;

        if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
          textChunks++;
          fullText += event.delta;
          onText(stripUIMarkers(fullText));
          // Log every 5th text chunk to avoid console spam
          if (textChunks % 5 === 1) {
            console.log("[Jarble:SSE] TEXT delta #" + textChunks + " — total length:", fullText.length, "chars");
          }
        } else if (event.type === "UI_BLOCK_START") {
          console.log("[Jarble:SSE] UI_BLOCK_START:", event.blockId, "component:", event.component, "editable:", event.editable, "fileId:", event.fileId, "saveMethod:", event.saveMethod);
          pendingBlocks.set(event.blockId, {
            id: event.blockId,
            component: event.component,
            props: {},
            ...(event.editable ? { editable: true } : {}),
            ...(event.fileId ? { fileId: event.fileId } : {}),
            ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
          });
        } else if (event.type === "UI_BLOCK_PROPS") {
          const block = pendingBlocks.get(event.blockId);
          if (block) {
            const propsKeys = Object.keys(event.props || {});
            const propsSize = JSON.stringify(event.props).length;
            console.log("[Jarble:SSE] UI_BLOCK_PROPS:", event.blockId, "keys:", propsKeys, "size:", propsSize, "bytes");
            // Log full props for sandbox (most complex), truncate for others
            if (block.component === "sandbox") {
              console.log("[Jarble:SSE] Sandbox props — html:", (event.props?.html || "").length, "chars, js:", (event.props?.js || "").length, "chars, css:", (event.props?.css || "").length, "chars, libraries:", event.props?.libraries);
            } else {
              console.log("[Jarble:SSE] UI_BLOCK_PROPS detail:", event.props);
            }
            block.props = event.props;
          } else {
            console.warn("[Jarble:SSE] UI_BLOCK_PROPS for unknown blockId:", event.blockId);
          }
        } else if (event.type === "UI_BLOCK_END") {
          const block = pendingBlocks.get(event.blockId);
          if (block) {
            console.log("[Jarble:SSE] UI_BLOCK_END:", event.blockId, "component:", block.component, "props keys:", Object.keys(block.props));
            onBlock({ ...block });
            onText(stripUIMarkers(fullText));
            pendingBlocks.delete(event.blockId);
          } else {
            console.warn("[Jarble:SSE] UI_BLOCK_END for unknown blockId:", event.blockId);
          }
        } else if (event.type === "UI_BLOCK_UPDATE") {
          console.log("[Jarble:SSE] UI_BLOCK_UPDATE:", event.cardId, "merge:", event.merge, "component:", event.component, "props keys:", Object.keys(event.props || {}));
          onUpdate?.({
            cardId: event.cardId,
            props: event.props ?? {},
            merge: event.merge ?? true,
            component: event.component,
          });
        } else if (event.type === "RUN_FINISHED") {
          console.log("[Jarble:SSE] RUN_FINISHED — stream complete. Total events:", eventCount, "text chunks:", textChunks, "pending blocks:", pendingBlocks.size);
          finished = true;
          break;
        } else {
          // Log any unrecognized event types
          console.log("[Jarble:SSE] Event type:", event.type, "data:", JSON.stringify(event).slice(0, 200));
        }
      } catch (e) {
        console.warn("[Jarble:SSE] Malformed JSON line:", trimmed.slice(0, 100), "error:", e);
      }
    }
    if (finished) break;
  }

  if (signal.aborted) {
    console.log("[Jarble:SSE] consumeSSE ended (aborted) — events:", eventCount);
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

  // Stable ref for deploymentId so in-flight streams always use the current value
  const deploymentIdRef = useRef(deploymentId);
  deploymentIdRef.current = deploymentId;

  // AbortController ref for cancelling the active stream (initial mount or follow-ups)
  const abortRef = useRef<AbortController | null>(null);

  /** Send a message to the bot via SSE and accumulate results into state. */
  const sendToBot = useCallback(
    async (msg: string, opts?: { append?: boolean; signal?: AbortSignal }) => {
      const msgPreview = msg.length > 80 ? msg.slice(0, 80) + "..." : msg;
      console.log("[Jarble:SSE] sendToBot called —", opts?.append ? "FOLLOW-UP" : "INITIAL", "— deploymentId:", deploymentIdRef.current, "— message:", msgPreview);

      setIsStreaming(true);
      setError(null);

      const signal = opts?.signal;

      try {
        const token = await getAccessTokenSilently();
        const url = `${API_URL}/api/tambo-agent`;
        console.log("[Jarble:SSE] Fetching:", url);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            deploymentId: deploymentIdRef.current,
            messages: [{ role: "user", content: msg }],
          }),
          signal,
        });

        console.log("[Jarble:SSE] Response:", res.status, res.statusText, "content-type:", res.headers.get("content-type"));

        if (!res.ok) {
          const errText = await res.text().catch(() => "Request failed");
          console.error("[Jarble:SSE] HTTP error:", res.status, errText.slice(0, 200));
          setError(errText);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          console.error("[Jarble:SSE] No response body reader");
          setError("No response stream");
          return;
        }

        if (opts?.append) {
          // For follow-ups, append a separator
          followUpTextRef.current += "\n\n---\n\n";
          console.log("[Jarble:SSE] Appending follow-up separator");
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
            console.log("[Jarble:SSE] Block received for rendering:", block.component, "id:", block.id, "editable:", block.editable);
            setUiBlocks((prev) => [...prev, block]);
          },
          signal ?? new AbortController().signal,
          (update) => {
            console.log("[Jarble:SSE] Block update received:", update.cardId, "merge:", update.merge, "component:", update.component);
            setUiBlocks((prev) =>
              prev.map((block) => {
                if (block.id !== update.cardId) return block;
                const newProps = update.merge ? { ...block.props, ...update.props } : update.props;
                return {
                  ...block,
                  props: newProps,
                  ...(update.component ? { component: update.component } : {}),
                };
              })
            );
          },
        );
        console.log("[Jarble:SSE] sendToBot complete");
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          console.log("[Jarble:SSE] Fetch aborted (cleanup)");
          return;
        }
        console.error("[Jarble:SSE] sendToBot error:", err);
        setError("Something went wrong. Please try again.");
      } finally {
        setIsStreaming(false);
      }
    },
    [getAccessTokenSilently],
  );

  /** Handle interactive UI block actions (button clicks, option selects). */
  const handleAction = useCallback(
    (action: CanvasAction) => {
      console.log("[Jarble:Action] UI action received:", action.component, "→", action.action, "blockId:", action.blockId, "payload:", action.payload);
      if (isStreaming) {
        console.log("[Jarble:Action] Ignored — currently streaming");
        return;
      }

      // Abort any previous follow-up stream before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const actionMsg = `[UI_ACTION] blockId=${action.blockId} component=${action.component} action=${action.action}\n${JSON.stringify(action.payload)}`;
      console.log("[Jarble:Action] Sending follow-up:", actionMsg.slice(0, 120));
      sendToBot(actionMsg, { append: true, signal: controller.signal });
    },
    [sendToBot, isStreaming],
  );

  // Initial message on mount — abort on cleanup (StrictMode + unmount safety)
  useEffect(() => {
    console.log("[Jarble:SSE] useEffect mount — message:", message?.slice(0, 60), "deploymentId:", deploymentId);
    const controller = new AbortController();
    abortRef.current = controller;

    sendToBot(message, { signal: controller.signal }).catch(() => {
      if (!controller.signal.aborted) {
        setError("Something went wrong. Please try again.");
      }
    });

    return () => {
      console.log("[Jarble:SSE] useEffect cleanup — aborting stream");
      controller.abort();
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
        console.log("[Jarble:Render] Block:", block.component, "id:", block.id, "editable:", isEditable, "→", isEditable ? "EditableCanvas" : "CanvasRenderer");
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
