import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isArtifactWorthy,
  ARTIFACT_WORTHY,
  SYNC_DEBOUNCE_MS,
} from "../useArtifactSync";

// ── Tests: ARTIFACT_WORTHY set ──────────────────────────────────────────────

describe("ARTIFACT_WORTHY", () => {
  it("contains exactly the expected components", () => {
    const expected = new Set([
      "spreadsheet",
      "code_editor",
      "data_table",
      "chart",
      "sandbox",
      "code_block",
      "embed",
    ]);
    expect(ARTIFACT_WORTHY).toEqual(expected);
  });

  it("has 7 members", () => {
    expect(ARTIFACT_WORTHY.size).toBe(7);
  });
});

// ── Tests: isArtifactWorthy ─────────────────────────────────────────────────

describe("isArtifactWorthy", () => {
  describe("returns true for artifact-worthy components", () => {
    const worthy = [
      "spreadsheet",
      "code_editor",
      "data_table",
      "chart",
      "sandbox",
      "code_block",
      "embed",
    ];

    for (const component of worthy) {
      it(`returns true for "${component}"`, () => {
        expect(isArtifactWorthy(component)).toBe(true);
      });
    }
  });

  describe("returns false for non-artifact-worthy components", () => {
    const unworthy = [
      "alert",
      "badge",
      "card",
      "stat_grid",
      "text_message",
      "metric_card",
      "key_value",
      "header",
      "blockquote",
      "result",
      "button_group",
      "form",
      "list",
      "timeline",
      "tabs",
      "accordion",
      "progress",
    ];

    for (const component of unworthy) {
      it(`returns false for "${component}"`, () => {
        expect(isArtifactWorthy(component)).toBe(false);
      });
    }
  });

  it("returns false for empty string", () => {
    expect(isArtifactWorthy("")).toBe(false);
  });

  it("returns false for unknown component names", () => {
    expect(isArtifactWorthy("totally_unknown_widget")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isArtifactWorthy("Chart")).toBe(false);
    expect(isArtifactWorthy("SANDBOX")).toBe(false);
    expect(isArtifactWorthy("Code_Editor")).toBe(false);
  });
});

// ── Tests: SYNC_DEBOUNCE_MS ─────────────────────────────────────────────────

describe("SYNC_DEBOUNCE_MS", () => {
  it("is 2000ms", () => {
    expect(SYNC_DEBOUNCE_MS).toBe(2000);
  });
});
