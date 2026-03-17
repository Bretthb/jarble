"use client";

/**
 * AssistantUIChat — Thread-based chat component powered by assistant-ui.
 *
 * Replaces the inline chat rendering in the workspace page with assistant-ui
 * primitives. Gains: message editing, regeneration, copy-to-clipboard,
 * keyboard navigation, auto-scroll, and full ARIA accessibility for free.
 */

import { memo, useState, useEffect, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  SuggestionPrimitive,
  useMessage,
  useMessagePartReasoning,
  type AssistantRuntime,
  type TextMessagePartProps,
  type ReasoningMessagePartProps,
} from "@assistant-ui/react";
import { Sparkles, SendHorizontal, Loader2, Copy, Pencil, RotateCcw, ChevronRight } from "lucide-react";
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
      <ThreadPrimitive.Root className="flex flex-col h-full overflow-hidden">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
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

          {/* Suggestion pills — rendered below the last message */}
          <div className="flex flex-wrap gap-2 px-4 py-2">
            <ThreadPrimitive.Suggestions
              components={{ Suggestion: SuggestionPill }}
            />
          </div>
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
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/40 max-w-[70%]" data-role="action-relay">
          <span className="text-xs italic text-muted-foreground">{content}</span>
        </div>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className="flex gap-3 flex-row-reverse group" data-testid="user-message">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-primary/90 text-primary-foreground border-primary/20" data-avatar="user">
        <span className="text-[10px] font-semibold">Y</span>
      </div>

      {/* Content + actions */}
      <div className="flex flex-col gap-0.5 items-end flex-1 max-w-[80%] min-w-0">
        <div className="rounded-lg px-4 py-3 bg-primary/90 text-primary-foreground shadow-sm break-words overflow-hidden max-w-full" data-role="user">
          <p className="text-sm break-words" style={{ overflowWrap: "anywhere" }}>{content}</p>
        </div>
        {/* Edit + Copy actions - only shows on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <ActionBarPrimitive.Edit className="p-1 rounded hover:bg-secondary/60 text-muted-foreground">
            <Pencil className="w-3 h-3" />
          </ActionBarPrimitive.Edit>
          <ActionBarPrimitive.Copy className="p-1 rounded hover:bg-secondary/60 text-muted-foreground" copiedDuration={2000}>
            <Copy className="w-3 h-3" />
          </ActionBarPrimitive.Copy>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Assistant Message Bubble ────────────────────────────────────────────────

function AssistantBubble() {
  const message = useMessage();
  const isInProgress = message?.status?.type === "requires-action" || message?.status?.type === "incomplete"
    ? false
    : message?.status?.type !== "complete";

  return (
    <MessagePrimitive.Root className="flex gap-3 group" data-testid="assistant-message">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/20 to-primary/20 border border-primary/10 flex items-center justify-center shrink-0" data-avatar="assistant">
        <Sparkles className="w-3.5 h-3.5 text-primary/70" />
      </div>

      {/* Content + actions */}
      <div className="flex flex-col gap-0.5 items-start flex-1 max-w-[80%] min-w-0">
        <div
          data-role="assistant"
          className={cn(
            "rounded-lg px-4 py-3 bg-secondary/30 break-words overflow-hidden max-w-full",
            isInProgress && "animate-[shimmer_2s_ease-in-out_infinite]",
          )}
          style={
            isInProgress
              ? {
                  backgroundSize: "200% 100%",
                  backgroundImage:
                    "linear-gradient(90deg, transparent 0%, hsl(var(--secondary)/0.15) 50%, transparent 100%)",
                }
              : undefined
          }
        >
          <MessagePrimitive.Parts
            components={{
              Text: TextPartRenderer,
              Reasoning: ReasoningPartRenderer,
            }}
          />
          {isInProgress && (
            <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-1 align-middle" />
          )}
        </div>
        {/* Copy + Regenerate - only shows on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <ActionBarPrimitive.Copy className="p-1 rounded hover:bg-secondary/60 text-muted-foreground" copiedDuration={2000}>
            <Copy className="w-3 h-3" />
          </ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload className="p-1 rounded hover:bg-secondary/60 text-muted-foreground">
            <RotateCcw className="w-3 h-3" />
          </ActionBarPrimitive.Reload>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Text Part Renderer ──────────────────────────────────────────────────────

function TextPartRenderer(props: TextMessagePartProps) {
  return <MarkdownMessage content={props.text} />;
}

// ── Reasoning Part Renderer ─────────────────────────────────────────────────

function ReasoningPartRenderer(props: ReasoningMessagePartProps) {
  const isRunning = props.status.type === "running";
  const [expanded, setExpanded] = useState(isRunning);

  // Auto-expand when reasoning starts streaming
  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        <span className="font-medium">
          {isRunning ? "Thinking..." : "Thought process"}
        </span>
        {isRunning && (
          <span className="inline-block w-1.5 h-3 bg-primary/50 animate-pulse ml-0.5" />
        )}
        {!expanded && !isRunning && props.text && (
          <span className="text-muted-foreground/60 truncate max-w-[200px]">
            {props.text.slice(0, 60)}...
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-4 border-l-2 border-border/40 text-xs text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
          {props.text}
          {isRunning && <span className="inline-block w-1.5 h-3 bg-primary/40 animate-pulse ml-0.5 align-middle" />}
        </div>
      )}
    </div>
  );
}

// ── Suggestion Pill ─────────────────────────────────────────────────────────

function SuggestionPill() {
  return (
    <SuggestionPrimitive.Trigger
      send
      className={cn(
        "inline-flex items-center rounded-full px-3.5 py-1.5",
        "text-sm font-medium",
        "bg-secondary/60 hover:bg-secondary text-foreground",
        "border border-border/40 hover:border-border/60",
        "shadow-sm hover:shadow",
        "transition-all duration-200 cursor-pointer",
        "hover:scale-[1.02]",
      )}
    >
      <SuggestionPrimitive.Title />
    </SuggestionPrimitive.Trigger>
  );
}
