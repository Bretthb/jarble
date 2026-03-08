"use client";

/**
 * AssistantUIChat — Thread-based chat component powered by assistant-ui.
 *
 * Replaces the inline chat rendering in the workspace page with assistant-ui
 * primitives. Gains: message editing, regeneration, copy-to-clipboard,
 * keyboard navigation, auto-scroll, and full ARIA accessibility for free.
 */

import { memo, useState, useEffect, useRef, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  useMessage,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { Sparkles, SendHorizontal, Loader2, Copy, RotateCcw, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownMessage from "@/components/MarkdownMessage";

// ── Thread Component ────────────────────────────────────────────────────────

interface AssistantUIChatProps {
  runtime: AssistantRuntime;
  isStreaming: boolean;
  emptyState?: ReactNode;
}

function AssistantUIChatInner({
  runtime,
  isStreaming,
  emptyState,
}: AssistantUIChatProps) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-col h-full">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-4 space-y-3">
          <ThreadPrimitive.Empty>
            {emptyState || (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Send a message to start chatting
              </div>
            )}
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage: UserBubble,
              AssistantMessage: AssistantBubble,
            }}
          />
        </ThreadPrimitive.Viewport>

        {/* Composer — rendered separately by parent to include selected card chip */}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export default memo(AssistantUIChatInner);

// ── User Message Bubble ─────────────────────────────────────────────────────

function UserBubble() {
  const message = useMessage();
  const isActionRelay = message?.metadata?.custom?.isActionRelay;
  const content = message?.content
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("") || "";

  // Action relay: compact inline chip
  if (isActionRelay) {
    return (
      <MessagePrimitive.Root className="flex justify-end">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/40 max-w-[70%]">
          <span className="text-xs italic text-muted-foreground">{content}</span>
        </div>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className="flex gap-3 flex-row-reverse group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-primary/90 text-primary-foreground border-primary/20">
        <span className="text-[10px] font-semibold">Y</span>
      </div>

      {/* Content + actions */}
      <div className="flex flex-col gap-0.5 items-end flex-1 max-w-[80%]">
        <div className="rounded-lg px-4 py-3 bg-primary/90 text-primary-foreground shadow-sm">
          <p className="text-sm">{content}</p>
        </div>
        {/* Edit action - only shows on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <ActionBarPrimitive.Edit className="p-1 rounded hover:bg-secondary/60 text-muted-foreground">
            <Pencil className="w-3 h-3" />
          </ActionBarPrimitive.Edit>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Typewriter Hook ─────────────────────────────────────────────────────────

function useTypewriter(text: string, speed = 12) {
  const [displayed, setDisplayed] = useState("");
  const prevTextRef = useRef("");

  useEffect(() => {
    // If text changed (new message), animate from where we left off
    if (text === prevTextRef.current) return;

    const startFrom = text.startsWith(prevTextRef.current)
      ? prevTextRef.current.length
      : 0;

    if (startFrom === 0) setDisplayed("");

    let i = startFrom;
    const timer = setInterval(() => {
      if (i >= text.length) {
        clearInterval(timer);
        prevTextRef.current = text;
        setDisplayed(text);
        return;
      }
      // Advance by a few chars per tick for snappy feel
      const step = Math.min(3, text.length - i);
      i += step;
      setDisplayed(text.slice(0, i));
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  const isAnimating = displayed.length < text.length;
  return { displayed, isAnimating };
}

// ── Assistant Message Bubble ────────────────────────────────────────────────

function AssistantBubble() {
  const message = useMessage();
  const content = message?.content
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("") || "";
  const isInProgress = message?.status?.type === "requires-action" || message?.status?.type === "incomplete"
    ? false
    : message?.status?.type !== "complete";

  const { displayed, isAnimating } = useTypewriter(content);
  const showCursor = isInProgress || isAnimating;

  return (
    <MessagePrimitive.Root className="flex gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-primary/20 border border-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-primary/70" />
      </div>

      {/* Content + actions */}
      <div className="flex flex-col gap-0.5 items-start flex-1 max-w-[80%]">
        <div
          className={cn(
            "rounded-lg px-4 py-3 bg-secondary/30",
            isInProgress && !isAnimating && "animate-[shimmer_2s_ease-in-out_infinite]",
          )}
          style={
            isInProgress && !isAnimating
              ? {
                  backgroundSize: "200% 100%",
                  backgroundImage:
                    "linear-gradient(90deg, transparent 0%, hsl(var(--secondary)/0.15) 50%, transparent 100%)",
                }
              : undefined
          }
        >
          <MarkdownMessage content={displayed} />
          {showCursor && (
            <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-1 align-middle" />
          )}
        </div>
        {/* Copy + Regenerate - only shows on hover, after animation */}
        {!isAnimating && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <ActionBarPrimitive.Copy className="p-1 rounded hover:bg-secondary/60 text-muted-foreground" copiedDuration={2000}>
              <Copy className="w-3 h-3" />
            </ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload className="p-1 rounded hover:bg-secondary/60 text-muted-foreground">
              <RotateCcw className="w-3 h-3" />
            </ActionBarPrimitive.Reload>
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}
