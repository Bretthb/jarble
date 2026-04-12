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
import { MemoryDisclosureBanner, MemoryDisclosureInline } from "../MemoryDisclosureBanner";

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
      expect(screen.getByText("This agent remembers things across every chat.")).toBeDefined();
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
