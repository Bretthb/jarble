import { describe, it, expect, beforeEach } from "vitest";
import {
  loadConversationIndex,
  saveConversationIndex,
  loadConversationMessages,
  saveConversationMessages,
  deleteConversation,
  createConversation,
  migrateFromLegacy,
} from "../conversationStorage";
import type { ConversationIndex, ConversationMeta } from "../conversationStorage";
import type { ChatMessage } from "@/hooks/useCanvasChat";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEP = "test-dep";
const INDEX_KEY = `jarble-conversations-${DEP}`;
const LEGACY_KEY = `jarble-chat-${DEP}`;

function msgKey(convId: string) {
  return `jarble-conv-${DEP}-${convId}`;
}

function makeMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: overrides.id ?? "conv-1",
    title: overrides.title ?? "Test Conversation",
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    messageCount: overrides.messageCount ?? 0,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role ?? "user",
    content: overrides.content ?? "Hello",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

function storeIndex(index: ConversationIndex) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function readIndex(): ConversationIndex {
  const raw = localStorage.getItem(INDEX_KEY);
  return raw ? JSON.parse(raw) : { conversations: [], activeId: null };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("conversationStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── loadConversationIndex ────────────────────────────────────────────────

  describe("loadConversationIndex", () => {
    it("returns empty index when localStorage has no data", () => {
      const index = loadConversationIndex(DEP);
      expect(index).toEqual({ conversations: [], activeId: null });
    });

    it("parses stored JSON index correctly", () => {
      const meta = makeMeta({ id: "conv-abc", title: "My Chat" });
      storeIndex({ conversations: [meta], activeId: "conv-abc" });

      const index = loadConversationIndex(DEP);
      expect(index.conversations).toHaveLength(1);
      expect(index.conversations[0].id).toBe("conv-abc");
      expect(index.conversations[0].title).toBe("My Chat");
      expect(index.activeId).toBe("conv-abc");
    });

    it("filters out expired conversations (> 7 days)", () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const fresh = makeMeta({ id: "fresh", updatedAt: Date.now() });
      const expired = makeMeta({ id: "expired", updatedAt: eightDaysAgo });
      storeIndex({ conversations: [fresh, expired], activeId: "fresh" });

      const index = loadConversationIndex(DEP);
      expect(index.conversations).toHaveLength(1);
      expect(index.conversations[0].id).toBe("fresh");
    });

    it("handles corrupt JSON gracefully (returns empty)", () => {
      localStorage.setItem(INDEX_KEY, "not-valid-json{{{");

      const index = loadConversationIndex(DEP);
      expect(index).toEqual({ conversations: [], activeId: null });
    });
  });

  // ── saveConversationIndex ────────────────────────────────────────────────

  describe("saveConversationIndex", () => {
    it("stores JSON in localStorage", () => {
      const meta = makeMeta({ id: "conv-1" });
      const index: ConversationIndex = { conversations: [meta], activeId: "conv-1" };

      saveConversationIndex(DEP, index);

      const stored = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(stored.conversations).toHaveLength(1);
      expect(stored.conversations[0].id).toBe("conv-1");
      expect(stored.activeId).toBe("conv-1");
    });

    it("trims to MAX_CONVERSATIONS (20)", () => {
      const conversations = Array.from({ length: 25 }, (_, i) =>
        makeMeta({ id: `conv-${i}` })
      );
      const index: ConversationIndex = { conversations, activeId: "conv-0" };

      saveConversationIndex(DEP, index);

      const stored = JSON.parse(localStorage.getItem(INDEX_KEY)!);
      expect(stored.conversations).toHaveLength(20);
    });
  });

  // ── loadConversationMessages ─────────────────────────────────────────────

  describe("loadConversationMessages", () => {
    it("returns empty array when no messages stored", () => {
      const messages = loadConversationMessages(DEP, "conv-1");
      expect(messages).toEqual([]);
    });

    it("parses stored messages correctly", () => {
      const msgs = [makeMessage({ id: "m1", content: "Hello" }), makeMessage({ id: "m2", role: "assistant", content: "Hi!" })];
      localStorage.setItem(msgKey("conv-1"), JSON.stringify(msgs));

      const loaded = loadConversationMessages(DEP, "conv-1");
      expect(loaded).toHaveLength(2);
      expect(loaded[0].content).toBe("Hello");
      expect(loaded[1].content).toBe("Hi!");
    });

    it("handles corrupt JSON (returns empty)", () => {
      localStorage.setItem(msgKey("conv-1"), "broken-json}}");

      const loaded = loadConversationMessages(DEP, "conv-1");
      expect(loaded).toEqual([]);
    });
  });

  // ── saveConversationMessages ─────────────────────────────────────────────

  describe("saveConversationMessages", () => {
    it("stores messages, trimmed to MAX_MESSAGES (100)", () => {
      const msgs = Array.from({ length: 120 }, (_, i) =>
        makeMessage({ id: `m-${i}`, content: `Message ${i}` })
      );

      saveConversationMessages(DEP, "conv-1", msgs);

      const stored: ChatMessage[] = JSON.parse(localStorage.getItem(msgKey("conv-1"))!);
      expect(stored).toHaveLength(100);
      // Should keep the LAST 100 messages (slice(-100))
      expect(stored[0].content).toBe("Message 20");
      expect(stored[99].content).toBe("Message 119");
    });

    it("returns true on success", () => {
      const msgs = [makeMessage()];
      const result = saveConversationMessages(DEP, "conv-1", msgs);
      expect(result).toBe(true);
    });

    it("handles QuotaExceededError by evicting oldest conversation", () => {
      // Set up an older conversation to be evicted
      const olderMeta = makeMeta({ id: "old-conv", updatedAt: Date.now() - 60000 });
      const currentMeta = makeMeta({ id: "current-conv", updatedAt: Date.now() });
      storeIndex({ conversations: [currentMeta, olderMeta], activeId: "current-conv" });
      localStorage.setItem(msgKey("old-conv"), JSON.stringify([makeMessage({ content: "old" })]));

      // Override setItem to throw QuotaExceededError on first call, then succeed
      let callCount = 0;
      const originalSetItem = localStorage.setItem.bind(localStorage);
      const setItemSpy = Object.getOwnPropertyDescriptor(
        Storage.prototype,
        "setItem"
      )!;
      Object.defineProperty(Storage.prototype, "setItem", {
        value: function (key: string, value: string) {
          // Throw QuotaExceededError only on the first attempt to save messages for current-conv
          if (key === msgKey("current-conv") && callCount === 0) {
            callCount++;
            const err = new DOMException("Storage quota exceeded", "QuotaExceededError");
            throw err;
          }
          return originalSetItem.call(localStorage, key, value);
        },
        writable: true,
        configurable: true,
      });

      const result = saveConversationMessages(DEP, "current-conv", [makeMessage({ content: "new" })]);

      // Restore original setItem
      Object.defineProperty(Storage.prototype, "setItem", setItemSpy);

      expect(result).toBe(true);
      // The old conversation's messages should have been removed
      expect(localStorage.getItem(msgKey("old-conv"))).toBeNull();
    });

    it("returns false when eviction also fails", () => {
      // Set up index with only the current conversation (nothing to evict)
      const meta = makeMeta({ id: "only-conv" });
      storeIndex({ conversations: [meta], activeId: "only-conv" });

      // Override setItem to always throw QuotaExceededError for messages
      const originalSetItem = localStorage.setItem.bind(localStorage);
      const setItemSpy = Object.getOwnPropertyDescriptor(
        Storage.prototype,
        "setItem"
      )!;
      Object.defineProperty(Storage.prototype, "setItem", {
        value: function (key: string, value: string) {
          if (key === msgKey("only-conv")) {
            throw new DOMException("Storage quota exceeded", "QuotaExceededError");
          }
          return originalSetItem.call(localStorage, key, value);
        },
        writable: true,
        configurable: true,
      });

      const result = saveConversationMessages(DEP, "only-conv", [makeMessage()]);

      // Restore original setItem
      Object.defineProperty(Storage.prototype, "setItem", setItemSpy);

      expect(result).toBe(false);
    });
  });

  // ── deleteConversation ───────────────────────────────────────────────────

  describe("deleteConversation", () => {
    it("removes messages key and updates index", () => {
      const meta1 = makeMeta({ id: "conv-1" });
      const meta2 = makeMeta({ id: "conv-2" });
      storeIndex({ conversations: [meta1, meta2], activeId: "conv-1" });
      localStorage.setItem(msgKey("conv-2"), JSON.stringify([makeMessage()]));

      deleteConversation(DEP, "conv-2");

      expect(localStorage.getItem(msgKey("conv-2"))).toBeNull();
      const index = readIndex();
      expect(index.conversations).toHaveLength(1);
      expect(index.conversations[0].id).toBe("conv-1");
    });

    it("sets activeId to first remaining conversation", () => {
      const meta1 = makeMeta({ id: "conv-1" });
      const meta2 = makeMeta({ id: "conv-2" });
      storeIndex({ conversations: [meta1, meta2], activeId: "conv-1" });

      deleteConversation(DEP, "conv-1");

      const index = readIndex();
      expect(index.activeId).toBe("conv-2");
    });

    it("sets activeId to null when last conversation deleted", () => {
      const meta = makeMeta({ id: "conv-only" });
      storeIndex({ conversations: [meta], activeId: "conv-only" });

      deleteConversation(DEP, "conv-only");

      const index = readIndex();
      expect(index.conversations).toHaveLength(0);
      expect(index.activeId).toBeNull();
    });
  });

  // ── createConversation ───────────────────────────────────────────────────

  describe("createConversation", () => {
    it("creates new conversation with generated ID and timestamp", () => {
      const meta = createConversation(DEP, "My Chat");

      expect(meta.id).toMatch(/^conv-\d+-[a-z0-9]+$/);
      expect(meta.title).toBe("My Chat");
      expect(meta.createdAt).toBeGreaterThan(0);
      expect(meta.updatedAt).toBe(meta.createdAt);
      expect(meta.messageCount).toBe(0);
    });

    it("sets it as activeId in index", () => {
      const meta = createConversation(DEP);

      const index = readIndex();
      expect(index.activeId).toBe(meta.id);
      expect(index.conversations[0].id).toBe(meta.id);
    });

    it("evicts oldest when MAX_CONVERSATIONS exceeded", () => {
      // Pre-fill with 20 conversations; conv-0 is first in array, conv-19 is last
      const conversations = Array.from({ length: 20 }, (_, i) =>
        makeMeta({ id: `conv-${i}`, updatedAt: Date.now() - (20 - i) * 1000 })
      );
      storeIndex({ conversations, activeId: "conv-0" });
      // Store messages for the last entry (conv-19) which will be popped after unshift
      localStorage.setItem(msgKey("conv-19"), JSON.stringify([makeMessage()]));

      const newMeta = createConversation(DEP, "New Chat");

      const index = readIndex();
      // Should still have at most 20
      expect(index.conversations.length).toBeLessThanOrEqual(20);
      // New conversation should be first
      expect(index.conversations[0].id).toBe(newMeta.id);
      // Last element in array (conv-19) is evicted by pop() after unshift
      const ids = index.conversations.map((c) => c.id);
      expect(ids).not.toContain("conv-19");
      expect(localStorage.getItem(msgKey("conv-19"))).toBeNull();
    });
  });

  // ── migrateFromLegacy ────────────────────────────────────────────────────

  describe("migrateFromLegacy", () => {
    it("migrates old-format messages to new conversation system", () => {
      const legacyMessages = [
        makeMessage({ id: "leg-1", role: "user", content: "Hello from the past" }),
        makeMessage({ id: "leg-2", role: "assistant", content: "Greetings!" }),
      ];
      localStorage.setItem(
        LEGACY_KEY,
        JSON.stringify({ messages: legacyMessages, savedAt: Date.now() })
      );

      migrateFromLegacy(DEP);

      // Legacy key should be removed
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

      // New index should have one conversation
      const index = loadConversationIndex(DEP);
      expect(index.conversations).toHaveLength(1);
      expect(index.conversations[0].title).toBe("Hello from the past");
      expect(index.conversations[0].messageCount).toBe(2);
      expect(index.conversations[0].preview).toBe("Greetings!");

      // Messages should be stored under the new key
      const convId = index.conversations[0].id;
      const storedMsgs = loadConversationMessages(DEP, convId);
      expect(storedMsgs).toHaveLength(2);
      expect(storedMsgs[0].content).toBe("Hello from the past");
    });
  });
});
