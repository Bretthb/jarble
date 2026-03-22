"use client";

import { memo, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Ungroup, Sparkles, MousePointerClick, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanvasCard } from "./types";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";

interface PageFullscreenOverlayProps {
  card: CanvasCard;
  onClose: () => void;
  onUngroup: () => void;
  onSelect?: () => void;
  onAsk?: () => void;
  onSave?: () => void;
}

function PageFullscreenOverlayInner({ card, onClose, onUngroup, onSelect, onAsk, onSave }: PageFullscreenOverlayProps) {
  // Escape key closes the overlay
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  const title = card.title || card.props?.title as string || "Page";
  const navigation = card.props?.navigation as { tabs?: string[]; activeTab?: string } | undefined;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="absolute inset-0 z-50 bg-background flex flex-col"
      >
        {/* Header bar */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border/60 bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[10px] font-semibold uppercase tracking-wider">
              Page
            </span>
            <h2 className="text-sm font-semibold truncate">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {onAsk && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { onAsk(); onClose(); }}
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="Ask the bot about this page"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Ask
              </Button>
            )}
            {onSelect && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelect}
                className={`h-7 gap-1.5 text-xs transition-colors ${
                  card.selected
                    ? "text-blue-400 bg-blue-500/10 hover:bg-blue-500/20"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={card.selected ? "Deselect — stop referencing in messages" : "Select — reference this page in your next message"}
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                {card.selected ? "Selected" : "Select"}
              </Button>
            )}
            {onSave && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSave}
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="Save to library"
              >
                <Bookmark className={`w-3.5 h-3.5 text-amber-400 ${card.savedName ? "fill-amber-400" : ""}`} />
                {card.savedName ? "Saved" : "Save"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onUngroup}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="Decompose into individual cards"
            >
              <Ungroup className="w-3.5 h-3.5" />
              Ungroup
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0"
              title="Close fullscreen (Escape)"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Navigation tabs (if present) */}
        {navigation?.tabs && navigation.tabs.length > 1 && (
          <div className="shrink-0 border-b border-border/40 px-4 flex gap-1 bg-secondary/10">
            {navigation.tabs.map((tab) => (
              <div
                key={tab}
                className={`px-3 py-2 text-xs font-medium cursor-default transition-colors ${
                  tab === navigation.activeTab
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-auto">
          <CanvasRenderer
            block={{
              id: card.id,
              component: card.component,
              props: card.props,
            }}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default memo(PageFullscreenOverlayInner);
