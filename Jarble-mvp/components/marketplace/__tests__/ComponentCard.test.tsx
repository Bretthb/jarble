import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComponentCard, type MarketplaceComponentData } from "../ComponentCard";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeComponent(overrides: Partial<MarketplaceComponentData> = {}): MarketplaceComponentData {
  return {
    id: "comp-1",
    name: "test-widget",
    displayName: "Test Widget",
    description: "A widget for testing",
    tier: "template",
    category: "chart",
    totalInstalls: 150,
    averageRating: 400,
    ratingCount: 12,
    pricingModel: "free",
    priceUsdCents: 0,
    creator: { id: "creator-1", displayName: "Bob" },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ComponentCard", () => {
  it("renders the display name", () => {
    render(<ComponentCard component={makeComponent()} />);
    expect(screen.getByText("Test Widget")).toBeDefined();
  });

  it("renders the description", () => {
    render(<ComponentCard component={makeComponent()} />);
    expect(screen.getByText("A widget for testing")).toBeDefined();
  });

  it("links to the component detail page", () => {
    render(<ComponentCard component={makeComponent({ id: "comp-abc" })} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/marketplace/comp-abc");
  });

  it("renders creator name", () => {
    render(<ComponentCard component={makeComponent()} />);
    expect(screen.getByText("Bob")).toBeDefined();
  });

  it("hides creator when null", () => {
    render(<ComponentCard component={makeComponent({ creator: null })} />);
    expect(screen.queryByText("Bob")).toBeNull();
  });

  describe("pricing", () => {
    it("shows Free for free model", () => {
      render(<ComponentCard component={makeComponent({ pricingModel: "free", priceUsdCents: 0 })} />);
      expect(screen.getByText("Free")).toBeDefined();
    });

    it("shows dollar amount for paid model", () => {
      render(<ComponentCard component={makeComponent({ pricingModel: "paid", priceUsdCents: 1299 })} />);
      expect(screen.getByText("$12.99")).toBeDefined();
    });

    it("shows whole dollar without decimals", () => {
      render(<ComponentCard component={makeComponent({ pricingModel: "paid", priceUsdCents: 1000 })} />);
      expect(screen.getByText("$10")).toBeDefined();
    });
  });

  describe("install count", () => {
    it("shows exact count under 1000", () => {
      render(<ComponentCard component={makeComponent({ totalInstalls: 150 })} />);
      expect(screen.getByText("150")).toBeDefined();
    });

    it("formats thousands with k", () => {
      render(<ComponentCard component={makeComponent({ totalInstalls: 5400 })} />);
      expect(screen.getByText("5.4k")).toBeDefined();
    });

    it("formats 10k+ without decimal", () => {
      render(<ComponentCard component={makeComponent({ totalInstalls: 25000 })} />);
      expect(screen.getByText("25k")).toBeDefined();
    });
  });

  it("renders tier badge", () => {
    render(<ComponentCard component={makeComponent({ tier: "sandbox" })} />);
    expect(screen.getByText("sandbox")).toBeDefined();
  });

  it("renders category badge", () => {
    render(<ComponentCard component={makeComponent({ category: "dashboard" })} />);
    expect(screen.getByText("dashboard")).toBeDefined();
  });

  it("passes className to card", () => {
    const { container } = render(<ComponentCard component={makeComponent()} className="my-class" />);
    expect(container.querySelector(".my-class")).toBeTruthy();
  });
});
