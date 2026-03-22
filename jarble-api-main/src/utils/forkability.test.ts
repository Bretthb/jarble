/**
 * Forkability scoring tests
 *
 * Tests computeForkabilityScore — a pure function that returns 0-100 based on
 * deployment profile completeness and community ratings.
 *
 * Scoring breakdown (100 pts total):
 *   isPublic           → 15
 *   non-empty bio      → 10
 *   >= 1 showcase      → 10
 *   >= 2 specialties   → 15
 *   ratings >= 10 + medium/high confidence → 20
 *   overallScore >= 350 → 20
 *   featuredAt != null  → 10
 */

import { describe, it, expect } from "vitest";
import {
  computeForkabilityScore,
  type ForkabilityInput,
} from "./forkability.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Baseline input with everything null/false — score should be 0 */
function emptyInput(): ForkabilityInput {
  return {
    isPublic: false,
    bio: null,
    specialties: null,
    showcasePrompts: null,
    featuredAt: null,
    bestDomainScore: null,
  };
}

/** Input that should achieve the maximum 100 points */
function perfectInput(): ForkabilityInput {
  return {
    isPublic: true,
    bio: "A helpful coding assistant specializing in TypeScript.",
    specialties: JSON.stringify(["typescript", "react", "node"]),
    showcasePrompts: JSON.stringify([
      "Help me build a REST API",
      "Generate a React form",
    ]),
    featuredAt: new Date("2026-01-15"),
    bestDomainScore: {
      overallScore: 400,
      ratingCount: 15,
      confidence: "medium",
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("computeForkabilityScore", () => {
  // ── Basic scoring ───────────────────────────────────────────────────────

  it("returns 0 for a non-public deployment with all null fields", () => {
    expect(computeForkabilityScore(emptyInput())).toBe(0);
  });

  it("returns 15 for isPublic only", () => {
    const input = emptyInput();
    input.isPublic = true;
    expect(computeForkabilityScore(input)).toBe(15);
  });

  it("returns 50 for full profile without ratings (isPublic + bio + 2 specialties + showcase + not featured)", () => {
    const input: ForkabilityInput = {
      isPublic: true, // 15
      bio: "I help with code.", // 10
      specialties: JSON.stringify(["ts", "react"]), // 15
      showcasePrompts: JSON.stringify(["Build me an API"]), // 10
      featuredAt: null, // 0
      bestDomainScore: null, // 0
    };
    expect(computeForkabilityScore(input)).toBe(50);
  });

  it("returns 100 for a perfect input", () => {
    expect(computeForkabilityScore(perfectInput())).toBe(100);
  });

  // ── Individual criteria ─────────────────────────────────────────────────

  it("awards 10 pts for non-empty bio", () => {
    const base = emptyInput();
    expect(computeForkabilityScore({ ...base, bio: "Hello" })).toBe(10);
  });

  it("awards 15 pts for >= 2 specialties", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        specialties: JSON.stringify(["a", "b"]),
      })
    ).toBe(15);
  });

  it("awards 10 pts for >= 1 showcase prompt", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        showcasePrompts: JSON.stringify(["prompt"]),
      })
    ).toBe(10);
  });

  it("awards 10 pts for featuredAt being set", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({ ...base, featuredAt: new Date() })
    ).toBe(10);
  });

  it("awards 20 pts for rating count >= 10 with medium confidence", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 100, // below 350 threshold
          ratingCount: 10,
          confidence: "medium",
        },
      })
    ).toBe(20);
  });

  it("awards 20 pts for rating count >= 10 with high confidence", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 100,
          ratingCount: 10,
          confidence: "high",
        },
      })
    ).toBe(20);
  });

  it("awards 20 pts for overallScore >= 350", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 350,
          ratingCount: 5, // below count threshold
          confidence: "low",
        },
      })
    ).toBe(20);
  });

  // ── Edge cases: thresholds ──────────────────────────────────────────────

  it("gives 0 pts for empty string bio", () => {
    const base = emptyInput();
    expect(computeForkabilityScore({ ...base, bio: "" })).toBe(0);
  });

  it("gives 0 pts for whitespace-only bio", () => {
    const base = emptyInput();
    expect(computeForkabilityScore({ ...base, bio: "   \t\n  " })).toBe(0);
  });

  it("gives 0 pts for only 1 specialty (need 2)", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        specialties: JSON.stringify(["only-one"]),
      })
    ).toBe(0);
  });

  it("gives 0 pts for ratingCount=9 (need 10)", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 400,
          ratingCount: 9,
          confidence: "medium",
        },
      })
    ).toBe(20); // only the overallScore >= 350 criterion passes
  });

  it("gives 0 rating pts for confidence=low even if count >= 10", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 100,
          ratingCount: 50,
          confidence: "low",
        },
      })
    ).toBe(0);
  });

  it("gives 0 score pts for overallScore=349 (need 350)", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 349,
          ratingCount: 10,
          confidence: "medium",
        },
      })
    ).toBe(20); // only the ratingCount criterion passes
  });

  // ── Edge cases: malformed JSON ──────────────────────────────────────────

  it("does not crash on invalid JSON in specialties", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({ ...base, specialties: "not valid json{[" })
    ).toBe(0);
  });

  it("does not crash on invalid JSON in showcasePrompts", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({ ...base, showcasePrompts: "{broken" })
    ).toBe(0);
  });

  it("treats non-array JSON as empty (specialties is an object)", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        specialties: JSON.stringify({ key: "val" }),
      })
    ).toBe(0);
  });

  it("treats non-array JSON as empty (showcasePrompts is a string)", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        showcasePrompts: JSON.stringify("just a string"),
      })
    ).toBe(0);
  });

  // ── Edge cases: null bestDomainScore ────────────────────────────────────

  it("handles null bestDomainScore without crashing", () => {
    const input = perfectInput();
    input.bestDomainScore = null;
    // Should get everything except the two rating criteria (20 + 20 = 40)
    expect(computeForkabilityScore(input)).toBe(60);
  });

  it("handles undefined bestDomainScore without crashing", () => {
    const input: ForkabilityInput = {
      isPublic: true,
      bio: "bio",
      specialties: JSON.stringify(["a", "b"]),
      showcasePrompts: JSON.stringify(["p"]),
      featuredAt: new Date(),
      // bestDomainScore omitted entirely
    };
    expect(computeForkabilityScore(input)).toBe(60);
  });

  // ── Boundary values ────────────────────────────────────────────────────

  it("awards score pts for exactly 350 overallScore", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 350,
          ratingCount: 1,
          confidence: "low",
        },
      })
    ).toBe(20);
  });

  it("awards rating pts for exactly 10 ratingCount with medium confidence", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 0,
          ratingCount: 10,
          confidence: "medium",
        },
      })
    ).toBe(20);
  });

  it("awards both rating criteria together (40 pts)", () => {
    const base = emptyInput();
    expect(
      computeForkabilityScore({
        ...base,
        bestDomainScore: {
          overallScore: 500,
          ratingCount: 100,
          confidence: "high",
        },
      })
    ).toBe(40);
  });
});
