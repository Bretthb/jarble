"use client";

import { memo, useCallback, type ReactNode } from "react";
import { Rnd } from "react-rnd";
import { Minus, X } from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { CanvasCard, CanvasAction } from "./types";

interface CanvasCardWrapperProps {
  card: CanvasCard;
  dispatch: React.Dispatch<CanvasAction>;
  focused?: boolean;
  streaming?: boolean;
  children: ReactNode;
}

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;
const TITLE_BAR_HEIGHT = 32;

function CanvasCardWrapperInner({ card, dispatch, focused, streaming, children }: CanvasCardWrapperProps) {
  const bringToFront = useCallback(() => {
    dispatch({ type: "BRING_TO_FRONT", id: card.id });
  }, [card.id, dispatch]);

  const handleClose = useCallback(() => {
    const el = document.getElementById(`card-${card.id}`);
    const iframe = el?.querySelector("iframe");
    if (iframe) iframe.srcdoc = "";
    dispatch({ type: "REMOVE_CARD", id: card.id });
  }, [card.id, dispatch]);

  const handleMinimize = useCallback(() => {
    if (card.minimized) {
      dispatch({ type: "RESTORE_CARD", id: card.id });
    } else {
      dispatch({ type: "MINIMIZE_CARD", id: card.id });
    }
  }, [card.id, card.minimized, dispatch]);

  const title = card.title || card.component.replace(/_/g, " ");

  return (
    <Rnd
      position={card.position}
      size={card.minimized ? { width: card.size.width, height: TITLE_BAR_HEIGHT } : card.size}
      minWidth={MIN_WIDTH}
      minHeight={card.minimized ? TITLE_BAR_HEIGHT : MIN_HEIGHT}
      style={{ zIndex: card.zIndex }}
      dragHandleClassName="canvas-card-drag-handle"
      enableResizing={!card.minimized}
      onDragStart={bringToFront}
      onDragStop={(_e, d) => {
        dispatch({ type: "MOVE_CARD", id: card.id, position: { x: d.x, y: d.y } });
      }}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        dispatch({
          type: "RESIZE_CARD",
          id: card.id,
          size: { width: ref.offsetWidth, height: ref.offsetHeight },
        });
        dispatch({ type: "MOVE_CARD", id: card.id, position });
      }}
      onMouseDown={bringToFront}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            id={`card-${card.id}`}
            className={`flex flex-col h-full rounded-xl border bg-background shadow-lg overflow-hidden transition-shadow ${
              streaming
                ? "border-primary/50 shadow-[0_0_12px_hsl(var(--primary)/0.25)] animate-pulse"
                : focused
                  ? "border-primary/60 ring-1 ring-primary/30"
                  : "border-border/60"
            }`}
          >
            {/* Title bar */}
            <div className="canvas-card-drag-handle flex items-center justify-between px-3 h-8 shrink-0 bg-secondary/50 border-b border-border/40 cursor-grab active:cursor-grabbing select-none">
              <span className="text-xs font-medium text-muted-foreground truncate capitalize">
                {title}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleMinimize}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title={card.minimized ? "Restore" : "Minimize"}
                  aria-label={card.minimized ? "Restore" : "Minimize"}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <button
                  onClick={handleClose}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Close"
                  aria-label="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Card content */}
            {!card.minimized && (
              <div className="flex-1 overflow-auto p-3 [&>*]:h-full">
                {children}
              </div>
            )}
          </div>
        </ContextMenu.Trigger>

        <CardContextMenu card={card} dispatch={dispatch} />
      </ContextMenu.Root>
    </Rnd>
  );
}

export default memo(CanvasCardWrapperInner);

// ── Context Menu ──────────────────────────────────────────────────────────────

function CardContextMenu({
  card,
  dispatch,
}: {
  card: CanvasCard;
  dispatch: React.Dispatch<CanvasAction>;
}) {
  const itemClass =
    "flex items-center gap-2 px-3 py-1.5 text-xs rounded cursor-default outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-foreground text-muted-foreground";
  const separatorClass = "h-px bg-border/40 my-1";

  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="min-w-[180px] rounded-lg border border-border/60 bg-background p-1 shadow-xl z-50">
        <ContextMenu.Item
          className={itemClass}
          onSelect={() => {
            const el = document.getElementById(`card-${card.id}`);
            const iframe = el?.querySelector("iframe");
            if (iframe) iframe.srcdoc = "";
            dispatch({ type: "REMOVE_CARD", id: card.id });
          }}
        >
          Close
        </ContextMenu.Item>

        <ContextMenu.Item
          className={itemClass}
          onSelect={() => {
            dispatch({
              type: card.minimized ? "RESTORE_CARD" : "MINIMIZE_CARD",
              id: card.id,
            });
          }}
        >
          {card.minimized ? "Restore" : "Minimize"}
        </ContextMenu.Item>

        <ContextMenu.Separator className={separatorClass} />

        <ContextMenu.Item
          className={itemClass}
          onSelect={() => dispatch({ type: "BRING_TO_FRONT", id: card.id })}
        >
          Bring to Front
        </ContextMenu.Item>

        <ContextMenu.Item
          className={itemClass}
          onSelect={() => dispatch({ type: "SEND_TO_BACK", id: card.id })}
        >
          Send to Back
        </ContextMenu.Item>

        <ContextMenu.Separator className={separatorClass} />

        <ContextMenu.Item
          className={itemClass}
          onSelect={() => {
            dispatch({
              type: "DUPLICATE_CARD",
              id: card.id,
              newId: `card-dup-${Date.now()}`,
              offset: { x: 30, y: 30 },
            });
          }}
        >
          Duplicate
        </ContextMenu.Item>

        <ContextMenu.Item
          className={itemClass}
          onSelect={() => dispatch({ type: "RESET_CARD_SIZE", id: card.id })}
        >
          Reset Size
        </ContextMenu.Item>

        <ContextMenu.Separator className={separatorClass} />

        <ContextMenu.Item
          className={itemClass}
          onSelect={() => {
            try {
              navigator.clipboard.writeText(JSON.stringify(card.props, null, 2));
            } catch {
              // Clipboard API may not be available
            }
          }}
        >
          Copy Props as JSON
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
