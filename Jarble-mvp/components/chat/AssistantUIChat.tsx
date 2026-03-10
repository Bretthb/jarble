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
import { Sparkles, SendHorizontal, Loader2, Copy, RotateCcw, Pencil, Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownMessage from "@/components/MarkdownMessage";
import { AnimatePresence, motion } from "framer-motion";

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

function useTypewriter(text: string, speed = 4) {
  const [displayed, setDisplayed] = useState(speed === 0 ? text : "");
  const prevTextRef = useRef("");

  useEffect(() => {
    // If text changed (new message), animate from where we left off
    if (text === prevTextRef.current) return;

    // Instant mode: skip animation entirely (used for loaded history messages)
    if (speed === 0) {
      setDisplayed(text);
      prevTextRef.current = text;
      return;
    }

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
      // Advance by several chars per tick — with real streaming, LLM pace provides natural typewriter
      const step = Math.min(8, text.length - i);
      i += step;
      setDisplayed(text.slice(0, i));
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  const isAnimating = displayed.length < text.length;
  return { displayed, isAnimating };
}

// ── Thinking Section ─────────────────────────────────────────────────────────

interface ThinkingSectionProps {
  text: string;
  isStreaming: boolean;
}

function ThinkingSection({ text, isStreaming }: ThinkingSectionProps) {
  // Auto-expand while streaming, allow manual toggle after
  const [isExpanded, setIsExpanded] = useState(true);
  const wasStreamingRef = useRef(isStreaming);

  useEffect(() => {
    // Auto-collapse when streaming finishes
    if (wasStreamingRef.current && !isStreaming) {
      setIsExpanded(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  return (
    <div className="w-full mb-1">
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-secondary/40 transition-colors text-xs text-muted-foreground"
      >
        <Brain className={cn("w-3 h-3", isStreaming && "animate-pulse text-violet-400")} />
        <span>{isStreaming ? "Thinking..." : "Thought process"}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 px-3 py-2 rounded-md bg-secondary/15 border border-border/30 max-h-48 overflow-y-auto">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{text}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Assistant Message Bubble ────────────────────────────────────────────────

function AssistantBubble() {
  const message = useMessage();
  const reasoningParts = message?.content?.filter((p): p is { type: "reasoning"; text: string } => p.type === "reasoning") || [];
  const content = message?.content
    ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("") || "";
  const isInProgress = message?.status?.type === "requires-action" || message?.status?.type === "incomplete"
    ? false
    : message?.status?.type !== "complete";

  const isComplete = message?.status?.type === "complete";
  const thinkingText = reasoningParts.map((p) => p.text).join("");
  // Skip typewriter for completed/loaded messages — show instantly
  const { displayed, isAnimating } = useTypewriter(content, isComplete ? 0 : 4);
  const showCursor = isInProgress || isAnimating;

  return (
    <MessagePrimitive.Root className="flex gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-primary/20 border border-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-primary/70" />
      </div>

      {/* Content + actions */}
      <div className="flex flex-col gap-0.5 items-start flex-1 max-w-[80%]">
        {/* Thinking section — collapsible */}
        {thinkingText && (
          <ThinkingSection text={thinkingText} isStreaming={isInProgress} />
        )}

        <div
          className={cn(
            "rounded-lg px-4 py-3 bg-secondary/30",
            isInProgress && !isAnimating && !content && "animate-[shimmer_2s_ease-in-out_infinite]",
          )}
          style={
            isInProgress && !isAnimating && !content
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
