/**
 * Unit tests for the lifecycle MCP tools (restart / stop / start).
 *
 * These three tools deliberately DO NOT execute the lifecycle action
 * — they each render a `confirm_action` component so the user has
 * to click Confirm in the UI before the tRPC mutation actually
 * fires. The bot's job is to show the confirmation, not run it.
 *
 * Two contracts pinned:
 *
 *   1. **`rendersComponent: "confirm_action"`** on every entry — the
 *      frontend dispatches on this string to render the confirmation
 *      card. A regression that swapped the value would silently break
 *      every restart/stop/start request from the bot.
 *
 *   2. **`data: { action, deploymentId }`** matches what the
 *      `confirm_action` card needs to call the tRPC mutation. A
 *      regression in either field name or the action value (`restart`
 *      vs `restart_bot` vs `RESTART`) would break the dispatch.
 *
 * The execute() functions are pure — no DB, no K8s. Tests use a
 * fake ToolContext.
 */

import { describe, it, expect } from "vitest";
import {
  restartBotTool,
  stopBotTool,
  startBotTool,
} from "../../../mcp/tools/lifecycle.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

const ctx: ToolContext = {
  userId: "user-1",
  deploymentId: "dep-abc",
  deployment: { id: "dep-abc", name: "My Bot", status: "running", runtime: "openclaw" },
};

describe("lifecycle tools — shared contract", () => {
  const tools = [
    { tool: restartBotTool, action: "restart" as const },
    { tool: stopBotTool, action: "stop" as const },
    { tool: startBotTool, action: "start" as const },
  ];

  it.each(tools)("$tool.name renders the confirm_action component", ({ tool }) => {
    expect(tool.rendersComponent).toBe("confirm_action");
  });

  it.each(tools)("$tool.name has empty parameters (no args needed)", ({ tool }) => {
    expect(tool.parameters).toEqual({ type: "object", properties: {} });
  });

  it.each(tools)("$tool.name returns success=true (the confirmation always 'succeeds' — execution comes later)", async ({ tool }) => {
    const r = await tool.execute({}, ctx);
    expect(r.success).toBe(true);
  });

  it.each(tools)("$tool.name includes deployment name in the human-readable message", async ({ tool }) => {
    const r = await tool.execute({}, ctx);
    expect(r.message).toContain("My Bot");
  });

  it.each(tools)("$tool.name returns the right action + deploymentId in data", async ({ tool, action }) => {
    const r = await tool.execute({}, ctx);
    expect(r.data).toEqual({ action, deploymentId: "dep-abc" });
  });
});

describe("restartBotTool", () => {
  it("uses the name 'restart_bot'", () => {
    expect(restartBotTool.name).toBe("restart_bot");
  });

  it("description mentions the action in user-friendly terms", () => {
    // The LLM uses the description to decide when to call this tool.
    // 'restart' or 'reboot' are the trigger keywords.
    expect(restartBotTool.description.toLowerCase()).toContain("restart");
  });
});

describe("stopBotTool", () => {
  it("uses the name 'stop_bot'", () => {
    expect(stopBotTool.name).toBe("stop_bot");
  });

  it("description mentions stop / shut down", () => {
    const desc = stopBotTool.description.toLowerCase();
    expect(desc.includes("stop") || desc.includes("shut")).toBe(true);
  });
});

describe("startBotTool", () => {
  it("uses the name 'start_bot'", () => {
    expect(startBotTool.name).toBe("start_bot");
  });

  it("description mentions start", () => {
    expect(startBotTool.description.toLowerCase()).toContain("start");
  });
});
