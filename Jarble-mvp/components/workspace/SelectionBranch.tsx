"use client";

/**
 * SelectionBranch — "+" branch prompt on selected cards.
 *
 * Shows a "+" button at the right edge of the selected card.
 * Clicking expands to a text input for branch prompts.
 */

import { useState, useRef, useCallback, memo } from "react";
import { Plus, SendHorizontal, X } from "lucide-react";
import type { CanvasCard } from "./types";

interface SelectionBranchProps {
  selectedCard: CanvasCard;
  zoom: number;
  onSendMessage: (text: string, displayText?: string) => Promise<void>;
  isChatStreaming: boolean;
}

function SelectionBranchInner({
  selectedCard,
  zoom,
  onSendMessage,
  isChatStreaming,
}: SelectionBranchProps) {
  const [showInput, setShowInput] = useState(false);
  const [branchPrompt, setBranchPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const text = branchPrompt.trim();
    if (!text || isChatStreaming) return;

    onSendMessage(
      `[EDITING ${selectedCard.id}] Branch: ${text}`,
      `Branch from card: ${text}`,
    );
    setBranchPrompt("");
    setShowInput(false);
  }, [branchPrompt, selectedCard.id, isChatStreaming, onSendMessage]);

  // Position at right edge, vertically centered
  const posX = (selectedCard.position.x + selectedCard.size.width) * zoom + 12;
  const posY = (selectedCard.position.y + selectedCard.size.height / 2) * zoom;

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{ left: posX, top: posY, transform: "translateY(-50%)" }}
    >
      {!showInput ? (
        <button
          onClick={() => {
            setShowInput(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground shadow-md hover:scale-110 transition-transform"
          title="Branch from this card"
        >
          <Plus className="w-4 h-4" />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background/95 backdrop-blur border border-border shadow-lg min-w-[200px]">
          <input
            ref={inputRef}
            type="text"
            value={branchPrompt}
            onChange={(e) => setBranchPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === "Escape") {
                setShowInput(false);
                setBranchPrompt("");
              }
            }}
            placeholder="Branch prompt..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 min-w-0"
            disabled={isChatStreaming}
          />
          <button
            onClick={handleSubmit}
            disabled={!branchPrompt.trim() || isChatStreaming}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <SendHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setShowInput(false);
              setBranchPrompt("");
            }}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(SelectionBranchInner);
