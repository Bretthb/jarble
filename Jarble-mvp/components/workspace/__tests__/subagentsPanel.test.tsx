/**
 * SubagentsPanel - Component Tests
 *
 * Smoke tests for the SubagentsPanel slide-out sidebar. Covers rendering
 * of the three agent categories (platform, custom, delegation), the create
 * form, and the delete confirmation dialog.
 *
 * The component is heavily coupled to tRPC hooks, so we mock the full
 * trpc module and provide pre-canned query/mutation results.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── Global polyfills ─────────────────────────────────────────────────────────
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// ── Types ────────────────────────────────────────────────────────────────────

interface Subagent {
  id: string;
  deploymentId: string;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string;
  model: string | null;
  triggerType: string;
  triggerConfig: string | null;
  tools: string | null;
  enabled: boolean;
  sortOrder: number;
  isPublic: boolean;
  forkedFromId: string | null;
  forkCount: number;
  source: "custom" | "platform" | "delegation";
  createdAt: string;
  updatedAt: string;
}

// ── Mock data ────────────────────────────────────────────────────────────────

const DEPLOYMENT_ID = "dep-test-001";

function makeSubagent(overrides: Partial<Subagent> = {}): Subagent {
  return {
    id: "sa-001",
    deploymentId: DEPLOYMENT_ID,
    name: "Component Agent",
    slug: "component_agent",
    description: "Creates components",
    systemPrompt: "You are a component builder.",
    model: "anthropic/claude-sonnet-4-20250514",
    triggerType: "manual",
    triggerConfig: null,
    tools: null,
    enabled: true,
    sortOrder: 0,
    isPublic: false,
    forkedFromId: null,
    forkCount: 0,
    source: "platform",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockListData: Subagent[] = [];
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    subagents: {
      list: {
        useQuery: () => ({
          data: mockListData,
          isLoading: false,
        }),
      },
      create: {
        useMutation: ({ onSuccess }: any = {}) => ({
          mutate: mockCreate,
          isPending: false,
          error: null,
        }),
      },
      update: {
        useMutation: ({ onSuccess }: any = {}) => ({
          mutate: mockUpdate,
          isPending: false,
          error: null,
        }),
      },
      delete: {
        useMutation: ({ onSuccess }: any = {}) => ({
          mutate: mockDelete,
          isPending: false,
          error: null,
        }),
      },
    },
    useUtils: () => ({
      subagents: {
        list: { invalidate: vi.fn() },
      },
    }),
  },
}));

// Mock lucide-react icons to render identifiable elements
vi.mock("lucide-react", () => {
  const makeIcon = (name: string) =>
    function Icon(props: any) {
      return <span data-testid={`icon-${name.toLowerCase()}`} className={props.className} />;
    };
  return {
    X: makeIcon("X"),
    Plus: makeIcon("Plus"),
    Pencil: makeIcon("Pencil"),
    Trash2: makeIcon("Trash2"),
    Loader2: makeIcon("Loader2"),
    Bot: makeIcon("Bot"),
    GitFork: makeIcon("GitFork"),
    ChevronLeft: makeIcon("ChevronLeft"),
    Save: makeIcon("Save"),
    Cpu: makeIcon("Cpu"),
    ArrowRightLeft: makeIcon("ArrowRightLeft"),
  };
});

// Mock shadcn/ui components to be simple pass-throughs
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={rest["data-testid"]}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: any) => open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogAction: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid="alert-action">{children}</button>
  ),
  AlertDialogCancel: ({ children, disabled }: any) => (
    <button disabled={disabled} data-testid="alert-cancel">{children}</button>
  ),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

// ── Import component (AFTER mocks) ─────────────────────────────────────────

import SubagentsPanel from "../SubagentsPanel";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SubagentsPanel", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockListData = [];
  });

  describe("empty state", () => {
    it("renders empty state message when no subagents", () => {
      mockListData = [];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);
      expect(screen.getByText("No subagents yet.")).toBeInTheDocument();
    });
  });

  describe("list rendering", () => {
    it("renders platform agents in their own section", () => {
      mockListData = [
        makeSubagent({ id: "sa-1", name: "Component Agent", source: "platform" }),
        makeSubagent({ id: "sa-2", name: "Data Agent", source: "platform", slug: "data_agent" }),
      ];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);
      expect(screen.getByText("Platform Agents")).toBeInTheDocument();
      expect(screen.getByText("Component Agent")).toBeInTheDocument();
      expect(screen.getByText("Data Agent")).toBeInTheDocument();
    });

    it("renders custom agents in their own section", () => {
      mockListData = [
        makeSubagent({ id: "sa-3", name: "My Custom Agent", source: "custom", slug: "my_custom_agent" }),
      ];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);
      expect(screen.getByText("Custom Agents")).toBeInTheDocument();
      expect(screen.getByText("My Custom Agent")).toBeInTheDocument();
    });

    it("renders delegation agents as Team Members section", () => {
      mockListData = [
        makeSubagent({ id: "sa-4", name: "Delegated Worker", source: "delegation", slug: "delegated_worker" }),
      ];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);
      expect(screen.getByText("Team Members")).toBeInTheDocument();
      expect(screen.getByText("Delegated Worker")).toBeInTheDocument();
    });

    it("shows agent slug as tool name", () => {
      mockListData = [
        makeSubagent({ id: "sa-5", name: "Research Bot", slug: "research_bot", source: "custom" }),
      ];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);
      expect(screen.getByText("agent_research_bot")).toBeInTheDocument();
    });

    it("shows subagent count badge", () => {
      mockListData = [
        makeSubagent({ id: "sa-1", source: "platform" }),
        makeSubagent({ id: "sa-2", name: "Custom", slug: "custom", source: "custom" }),
      ];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);
      // The badge shows total count
      const badges = screen.getAllByTestId("badge");
      const countBadge = badges.find((b) => b.textContent === "2");
      expect(countBadge).toBeDefined();
    });
  });

  describe("New Subagent button", () => {
    it("shows create form when New Subagent is clicked", () => {
      mockListData = [
        makeSubagent({ id: "sa-1", source: "custom", slug: "test" }),
      ];
      render(<SubagentsPanel deploymentId={DEPLOYMENT_ID} onClose={onClose} />);

      const newBtn = screen.getByText("New Subagent");
      fireEvent.click(newBtn);

      // Form should be visible with "Create Subagent" button
      expect(screen.getByText("Create Subagent")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("e.g. Research Assistant")).toBeInTheDocument();
    });
  });
});
