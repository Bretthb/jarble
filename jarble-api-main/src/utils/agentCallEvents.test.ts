import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentCallEvents } from "./agentCallEvents.js";
import type {
  AgentCallStartEvent,
  AgentCallEndEvent,
} from "./agentCallEvents.js";

describe("agentCallEvents", () => {
  beforeEach(() => {
    agentCallEvents.removeAllListeners();
  });

  it("is an EventEmitter instance", () => {
    expect(typeof agentCallEvents.on).toBe("function");
    expect(typeof agentCallEvents.emit).toBe("function");
    expect(typeof agentCallEvents.removeAllListeners).toBe("function");
  });

  it("has maxListeners set to 100 for concurrent SSE streams", () => {
    expect(agentCallEvents.getMaxListeners()).toBe(100);
  });

  it("emits start events with correct payload", () => {
    const handler = vi.fn();
    agentCallEvents.on("start", handler);

    const event: AgentCallStartEvent = {
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
      agentName: "Summarizer",
    };
    agentCallEvents.emit("start", event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("emits end events with correct payload", () => {
    const handler = vi.fn();
    agentCallEvents.on("end", handler);

    const event: AgentCallEndEvent = {
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
      agentName: "Summarizer",
      creditsCharged: 1,
      success: true,
    };
    agentCallEvents.emit("end", event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("emits failure end events with success=false and zero credits", () => {
    const handler = vi.fn();
    agentCallEvents.on("end", handler);

    const event: AgentCallEndEvent = {
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "summarize",
      creditsCharged: 0,
      success: false,
    };
    agentCallEvents.emit("end", event);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, creditsCharged: 0 })
    );
  });

  it("supports multiple listeners on the same event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    agentCallEvents.on("start", handler1);
    agentCallEvents.on("start", handler2);

    agentCallEvents.emit("start", {
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "test",
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("does not cross-fire between start and end events", () => {
    const startHandler = vi.fn();
    const endHandler = vi.fn();
    agentCallEvents.on("start", startHandler);
    agentCallEvents.on("end", endHandler);

    agentCallEvents.emit("start", {
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "test",
    });

    expect(startHandler).toHaveBeenCalledOnce();
    expect(endHandler).not.toHaveBeenCalled();
  });

  it("removes listeners correctly", () => {
    const handler = vi.fn();
    agentCallEvents.on("start", handler);
    agentCallEvents.removeListener("start", handler);

    agentCallEvents.emit("start", {
      deploymentId: "dep-1",
      serviceId: "svc-1",
      skillName: "test",
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
