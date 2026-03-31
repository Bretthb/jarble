import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock ReactFlow - it requires browser APIs not available in jsdom
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  Handle: () => <div />,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BaseEdge: () => <line />,
  getBezierPath: () => ["M0,0", 0, 0],
  useReactFlow: () => ({ fitView: vi.fn() }),
}));

// Mock dagre - return deterministic positions
vi.mock("dagre", () => {
  const nodes = new Map<string, { x: number; y: number }>();
  let idx = 0;
  return {
    __esModule: true,
    default: {
      graphlib: {
        Graph: vi.fn().mockImplementation(() => ({
          setDefaultEdgeLabel: vi.fn(),
          setGraph: vi.fn(),
          setNode: (id: string) => {
            nodes.set(id, { x: idx * 250, y: idx * 150 });
            idx++;
          },
          setEdge: vi.fn(),
          node: (id: string) => nodes.get(id) || { x: 0, y: 0 },
        })),
      },
      layout: vi.fn(),
    },
  };
});

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...rest }: { children?: React.ReactNode }) => (
      <div {...rest}>{children}</div>
    ),
  },
}));

// Mock ErrorBoundary
vi.mock("@/components/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ResourceMapView from "../ResourceMapView";

// ── Test data ──────────────────────────────────────────────────────────────

function makeDeployment(overrides: Partial<{
  id: string;
  name: string;
  status: string;
  runtime: string;
  description: string | null;
  llmMode: string;
  llmApiKeyId: string | null;
  llmApiKeySourceDeploymentId: string | null;
  llmCreditLimitDollars: number | null;
}> = {}) {
  return {
    id: overrides.id ?? "dep-1",
    name: overrides.name ?? "Test Bot",
    status: overrides.status ?? "running",
    runtime: overrides.runtime ?? "openclaw",
    description: overrides.description ?? null,
    llmMode: overrides.llmMode ?? "byok",
    llmApiKeyId: overrides.llmApiKeyId ?? null,
    llmApiKeySourceDeploymentId: overrides.llmApiKeySourceDeploymentId ?? null,
    llmCreditLimitDollars: overrides.llmCreditLimitDollars ?? null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ResourceMapView", () => {
  it("renders empty state when no deployments", () => {
    render(<ResourceMapView deployments={[]} />);
    expect(screen.getByText(/No resource connections yet/)).toBeInTheDocument();
  });

  it("renders empty state with a single deployment (no edges possible)", () => {
    render(<ResourceMapView deployments={[makeDeployment()]} />);
    expect(screen.getByText(/No resource connections yet/)).toBeInTheDocument();
  });

  it("renders empty state when two deployments have no connections", () => {
    render(
      <ResourceMapView
        deployments={[
          makeDeployment({ id: "dep-1" }),
          makeDeployment({ id: "dep-2" }),
        ]}
      />,
    );
    // No shared API keys, so no edges - should show empty state
    expect(screen.getByText(/No resource connections yet/)).toBeInTheDocument();
  });

  it("renders the graph when deployments share an API key", () => {
    render(
      <ResourceMapView
        deployments={[
          makeDeployment({ id: "dep-1", llmApiKeyId: "key-shared" }),
          makeDeployment({ id: "dep-2", llmApiKeyId: "key-shared" }),
        ]}
      />,
    );
    // Should render ReactFlow instead of empty state
    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.queryByText(/No resource connections yet/)).not.toBeInTheDocument();
  });

  it("renders the graph when a deployment sources API key from another", () => {
    render(
      <ResourceMapView
        deployments={[
          makeDeployment({ id: "dep-1" }),
          makeDeployment({ id: "dep-2", llmApiKeySourceDeploymentId: "dep-1" }),
        ]}
      />,
    );
    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
  });

  it("renders the empty state message with helpful guidance", () => {
    render(<ResourceMapView deployments={[]} />);
    expect(
      screen.getByText(/Deploy more bots to see how they connect/),
    ).toBeInTheDocument();
  });
});
