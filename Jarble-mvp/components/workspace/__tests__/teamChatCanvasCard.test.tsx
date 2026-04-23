/**
 * TeamChatCanvasCard - Component Tests
 *
 * Tests the compact, read-only canvas card used in the Bot Teams team-chat
 * drawer. Focuses on attribution header rendering (origin label, delegation
 * tool suffix, stable producer color), the optional remove button, and that
 * block rendering is delegated to CanvasRenderer.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Mock CanvasRenderer so we don't pull in the whole component registry /
// ComponentCatalogProvider / Sentry / autoFixProps chain. The stub just
// surfaces the block's component name so we can assert that TeamChatCanvasCard
// actually delegated rendering to it.
vi.mock("@/components/canvas/CanvasRenderer", () => ({
  __esModule: true,
  default: ({ block }: { block: { component: string; id: string } }) => (
    <div data-testid="canvas-renderer-stub" data-block-id={block.id}>
      {block.component}
    </div>
  ),
}));

// Mock lucide-react icons so we can locate them without loading all icons.
// Stubs mirror the icons imported by TeamChatCanvasCard.
vi.mock("lucide-react", () => {
  const makeIcon = (testId: string) =>
    ({ className }: { className?: string }) =>
      <span className={className} data-testid={testId} />;
  return {
    X: makeIcon("icon-x"),
    BarChart3: makeIcon("icon-bar-chart-3"),
    Table2: makeIcon("icon-table-2"),
    Code2: makeIcon("icon-code-2"),
    Image: makeIcon("icon-image"),
    Activity: makeIcon("icon-activity"),
    LayoutGrid: makeIcon("icon-layout-grid"),
    Layers: makeIcon("icon-layers"),
    ExternalLink: makeIcon("icon-external-link"),
  };
});

import TeamChatCanvasCard, {
  type TeamCanvasCardData,
} from "../TeamChatCanvasCard";

function makeCard(overrides: Partial<TeamCanvasCardData> = {}): TeamCanvasCardData {
  return {
    id: "card-1",
    block: {
      id: "block-1",
      component: "card",
      props: { title: "Hello" },
    },
    producerDeploymentId: "dep-abc-123",
    producerRole: "Researcher",
    origin: "delegation",
    ...overrides,
  };
}

describe("TeamChatCanvasCard", () => {
  describe("origin label", () => {
    it("renders producerRole for origin=delegation", () => {
      render(<TeamChatCanvasCard card={makeCard({ origin: "delegation", producerRole: "Designer" })} />);
      expect(screen.getByText("Designer")).toBeInTheDocument();
    });

    it("renders 'Entry agent' for origin=entry", () => {
      render(<TeamChatCanvasCard card={makeCard({ origin: "entry", producerRole: "Anything" })} />);
      expect(screen.getByText("Entry agent")).toBeInTheDocument();
      expect(screen.queryByText("Anything")).not.toBeInTheDocument();
    });

    it("renders 'Synthesis' for origin=synthesis", () => {
      render(<TeamChatCanvasCard card={makeCard({ origin: "synthesis", producerRole: "Anything" })} />);
      expect(screen.getByText("Synthesis")).toBeInTheDocument();
      expect(screen.queryByText("Anything")).not.toBeInTheDocument();
    });
  });

  describe("delegation tool suffix", () => {
    it("renders 'via researcher' when tool prefix is delegate_to_ and origin is delegation", () => {
      render(
        <TeamChatCanvasCard
          card={makeCard({
            origin: "delegation",
            delegationToolName: "delegate_to_researcher",
          })}
        />
      );
      expect(screen.getByText("via researcher")).toBeInTheDocument();
    });

    it("does NOT render tool name when origin is entry (even if delegationToolName set)", () => {
      render(
        <TeamChatCanvasCard
          card={makeCard({
            origin: "entry",
            delegationToolName: "delegate_to_researcher",
          })}
        />
      );
      expect(screen.queryByText(/^via /)).not.toBeInTheDocument();
    });

    it("does NOT render tool name when origin is synthesis (even if delegationToolName set)", () => {
      render(
        <TeamChatCanvasCard
          card={makeCard({
            origin: "synthesis",
            delegationToolName: "delegate_to_researcher",
          })}
        />
      );
      expect(screen.queryByText(/^via /)).not.toBeInTheDocument();
    });
  });

  describe("remove button", () => {
    it("does not render remove button when onRemove is not provided", () => {
      render(<TeamChatCanvasCard card={makeCard()} />);
      expect(screen.queryByRole("button", { name: /remove card/i })).not.toBeInTheDocument();
    });

    it("renders remove button when onRemove is provided and calls it with card.id on click", () => {
      const onRemove = vi.fn();
      render(<TeamChatCanvasCard card={makeCard({ id: "card-xyz" })} onRemove={onRemove} />);
      const btn = screen.getByRole("button", { name: /remove card/i });
      fireEvent.click(btn);
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith("card-xyz");
    });
  });

  describe("producer attribution dot color", () => {
    function getDotBg(container: HTMLElement): string | undefined {
      const dot = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
      return dot?.style.backgroundColor;
    }

    it("is stable for the same producerDeploymentId across renders", () => {
      const { container: a } = render(
        <TeamChatCanvasCard card={makeCard({ producerDeploymentId: "dep-same" })} />
      );
      const { container: b } = render(
        <TeamChatCanvasCard card={makeCard({ id: "card-2", producerDeploymentId: "dep-same" })} />
      );
      expect(getDotBg(a)).toBeTruthy();
      expect(getDotBg(a)).toBe(getDotBg(b));
    });

    it("differs for two producerDeploymentIds that hash to distinct hues", () => {
      // dep-alpha -> hue 308, dep-beta -> hue 258 (verified against producerHue).
      const { container: a } = render(
        <TeamChatCanvasCard card={makeCard({ producerDeploymentId: "dep-alpha" })} />
      );
      const { container: b } = render(
        <TeamChatCanvasCard card={makeCard({ id: "card-2", producerDeploymentId: "dep-beta" })} />
      );
      expect(getDotBg(a)).not.toBe(getDotBg(b));
    });
  });

  describe("CanvasRenderer delegation", () => {
    it("renders CanvasRenderer with the provided block", () => {
      render(
        <TeamChatCanvasCard
          card={makeCard({
            block: { id: "block-42", component: "chart", props: { type: "bar" } },
          })}
        />
      );
      const stub = screen.getByTestId("canvas-renderer-stub");
      expect(stub).toBeInTheDocument();
      expect(stub).toHaveAttribute("data-block-id", "block-42");
      expect(stub).toHaveTextContent("chart");
    });
  });

  describe("data attributes", () => {
    it("has data-testid, data-producer-deployment-id, and data-origin", () => {
      render(
        <TeamChatCanvasCard
          card={makeCard({ producerDeploymentId: "dep-abc-123", origin: "synthesis" })}
        />
      );
      const root = screen.getByTestId("team-chat-canvas-card");
      expect(root).toHaveAttribute("data-producer-deployment-id", "dep-abc-123");
      expect(root).toHaveAttribute("data-origin", "synthesis");
    });
  });
});
