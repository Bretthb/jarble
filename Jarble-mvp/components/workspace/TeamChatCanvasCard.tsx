"use client";

/**
 * TeamChatCanvasCard - a compact, read-only canvas card for the Bot Teams
 * team-chat drawer.
 *
 * The individual deployment chat at /d/[id] renders UI blocks via the heavy
 * SimpleCanvasGrid (drag, resize, inline chat, drawing, context menus). That
 * surface is far too wide for the 384px team-chat side drawer, and most of
 * its interactions don't make sense when multiple specialists are producing
 * cards in quick succession.
 *
 * This component is intentionally minimal: it takes a single JarbleUIBlock
 * and its producer attribution, delegates rendering to the shared
 * CanvasRenderer (which already wraps its own error boundary, action
 * context, and component registry lookup), and adds a small attribution
 * header so the user can see WHICH specialist in the flow produced the
 * card.
 *
 * Cards are read-only in this surface — any onAction dispatches from
 * interactive components become no-ops inside CanvasRenderer's internal
 * CanvasActionProvider. To open a card for real interaction, the user
 * opens the source deployment page.
 */

import { memo } from "react";
import { X } from "lucide-react";
import CanvasRenderer, { type UIBlock } from "@/components/canvas/CanvasRenderer";

/** Origin of a team-chat canvas card — which phase of the flow emitted it. */
export type TeamCanvasCardOrigin = "entry" | "delegation" | "synthesis";

/** One canvas card surfaced inside the team chat drawer. */
export interface TeamCanvasCardData {
  /** Stable card id (reuses the JarbleUIBlock id from the wire event). */
  id: string;
  /** The UI block to render. */
  block: UIBlock;
  /** Deployment id of the specialist (or entry bot) that produced the block. */
  producerDeploymentId: string;
  /** Human-readable role label (e.g. "Researcher", "Designer", "Team member"). */
  producerRole: string;
  /** Delegation tool name if this came from a delegation call (e.g. "delegate_to_researcher"). */
  delegationToolName?: string;
  /** Which phase of the flow emitted this card. */
  origin: TeamCanvasCardOrigin;
}

// Shared with TeamChatAvatar and other team-chat components for consistent
// hue-based bot identification. See lib/teamChatUtils.ts.
import { producerHue } from "@/lib/teamChatUtils";

interface TeamChatCanvasCardProps {
  card: TeamCanvasCardData;
  onRemove?: (id: string) => void;
}

function TeamChatCanvasCardInner({ card, onRemove }: TeamChatCanvasCardProps) {
  const hue = producerHue(card.producerDeploymentId);
  const dotColor = `hsl(${hue}, 70%, 55%)`;

  const originLabel =
    card.origin === "entry"
      ? "Entry agent"
      : card.origin === "synthesis"
        ? "Synthesis"
        : card.producerRole;

  return (
    <div
      className="mt-2 rounded-lg border border-border/60 bg-background/80 overflow-hidden"
      data-testid="team-chat-canvas-card"
      data-producer-deployment-id={card.producerDeploymentId}
      data-origin={card.origin}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/40 bg-secondary/40">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          <span className="text-[10px] font-medium text-foreground/90 truncate">
            {originLabel}
          </span>
          {card.delegationToolName && card.origin === "delegation" && (
            <span className="text-[9px] text-muted-foreground/70 truncate">
              via {card.delegationToolName.replace(/^delegate_to_/, "")}
            </span>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(card.id)}
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Remove card"
            aria-label="Remove card"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="max-h-[280px] overflow-auto p-2 text-xs">
        <CanvasRenderer block={card.block} />
      </div>
    </div>
  );
}

/**
 * Memoized: re-renders only when the card data or remove handler changes.
 * The block prop is a stable reference from the SSE reducer, so cards in a
 * long conversation don't pay the cost of re-rendering on every new delta.
 */
export default memo(TeamChatCanvasCardInner);

// ── Artifact Preview Card ──────────────────────────────────────────────────
// Lightweight preview shown in team chat when a delegated bot produces UI
// components. Links to the entry bot's canvas at /d/[id] where the actual
// component renders.

import {
  BarChart3,
  Table2,
  Code2,
  Image as ImageIcon,
  Activity,
  LayoutGrid,
  Layers,
  ExternalLink,
} from "lucide-react";

const COMPONENT_ICONS: Record<string, typeof BarChart3> = {
  chart: BarChart3,
  bar_chart: BarChart3,
  line_chart: BarChart3,
  pie_chart: BarChart3,
  area_chart: BarChart3,
  data_table: Table2,
  table: Table2,
  sandbox: Code2,
  code_block: Code2,
  image: ImageIcon,
  image_gallery: ImageIcon,
  metric_card: Activity,
  stat_grid: LayoutGrid,
  stat_card: LayoutGrid,
  carousel: ImageIcon,
};

interface ArtifactPreviewCardProps {
  preview: {
    blockId: string;
    component: string;
    title: string;
    producerRole: string;
    producerDeploymentId: string;
    entryBotDeploymentId: string;
    delegationToolName?: string;
  };
}

export function ArtifactPreviewCard({ preview }: ArtifactPreviewCardProps) {
  const hue = producerHue(preview.producerDeploymentId);
  const Icon = COMPONENT_ICONS[preview.component] || Layers;

  return (
    <a
      href={`/d/${preview.entryBotDeploymentId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/60
                 bg-background/80 hover:bg-secondary/60 transition-colors group"
      data-testid="team-chat-artifact-preview"
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `hsl(${hue}, 70%, 55%, 0.15)` }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: `hsl(${hue}, 70%, 55%)` }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{preview.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {preview.producerRole}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground
                        transition-colors whitespace-nowrap shrink-0 flex items-center gap-1">
        View on canvas
        <ExternalLink className="w-3 h-3" />
      </span>
    </a>
  );
}
