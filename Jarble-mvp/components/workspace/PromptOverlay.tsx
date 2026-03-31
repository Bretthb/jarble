"use client";

/**
 * PromptOverlay - Cmd+K floating prompt for the freeform canvas.
 *
 * Bottom-center when cards exist; vertically centered when empty.
 */

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { SendHorizontal, X } from "lucide-react";

interface PromptOverlayProps {
  hasCards: boolean;
  onSendMessage: (text: string, displayText?: string) => Promise<void>;
  isChatStreaming: boolean;
}

function PromptOverlayInner({
  hasCards,
  onSendMessage,
  isChatStreaming,
}: PromptOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Toggle with Cmd+K / Ctrl+K
  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      setVisible((v) => !v);
    },
    { enableOnFormTags: true },
  );

  // Focus input when visible
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text || isChatStreaming) return;
    onSendMessage(text);
    setValue("");
    setVisible(false);
  }, [value, isChatStreaming, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setVisible(false);
        setValue("");
      }
    },
    [handleSubmit],
  );

  // Show hint button when not visible
  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur border border-border/60 shadow-md text-xs text-muted-foreground hover:text-foreground hover:bg-background/95 transition-all pointer-events-auto"
      >
        <span className="font-mono text-[10px] bg-secondary/80 px-1.5 py-0.5 rounded">
          {isMac ? "\u2318K" : "Ctrl+K"}
        </span>
        <span>Prompt</span>
      </button>
    );
  }

  return (
    <div
      className={`absolute z-50 left-1/2 -translate-x-1/2 pointer-events-auto ${
        hasCards ? "bottom-6" : "top-1/2 -translate-y-1/2"
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-background/95 backdrop-blur border border-border shadow-lg min-w-[320px] max-w-[500px]">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          disabled={isChatStreaming}
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isChatStreaming}
          className="p-1 rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <SendHorizontal className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setVisible(false);
            setValue("");
          }}
          className="p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default memo(PromptOverlayInner);
