"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { ChatSession } from "@/components/chat/ChatSessionSidebar";
import type { DirectChatMessage } from "@/hooks/useDirectChat";

interface UseChatSessionsReturn {
  sessions: ChatSession[];
  isLoading: boolean;
  activeSessionId: string | null;
  loadSession: (sessionId: string) => Promise<DirectChatMessage[]>;
  startNewChat: () => void;
  refreshSessions: () => void;
}

export function useChatSessions(deploymentId: string): UseChatSessionsReturn {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchSessions = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/tambo-agent/sessions/${deploymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
      }
    } catch (err) {
      console.error("[useChatSessions] Failed to fetch sessions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [deploymentId, isAuthenticated, getAccessTokenSilently]);

  // Fetch on mount
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchSessions();
  }, [fetchSessions]);

  const loadSession = useCallback(
    async (sessionId: string): Promise<DirectChatMessage[]> => {
      setActiveSessionId(sessionId);
      try {
        const token = await getAccessTokenSilently();
        const res = await fetch(
          `${API_URL}/api/tambo-agent/sessions/${deploymentId}/${sessionId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinkingText: m.thinkingText,
        }));
      } catch (err) {
        console.error("[useChatSessions] Failed to load session:", err);
        return [];
      }
    },
    [deploymentId, getAccessTokenSilently]
  );

  const startNewChat = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  return {
    sessions,
    isLoading,
    activeSessionId,
    loadSession,
    startNewChat,
    refreshSessions: fetchSessions,
  };
}
