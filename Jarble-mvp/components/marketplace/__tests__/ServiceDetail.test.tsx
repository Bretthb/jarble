import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ServiceDetail } from "../ServiceDetail";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockLoginWithRedirect = vi.fn();
const mockUseAuth0 = vi.fn(() => ({
  isAuthenticated: true,
  isLoading: false,
  loginWithRedirect: mockLoginWithRedirect,
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => mockUseAuth0(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/ProfileDropdown", () => ({
  default: () => <div data-testid="profile-dropdown" />,
}));

const mockMutateAsync = vi.fn();
const mockUninstallMutateAsync = vi.fn();
let mockServiceData: any = null;
let mockServiceLoading = false;
let mockInstallError: Error | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    services: {
      get: {
        useQuery: () => ({
          data: mockServiceData,
          isLoading: mockServiceLoading,
        }),
      },
      install: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          error: mockInstallError,
        }),
      },
      uninstall: {
        useMutation: () => ({
          mutateAsync: mockUninstallMutateAsync,
        }),
      },
    },
  },
}));

vi.mock("@/components/marketplace/DeploymentPicker", () => ({
  default: ({ selectedId, onSelect }: any) => (
    <button data-testid="deployment-picker" onClick={() => onSelect("dep-1")}>
      {selectedId ? `Selected: ${selectedId}` : "Pick deployment"}
    </button>
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseService = {
  id: "svc-1",
  name: "analytics-suite",
  displayName: "Analytics Suite",
  description: "Full analytics service with charts and reports.",
  hostingModel: "self_hosted",
  status: "published",
  pricingModel: "free",
  priceUsdCents: 0,
  totalInstalls: 500,
  remoteApiEndpoint: null,
  instructionSnippet: "Use the analytics tools when asked about data.",
  components: [
    { id: "c1", name: "chart", displayName: "Chart", description: "Renders charts", tier: "template", category: "chart" },
    { id: "c2", name: "table", displayName: "Data Table", description: null, tier: "sandbox", category: null },
  ],
  skills: [
    { id: "s1", name: "web-search", description: "Search the web" },
  ],
  creator: { id: "cr-1", displayName: "Alice", bio: "Data scientist" },
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ServiceDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceData = null;
    mockServiceLoading = false;
    mockInstallError = null;
    mockUseAuth0.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      loginWithRedirect: mockLoginWithRedirect,
    });
  });

  describe("loading state", () => {
    it("renders skeleton when loading", () => {
      mockServiceLoading = true;
      const { container } = render(<ServiceDetail serviceId="svc-1" />);
      // Skeleton uses the Skeleton component which renders divs
      expect(container.querySelector("[class*='animate-pulse'], [class*='skeleton']") || container.textContent?.includes("Back to Marketplace")).toBeTruthy();
    });
  });

  describe("not found state", () => {
    it("shows not found when data is null", () => {
      mockServiceData = null;
      mockServiceLoading = false;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Service not found")).toBeDefined();
      expect(screen.getByText(/may have been removed/)).toBeDefined();
    });

    it("shows Browse Marketplace link in not found", () => {
      mockServiceData = null;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Browse Marketplace")).toBeDefined();
    });
  });

  describe("service header", () => {
    it("renders the display name", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Analytics Suite")).toBeDefined();
    });

    it("renders Service badge", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Service")).toBeDefined();
    });

    it("renders hosting label", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      const elements = screen.getAllByText("Self-hosted");
      expect(elements.length).toBeGreaterThan(0);
    });

    it("renders install count", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("500 installs")).toBeDefined();
    });

    it("renders component count", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("2 components")).toBeDefined();
    });

    it("renders skill count singular", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("1 skill")).toBeDefined();
    });
  });

  describe("description section", () => {
    it("renders the description text", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Full analytics service with charts and reports.")).toBeDefined();
    });

    it("renders fallback when description is null", () => {
      mockServiceData = { ...baseService, description: null };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("No description available.")).toBeDefined();
    });
  });

  describe("components section", () => {
    it("renders included components", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Chart")).toBeDefined();
      expect(screen.getByText("Data Table")).toBeDefined();
    });

    it("shows component tier badges", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("template")).toBeDefined();
      expect(screen.getByText("sandbox")).toBeDefined();
    });

    it("hides components section when empty", () => {
      mockServiceData = { ...baseService, components: [] };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.queryByText(/Included Components/)).toBeNull();
    });
  });

  describe("skills section", () => {
    it("renders included skills", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("web-search")).toBeDefined();
    });

    it("hides skills section when empty", () => {
      mockServiceData = { ...baseService, skills: [] };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.queryByText(/Included Skills/)).toBeNull();
    });
  });

  describe("instruction snippet", () => {
    it("renders the instruction snippet", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Use the analytics tools when asked about data.")).toBeDefined();
    });

    it("shows Bot Instructions heading", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Bot Instructions")).toBeDefined();
    });

    it("hides snippet section when null", () => {
      mockServiceData = { ...baseService, instructionSnippet: null };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.queryByText("Bot Instructions")).toBeNull();
    });
  });

  describe("pricing display", () => {
    it("shows Free for free service", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Free")).toBeDefined();
    });

    it("shows dollar amount for paid service", () => {
      mockServiceData = { ...baseService, pricingModel: "paid", priceUsdCents: 2999 };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("$29.99")).toBeDefined();
    });
  });

  describe("creator card", () => {
    it("renders creator name", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Alice")).toBeDefined();
    });

    it("renders creator bio", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Data scientist")).toBeDefined();
    });

    it("hides creator card when null", () => {
      mockServiceData = { ...baseService, creator: null };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.queryByText("Creator")).toBeNull();
    });
  });

  describe("hosting model in details", () => {
    it("shows Cloud for remote hosting", () => {
      mockServiceData = { ...baseService, hostingModel: "remote", remoteHealth: "healthy" };
      render(<ServiceDetail serviceId="svc-1" />);
      // Multiple elements show "Cloud"
      const cloudElements = screen.getAllByText("Cloud");
      expect(cloudElements.length).toBeGreaterThan(0);
    });

    it("shows API Health for remote services", () => {
      mockServiceData = { ...baseService, hostingModel: "remote", remoteHealth: "healthy" };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("API Health")).toBeDefined();
      expect(screen.getByText("Healthy")).toBeDefined();
    });

    it("hides API Health for self-hosted", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.queryByText("API Health")).toBeNull();
    });

    it("shows API endpoint for remote services", () => {
      mockServiceData = { ...baseService, hostingModel: "remote", remoteApiEndpoint: "https://api.example.com" };
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("https://api.example.com")).toBeDefined();
    });
  });

  describe("install flow", () => {
    it("shows Sign in button when not authenticated", () => {
      mockUseAuth0.mockReturnValue({ isAuthenticated: false, isLoading: false, loginWithRedirect: mockLoginWithRedirect });
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Sign in to install")).toBeDefined();
    });

    it("calls loginWithRedirect when Sign in clicked", () => {
      mockUseAuth0.mockReturnValue({ isAuthenticated: false, isLoading: false, loginWithRedirect: mockLoginWithRedirect });
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      fireEvent.click(screen.getByText("Sign in to install"));
      expect(mockLoginWithRedirect).toHaveBeenCalled();
    });

    it("shows deployment picker and Install button when authenticated", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByTestId("deployment-picker")).toBeDefined();
      expect(screen.getByText("Install Service")).toBeDefined();
    });

    it("disables Install button when no deployment selected", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      const installBtn = screen.getByText("Install Service").closest("button");
      expect(installBtn?.disabled).toBe(true);
    });

    it("shows install error message", () => {
      mockInstallError = new Error("Already installed");
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Already installed")).toBeDefined();
    });
  });

  describe("navigation", () => {
    it("renders back link to marketplace", () => {
      mockServiceData = baseService;
      render(<ServiceDetail serviceId="svc-1" />);
      expect(screen.getByText("Back to Marketplace")).toBeDefined();
    });
  });
});
