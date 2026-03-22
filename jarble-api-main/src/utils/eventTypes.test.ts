import { describe, it, expect } from "vitest";
import * as eventTypes from "./eventTypes.js";

describe("eventTypes", () => {
  describe("AG-UI standard events", () => {
    it("exports RUN_STARTED", () => {
      expect(eventTypes.RUN_STARTED).toBe("RUN_STARTED");
    });

    it("exports TEXT_MESSAGE_START", () => {
      expect(eventTypes.TEXT_MESSAGE_START).toBe("TEXT_MESSAGE_START");
    });

    it("exports TEXT_MESSAGE_CONTENT", () => {
      expect(eventTypes.TEXT_MESSAGE_CONTENT).toBe("TEXT_MESSAGE_CONTENT");
    });

    it("exports TEXT_MESSAGE_END", () => {
      expect(eventTypes.TEXT_MESSAGE_END).toBe("TEXT_MESSAGE_END");
    });

    it("exports RUN_FINISHED", () => {
      expect(eventTypes.RUN_FINISHED).toBe("RUN_FINISHED");
    });
  });

  describe("AG-UI tool call events", () => {
    it("exports TOOL_CALL_START", () => {
      expect(eventTypes.TOOL_CALL_START).toBe("TOOL_CALL_START");
    });

    it("exports TOOL_CALL_ARGS", () => {
      expect(eventTypes.TOOL_CALL_ARGS).toBe("TOOL_CALL_ARGS");
    });

    it("exports TOOL_CALL_END", () => {
      expect(eventTypes.TOOL_CALL_END).toBe("TOOL_CALL_END");
    });
  });

  describe("AG-UI custom event wrapper", () => {
    it("exports CUSTOM", () => {
      expect(eventTypes.CUSTOM).toBe("CUSTOM");
    });
  });

  describe("AG-UI reasoning events", () => {
    it("exports REASONING_START", () => {
      expect(eventTypes.REASONING_START).toBe("REASONING_START");
    });

    it("exports REASONING_CONTENT", () => {
      expect(eventTypes.REASONING_CONTENT).toBe("REASONING_CONTENT");
    });

    it("exports REASONING_END", () => {
      expect(eventTypes.REASONING_END).toBe("REASONING_END");
    });
  });

  describe("Phase 2 agent call custom events", () => {
    it("exports CUSTOM_AGENT_CALL_START with correct event name", () => {
      expect(eventTypes.CUSTOM_AGENT_CALL_START).toBe("jarble.agent.call.start");
    });

    it("exports CUSTOM_AGENT_CALL_END with correct event name", () => {
      expect(eventTypes.CUSTOM_AGENT_CALL_END).toBe("jarble.agent.call.end");
    });

    it("uses jarble namespace prefix for agent call events", () => {
      expect(eventTypes.CUSTOM_AGENT_CALL_START).toMatch(/^jarble\./);
      expect(eventTypes.CUSTOM_AGENT_CALL_END).toMatch(/^jarble\./);
    });
  });

  describe("other custom event names", () => {
    it("exports CUSTOM_CARD_UPDATE", () => {
      expect(eventTypes.CUSTOM_CARD_UPDATE).toBe("jarble.card.update");
    });

    it("exports CUSTOM_CHAT_ERROR", () => {
      expect(eventTypes.CUSTOM_CHAT_ERROR).toBe("jarble.chat.error");
    });

    it("exports CUSTOM_SUGGESTIONS", () => {
      expect(eventTypes.CUSTOM_SUGGESTIONS).toBe("jarble.suggestions");
    });

    it("exports CUSTOM_TOOL_STATUS", () => {
      expect(eventTypes.CUSTOM_TOOL_STATUS).toBe("jarble.tool.status");
    });
  });
});
