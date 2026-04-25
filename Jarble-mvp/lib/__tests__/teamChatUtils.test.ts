/**
 * Unit tests for `lib/teamChatUtils.ts`.
 *
 * Three pure helpers drive the Team Chat visual identity:
 *
 *   - `producerHue(producerId)` — hashes a string to a stable HSL hue
 *     so the same bot always gets the same color across messages,
 *     sessions, and components. Must be deterministic AND skip the
 *     muddy red-orange band near 0.
 *
 *   - `roleInitial(role)` — first-letter-uppercased initials for
 *     avatar circles, falling back to "B" (Bot) when the role is
 *     missing or empty. The fallback is the contract that lets a
 *     deployment without a configured role still render an avatar.
 *
 *   - `splitAssistantMessage(text)` — splits a monolithic concatenated
 *     assistant message at server-emitted `**RoleName:** ...` prefixes
 *     into per-specialist segments + an optional synthesis tail. This
 *     is the entire group-chat visual redesign Phase 1 — done at
 *     render time without a server change. A regression that mis-
 *     parsed the role pattern (or dropped the synthesis split) would
 *     collapse the multi-specialist UX back to one wall of text.
 */

import { describe, it, expect } from "vitest";
import {
  producerHue,
  roleInitial,
  splitAssistantMessage,
} from "../teamChatUtils";

// ── producerHue ─────────────────────────────────────────────────────────────

