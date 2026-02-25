"use client";

/**
 * ConfigPanel — slide-out left sidebar for deployment configuration via Tambo.
 *
 * Tambo is repurposed here for config-only: system prompt, platforms, LLM
 * settings, lifecycle ops. Main bot chat goes through the canvas directly.
 *
 * Polish notes:
 * - Styled as a config assistant, not a generic chat
 * - Quick action chips for common tasks
 * - Welcome empty state with guidance
 * - Warm charcoal aesthetic matching globals.css
 * - [Jarble:Config] prefix logging
 */

import { useRef, useEffect, useState, useCallback } from "react";
import {
  useTambo,
  useTamboThreadInput,
  ComponentRenderer,
  type TamboThreadMessage,
  type Content,
} from "@tambo-ai/react";
import { Button } from "@/components/ui/button";
import {
  X,
  Loader2,
  SendHorizontal,
  Wrench,
  User,
  Sparkles,
  MessageSquare,
  Cpu,
  Send as SendIcon,
  FileText,
  ScrollText,
} from "lucide-react";
import MarkdownMessage from "@/components/MarkdownMessage";

// ── Logging helper ──────────────────────────────────────────────────────────

const LOG_PREFIX = "[Jarble:Config]";

function logConfig(msg: string, ...args: unknown[]) {
  console.log(`${LOG_PREFIX} ${msg}`, ...args);
}

function logConfigError(msg: string, ...args: unknown[]) {
  console.error(`${LOG_PREFIX} ${msg}`, ...args);
}

// ── Quick action chip definitions ───────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Change LLM model", icon: Cpu, prompt: "Change the LLM model" },
  { label: "Connect Telegram", icon: SendIcon, prompt: "Connect Telegram to my bot" },
  { label: "Edit system prompt", icon: FileText, prompt: "Edit the system prompt" },
  { label: "View logs", icon: ScrollText, prompt: "Show me the deployment logs" },
] as const;

// ── ConfigPanel (outer shell) ───────────────────────────────────────────────

interface ConfigPanelProps {
  deploymentId: string;
  onClose: () => void;
}

export default function ConfigPanel({ deploymentId, onClose }: ConfigPanelProps) {
  return (
    <div className="h-full w-[360px] shrink-0 border-r border-border/60 bg-background flex flex-col relative">
      {/* Left accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          <div>
            <span className="text-sm font-semibold text-foreground">Configuration</span>
            <p className="text-[10px] text-muted-foreground leading-tight">Powered by Tambo AI</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-md hover:bg-secondary/80 transition-colors"
          aria-label="Close config panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tambo config chat */}
      <ConfigChat deploymentId={deploymentId} />
    </div>
  );
}

// ── Config Chat (Tambo-powered) ─────────────────────────────────────────────

