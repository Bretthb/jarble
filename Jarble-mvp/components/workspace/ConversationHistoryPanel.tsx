"use client";

import { useState } from "react";
import { Plus, MessageSquare, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationMeta } from "@/lib/conversationStorage";

interface ConversationHistoryPanelProps {
  conversations: ConversationMeta[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
  isStreaming: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ConversationHistoryPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onClose,
  isStreaming,
}: ConversationHistoryPanelProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="h-full w-[360px] shrink-0 border-r border-border/60 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary/70" />
          <span className="text-sm font-semibold text-foreground">Conversations</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-md hover:bg-secondary/80 transition-colors"
          aria-label="Close history panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* New Chat button */}
      <div className="px-3 pt-3 pb-1">
        <Button
          onClick={onNewConversation}
          disabled={isStreaming}
          className="w-full justify-start gap-2 h-9"
          variant="default"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No conversations yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Start chatting to create one</p>
          </div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              role="button"
              tabIndex={0}
              onClick={() => !isStreaming && onSelectConversation(conv.id)}
              onKeyDown={(e) => { if (e.key === "Enter" && !isStreaming) onSelectConversation(conv.id); }}
              onMouseEnter={() => setHoveredId(conv.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "w-full text-left px-3 py-2.5 transition-colors relative group cursor-pointer",
                activeConversationId === conv.id
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                isStreaming && "opacity-60 cursor-not-allowed pointer-events-none"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-medium leading-relaxed">
                    {conv.title}
                  </div>
                  {conv.preview && (
                    <div className="truncate text-[10px] text-muted-foreground/60 mt-0.5">
                      {conv.preview}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/50">
                    <span>{formatRelativeTime(conv.updatedAt)}</span>
                    <span>{conv.messageCount} msg{conv.messageCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                {hoveredId === conv.id && !isStreaming && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(conv.id);
                    }}
                    className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
