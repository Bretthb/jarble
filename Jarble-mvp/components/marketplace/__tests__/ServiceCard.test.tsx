import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceCard, type ServiceCardData } from "../ServiceCard";

// ── Mock next/link ──────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeService(overrides: Partial<ServiceCardData> = {}): ServiceCardData {
  return {
    id: "svc-1",
    name: "test-service",
    displayName: "Test Service",
    description: "A test service for unit tests",
    hostingModel: "self_hosted",
    status: "published",
    pricingModel: "free",
    priceUsdCents: 0,
    totalInstalls: 42,
    avgRating: 450,
    remoteHealth: null,
    componentCount: 3,
    skillCount: 2,
    creator: { id: "creator-1", displayName: "Alice" },
    createdAt: new Date("2026-01-15"),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ServiceCard", () => {
  describe("rendering", () => {
    it("renders the display name", () => {
      render(<ServiceCard pkg={makeService()} />);
      expect(screen.getByText("Test Service")).toBeDefined();
    });

    it("renders the description", () => {
      render(<ServiceCard pkg={makeService()} />);
      expect(screen.getByText("A test service for unit tests")).toBeDefined();
    });

    it("renders 'No description' when description is null", () => {
      render(<ServiceCard pkg={makeService({ description: null })} />);
      expect(screen.getByText("No description")).toBeDefined();
    });

    it("renders the creator name", () => {
      render(<ServiceCard pkg={makeService()} />);
      expect(screen.getByText("Alice")).toBeDefined();
    });

    it("does not render creator when null", () => {
      render(<ServiceCard pkg={makeService({ creator: null })} />);
      expect(screen.queryByText("Alice")).toBeNull();
    });

    it("links to the service detail page", () => {
      render(<ServiceCard pkg={makeService({ id: "svc-123" })} />);
      const link = screen.getByRole("link");
      expect(link.getAttribute("href")).toBe("/marketplace/services/svc-123");
    });

    it("renders 'Service' badge", () => {
      render(<ServiceCard pkg={makeService()} />);
      expect(screen.getByText("Service")).toBeDefined();
    });
  });

  describe("pricing display", () => {
    it("shows 'Free' for free pricing model", () => {
      render(<ServiceCard pkg={makeService({ pricingModel: "free", priceUsdCents: 0 })} />);
      expect(screen.getByText("Free")).toBeDefined();
    });

    it("shows 'Free' when price is 0 regardless of model", () => {
      render(<ServiceCard pkg={makeService({ pricingModel: "paid", priceUsdCents: 0 })} />);
      expect(screen.getByText("Free")).toBeDefined();
    });

    it("formats whole dollar amounts without decimals", () => {
      render(<ServiceCard pkg={makeService({ pricingModel: "paid", priceUsdCents: 500 })} />);
      expect(screen.getByText("$5")).toBeDefined();
    });

    it("formats fractional dollar amounts with two decimals", () => {
      render(<ServiceCard pkg={makeService({ pricingModel: "paid", priceUsdCents: 999 })} />);
      expect(screen.getByText("$9.99")).toBeDefined();
    });

    it("handles null priceUsdCents as 0 (free)", () => {
      render(<ServiceCard pkg={makeService({ pricingModel: "paid", priceUsdCents: null })} />);
      expect(screen.getByText("Free")).toBeDefined();
    });
  });

  describe("install count formatting", () => {
    it("shows exact count under 1000", () => {
      render(<ServiceCard pkg={makeService({ totalInstalls: 42 })} />);
      expect(screen.getByText("42")).toBeDefined();
    });

    it("formats 1000+ as k with one decimal", () => {
      render(<ServiceCard pkg={makeService({ totalInstalls: 2500 })} />);
      expect(screen.getByText("2.5k")).toBeDefined();
    });

    it("formats 10000+ as k without decimal", () => {
      render(<ServiceCard pkg={makeService({ totalInstalls: 15000 })} />);
      expect(screen.getByText("15k")).toBeDefined();
    });

    it("handles null totalInstalls as 0", () => {
      render(<ServiceCard pkg={makeService({ totalInstalls: null })} />);
      expect(screen.getByText("0")).toBeDefined();
    });
  });

  describe("hosting model display", () => {
    it("shows Self-hosted label for self_hosted model", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "self_hosted" })} />);
      expect(screen.getByText("Self-hosted")).toBeDefined();
    });

    it("shows Cloud label for remote model", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "remote" })} />);
      expect(screen.getByText("Cloud")).toBeDefined();
    });

    it("shows Hybrid label for hybrid model", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "hybrid" })} />);
      expect(screen.getByText("Hybrid")).toBeDefined();
    });

    it("falls back to raw hosting model for unknown types", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "custom_model" })} />);
      expect(screen.getByText("custom_model")).toBeDefined();
    });
  });

  describe("health indicator", () => {
    it("shows health dot for remote hosting model", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "remote", remoteHealth: "healthy" })} />);
      expect(screen.getByLabelText("Health: Healthy")).toBeDefined();
    });

    it("shows health dot for hybrid hosting model", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "hybrid", remoteHealth: "degraded" })} />);
      expect(screen.getByLabelText("Health: Degraded")).toBeDefined();
    });

    it("does not show health dot for self_hosted model", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "self_hosted", remoteHealth: "healthy" })} />);
      expect(screen.queryByLabelText(/Health:/)).toBeNull();
    });

    it("defaults health to Unknown when remoteHealth is null", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "remote", remoteHealth: null })} />);
      expect(screen.getByLabelText("Health: Unknown")).toBeDefined();
    });

    it("shows Offline health label", () => {
      render(<ServiceCard pkg={makeService({ hostingModel: "remote", remoteHealth: "offline" })} />);
      expect(screen.getByLabelText("Health: Offline")).toBeDefined();
    });
  });

  describe("component and skill counts", () => {
    it("shows component count with plural", () => {
      render(<ServiceCard pkg={makeService({ componentCount: 3 })} />);
      expect(screen.getByText("3 components")).toBeDefined();
    });

    it("shows singular component for count of 1", () => {
      render(<ServiceCard pkg={makeService({ componentCount: 1 })} />);
      expect(screen.getByText("1 component")).toBeDefined();
    });

    it("hides component count when 0", () => {
      render(<ServiceCard pkg={makeService({ componentCount: 0 })} />);
      expect(screen.queryByText(/component/)).toBeNull();
    });

    it("shows skill count with plural", () => {
      render(<ServiceCard pkg={makeService({ skillCount: 5 })} />);
      expect(screen.getByText("5 skills")).toBeDefined();
    });

    it("shows singular skill for count of 1", () => {
      render(<ServiceCard pkg={makeService({ skillCount: 1 })} />);
      expect(screen.getByText("1 skill")).toBeDefined();
    });

    it("hides skill count when 0", () => {
      render(<ServiceCard pkg={makeService({ skillCount: 0 })} />);
      expect(screen.queryByText(/skill/)).toBeNull();
    });
  });

  describe("className passthrough", () => {
    it("passes additional className", () => {
      const { container } = render(<ServiceCard pkg={makeService()} className="custom-class" />);
      const card = container.querySelector(".custom-class");
      expect(card).toBeTruthy();
    });
  });
});
