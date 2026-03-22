import type { ChatMessage } from "@/hooks/useCanvasChat";

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview?: string;
}

export interface ConversationIndex {
  conversations: ConversationMeta[];
  activeId: string | null;
}

const INDEX_PREFIX = "jarble-conversations-";
const MESSAGES_PREFIX = "jarble-conv-";
const LEGACY_PREFIX = "jarble-chat-";
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 100;
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function indexKey(deploymentId: string) {
  return `${INDEX_PREFIX}${deploymentId}`;
}

function messagesKey(deploymentId: string, conversationId: string) {
  return `${MESSAGES_PREFIX}${deploymentId}-${conversationId}`;
}

export function loadConversationIndex(deploymentId: string): ConversationIndex {
  try {
    const raw = localStorage.getItem(indexKey(deploymentId));
    if (!raw) return { conversations: [], activeId: null };
    const index: ConversationIndex = JSON.parse(raw);
    const now = Date.now();
    index.conversations = index.conversations.filter(
      (c) => now - c.updatedAt < EXPIRY_MS
    );
    return index;
  } catch {
    return { conversations: [], activeId: null };
  }
}

export function saveConversationIndex(deploymentId: string, index: ConversationIndex): void {
  try {
    const trimmed = {
      ...index,
      conversations: index.conversations.slice(0, MAX_CONVERSATIONS),
    };
    localStorage.setItem(indexKey(deploymentId), JSON.stringify(trimmed));
  } catch {}
}

export function loadConversationMessages(deploymentId: string, conversationId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(messagesKey(deploymentId, conversationId));
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

/** Returns true if save succeeded, false if quota exceeded */
export function saveConversationMessages(deploymentId: string, conversationId: string, messages: ChatMessage[]): boolean {
  try {
    const trimmed = messages.slice(-MAX_MESSAGES);
    localStorage.setItem(messagesKey(deploymentId, conversationId), JSON.stringify(trimmed));
    return true;
  } catch (err) {
    // QuotaExceededError — try evicting oldest conversations to make room
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      try {
        const index = loadConversationIndex(deploymentId);
        // Evict oldest conversation (not the current one) to free space
        const evictable = index.conversations
          .filter((c) => c.id !== conversationId)
          .sort((a, b) => a.updatedAt - b.updatedAt);
        if (evictable.length > 0) {
          deleteConversation(deploymentId, evictable[0].id);
          // Retry save after eviction
          const trimmed = messages.slice(-MAX_MESSAGES);
          localStorage.setItem(messagesKey(deploymentId, conversationId), JSON.stringify(trimmed));
          return true;
        }
      } catch {
        // Eviction also failed — give up
      }
    }
    return false;
  }
}

export function deleteConversation(deploymentId: string, conversationId: string): void {
  try {
    localStorage.removeItem(messagesKey(deploymentId, conversationId));
    const index = loadConversationIndex(deploymentId);
    index.conversations = index.conversations.filter((c) => c.id !== conversationId);
    if (index.activeId === conversationId) {
      index.activeId = index.conversations[0]?.id ?? null;
    }
    saveConversationIndex(deploymentId, index);
  } catch {}
}

export function createConversation(deploymentId: string, title = "New Conversation"): ConversationMeta {
  const now = Date.now();
  const meta: ConversationMeta = {
    id: `conv-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  const index = loadConversationIndex(deploymentId);
  index.conversations.unshift(meta);
  index.activeId = meta.id;
  if (index.conversations.length > MAX_CONVERSATIONS) {
    const removed = index.conversations.pop()!;
    localStorage.removeItem(messagesKey(deploymentId, removed.id));
  }
  saveConversationIndex(deploymentId, index);
  return meta;
}

export function migrateFromLegacy(deploymentId: string): void {
  try {
    const legacyKey = `${LEGACY_PREFIX}${deploymentId}`;
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    const { messages, savedAt } = JSON.parse(raw);
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      localStorage.removeItem(legacyKey);
      return;
    }
    if (Date.now() - savedAt > EXPIRY_MS) {
      localStorage.removeItem(legacyKey);
      return;
    }
    const existing = loadConversationIndex(deploymentId);
    if (existing.conversations.length > 0) {
      localStorage.removeItem(legacyKey);
      return;
    }
    const firstUserMsg = messages.find((m: ChatMessage) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 50)
      : "Imported Conversation";
    const meta = createConversation(deploymentId, title);
    meta.messageCount = messages.length;
    const lastAssistant = [...messages].reverse().find((m: ChatMessage) => m.role === "assistant");
    if (lastAssistant) {
      meta.preview = lastAssistant.content.slice(0, 80);
    }
    meta.updatedAt = savedAt || Date.now();
    meta.createdAt = messages[0]?.createdAt || savedAt || Date.now();
    saveConversationMessages(deploymentId, meta.id, messages);
    const index = loadConversationIndex(deploymentId);
    const idx = index.conversations.findIndex((c) => c.id === meta.id);
    if (idx !== -1) index.conversations[idx] = meta;
    saveConversationIndex(deploymentId, index);
    localStorage.removeItem(legacyKey);
  } catch {}
}
