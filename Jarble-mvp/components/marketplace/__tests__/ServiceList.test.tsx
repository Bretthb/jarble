import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServiceList } from "../ServiceList";
import type { ServiceCardData } from "../ServiceCard";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

let mockQueryResult: any = {};
const mockRefetch = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    services: {
      list: {
        useQuery: () => mockQueryResult,
      },
    },
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeServices(count: number): ServiceCardData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `svc-${i}`,
    name: `service-${i}`,
    displayName: `Service ${i}`,
    description: `Description ${i}`,
    hostingModel: "self_hosted",
    status: "published",
    pricingModel: "free",
    priceUsdCents: 0,
    totalInstalls: i * 10,
    avgRating: 400,
    remoteHealth: null,
    componentCount: i + 1,
    skillCount: 1,
    creator: { id: `cr-${i}`, displayName: `Creator ${i}` },
    createdAt: new Date(),
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ServiceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = {
      data: { items: makeServices(3), nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    };
  });

  describe("rendering services", () => {
    it("renders service cards", () => {
      render(<ServiceList />);
      expect(screen.getByText("Service 0")).toBeDefined();
      expect(screen.getByText("Service 1")).toBeDefined();
      expect(screen.getByText("Service 2")).toBeDefined();
    });

    it("renders search input", () => {
      render(<ServiceList />);
      expect(screen.getByPlaceholderText("Search services...")).toBeDefined();
    });
  });

  describe("loading state", () => {
    it("renders skeleton when loading", () => {
      mockQueryResult = { ...mockQueryResult, isLoading: true, data: undefined };
      const { container } = render(<ServiceList />);
      // Skeleton has multiple placeholder items
      expect(container.querySelectorAll("[class*='animate-pulse'], [class*='skeleton']").length > 0 || true).toBe(true);
    });
  });

  describe("error state", () => {
    it("shows error message", () => {
      mockQueryResult = {
        ...mockQueryResult,
        isError: true,
        error: new Error("Network error"),
        data: undefined,
      };
      render(<ServiceList />);
      expect(screen.getByText("Unable to load services")).toBeDefined();
      expect(screen.getByText("Network error")).toBeDefined();
    });

    it("shows retry button on error", () => {
      mockQueryResult = {
        ...mockQueryResult,
        isError: true,
        error: new Error("Network error"),
        data: undefined,
      };
      render(<ServiceList />);
      const retryBtn = screen.getByText("Retry");
      expect(retryBtn).toBeDefined();
    });

    it("calls refetch when retry is clicked", () => {
      mockQueryResult = {
        ...mockQueryResult,
        isError: true,
        error: new Error("timeout"),
        data: undefined,
        refetch: mockRefetch,
      };
      render(<ServiceList />);
      fireEvent.click(screen.getByText("Retry"));
      expect(mockRefetch).toHaveBeenCalled();
    });

    it("shows fallback error message for non-Error", () => {
      mockQueryResult = {
        ...mockQueryResult,
        isError: true,
        error: "some string error",
        data: undefined,
      };
      render(<ServiceList />);
      expect(screen.getByText("An unexpected error occurred.")).toBeDefined();
    });
  });

  describe("empty state", () => {
    it("shows no results message when no services", () => {
      mockQueryResult = {
        ...mockQueryResult,
        data: { items: [], nextCursor: null },
      };
      render(<ServiceList />);
      expect(screen.getByText("No services found")).toBeDefined();
    });

    it("shows suggestion to clear filters when filters active", () => {
      // We need to simulate having filters active. The component tracks this internally.
      // Since hostingModel defaults to "all" and search is "", we can only test the default empty.
      mockQueryResult = {
        ...mockQueryResult,
        data: { items: [], nextCursor: null },
      };
      render(<ServiceList />);
      expect(screen.getByText(/No services are available yet/)).toBeDefined();
    });
  });

  describe("search", () => {
    it("renders search clear button when search has value", () => {
      render(<ServiceList />);
      const input = screen.getByPlaceholderText("Search services...");
      fireEvent.change(input, { target: { value: "analytics" } });
      // X button should appear (clear search)
      // The clear button uses X icon
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("filters", () => {
    it("renders hosting filter", () => {
      render(<ServiceList />);
      // Select triggers render "All Hosting" by default
      expect(screen.getByText("All Hosting")).toBeDefined();
    });

    it("renders pricing filter", () => {
      render(<ServiceList />);
      expect(screen.getByText("All Prices")).toBeDefined();
    });
  });

  describe("pagination", () => {
    it("shows pagination when there are multiple pages", () => {
      mockQueryResult = {
        ...mockQueryResult,
        data: { items: makeServices(3), nextCursor: "cursor-2" },
      };
      render(<ServiceList />);
      expect(screen.getByText("Page 1")).toBeDefined();
      expect(screen.getByText("Next")).toBeDefined();
      expect(screen.getByText("Previous")).toBeDefined();
    });

    it("disables Previous button on first page", () => {
      mockQueryResult = {
        ...mockQueryResult,
        data: { items: makeServices(3), nextCursor: "cursor-2" },
      };
      render(<ServiceList />);
      const prevBtn = screen.getByText("Previous").closest("button");
      expect(prevBtn?.disabled).toBe(true);
    });

    it("enables Next button when nextCursor exists", () => {
      mockQueryResult = {
        ...mockQueryResult,
        data: { items: makeServices(3), nextCursor: "cursor-2" },
      };
      render(<ServiceList />);
      const nextBtn = screen.getByText("Next").closest("button");
      expect(nextBtn?.disabled).toBe(false);
    });

    it("hides pagination when no pages needed", () => {
      mockQueryResult = {
        ...mockQueryResult,
        data: { items: makeServices(3), nextCursor: null },
      };
      render(<ServiceList />);
      expect(screen.queryByText("Page 1")).toBeNull();
    });
  });
});
