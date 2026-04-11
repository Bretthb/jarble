/**
 * MemoryDisclosureBanner tests.
 *
 * This component is the user-facing disclosure for the memory-scoping
 * feature. Its copy is privacy-critical: the global-mode banner is the
 * compensating control we agreed on in docs/audits/memory-scoping-decision.md
 * (Option B) because we can't force per-conversation partitioning in the
 * closed OpenClaw runtime. These tests lock down the wording for each
 * scope so silent regressions in the disclosure can't slip through review.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryDisclosureBanner,
  MemoryDisclosureInline,
  aggregateTeamMemoryScope,
} from "../MemoryDisclosureBanner";

describe("MemoryDisclosureBanner", () => {
  describe("global mode", () => {
    it("renders the loud amber disclosure banner with role=alert", () => {
      render(<MemoryDisclosureBanner scope="global" />);
      const banner = screen.getByTestId("memory-disclosure-banner");
      expect(banner).toBeDefined();
      expect(banner.getAttribute("role")).toBe("alert");
      expect(banner.getAttribute("aria-live")).toBe("polite");
    });

    it("renders the headline copy about cross-chat memory", () => {
      render(<MemoryDisclosureBanner scope="global" />);
      expect(screen.getByText("This bot remembers things across every chat.")).toBeDefined();
    });

    it("mentions all supported messaging platforms", () => {
      render(<MemoryDisclosureBanner scope="global" />);
      const content = screen.getByTestId("memory-disclosure-banner").textContent ?? "";
      expect(content).toContain("web");
      expect(content).toContain("Discord");
      expect(content).toContain("WhatsApp");
      expect(content).toContain("Slack");
      expect(content).toContain("Telegram");
    });

    it("hides detail copy until the More button is clicked", async () => {
      const user = userEvent.setup();
      render(<MemoryDisclosureBanner scope="global" />);
      expect(screen.queryByText(/single long-term memory pool/i)).toBeNull();
      await user.click(screen.getByRole("button", { name: /show more/i }));
      expect(screen.getByText(/single long-term memory pool/i)).toBeDefined();
    });

    it("defaults unknown scope values to global (privacy-safe default)", () => {
      // Passing an unexpected string/null/undefined must render the loud banner,
      // not silently hide the disclosure.
      // @ts-expect-error intentional: feeding a bogus value
      render(<MemoryDisclosureBanner scope="bogus" />);
      expect(screen.getByTestId("memory-disclosure-banner")).toBeDefined();
    });

    it("defaults null scope to global banner", () => {
      render(<MemoryDisclosureBanner scope={null} />);
      expect(screen.getByTestId("memory-disclosure-banner")).toBeDefined();
    });

    it("defaults undefined scope to global banner", () => {
      render(<MemoryDisclosureBanner scope={undefined} />);
      expect(screen.getByTestId("memory-disclosure-banner")).toBeDefined();
    });
  });

  describe("session mode", () => {
    it("does NOT render the loud amber banner", () => {
      render(<MemoryDisclosureBanner scope="session" />);
      expect(screen.queryByTestId("memory-disclosure-banner")).toBeNull();
    });

    it("tells the user memory is scoped to this chat", () => {
      const { container } = render(<MemoryDisclosureBanner scope="session" />);
      expect(container.textContent).toContain("Memory is scoped to this chat");
    });

    it("warns that the bot runtime may still retain its own memory (per decision doc)", () => {
      // This copy is required by docs/audits/memory-scoping-decision.md —
      // we can't force OpenClaw's closed runtime to honor the partition,
      // so session mode is explicitly labeled best-effort.
      const { container } = render(<MemoryDisclosureBanner scope="session" />);
      const text = container.textContent ?? "";
      expect(text.toLowerCase()).toContain("best-effort");
      expect(text.toLowerCase()).toMatch(/runtime.*retain|separate|not guaranteed/i);
    });
  });

  describe("off mode", () => {
    it("does NOT render the loud amber banner", () => {
      render(<MemoryDisclosureBanner scope="off" />);
      expect(screen.queryByTestId("memory-disclosure-banner")).toBeNull();
    });

    it("tells the user memory is off and nothing will persist", () => {
      const { container } = render(<MemoryDisclosureBanner scope="off" />);
      const text = container.textContent ?? "";
      expect(text).toContain("Long-term memory is off");
      expect(text).toContain("will not remember");
    });
  });
});

describe("MemoryDisclosureInline", () => {
  it("renders a short global-mode label", () => {
    const { container } = render(<MemoryDisclosureInline scope="global" />);
    expect(container.textContent).toContain("shared across all chats");
  });

  it("renders a short session-mode label", () => {
    const { container } = render(<MemoryDisclosureInline scope="session" />);
    expect(container.textContent).toContain("scoped to this chat");
  });

  it("renders a short off-mode label", () => {
    const { container } = render(<MemoryDisclosureInline scope="off" />);
    expect(container.textContent).toContain("Memory: off");
  });

  it("falls back to global for null/undefined scope", () => {
    const { container } = render(<MemoryDisclosureInline scope={null} />);
    expect(container.textContent).toContain("shared across all chats");
  });
});

describe("aggregateTeamMemoryScope (loudest scope wins)", () => {
  // Privacy-critical: a team is only as private as its leakiest member.
  // The team chat banner in views/Deployments.tsx renders the loudest
  // possible scope across every deployment in the active flow, so a
  // single global-memory bot in a team forces the loud disclosure on
  // the whole team chat. This test locks down the rule.
  it("returns global if any deployment is global", () => {
    expect(aggregateTeamMemoryScope(["global", "session", "off"])).toBe("global");
    expect(aggregateTeamMemoryScope(["session", "global"])).toBe("global");
    expect(aggregateTeamMemoryScope(["off", "global"])).toBe("global");
  });

  it("returns session if all are session or session+off", () => {
    expect(aggregateTeamMemoryScope(["session"])).toBe("session");
    expect(aggregateTeamMemoryScope(["session", "session"])).toBe("session");
    expect(aggregateTeamMemoryScope(["session", "off"])).toBe("session");
    expect(aggregateTeamMemoryScope(["off", "session"])).toBe("session");
  });

  it("returns off only when every deployment is off", () => {
    expect(aggregateTeamMemoryScope(["off"])).toBe("off");
    expect(aggregateTeamMemoryScope(["off", "off", "off"])).toBe("off");
  });

  it("falls back to global on empty input (privacy-safe default)", () => {
    expect(aggregateTeamMemoryScope([])).toBe("global");
  });

  it("treats null and undefined as unknown and falls back to global", () => {
    // Stale rows from before the memory_scope column existed return null;
    // unknown rows must default to the loud global banner, never silently
    // hide the disclosure.
    expect(aggregateTeamMemoryScope([null, undefined])).toBe("global");
    expect(aggregateTeamMemoryScope([null])).toBe("global");
  });

  it("ignores nulls when other valid scopes are present", () => {
    // If at least one deployment has a known non-global scope and the
    // rest are unknown, the unknowns shouldn't downgrade to global —
    // they're absent, not loud. This still picks the loudest *known*
    // scope, but the empty/unknown-only case stays global.
    expect(aggregateTeamMemoryScope(["session", null])).toBe("session");
    expect(aggregateTeamMemoryScope(["off", null, undefined])).toBe("off");
  });
});
