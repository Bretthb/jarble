"use client";

import { useState } from "react";
import { Plus, MessageSquare, Trash2, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChatSession {
  sessionId: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

interface ChatSessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession?: (sessionId: string) => void;
  isLoading: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupSessionsByDate(sessions: ChatSession[]): Map<string, ChatSession[]> {
  const groups = new Map<string, ChatSession[]>();

  for (const session of sessions) {
    const date = new Date(session.createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let label: string;
    if (diffDays === 0) label = "Today";
    else if (diffDays === 1) label = "Yesterday";
    else if (diffDays < 7) label = "Last 7 days";
    else label = "Older";

    const existing = groups.get(label) ?? [];
    existing.push(session);
    groups.set(label, existing);
  }

  return groups;
}

export function ChatSessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  isLoading,
  isOpen,
  onToggle,
}: ChatSessionSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const grouped = groupSessionsByDate(sessions);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="w-64 border-r border-border/60 bg-secondary/20 flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="p-3 border-b border-border/40 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">History</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onNewChat}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="Hide sidebar"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No conversations yet</p>
          </div>
        ) : (
          <div className="py-1">
            {Array.from(grouped.entries()).map(([label, groupSessions]) => (
              <div key={label}>
                <div className="px-3 py-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    {label}
                  </span>
                </div>
                {groupSessions.map((session) => (
                  <button
                    key={session.sessionId}
                    onClick={() => onSelectSession(session.sessionId)}
                    onMouseEnter={() => setHoveredId(session.sessionId)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors relative group",
                      activeSessionId === session.sessionId
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <div className="truncate pr-6 text-xs leading-relaxed">
                      {session.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                      {session.messageCount} message{session.messageCount !== 1 ? "s" : ""}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
