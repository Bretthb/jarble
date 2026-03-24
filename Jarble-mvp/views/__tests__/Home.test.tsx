import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>, opts?: { loading?: () => unknown }) => {
    // Return the loading placeholder so tests don't need to resolve the dynamic import
    return opts?.loading ?? (() => null);
  },
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    const { priority, fill, ...rest } = props;
    return <img {...rest} />;
  },
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let mockAuth0 = {
  isAuthenticated: false,
  isLoading: false,
};

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => mockAuth0,
}));

vi.mock("@/components/marketing/MarketingNav", () => ({
  __esModule: true,
  default: () => <nav data-testid="marketing-nav">Nav</nav>,
}));

vi.mock("@/components/marketing/MarketingFooter", () => ({
  __esModule: true,
  default: () => <footer data-testid="marketing-footer">Footer</footer>,
}));

vi.mock("@/components/InteractiveHero", () => ({
  __esModule: true,
  default: () => <div data-testid="interactive-hero">Hero</div>,
}));

import Home from "../Home";

beforeEach(() => {
  mockAuth0 = { isAuthenticated: false, isLoading: false };
  mockPush.mockReset();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Home", () => {
  it("renders loading state when Auth0 is loading", () => {
    mockAuth0 = { isAuthenticated: false, isLoading: true };
    const { container } = render(<Home />);
    // Should render an empty placeholder
    expect(container.querySelector(".min-h-screen.bg-background")).toBeTruthy();
    // Should NOT render the hero heading
    expect(screen.queryByText(/Launch an AI agent/)).not.toBeInTheDocument();
  });

  it("renders the hero heading", () => {
    render(<Home />);
    expect(screen.getByText(/Launch an AI agent/)).toBeInTheDocument();
    expect(screen.getByText(/in minutes\./)).toBeInTheDocument();
  });

  it("renders the CTA button", () => {
    render(<Home />);
    const cta = screen.getByRole("button", { name: /Launch Your First Agent/i });
    expect(cta).toBeInTheDocument();
  });

  it("CTA redirects to /login when unauthenticated", () => {
    render(<Home />);
    const cta = screen.getByRole("button", { name: /Launch Your First Agent/i });
    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith("/login");
  });

  it("CTA redirects to /dashboard when authenticated", () => {
    mockAuth0 = { isAuthenticated: true, isLoading: false };
    render(<Home />);
    const cta = screen.getByRole("button", { name: /Launch Your First Agent/i });
    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("renders navigation and footer", () => {
    render(<Home />);
    expect(screen.getByTestId("marketing-nav")).toBeInTheDocument();
    expect(screen.getByTestId("marketing-footer")).toBeInTheDocument();
  });

  it("has no horizontal overflow (overflow-x-hidden on root)", () => {
    const { container } = render(<Home />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-x-hidden");
  });

  it("renders the beta banner with apply link", () => {
    render(<Home />);
    expect(screen.getByText(/Beta Testing/i)).toBeInTheDocument();
    const applyLink = screen.getByText(/Apply Now/i);
    expect(applyLink.closest("a")).toHaveAttribute("href", "/beta");
  });

  it("renders the 'Why Jarble' feature cards", () => {
    render(<Home />);
    expect(screen.getByText(/Any model, swappable anytime/)).toBeInTheDocument();
    expect(screen.getByText(/One agent, every platform/)).toBeInTheDocument();
    expect(screen.getByText(/Transparent pricing/)).toBeInTheDocument();
    expect(screen.getByText(/No code, no infrastructure/)).toBeInTheDocument();
  });

  it("renders the integrations search input", () => {
    render(<Home />);
    const searchInput = screen.getByPlaceholderText(/Search integrations/i);
    expect(searchInput).toBeInTheDocument();
  });
});
