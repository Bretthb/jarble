"use client";

/**
 * ConfigPanel — slide-out left sidebar for deployment configuration via Tambo.
 *
 * Tambo is repurposed here for config-only: system prompt, platforms, LLM
 * settings, lifecycle ops. Main bot chat goes through the canvas directly.
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
import { X, Loader2, SendHorizontal, Wrench, Bot, User } from "lucide-react";
import MarkdownMessage from "@/components/MarkdownMessage";

interface ConfigPanelProps {
  deploymentId: string;
  onClose: () => void;
}

export default function ConfigPanel({ deploymentId, onClose }: ConfigPanelProps) {
  return (
    <div className="h-full w-[380px] shrink-0 border-r border-border/60 bg-background flex flex-col">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
        <span className="text-sm font-semibold text-foreground">Configuration</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tambo config chat */}
      <ConfigChat deploymentId={deploymentId} />
    </div>
  );
}

// ── Config Chat (Tambo-powered) ───────────────────────────────────────────────

function ConfigChat({ deploymentId }: { deploymentId: string }) {
  const { messages, isStreaming, isWaiting, currentThreadId } = useTambo();
  const { value, setValue, submit, isPending } = useTamboThreadInput();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isBusy = isStreaming || isWaiting || isPending;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!value.trim() || isBusy) return;
      setSubmitError(null);
      try {
        await submit();
      } catch (err: any) {
        setSubmitError(err.message || "Failed to send message");
      }
    },
    [value, isBusy, submit]
  );

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="px-3 py-4 space-y-4">
          {messages.map((msg) => (
            <ConfigMessageBubble
              key={msg.id}
              message={msg}
              threadId={currentThreadId}
              deploymentId={deploymentId}
            />
          ))}
          {(isStreaming || isWaiting) && messages.length > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs">{isWaiting ? "Thinking..." : "Streaming..."}</span>
            </div>
          )}
          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {submitError}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/40 bg-background">
        <form
          onSubmit={handleSubmit}
          className="px-3 py-2 flex gap-2 items-center"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Configure bot..."
            className="flex-1 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary"
            disabled={isBusy}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!value.trim() || isBusy}
            className="h-7 w-7 p-0"
          >
            {isBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="w-3.5 h-3.5" />
            )}
          </Button>
        </form>
      </div>
    </>
  );
}

// ── Config Message Bubble ─────────────────────────────────────────────────────

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
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary/10" : "bg-secondary"
        }`}
      >
        {isUser ? (
          <User className="w-3 h-3 text-primary" />
        ) : (
          <Bot className="w-3 h-3 text-muted-foreground" />
        )}
      </div>

      <div className={`flex-1 ${isUser ? "text-right" : ""} space-y-2`}>
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
  if (block.type === "text" && block.text) {
    if (isUser) {
      return (
        <div className="inline-block rounded-lg px-3 py-1.5 text-xs leading-relaxed bg-primary text-primary-foreground">
          <span className="whitespace-pre-wrap">{block.text}</span>
        </div>
      );
    }
    return (
      <div className="inline-block rounded-lg px-3 py-1.5 text-xs leading-relaxed bg-secondary/50 text-foreground">
        <MarkdownMessage content={block.text} />
      </div>
    );
  }

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

  if (block.type === "tool_use") {
    const toolBlock = block as Content & { type: "tool_use" };
    const hasCompleted = (toolBlock as any).hasCompleted;
    const statusMessage = (toolBlock as any).statusMessage;
    const toolName = (toolBlock as any).name;

    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-secondary/30 border border-border/40 text-xs text-muted-foreground">
        {hasCompleted ? (
          <Wrench className="w-3 h-3" />
        ) : (
          <Loader2 className="w-3 h-3 animate-spin" />
        )}
        <span>{statusMessage || toolName || "Running..."}</span>
      </div>
    );
  }

  return null;
}
