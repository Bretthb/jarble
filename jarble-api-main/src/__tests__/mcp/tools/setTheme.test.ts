/**
 * Unit tests for the `set_theme` MCP tool.
 *
 * `set_theme` is a multi-mode tool — same MCP entrypoint, three
 * distinct branches keyed on the input shape:
 *
 *   - **View** (no params) — return the current themeConfig from
 *     the deployment row, or "no custom theme" when null.
 *   - **Reset** (preset === "default" alone) — clear themeConfig
 *     to null and emit a `jarble.theme.updated` SSE event.
 *   - **Set** (any other input shape) — validate via
 *     `validateThemeConfig`, then persist a JSON-stringified
 *     config + emit the SSE event.
 *
 * Two contracts pinned:
 *
 *   1. **Mode dispatch** — the tool must take the right branch
 *      for each input shape. A regression that fell through to
 *      Set when the user meant View would silently overwrite
 *      their theme with empty config.
 *
 *   2. **SSE event payload** — every successful Set/Reset emits
 *      a `jarble.theme.updated` event with the new config (or
 *      null on reset) so the frontend's chat page re-renders
 *      with the new colors. A regression in the event name or
 *      shape would silently break live theme updates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockValidateThemeConfig = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    update: (...args: any[]) => {
      mockUpdate(...args);
      return { set: mockSet };
    },
  },
  tables: { deployments: { id: { name: "id" } } },
  dbDate: () => "2026-04-26T00:00:00Z",
}));

vi.mock("@jarble/component-manifest", () => ({
  validateThemeConfig: (...args: any[]) => mockValidateThemeConfig(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { setThemeTool } from "../../../mcp/tools/setTheme.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockUpdate.mockReset();
  mockSet.mockReset();
  mockWhere.mockReset();
  mockValidateThemeConfig.mockReset();
  // Wire the chained set→where calls so the SUT's `await` resolves.
  mockSet.mockReturnValue({ where: (...args: any[]) => { mockWhere(...args); return Promise.resolve(); } });
  // Default: no validation errors.
  mockValidateThemeConfig.mockReturnValue(null);
});

function ctx(themeConfig: string | null = null): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: {
      id: "dep-abc",
      name: "My Bot",
      themeConfig,
    },
  };
}

// ── Metadata ────────────────────────────────────────────────────────────────

describe("setThemeTool — metadata", () => {
  it("registers under the name 'set_theme'", () => {
    expect(setThemeTool.name).toBe("set_theme");
  });

  it("description mentions theme + presets + skins (LLM trigger keywords)", () => {
    const desc = setThemeTool.description.toLowerCase();
    expect(desc).toContain("theme");
    expect(desc).toContain("preset");
    expect(desc).toContain("skin");
  });

  it("declares the preset enum with all canonical values", () => {
    const presetEnum = (setThemeTool.parameters as any).properties.preset.enum;
    // Pin the full set so a future preset addition has to update this test
    // (and the user-facing docs along with it).
    expect(presetEnum).toEqual([
      "default", "midnight", "forest", "cyberpunk", "ocean", "rose", "amber", "terminal", "retro", "win98",
    ]);
  });

  it("declares the skin enum (chat visual style)", () => {
    const skinEnum = (setThemeTool.parameters as any).properties.skin.enum;
    expect(skinEnum).toContain("default");
    expect(skinEnum).toContain("minimal");
    expect(skinEnum).toContain("terminal");
    expect(skinEnum).toContain("neobrutalist");
    expect(skinEnum).toContain("glass");
  });
});

// ── View mode (no params) ───────────────────────────────────────────────────

describe("setThemeTool — view mode", () => {
  it("returns 'no custom theme' when the deployment has no themeConfig", async () => {
    const r = await setThemeTool.execute({}, ctx(null));

    expect(r.success).toBe(true);
    expect(r.message).toContain("No custom theme");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns the parsed current theme as data when themeConfig is set", async () => {
    const stored = { preset: "midnight", radius: "1rem" };
    const r = await setThemeTool.execute({}, ctx(JSON.stringify(stored)));

    expect(r.success).toBe(true);
    expect(r.data).toEqual(stored);
    expect(r.message).toContain("midnight");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("falls back to 'no custom theme' when the stored themeConfig is malformed JSON", async () => {
    const r = await setThemeTool.execute({}, ctx("{not json"));

    expect(r.success).toBe(true);
    expect(r.message).toContain("No custom theme");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does NOT emit an SSE event in view mode (no state change)", async () => {
    const r = await setThemeTool.execute({}, ctx(null));
    expect(r.sseEvents).toBeUndefined();
  });
});

// ── Reset mode (preset === "default" alone) ────────────────────────────────

describe("setThemeTool — reset mode", () => {
  it("clears themeConfig to null when preset='default' is the only param", async () => {
    const r = await setThemeTool.execute({ preset: "default" }, ctx("{old}"));

    expect(r.success).toBe(true);
    expect(r.message).toContain("reset");
    // DB update was called with themeConfig: null.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.themeConfig).toBeNull();
  });

  it("emits jarble.theme.updated with null payload on reset", async () => {
    const r = await setThemeTool.execute({ preset: "default" }, ctx("{old}"));

    expect(r.sseEvents).toEqual([{ name: "jarble.theme.updated", value: null }]);
  });

  it("preset='default' WITH other params is NOT a reset — it's a Set with default preset + extras", async () => {
    // The reset-only branch fires when preset='default' is the SOLE
    // key. Adding any other param falls into the Set branch (which
    // persists default-preset-with-extras).
    const r = await setThemeTool.execute(
      { preset: "default", radius: "0.5rem" },
      ctx(null),
    );

    expect(r.success).toBe(true);
    // Set branch persists JSON, NOT null.
    const setArg = mockSet.mock.calls[0][0];
    expect(typeof setArg.themeConfig).toBe("string");
    expect(JSON.parse(setArg.themeConfig)).toEqual({
      preset: "default",
      radius: "0.5rem",
    });
  });
});

// ── Set mode ────────────────────────────────────────────────────────────────

describe("setThemeTool — set mode", () => {
  it("persists a stringified themeConfig and emits the SSE event", async () => {
    const params = { preset: "midnight", radius: "0.75rem" };
    const r = await setThemeTool.execute(params, ctx(null));

    expect(r.success).toBe(true);
    expect(mockValidateThemeConfig).toHaveBeenCalledWith(params);

    // DB receives a JSON string.
    const setArg = mockSet.mock.calls[0][0];
    expect(JSON.parse(setArg.themeConfig)).toEqual(params);

    expect(r.sseEvents).toEqual([{ name: "jarble.theme.updated", value: params }]);
  });

  it("includes a human-readable summary in the message (preset + radius + colors etc.)", async () => {
    const r = await setThemeTool.execute(
      {
        preset: "ocean",
        colors: { primary: "#0099ff", secondary: "#003366" },
        radius: "1rem",
        skin: "glass",
      },
      ctx(null),
    );

    expect(r.message).toContain("ocean");
    expect(r.message).toContain("primary, secondary"); // from Object.keys join
    expect(r.message).toContain("1rem");
    expect(r.message).toContain("glass");
  });

  it("rejects when validateThemeConfig returns an error string", async () => {
    mockValidateThemeConfig.mockReturnValueOnce("Invalid color: not a hex");

    const r = await setThemeTool.execute(
      { colors: { primary: "not-hex" } as any },
      ctx(null),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Invalid theme config");
    expect(r.message).toContain("Invalid color: not a hex");
    // DB MUST NOT be touched on validation failure.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("includes radius alone in the summary when only radius is provided", async () => {
    const r = await setThemeTool.execute({ radius: "0" }, ctx(null));

    expect(r.success).toBe(true);
    expect(r.message).toContain("Border radius: 0");
    // No Preset / Colors / Skin / Font lines.
    expect(r.message).not.toContain("Preset:");
    expect(r.message).not.toContain("Skin:");
    expect(r.message).not.toContain("Font:");
  });

  it("includes both font lines when fontFamily and headingFontFamily are set", async () => {
    const r = await setThemeTool.execute(
      { fontFamily: "'Inter', sans-serif", headingFontFamily: "'Playfair Display', serif" },
      ctx(null),
    );

    expect(r.message).toContain("Font: 'Inter', sans-serif");
    expect(r.message).toContain("Heading font: 'Playfair Display', serif");
  });
});
