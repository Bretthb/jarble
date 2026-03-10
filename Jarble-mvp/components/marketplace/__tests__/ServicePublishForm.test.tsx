import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServicePublishForm } from "../ServicePublishForm";

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

const mockMutateAsync = vi.fn();
let mockMutationError: Error | null = null;
let mockIsPending = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    services: {
      publish: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          error: mockMutationError,
          isPending: mockIsPending,
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

vi.mock("@/components/marketplace/DeploymentComponentBrowser", () => ({
  default: ({ deploymentId, selectedIds, onSelectionChange }: any) => (
    <div data-testid="component-browser">
      <button onClick={() => onSelectionChange([...selectedIds, "comp-1"])}>
        Add Component
      </button>
    </div>
  ),
}));

vi.mock("@/components/marketplace/DeploymentSkillBrowser", () => ({
  default: ({ deploymentId, selectedIds, onSelectionChange }: any) => (
    <div data-testid="skill-browser">
      <button onClick={() => onSelectionChange([...selectedIds, "skill-1"])}>
        Add Skill
      </button>
    </div>
  ),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ServicePublishForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationError = null;
    mockIsPending = false;
    mockUseAuth0.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      loginWithRedirect: mockLoginWithRedirect,
    });
  });

  describe("unauthenticated state", () => {
    it("shows sign in prompt when not authenticated", () => {
      mockUseAuth0.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        loginWithRedirect: mockLoginWithRedirect,
      });
      render(<ServicePublishForm />);
      expect(screen.getByText(/Sign in to publish/)).toBeDefined();
    });

    it("calls loginWithRedirect on sign in click", () => {
      mockUseAuth0.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        loginWithRedirect: mockLoginWithRedirect,
      });
      render(<ServicePublishForm />);
      fireEvent.click(screen.getByText("Sign in"));
      expect(mockLoginWithRedirect).toHaveBeenCalled();
    });
  });

  describe("form rendering", () => {
    it("renders form title", () => {
      render(<ServicePublishForm />);
      expect(screen.getByText("Publish a Service")).toBeDefined();
    });

    it("renders name input", () => {
      render(<ServicePublishForm />);
      expect(screen.getByLabelText("Service Name (slug)")).toBeDefined();
    });

    it("renders display name input", () => {
      render(<ServicePublishForm />);
      expect(screen.getByLabelText("Display Name")).toBeDefined();
    });

    it("renders description textarea", () => {
      render(<ServicePublishForm />);
      expect(screen.getByLabelText("Description")).toBeDefined();
    });

    it("renders hosting model select", () => {
      render(<ServicePublishForm />);
      expect(screen.getByText("Hosting Model")).toBeDefined();
    });

    it("renders instruction snippet textarea", () => {
      render(<ServicePublishForm />);
      expect(screen.getByLabelText("Bot Instruction Snippet (optional)")).toBeDefined();
    });

    it("renders pricing model select", () => {
      render(<ServicePublishForm />);
      expect(screen.getByText("Pricing Model")).toBeDefined();
    });

    it("renders submit button", () => {
      render(<ServicePublishForm />);
      expect(screen.getByText("Submit for Review")).toBeDefined();
    });

    it("renders deployment picker", () => {
      render(<ServicePublishForm />);
      expect(screen.getByTestId("deployment-picker")).toBeDefined();
    });
  });

  describe("name sanitization", () => {
    it("converts name to lowercase with hyphens", () => {
      render(<ServicePublishForm />);
      const input = screen.getByLabelText("Service Name (slug)") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "My Service Name!" } });
      expect(input.value).toBe("my-service-name-");
    });
  });

  describe("submit validation", () => {
    it("disables submit when name is empty", () => {
      render(<ServicePublishForm />);
      const submitBtn = screen.getByText("Submit for Review").closest("button");
      expect(submitBtn?.disabled).toBe(true);
    });

    it("disables submit when no components or skills selected", () => {
      render(<ServicePublishForm />);
      const nameInput = screen.getByLabelText("Service Name (slug)");
      const displayInput = screen.getByLabelText("Display Name");
      fireEvent.change(nameInput, { target: { value: "test" } });
      fireEvent.change(displayInput, { target: { value: "Test" } });
      const submitBtn = screen.getByText("Submit for Review").closest("button");
      expect(submitBtn?.disabled).toBe(true);
    });
  });

  describe("manual component/skill ID input", () => {
    it("shows manual component ID input when no deployment selected", () => {
      render(<ServicePublishForm />);
      expect(screen.getByPlaceholderText("Component ID")).toBeDefined();
    });

    it("shows manual skill ID input when no deployment selected", () => {
      render(<ServicePublishForm />);
      expect(screen.getByPlaceholderText("Skill ID")).toBeDefined();
    });
  });

  describe("deployment browser", () => {
    it("shows component browser when deployment selected", () => {
      render(<ServicePublishForm />);
      // Select a deployment
      fireEvent.click(screen.getByTestId("deployment-picker"));
      expect(screen.getByTestId("component-browser")).toBeDefined();
    });

    it("shows skill browser when deployment selected", () => {
      render(<ServicePublishForm />);
      fireEvent.click(screen.getByTestId("deployment-picker"));
      expect(screen.getByTestId("skill-browser")).toBeDefined();
    });
  });

  describe("error display", () => {
    it("shows mutation error message", () => {
      mockMutationError = new Error("Duplicate name");
      render(<ServicePublishForm />);
      expect(screen.getByText("Duplicate name")).toBeDefined();
    });
  });

  describe("pending state", () => {
    it("shows Submitting text when pending", () => {
      mockIsPending = true;
      render(<ServicePublishForm />);
      expect(screen.getByText("Submitting...")).toBeDefined();
    });
  });

  describe("success state", () => {
    it("shows success message after submit", async () => {
      mockMutateAsync.mockResolvedValue({});
      render(<ServicePublishForm />);

      // Fill required fields
      const nameInput = screen.getByLabelText("Service Name (slug)");
      const displayInput = screen.getByLabelText("Display Name");
      fireEvent.change(nameInput, { target: { value: "test-svc" } });
      fireEvent.change(displayInput, { target: { value: "Test Svc" } });

      // Select deployment and add component
      fireEvent.click(screen.getByTestId("deployment-picker"));
      fireEvent.click(screen.getByText("Add Component"));

      // Submit
      const submitBtn = screen.getByText("Submit for Review").closest("button")!;
      fireEvent.click(submitBtn);

      // Wait for async submit
      await vi.waitFor(() => {
        expect(screen.getByText("Service Submitted")).toBeDefined();
      });
    });

    it("shows Publish another button after success", async () => {
      mockMutateAsync.mockResolvedValue({});
      render(<ServicePublishForm />);

      const nameInput = screen.getByLabelText("Service Name (slug)");
      const displayInput = screen.getByLabelText("Display Name");
      fireEvent.change(nameInput, { target: { value: "test-svc" } });
      fireEvent.change(displayInput, { target: { value: "Test Svc" } });

      fireEvent.click(screen.getByTestId("deployment-picker"));
      fireEvent.click(screen.getByText("Add Component"));
      fireEvent.click(screen.getByText("Submit for Review").closest("button")!);

      await vi.waitFor(() => {
        expect(screen.getByText("Publish another")).toBeDefined();
      });
    });
  });
});