describe("producerHue", () => {
  it("is deterministic — same input always produces the same hue", () => {
    expect(producerHue("dep-abc-123")).toBe(producerHue("dep-abc-123"));
    expect(producerHue("alice")).toBe(producerHue("alice"));
  });

  it("output stays within [20, 339] — skips the muddy red-orange band 0-19", () => {
    // Formula: ((Math.abs(hash) % 320) + 20) % 360
    // → max value before final %: (319) + 20 = 339, which is < 360 (no wrap).
    // → min value: 0 + 20 = 20.
    // So output ∈ [20, 339].
    const ids = ["a", "b", "c", "alice", "bob", "dep-1", "dep-2", "long-id-with-numbers-12345", "z".repeat(200)];
    for (const id of ids) {
      const hue = producerHue(id);
      expect(hue).toBeGreaterThanOrEqual(20);
      expect(hue).toBeLessThanOrEqual(339);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it("different inputs usually map to different hues (collision rate is acceptably low for ~10 ids)", () => {
    // Not a hash-quality test — just a sanity check that we get spread.
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const hues = new Set(ids.map(producerHue));
    // We don't expect 0% collisions on 10 short strings, but at least 6 should be distinct.
    expect(hues.size).toBeGreaterThanOrEqual(6);
  });

  it("handles the empty string without throwing (hash starts at 0 → hue=20)", () => {
    expect(() => producerHue("")).not.toThrow();
    expect(producerHue("")).toBe(20);
  });

  it("handles long strings (no overflow / NaN)", () => {
    const long = "x".repeat(10_000);
    const hue = producerHue(long);
    expect(Number.isFinite(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(20);
    expect(hue).toBeLessThanOrEqual(339);
  });
});

// ── roleInitial ─────────────────────────────────────────────────────────────

describe("roleInitial", () => {
  it("returns the first letter, uppercased", () => {
    expect(roleInitial("Analyst")).toBe("A");
    expect(roleInitial("data")).toBe("D");
    expect(roleInitial("Workflow Coordinator")).toBe("W");
  });

  it("falls back to 'B' for empty / null / undefined input", () => {
    expect(roleInitial("")).toBe("B");
    expect(roleInitial(null)).toBe("B");
    expect(roleInitial(undefined)).toBe("B");
  });

  it("trims whitespace before taking the first letter", () => {
    expect(roleInitial("  Analyst  ")).toBe("A");
    expect(roleInitial("\tEngineer\n")).toBe("E");
  });

  it("falls back to 'B' for whitespace-only input", () => {
    expect(roleInitial("   ")).toBe("B");
    expect(roleInitial("\t\n")).toBe("B");
  });

  it("preserves casing only for the first letter (rest of string is irrelevant)", () => {
    // Only the first character is read — the casing of the rest doesn't matter.
    expect(roleInitial("aLPHA")).toBe("A");
  });
});

// ── splitAssistantMessage ──────────────────────────────────────────────────

describe("splitAssistantMessage", () => {
  it("returns an empty array for empty / whitespace-only input", () => {
    expect(splitAssistantMessage("")).toEqual([]);
    expect(splitAssistantMessage("   ")).toEqual([]);
    expect(splitAssistantMessage("\n\n\n")).toEqual([]);
  });

  it("returns a single null-role segment for plain text without role prefixes", () => {
    const segs = splitAssistantMessage("Hello, this is a regular response.");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      content: "Hello, this is a regular response.",
      sourceRole: null,
      isSynthesis: false,
    });
  });

  it("splits at a single **Role:** prefix and attaches the role", () => {
    const segs = splitAssistantMessage("**Analyst:** The data shows growth.");
    expect(segs).toHaveLength(1);
    expect(segs[0].sourceRole).toBe("Analyst");
    expect(segs[0].content).toBe("The data shows growth.");
    expect(segs[0].isSynthesis).toBe(false);
  });

  it("splits multiple **Role:** segments in declaration order", () => {
    const text = "**Analyst:** Numbers up 10%.\n**Engineer:** Latency down 50ms.\n**PM:** Ship it.";
    const segs = splitAssistantMessage(text);
    expect(segs).toHaveLength(3);
    expect(segs[0].sourceRole).toBe("Analyst");
    expect(segs[0].content).toContain("Numbers up");
    expect(segs[1].sourceRole).toBe("Engineer");
    expect(segs[1].content).toContain("Latency down");
    expect(segs[2].sourceRole).toBe("PM");
    expect(segs[2].content).toContain("Ship it");
  });

  it("preserves entry-bot text BEFORE the first role prefix as a null-role segment", () => {
    // The Team Chat entry bot can intro with text before delegating —
    // that intro must surface with sourceRole:null so the UI renders
    // it as the entry bot's message, not a specialist's.
    const text = "Let me check with the team.\n**Analyst:** All clear.";
    const segs = splitAssistantMessage(text);
    expect(segs).toHaveLength(2);
    expect(segs[0].sourceRole).toBe(null);
    expect(segs[0].content).toContain("check with the team");
    expect(segs[1].sourceRole).toBe("Analyst");
  });

  it("captures a synthesis segment after `\\n---\\n**Summary:**`", () => {
    const text = "**Analyst:** Numbers up.\n**Engineer:** Latency down.\n---\n**Summary:** Both metrics improving.";
    const segs = splitAssistantMessage(text);
    // 2 specialist segments + 1 synthesis segment.
    expect(segs).toHaveLength(3);
    const synthesis = segs.find((s) => s.isSynthesis);
    expect(synthesis).toBeDefined();
    expect(synthesis!.content).toContain("Both metrics improving");
    expect(synthesis!.sourceRole).toBe(null);
  });

  it("back-to-back role prefixes — first segment swallows the rest of the string (current SUT quirk)", () => {
    // **A:** **B:** body
    //
    // The role-pattern loop only sets the previous segment's `end`
    // when the next match is strictly AFTER `lastIndex`. With B
    // landing exactly at lastIndex (no gap), A's `end` stays
    // undefined, and `slice(start, undefined)` reads to the end of
    // the string — so A's content ends up as "**B:** body" instead
    // of being trimmed away.
    //
    // The empty-content `if (content)` guard does NOT catch this —
    // A's content is non-empty, just wrong. This is a current
    // behavior pin; a future fix should split this case into two
    // clean segments OR drop A entirely.
    const segs = splitAssistantMessage("**A:** **B:** body");
    expect(segs).toHaveLength(2);
    expect(segs[0].sourceRole).toBe("A");
    expect(segs[0].content).toBe("**B:** body");
    expect(segs[1].sourceRole).toBe("B");
    expect(segs[1].content).toBe("body");
  });

  it("synthesis-only input emits an empty leading segment plus the synthesis (current SUT shape)", () => {
    // Edge case: an LLM that emits only a summary. The split before
    // the separator is the empty string. mainSegments is empty, so
    // the SUT falls into the `if (mainSegments.length === 0)` branch
    // and pushes a `{ content: "", sourceRole: null, isSynthesis:
    // false }` segment with NO `if (content)` filter on that branch.
    //
    // The synthesis still lands as the second segment. The empty
    // leading segment is a render-side concern — the UI either
    // tolerates empty content or filters it before display. This
    // test pins the current shape so a fix can be made deliberately.
    const segs = splitAssistantMessage("\n---\n**Summary:** Just the summary.");
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ content: "", sourceRole: null, isSynthesis: false });
    expect(segs[1].isSynthesis).toBe(true);
    expect(segs[1].content).toBe("Just the summary.");
  });

  it("does NOT match a colon-less '**Role**' as a role prefix", () => {
    // The pattern requires **NAME:** with the colon. Bold text like
    // **emphasis** in the middle of a response should NOT be parsed
    // as a role boundary.
    const segs = splitAssistantMessage("This is **important** information.");
    expect(segs).toHaveLength(1);
    expect(segs[0].sourceRole).toBe(null);
    expect(segs[0].content).toBe("This is **important** information.");
  });
});