function ConfigChat({ deploymentId }: { deploymentId: string }) {
  const { messages, isStreaming, isWaiting, currentThreadId } = useTambo();
  const { value, setValue, submit, isPending } = useTamboThreadInput();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const prevMsgCountRef = useRef(messages.length);

  const isBusy = isStreaming || isWaiting || isPending;
  const hasMessages = messages.length > 0;

  // Log when Tambo messages arrive
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const newest = messages[messages.length - 1];
      logConfig("Message arrived", {
        role: newest?.role,
        id: newest?.id,
        contentBlocks: newest?.content?.length,
        totalMessages: messages.length,
      });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, messages]);

  // Track scroll position for fade gradient
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setIsScrolled(scrollRef.current.scrollTop > 12);
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!value.trim() || isBusy) return;
      setSubmitError(null);
      logConfig("Submitting message:", value.trim());
      try {
        await submit();
        logConfig("Message submitted successfully");
      } catch (err: any) {
        const errMsg = err.message || "Failed to send message";
        logConfigError("Submit failed:", errMsg);
        setSubmitError(errMsg);
      }
    },
    [value, isBusy, submit]
  );

  // Quick action: set the input value and auto-submit
  const handleQuickAction = useCallback(
    async (prompt: string) => {
      if (isBusy) return;
      logConfig("Quick action triggered:", prompt);
      setValue(prompt);
      // Defer submit to next tick so the value is set
      setTimeout(async () => {
        setSubmitError(null);
        try {
          await submit();
          logConfig("Quick action submitted successfully");
        } catch (err: any) {
          const errMsg = err.message || "Failed to send message";
          logConfigError("Quick action submit failed:", errMsg);
          setSubmitError(errMsg);
        }
      }, 0);
    },
    [isBusy, setValue, submit]
  );

  return (
    <>
      {/* Scrollable message area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Fade gradient at top when scrolled */}
        <div
          className={`absolute top-0 left-0 right-0 h-6 z-10 pointer-events-none transition-opacity duration-200 bg-gradient-to-b from-background to-transparent ${
            isScrolled ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
        >
          <div className="px-3 py-4 space-y-3">
            {/* Empty/welcome state */}
            {!hasMessages && (
              <div className="flex flex-col items-center text-center px-2 pt-6 pb-2 space-y-4 animate-fade-in-up-fast">
                <div className="w-10 h-10 rounded-full bg-secondary/60 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-muted-foreground/70" />
                </div>
                <div>
                  <p className="text-xs text-foreground/80 leading-relaxed max-w-[260px]">
                    Ask me to configure your bot — I can change models, connect
                    platforms, update the system prompt, manage skills, and more.
                  </p>
                </div>

                {/* Quick action chips */}
                <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => handleQuickAction(action.prompt)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium
                        bg-secondary/50 text-muted-foreground border border-border/50
                        hover:bg-secondary hover:text-foreground hover:border-border
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-all duration-150 cursor-pointer"
                    >
                      <action.icon className="w-3 h-3" />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((msg) => (
              <ConfigMessageBubble
                key={msg.id}
                message={msg}
                threadId={currentThreadId}
                deploymentId={deploymentId}
              />
            ))}

            {/* Streaming/waiting indicator */}
            {(isStreaming || isWaiting) && hasMessages && (
              <div className="flex items-center gap-2 text-muted-foreground pl-8">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[11px]">
                  {isWaiting ? "Thinking..." : "Streaming..."}
                </span>
              </div>
            )}

            {/* Error display */}
            {submitError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {submitError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="px-3 pt-2 pb-1">
          <span className="text-[10px] text-muted-foreground/60">
            Ask about config...
          </span>
        </div>
        <form
          onSubmit={handleSubmit}
          className="px-3 pb-3 flex gap-2 items-center"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Change model, connect platform, edit prompt..."
            className="flex-1 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs
              placeholder:text-muted-foreground/50
              focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/40
              disabled:opacity-50
              transition-colors"
            disabled={isBusy}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!value.trim() || isBusy}
            className="h-8 w-8 p-0 rounded-lg"
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="w-3.5 h-3.5" />
            )}
          </Button>
        </form>
        <div className="px-3 pb-2">
          <span className="text-[9px] text-muted-foreground/40">
            Press Enter to send
          </span>
        </div>
      </div>
    </>
  );
}

// ── Config Message Bubble ───────────────────────────────────────────────────

function ConfigMessageBubble({
  message,
  threadId,
  deploymentId,
}: {
  message: TamboThreadMessage;
  threadId: string;
  deploymentId: string;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""} animate-fade-in-up-fast`}>
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isUser ? "bg-primary/10" : "bg-secondary/80"
        }`}
      >
        {isUser ? (
          <User className="w-3 h-3 text-primary" />
        ) : (
          <Sparkles className="w-3 h-3 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""} space-y-1.5`}>
        {(() => {
          const hasStreamingComponent = !isUser && message.content.some(
            (b) => b.type === "component" && (b as any).name === "StreamingBotMessage"
          );
          return message.content
            .filter((block) => !(hasStreamingComponent && block.type === "text"))
            .map((block, i) => (
              <ConfigContentBlock
                key={`${message.id}-${i}`}
                block={block}
                isUser={isUser}
                threadId={threadId}
                messageId={message.id}
              />
            ));
        })()}
      </div>
    </div>
  );
}

// ── Content Block Renderer ──────────────────────────────────────────────────

function ConfigContentBlock({
  block,
  isUser,
  threadId,
  messageId,
}: {
  block: Content;
  isUser: boolean;
  threadId: string;
  messageId: string;
}) {
  // Text blocks
  if (block.type === "text" && block.text) {
    if (isUser) {
      return (
        <div className="inline-block rounded-lg px-3 py-1.5 text-xs leading-relaxed bg-primary text-primary-foreground max-w-[85%]">
          <span className="whitespace-pre-wrap">{block.text}</span>
        </div>
      );
    }
    return (
      <div className="inline-block rounded-lg px-3 py-2 text-xs leading-relaxed bg-secondary/20 text-foreground max-w-[95%]">
        <MarkdownMessage content={block.text} />
      </div>
    );
  }

  // Component blocks (Tambo-rendered components)
  if (block.type === "component") {
    return (
      <div className="max-w-full">
        <ComponentRenderer
          content={block}
          threadId={threadId}
          messageId={messageId}
          fallback={
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-300">
              Unknown: {block.name}
            </div>
          }
        />
      </div>
    );
  }

  // Tool use blocks — extracted to own component to keep hooks unconditional
  if (block.type === "tool_use") {
    return <ToolUseIndicator block={block} />;
  }

  return null;
}

// ── Tool Use Indicator ──────────────────────────────────────────────────────

function ToolUseIndicator({ block }: { block: Content }) {
  const hasCompleted = (block as any).hasCompleted;
  const statusMessage = (block as any).statusMessage;
  const toolName = (block as any).name;

  // Log tool executions
  useEffect(() => {
    logConfig("Tool execution:", {
      tool: toolName,
      completed: hasCompleted,
      status: statusMessage,
    });
  }, [hasCompleted, toolName, statusMessage]);

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-secondary/20 border border-border/30 text-[11px] text-muted-foreground">
      {hasCompleted ? (
        <Wrench className="w-3 h-3 text-muted-foreground/70" />
      ) : (
        <Loader2 className="w-3 h-3 animate-spin text-primary/60" />
      )}
      <span>
        {toolName && (
          <span className="font-mono text-[10px] text-muted-foreground/80 mr-1.5">
            {toolName}
          </span>
        )}
        {statusMessage && (
          <span className="text-muted-foreground/60">
            {statusMessage}
          </span>
        )}
        {!toolName && !statusMessage && "Running..."}
      </span>
    </div>
  );
}
