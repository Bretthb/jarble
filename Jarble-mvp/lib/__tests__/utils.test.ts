/**
 * Unit tests for the shadcn `cn(...)` helper in `lib/utils.ts`.
 *
 * `cn` is the universal className-merge primitive used by every
 * shadcn-style component in the platform. It composes `clsx`
 * (conditional class joining) with `tailwind-merge` (last-write-wins
 * Tailwind utility de-duplication). A regression here breaks visual
 * styling everywhere — and because the bug surfaces as
 * "extra classes that should have been overridden", it would slip
 * past linters silently.
 */

import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("joins multiple string arguments with single spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters out falsy entries (null, undefined, false, 0, empty string)", () => {
    expect(cn("a", null, "b", undefined, false, 0, "", "c")).toBe("a b c");
  });

  it("supports the conditional-object syntax — true keys are included, false are dropped", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("supports nested arrays (clsx's recursive flattening)", () => {
    expect(cn("a", ["b", ["c", "d"]])).toBe("a b c d");
  });

  it("resolves a Tailwind utility conflict via tailwind-merge — last-write-wins", () => {
    // The whole point of pairing tailwind-merge with clsx: the
    // second `px-4` overrides the first `px-2`. Without merge, the
    // browser would apply the LAST class in the DOM order anyway,
    // but the className string would be `"px-2 px-4"` — flagged by
    // the linter and visually noisy in DevTools.
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("resolves conflicting margins in mixed-axis classes", () => {
    // `m-2` (all sides) vs `mx-4` (horizontal only) — merge keeps
    // both because they target different axes after the conflict
    // resolution.
    const result = cn("m-2", "mx-4");
    expect(result).toContain("mx-4");
    // The all-sides `m-2` should NOT be replaced wholesale; it stays
    // for vertical (my) sides since mx-4 only affects horizontal.
    expect(result).toContain("m-2");
  });

  it("resolves the same-property conflict across object + string syntax", () => {
    // Combine two ways of specifying classes — merge still picks
    // the last value.
    expect(cn("text-red-500", { "text-blue-500": true })).toBe("text-blue-500");
  });

  it("preserves arbitrary (non-Tailwind) classes verbatim", () => {
    // Any class merge doesn't recognize is left in place. Custom
    // class names from the user's own CSS must survive.
    const result = cn("my-custom-class", "another-custom", "px-4");
    expect(result).toContain("my-custom-class");
    expect(result).toContain("another-custom");
    expect(result).toContain("px-4");
  });

  it("works with the conditional-object + falsy combo (most common shadcn pattern)", () => {
    // The canonical shadcn invocation: a base class plus optional
    // variant classes gated on props.
    const isActive = true;
    const isDisabled = false;
    expect(cn(
      "rounded-md border",
      isActive && "bg-blue-500",
      isDisabled && "opacity-50",
    )).toBe("rounded-md border bg-blue-500");
  });
});
