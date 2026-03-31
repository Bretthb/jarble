/**
 * Tests for the dev handler runtime - in-process handler execution,
 * store persistence, and event streaming (subscribe/emit).
 *
 * This is the core of the streaming todo service:
 * - Handler code runs in-process via new Function()
 * - Each service gets an isolated key-value store
 * - Mutations emit events to subscribers (SSE backing)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  executeHandlerLocally,
  clearAllStores,
  getStoreSnapshot,
  subscribe,
  subscriberCount,
  clearStore,
} from "../devHandlerRuntime.js";

// ── Handler code (same JS that would run in the creator pod) ────────────────

const HANDLER_ADD_TODO = `
  const todos = context.store.get("todos") || [];
  const todo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: args.text,
    completed: false,
    createdBy: args._callerDeploymentId || "unknown",
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  context.store.set("todos", todos);
  return { success: true, todo, totalCount: todos.length };
`;

const HANDLER_LIST_TODOS = `
  const todos = context.store.get("todos") || [];
  return { todos, totalCount: todos.length };
`;

const HANDLER_COMPLETE_TODO = `
  const todos = context.store.get("todos") || [];
  const idx = todos.findIndex(t => t.id === args.id);
  if (idx === -1) throw new Error("Todo not found: " + args.id);
  todos[idx].completed = true;
  todos[idx].completedAt = new Date().toISOString();
  context.store.set("todos", todos);
  return { success: true, todo: todos[idx] };
`;

const HANDLER_DELETE_TODO = `
  const todos = context.store.get("todos") || [];
  const idx = todos.findIndex(t => t.id === args.id);
  if (idx === -1) throw new Error("Todo not found: " + args.id);
  const deleted = todos.splice(idx, 1)[0];
  context.store.set("todos", todos);
  return { success: true, deleted, remainingCount: todos.length };
`;

const SERVICE_ID = "svc_todo_test";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Dev Handler Runtime - Streaming Todo Service", () => {
  beforeEach(() => {
    clearAllStores();
  });

  // ── Basic CRUD ──────────────────────────────────────────────────────────

  describe("CRUD operations", () => {
    it("add-todo creates a todo in the store", async () => {
      const result = await executeHandlerLocally(
        SERVICE_ID,
        "add-todo",
        HANDLER_ADD_TODO,
        { text: "Buy groceries" },
      );

      expect(result.ok).toBe(true);
      expect((result.result as any).success).toBe(true);
      expect((result.result as any).todo.text).toBe("Buy groceries");
      expect((result.result as any).todo.completed).toBe(false);
      expect((result.result as any).totalCount).toBe(1);
    });

    it("list-todos returns all todos", async () => {
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Todo A" });
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Todo B" });
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Todo C" });

      const result = await executeHandlerLocally(
        SERVICE_ID,
        "list-todos",
        HANDLER_LIST_TODOS,
        {},
      );

      expect(result.ok).toBe(true);
      const data = result.result as any;
      expect(data.totalCount).toBe(3);
      expect(data.todos.map((t: any) => t.text)).toEqual(["Todo A", "Todo B", "Todo C"]);
    });

    it("complete-todo marks a todo as done", async () => {
      const addResult = await executeHandlerLocally(
        SERVICE_ID,
        "add-todo",
        HANDLER_ADD_TODO,
        { text: "Write tests" },
      );
      const todoId = (addResult.result as any).todo.id;

      const result = await executeHandlerLocally(
        SERVICE_ID,
        "complete-todo",
        HANDLER_COMPLETE_TODO,
        { id: todoId },
      );

      expect(result.ok).toBe(true);
      expect((result.result as any).todo.completed).toBe(true);
      expect((result.result as any).todo.completedAt).toBeDefined();
    });

    it("delete-todo removes a todo and returns remaining count", async () => {
      const add1 = await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "A" });
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "B" });
      const todoId = (add1.result as any).todo.id;

      const result = await executeHandlerLocally(
        SERVICE_ID,
        "delete-todo",
        HANDLER_DELETE_TODO,
        { id: todoId },
      );

      expect(result.ok).toBe(true);
      expect((result.result as any).deleted.text).toBe("A");
      expect((result.result as any).remainingCount).toBe(1);
    });

    it("delete non-existent todo returns error", async () => {
      const result = await executeHandlerLocally(
        SERVICE_ID,
        "delete-todo",
        HANDLER_DELETE_TODO,
        { id: "nonexistent" },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Todo not found");
    });

    it("complete non-existent todo returns error", async () => {
      const result = await executeHandlerLocally(
        SERVICE_ID,
        "complete-todo",
        HANDLER_COMPLETE_TODO,
        { id: "nope" },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Todo not found");
    });
  });

  // ── Store isolation ─────────────────────────────────────────────────────

  describe("Store isolation", () => {
    it("different services have isolated stores", async () => {
      await executeHandlerLocally("svc_a", "add-todo", HANDLER_ADD_TODO, { text: "Service A" });
      await executeHandlerLocally("svc_b", "add-todo", HANDLER_ADD_TODO, { text: "Service B" });

      const listA = await executeHandlerLocally("svc_a", "list-todos", HANDLER_LIST_TODOS, {});
      const listB = await executeHandlerLocally("svc_b", "list-todos", HANDLER_LIST_TODOS, {});

      expect((listA.result as any).totalCount).toBe(1);
      expect((listA.result as any).todos[0].text).toBe("Service A");

      expect((listB.result as any).totalCount).toBe(1);
      expect((listB.result as any).todos[0].text).toBe("Service B");
    });

    it("clearStore only clears one service", async () => {
      await executeHandlerLocally("svc_a", "add-todo", HANDLER_ADD_TODO, { text: "A" });
      await executeHandlerLocally("svc_b", "add-todo", HANDLER_ADD_TODO, { text: "B" });

      clearStore("svc_a");

      const listA = await executeHandlerLocally("svc_a", "list-todos", HANDLER_LIST_TODOS, {});
      const listB = await executeHandlerLocally("svc_b", "list-todos", HANDLER_LIST_TODOS, {});

      expect((listA.result as any).totalCount).toBe(0);
      expect((listB.result as any).totalCount).toBe(1);
    });

    it("getStoreSnapshot returns raw store data", async () => {
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Snap" });

      const snapshot = getStoreSnapshot(SERVICE_ID);
      expect(snapshot.todos).toBeDefined();
      expect((snapshot.todos as any[])[0].text).toBe("Snap");
    });
  });

  // ── Event streaming (subscribe/emit) ────────────────────────────────────

  describe("Real-time event streaming", () => {
    it("subscriber receives mutation events for add-todo", async () => {
      const events: any[] = [];
      const unsub = subscribe(SERVICE_ID, (event) => events.push(event));

      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Buy milk" });
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Buy eggs" });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("mutation");
      expect(events[0].skillName).toBe("add-todo");
      expect(events[0].data.todo.text).toBe("Buy milk");
      expect(events[0].serviceId).toBe(SERVICE_ID);
      expect(events[0].timestamp).toBeDefined();

      expect(events[1].data.todo.text).toBe("Buy eggs");

      unsub();
    });

    it("subscriber receives delete and complete events", async () => {
      const events: any[] = [];
      const unsub = subscribe(SERVICE_ID, (event) => events.push(event));

      // Add, complete, delete
      const addResult = await executeHandlerLocally(
        SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Task" },
      );
      const todoId = (addResult.result as any).todo.id;

      await executeHandlerLocally(
        SERVICE_ID, "complete-todo", HANDLER_COMPLETE_TODO, { id: todoId },
      );
      await executeHandlerLocally(
        SERVICE_ID, "delete-todo", HANDLER_DELETE_TODO, { id: todoId },
      );

      expect(events).toHaveLength(3);
      expect(events[0].skillName).toBe("add-todo");
      expect(events[1].skillName).toBe("complete-todo");
      expect(events[1].data.todo.completed).toBe(true);
      expect(events[2].skillName).toBe("delete-todo");
      expect(events[2].data.remainingCount).toBe(0);

      unsub();
    });

    it("unsubscribe stops events", async () => {
      const events: any[] = [];
      const unsub = subscribe(SERVICE_ID, (event) => events.push(event));

      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Before" });
      unsub();
      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "After" });

      expect(events).toHaveLength(1);
      expect(events[0].data.todo.text).toBe("Before");
    });

    it("multiple subscribers all receive events", async () => {
      const events1: any[] = [];
      const events2: any[] = [];

      const unsub1 = subscribe(SERVICE_ID, (e) => events1.push(e));
      const unsub2 = subscribe(SERVICE_ID, (e) => events2.push(e));

      expect(subscriberCount(SERVICE_ID)).toBe(2);

      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Shared" });

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].data.todo.text).toBe("Shared");
      expect(events2[0].data.todo.text).toBe("Shared");

      unsub1();
      unsub2();

      expect(subscriberCount(SERVICE_ID)).toBe(0);
    });

    it("subscriber on service A does not receive service B events", async () => {
      const eventsA: any[] = [];
      const unsub = subscribe("svc_a", (e) => eventsA.push(e));

      await executeHandlerLocally("svc_b", "add-todo", HANDLER_ADD_TODO, { text: "B only" });

      expect(eventsA).toHaveLength(0);

      unsub();
    });

    it("error in subscriber does not crash other subscribers", async () => {
      const events: any[] = [];
      const unsub1 = subscribe(SERVICE_ID, () => { throw new Error("bad subscriber"); });
      const unsub2 = subscribe(SERVICE_ID, (e) => events.push(e));

      await executeHandlerLocally(SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text: "Survives" });

      expect(events).toHaveLength(1);
      expect(events[0].data.todo.text).toBe("Survives");

      unsub1();
      unsub2();
    });
  });

  // ── Full lifecycle ──────────────────────────────────────────────────────

  describe("Full todo lifecycle with streaming", () => {
    it("add → complete → delete with real-time events", async () => {
      const events: any[] = [];
      const unsub = subscribe(SERVICE_ID, (e) => events.push(e));

      // Add 3 todos
      const ids: string[] = [];
      for (const text of ["Write tests", "Review PR", "Deploy"]) {
        const r = await executeHandlerLocally(
          SERVICE_ID, "add-todo", HANDLER_ADD_TODO, { text },
        );
        ids.push((r.result as any).todo.id);
      }

      // Verify list
      const listResult = await executeHandlerLocally(
        SERVICE_ID, "list-todos", HANDLER_LIST_TODOS, {},
      );
      expect((listResult.result as any).totalCount).toBe(3);

      // Complete first
      await executeHandlerLocally(
        SERVICE_ID, "complete-todo", HANDLER_COMPLETE_TODO, { id: ids[0] },
      );

      // Delete second
      await executeHandlerLocally(
        SERVICE_ID, "delete-todo", HANDLER_DELETE_TODO, { id: ids[1] },
      );

      // Final state: 2 todos (1 completed, 1 active)
      const finalList = await executeHandlerLocally(
        SERVICE_ID, "list-todos", HANDLER_LIST_TODOS, {},
      );
      const todos = (finalList.result as any).todos;
      expect(todos).toHaveLength(2);
      expect(todos.find((t: any) => t.text === "Write tests").completed).toBe(true);
      expect(todos.find((t: any) => t.text === "Deploy").completed).toBe(false);

      // Verify event stream: 3 adds + 1 list + 1 complete + 1 delete + 1 list = 7
      // (list-todos also emits because executeHandlerLocally always emits)
      expect(events).toHaveLength(7);
      expect(events.filter((e) => e.skillName === "add-todo")).toHaveLength(3);
      expect(events.filter((e) => e.skillName === "list-todos")).toHaveLength(2);
      expect(events.filter((e) => e.skillName === "complete-todo")).toHaveLength(1);
      expect(events.filter((e) => e.skillName === "delete-todo")).toHaveLength(1);

      unsub();
    });

    it("bidirectional: multiple callers share state via store", async () => {
      const events: any[] = [];
      const unsub = subscribe(SERVICE_ID, (e) => events.push(e));

      // Caller A adds
      const addA = await executeHandlerLocally(
        SERVICE_ID, "add-todo", HANDLER_ADD_TODO,
        { text: "From caller A", _callerDeploymentId: "dep-A" },
      );

      // Caller B adds
      const addB = await executeHandlerLocally(
        SERVICE_ID, "add-todo", HANDLER_ADD_TODO,
        { text: "From caller B", _callerDeploymentId: "dep-B" },
      );

      // Caller A sees both
      const list = await executeHandlerLocally(
        SERVICE_ID, "list-todos", HANDLER_LIST_TODOS, {},
      );
      expect((list.result as any).totalCount).toBe(2);
      expect((list.result as any).todos[0].createdBy).toBe("dep-A");
      expect((list.result as any).todos[1].createdBy).toBe("dep-B");

      // Caller B deletes caller A's todo
      await executeHandlerLocally(
        SERVICE_ID, "delete-todo", HANDLER_DELETE_TODO,
        { id: (addA.result as any).todo.id },
      );

      // Only caller B's todo remains
      const finalList = await executeHandlerLocally(
        SERVICE_ID, "list-todos", HANDLER_LIST_TODOS, {},
      );
      expect((finalList.result as any).totalCount).toBe(1);
      expect((finalList.result as any).todos[0].text).toBe("From caller B");

      // All events captured
      expect(events).toHaveLength(5); // 2 adds + 1 list + 1 delete + 1 list

      unsub();
    });
  });
});
